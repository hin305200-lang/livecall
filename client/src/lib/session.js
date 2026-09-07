import { createPeer, disableAuxHangup, openPeer } from "./peer.js";
import { peerIdForRoom } from "./rooms.js";

const JOIN_DELAY_MS = 1200;
const STREAM_WAIT_MS = 25000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Claim the host PeerJS id during device setup so guests can find the room.
 * Keep the latest incoming call until the host joins, then answer it.
 */
export function createHostLobby(roomId) {
  let destroyed = false;
  let peer = null;
  let handler = null;
  let pending = null;

  const ready = (async () => {
    let lastErr;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (destroyed) return;
      const opened = openPeer(peerIdForRoom(roomId));
      peer = opened.peer;
      peer.on("disconnected", () => {
        if (!destroyed) peer.reconnect();
      });
      peer.on("call", (call) => {
        disableAuxHangup(call);
        if (destroyed) {
          try {
            call.close();
          } catch {
            /* ignore */
          }
          return;
        }
        if (handler) {
          handler(call);
          return;
        }
        if (pending && pending !== call) {
          try {
            pending.close();
          } catch {
            /* ignore */
          }
        }
        pending = call;
      });
      try {
        await opened.ready;
        return;
      } catch (err) {
        lastErr = err;
        peer = null;
        if (attempt < 7) await delay(err?.type === "unavailable-id" ? 1500 : 800);
      }
    }
    throw lastErr;
  })();

  return {
    ready,
    getPeer() {
      return peer;
    },
    onCall(fn) {
      handler = fn;
      if (pending) {
        const call = pending;
        pending = null;
        fn(call);
      }
    },
    destroy() {
      destroyed = true;
      handler = null;
      pending = null;
      try {
        peer?.destroy();
      } catch {
        /* ignore */
      }
      peer = null;
    },
  };
}

/**
 * 1:1 call. Signaling uses the PeerJS broker (WebSocket).
 * Video uses one MediaConnection, with TURN when a direct path is blocked.
 */
