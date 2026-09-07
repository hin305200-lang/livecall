import {
  createPeer,
  forceCloseCall,
  keepCallMedia,
  openPeer,
  shieldCall,
} from "./peer.js";
import { peerIdForRoom } from "./rooms.js";

const JOIN_DELAY_MS = 1200;
const STREAM_WAIT_MS = 30000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasLiveMedia(stream) {
  return Boolean(stream?.getTracks().some((t) => t.readyState === "live"));
}

/**
 * Host PeerJS id is claimed during camera setup.
 * As soon as the camera is on, incoming calls are answered so the guest
 * does not wait until the host taps Join.
 */
export function createHostLobby(roomId) {
  let destroyed = false;
  let peer = null;
  let handler = null;
  let pending = null;
  let activeCall = null;
  let localStream = null;

  function deliver(call) {
    shieldCall(call);
    if (handler) {
      handler(call);
      return;
    }
    if (!localStream) {
      pending = call;
      return;
    }
    try {
      if (!call.localStream) call.answer(localStream);
      activeCall = call;
    } catch (err) {
      console.warn("Could not answer during setup", err);
      pending = call;
    }
  }

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
          forceCloseCall(call);
          return;
        }
        deliver(call);
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
    takeCall() {
      const call = activeCall;
      activeCall = null;
      return call;
    },
    setLocalStream(stream) {
      localStream = stream;
      const pc = activeCall?.peerConnection;
      if (pc && stream) {
        stream.getTracks().forEach((track) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === track.kind);
          if (sender) sender.replaceTrack(track).catch(() => {});
        });
      }
      if (pending && !destroyed) {
        const call = pending;
        pending = null;
        deliver(call);
      }
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
      forceCloseCall(activeCall);
      activeCall = null;
      try {
        peer?.destroy();
      } catch {
        /* ignore */
      }
      peer = null;
    },
  };
}

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
  let remoteHold = null;
  let inCall = false;
  let guestLoop = true;
  const failAttempt = [];

  function closeCall() {
    const call = mediaCall;
    mediaCall = null;
    forceCloseCall(call);
  }

  function applyRemote(stream, call) {
    if (destroyed || !hasLiveMedia(stream)) return;
    remoteHold = stream;
    inCall = true;
    keepCallMedia(call);
    onRemoteStream(stream);
    onStatus("in-call");
    onError("");
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
        if (Date.now() - started > 20000) clearInterval(timer);
        return;
      }
      clearInterval(timer);

      pc.addEventListener("track", (event) => {
        const stream = event.streams?.[0] || new MediaStream([event.track]);
        applyRemote(stream, call);
      });

      const onState = () => {
        if (destroyed || mediaCall !== call) return;
        const ice = pc.iceConnectionState;
        const conn = pc.connectionState;
        onConnectionState(conn || ice || "");
        if (conn === "connected" || ice === "connected" || ice === "completed") {
          if (inCall) {
            onStatus("in-call");
            onError("");
          }
        }
      };
      pc.addEventListener("connectionstatechange", onState);
      pc.addEventListener("iceconnectionstatechange", onState);
      onState();
    }, 100);
  }

  function bindCall(call) {
    shieldCall(call);
    mediaCall = call;
    onPeerName(call.metadata?.name || (isHost ? "Guest" : "Host"));

    call.on("stream", (stream) => applyRemote(stream, call));
    if (call.remoteStream) applyRemote(call.remoteStream, call);

    watchPc(call);
  }

  function acceptCall(call) {
    shieldCall(call);
    if (destroyed) {
      forceCloseCall(call);
      return;
    }
    if (inCall && mediaCall && mediaCall !== call) {
      forceCloseCall(call);
      return;
    }
    if (mediaCall && mediaCall !== call && !inCall) {
      mediaCall.__keepMedia = false;
      forceCloseCall(mediaCall);
    }
    bindCall(call);
    try {
      if (!call.localStream) call.answer(localStream);
      onStatus(inCall ? "in-call" : "connecting");
    } catch (err) {
      console.warn("Could not answer call", err);
    }
  }

  async function runHost() {
    if (lobby) {
      await lobby.ready;
      if (destroyed) return;
      peer = lobby.getPeer();
      if (!peer) throw new Error("Could not open this room. Create a new one.");
      lobby.setLocalStream(localStream);
      const existing = lobby.takeCall();
      if (existing) acceptCall(existing);
      lobby.onCall(acceptCall);
      if (!inCall) onStatus("waiting");
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
      if (hasLiveMedia(call.remoteStream) || hasLiveMedia(remoteHold)) {
        resolve(call.remoteStream || remoteHold);
        return;
      }
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        fn(value);
      };
      const timer = setTimeout(() => finish(reject, new Error("timeout")), STREAM_WAIT_MS);
      const poll = setInterval(() => {
        if (hasLiveMedia(call.remoteStream) || hasLiveMedia(remoteHold)) {
          finish(resolve, call.remoteStream || remoteHold);
        }
      }, 250);
      call.once("stream", (stream) => {
        if (hasLiveMedia(stream)) finish(resolve, stream);
      });
      call.once("error", (err) => finish(reject, err));
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
      shieldCall(call);
      bindCall(call);

      failAttempt.push((err) => {
        call.__keepMedia = false;
        forceCloseCall(call);
        finish(reject, err);
      });

      waitForRemoteStream(call)
        .then((stream) => finish(resolve, stream))
        .catch((err) => finish(reject, err));
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
        return;
      } catch {
        if (destroyed || !guestLoop || inCall) return;
        mediaCall = null;
        onStatus("connecting");
        onError("Waiting for the host…");
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
