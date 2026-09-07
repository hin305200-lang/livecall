import { createPeer, openPeer } from "./peer.js";
import { peerIdForRoom } from "./rooms.js";

const JOIN_DELAY_MS = 1500;
const STREAM_WAIT_MS = 20000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Claim the host PeerJS id during device setup so guests can find the room.
 * Incoming calls are ignored until the host is on the call screen, so the
 * guest retries with a fresh offer instead of a stale one.
 */
export function createHostLobby(roomId) {
  let destroyed = false;
  let peer = null;
  let handler = null;

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
        if (destroyed) {
          try {
            call.close();
          } catch {
            /* ignore */
          }
          return;
        }
        if (handler) handler(call);
        else {
          try {
            call.close();
          } catch {
            /* ignore */
          }
        }
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
    },
    destroy() {
      destroyed = true;
      handler = null;
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
 * 1:1 call. PeerJS broker carries SDP/ICE over WebSocket.
 * Media uses a single PeerJS MediaConnection (with TURN when needed).
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
  let guestLoop = false;
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

  function resetRemote() {
    inCall = false;
    onRemoteStream(null);
    onPeerName("");
    onConnectionState("");
  }

  function handlePeerLeft() {
    closeCall();
    resetRemote();
    if (isHost) {
      onStatus("waiting");
      onError("");
      return;
    }
    onStatus("error");
    onError("The other person left.");
    guestLoop = false;
  }

  function watchRemote(stream) {
    stream.getTracks().forEach((track) => {
      track.onended = () => {
        if (destroyed || !inCall) return;
        if (stream.getTracks().every((t) => t.readyState === "ended")) {
          handlePeerLeft();
        }
      };
    });
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
        if (Date.now() - started > 12000) clearInterval(timer);
        return;
      }
      clearInterval(timer);
      const onState = () => {
        if (destroyed || mediaCall !== call) return;
        const state = pc.connectionState || pc.iceConnectionState || "";
        onConnectionState(pc.connectionState || state);
        if (state === "connected" || state === "completed") {
          if (inCall) {
            onStatus("in-call");
            onError("");
          }
        }
        if (state === "failed") {
          if (inCall) handlePeerLeft();
          else onError("Still connecting…");
        }
        if (state === "disconnected") onStatus("reconnecting");
      };
      pc.addEventListener("connectionstatechange", onState);
      pc.addEventListener("iceconnectionstatechange", onState);
    }, 250);
  }

  function preventAuxClose(call) {
    const started = Date.now();
    const timer = setInterval(() => {
      if (destroyed || mediaCall !== call || Date.now() - started > 20000) {
        clearInterval(timer);
        return;
      }
      const dc = call.dataChannel;
      if (!dc) return;
      dc.onclose = () => {};
      clearInterval(timer);
    }, 50);
  }

  function bindCall(call) {
    mediaCall = call;
    preventAuxClose(call);
    const name = call.metadata?.name;
    onPeerName(name || (isHost ? "Guest" : "Host"));

    const onStream = (stream) => {
      if (destroyed || mediaCall !== call || !stream) return;
      inCall = true;
      onRemoteStream(stream);
      onStatus("in-call");
      onError("");
      watchRemote(stream);
    };

    call.on("stream", onStream);
    if (call.remoteStream) onStream(call.remoteStream);

    call.on("error", (err) => {
      if (destroyed || mediaCall !== call) return;
      console.warn("Call error", err);
      if (!inCall) {
        closeCall();
        return;
      }
      handlePeerLeft();
    });

    // PeerJS closes the whole call when its auxiliary data channel drops.
    // That is not the same as the other person hanging up.
    call.on("close", () => {
      if (destroyed || mediaCall !== call) return;
      mediaCall = null;
      if (!inCall) return;
      const stillLive = call.remoteStream?.getTracks().some((t) => t.readyState === "live");
      if (stillLive) return;
      handlePeerLeft();
    });

    watchPc(call);
  }

  function acceptCall(call) {
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
      if (call.remoteStream) {
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
      call.once("stream", (stream) => finish(resolve, stream));
      call.once("error", (err) => finish(reject, err));
      call.once("close", () => {
        if (!inCall) finish(reject, new Error("closed"));
      });
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
        .catch((err) => {
          try {
            call.close();
          } catch {
            /* ignore */
          }
          finish(reject, err);
        });
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

    while (!destroyed && guestLoop && !inCall) {
      try {
        await tryCall(hostId);
        onError("");
        return;
      } catch {
        if (destroyed || !guestLoop || inCall) return;
        closeCall();
        resetRemote();
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