export function startSession({
  isHost,
  roomId,
  localStream,
  displayName,
  lobby,
  onStatus,
  onError,
  onPeerName,
  onRemoteStream,
  onConnectionState,
}) {
  if (!localStream) {
    onStatus("error");
    onError("Camera is not ready. Go back and try again.");
    return {
      async replaceTrack() {},
      destroy() {},
    };
  }

  let destroyed = false;
  let peer;
  let mediaCall;
  let inCall = false;
  let guestLoop = true;
  const failAttempt = [];

  function closeCall() {
    const call = mediaCall;
    mediaCall = null;
    if (!call) return;
    try {
      call.close();
    } catch {
      /* ignore */
    }
  }

  function dropToWaitingOrRetry() {
    inCall = false;
    onRemoteStream(null);
    onPeerName("");
    onConnectionState("");
    mediaCall = null;
    if (isHost) {
      onStatus("waiting");
      onError("");
      return;
    }
    onStatus("connecting");
    onError("Reconnecting…");
  }

  function watchPc(call) {
    const started = Date.now();
    const timer = setInterval(() => {
      if (destroyed || mediaCall !== call) {
        clearInterval(timer);
        return;
      }
      const pc = call.peerConnection;
      if (!pc) {
        if (Date.now() - started > 15000) clearInterval(timer);
        return;
      }
      clearInterval(timer);
      const onState = () => {
        if (destroyed || mediaCall !== call) return;
        const ice = pc.iceConnectionState;
        const conn = pc.connectionState;
        onConnectionState(conn || ice || "");
        if (conn === "connected" || ice === "connected" || ice === "completed") {
          onStatus("in-call");
          onError("");
        }
      };
      pc.addEventListener("connectionstatechange", onState);
      pc.addEventListener("iceconnectionstatechange", onState);
    }, 200);
  }

  function bindCall(call) {
    disableAuxHangup(call);
    mediaCall = call;
    onPeerName(call.metadata?.name || (isHost ? "Guest" : "Host"));

    const onStream = (stream) => {
      if (destroyed || mediaCall !== call || !stream) return;
      const live = stream.getTracks().some((t) => t.readyState === "live");
      if (!live) return;
      inCall = true;
      onRemoteStream(stream);
      onStatus("in-call");
      onError("");
    };

    call.on("stream", onStream);
    if (call.remoteStream) onStream(call.remoteStream);

    call.on("error", () => {
      if (destroyed || mediaCall !== call) return;
      if (!inCall) closeCall();
    });

    call.on("close", () => {
      if (destroyed || mediaCall !== call) return;
      dropToWaitingOrRetry();
    });

    watchPc(call);
  }

  function acceptCall(call) {
    disableAuxHangup(call);
    if (destroyed) {
      try {
        call.close();
      } catch {
        /* ignore */
      }
      return;
    }
    if (inCall) {
      try {
        call.close();
      } catch {
        /* ignore */
      }
      return;
    }
    if (mediaCall && mediaCall !== call) closeCall();
    bindCall(call);
    try {
      call.answer(localStream);
      onStatus("connecting");
    } catch (err) {
      console.warn("Could not answer call", err);
      closeCall();
    }
  }

  async function runHost() {
    if (lobby) {
      await lobby.ready;
      if (destroyed) return;
      peer = lobby.getPeer();
      if (!peer) throw new Error("Could not open this room. Create a new one.");
      lobby.onCall(acceptCall);
      onStatus("waiting");
      return;
    }

    let lastErr;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (destroyed) return;
      const opened = openPeer(peerIdForRoom(roomId));
      peer = opened.peer;
      peer.on("disconnected", () => {
        if (!destroyed) peer.reconnect();
      });
      peer.on("call", acceptCall);
      try {
        await opened.ready;
        onStatus("waiting");
        return;
      } catch (err) {
        lastErr = err;
        peer = null;
        if (attempt < 7) await delay(err?.type === "unavailable-id" ? 1500 : 800);
      }
    }
    throw lastErr;
  }

  function waitForRemoteStream(call) {
    return new Promise((resolve, reject) => {
      if (call.remoteStream?.getTracks().some((t) => t.readyState === "live")) {
        resolve(call.remoteStream);
        return;
      }
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(() => finish(reject, new Error("timeout")), STREAM_WAIT_MS);
      call.once("stream", (stream) => {
        if (stream?.getTracks().some((t) => t.readyState === "live")) finish(resolve, stream);
      });
      call.once("error", (err) => finish(reject, err));
      call.once("close", () => finish(reject, new Error("closed")));
    });
  }

  function tryCall(hostId) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        failAttempt.length = 0;
        fn(value);
      };

      failAttempt.length = 0;
      const call = peer.call(hostId, localStream, {
        metadata: { name: displayName },
      });
      if (!call) {
        finish(reject, new Error("unavailable"));
        return;
      }
      disableAuxHangup(call);
      bindCall(call);

      failAttempt.push((err) => {
        try {
          call.close();
        } catch {
          /* ignore */
        }
        finish(reject, err);
      });

      waitForRemoteStream(call)
        .then((stream) => finish(resolve, stream))
        .catch((err) => finish(reject, err));
    });
  }

  function waitUntilDropped() {
    return new Promise((resolve) => {
      const tick = () => {
        if (destroyed || !inCall || !mediaCall) resolve();
        else setTimeout(tick, 400);
      };
      tick();
    });
  }

  async function runGuest() {
    peer = await createPeer();
    if (destroyed) {
      peer.destroy();
      return;
    }
    peer.on("disconnected", () => {
      if (!destroyed) peer.reconnect();
    });

    const hostId = peerIdForRoom(roomId);
    onStatus("connecting");
    onError("");
    guestLoop = true;

    peer.on("error", (err) => {
      if (err?.type === "peer-unavailable") {
        failAttempt.forEach((fn) => fn(err));
        failAttempt.length = 0;
      }
    });

    while (!destroyed && guestLoop) {
      try {
        await tryCall(hostId);
        onError("");
        await waitUntilDropped();
        if (destroyed) return;
        onStatus("connecting");
        onError("Reconnecting…");
        await delay(JOIN_DELAY_MS);
      } catch {
        if (destroyed || !guestLoop) return;
        closeCall();
        inCall = false;
        onRemoteStream(null);
        onStatus("connecting");
        onError("Waiting for the host to join the call…");
        await delay(JOIN_DELAY_MS);
      }
    }
  }

  const started = isHost ? runHost() : runGuest();
  started.catch((err) => {
    if (destroyed) return;
    onStatus("error");
    if (err?.type === "unavailable-id") {
      onError("This room is already in use. Create a new room.");
      return;
    }
    onError(err?.message || "Could not start the call.");
  });

  return {
    async replaceTrack(kind, track) {
      const pc = mediaCall?.peerConnection;
      const sender = pc?.getSenders().find((s) => s.track?.kind === kind);
      if (sender) await sender.replaceTrack(track);
    },
    destroy() {
      destroyed = true;
      guestLoop = false;
      closeCall();
      if (!lobby) {
        try {
          peer?.destroy();
        } catch {
          /* ignore */
        }
      }
    },
  };
}
