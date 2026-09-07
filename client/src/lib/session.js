import { createPeer, openPeer } from "./peer.js";
import { peerIdForRoom } from "./rooms.js";

const JOIN_DELAY_MS = 1500;
const STREAM_WAIT_MS = 20000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function liveStream(stream) {
  return stream?.getTracks().some((t) => t.readyState === "live") ? stream : null;
}

/**
 * Host claims the room id during camera setup and answers as soon as
 * the camera is on. Stream listeners are attached before answer() so
 * the remote video is never missed.
 */
export function createHostLobby(roomId) {
  let destroyed = false;
  let peer = null;
  let localStream = null;
  let pending = null;
  let activeCall = null;
  let remoteStream = null;
  let onIncoming = null;
  let onRemote = null;

  function listenForRemote(call) {
    const got = (stream) => {
      const live = liveStream(stream);
      if (!live) return;
      remoteStream = live;
      onRemote?.(live, call);
    };
    call.on("stream", got);
    if (call.remoteStream) got(call.remoteStream);

    const hookPc = () => {
      const pc = call.peerConnection;
      if (!pc) return false;
      pc.addEventListener("track", (event) => {
        got(event.streams?.[0] || new MediaStream([event.track]));
      });
      return true;
    };
    if (!hookPc()) {
      const timer = setInterval(() => {
        if (destroyed || hookPc()) clearInterval(timer);
      }, 100);
    }
  }

  function answerNow(call) {
    listenForRemote(call);
    activeCall = call;
    onIncoming?.(call);
    try {
      if (localStream && !call.localStream) call.answer(localStream);
    } catch (err) {
      console.warn("Answer failed", err);
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
          try {
            call.close();
          } catch {
            /* ignore */
          }
          return;
        }
        if (!localStream) {
          pending = call;
          return;
        }
        answerNow(call);
      });
      try {
        await opened.ready;
        return;
      } catch (err) {
        lastErr = err;
        peer = null;
        if (attempt < 7) await delay(1500);
      }
    }
    throw lastErr;
  })();

  return {
    ready,
    getPeer() {
      return peer;
    },
    getRemoteStream() {
      return remoteStream;
    },
    getActiveCall() {
      return activeCall;
    },
    setLocalStream(stream) {
      localStream = stream;
      if (pending && !destroyed) {
        const call = pending;
        pending = null;
        answerNow(call);
      }
    },
    onIncoming(fn) {
      onIncoming = fn;
    },
    onRemote(fn) {
      onRemote = fn;
      if (remoteStream && activeCall) fn(remoteStream, activeCall);
    },
    destroy() {
      destroyed = true;
      onIncoming = null;
      onRemote = null;
      pending = null;
      try {
        activeCall?.close();
      } catch {
        /* ignore */
      }
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
}) {
  if (!localStream) {
    onStatus("error");
    onError("Camera is not ready. Go back and try again.");
    return { async replaceTrack() {}, destroy() {} };
  }

  let destroyed = false;
  let peer;
  let mediaCall;
  let inCall = false;

  function showRemote(stream, call, name) {
    const live = liveStream(stream);
    if (destroyed || !live) return;
    mediaCall = call;
    inCall = true;
    onPeerName(name || call?.metadata?.name || (isHost ? "Guest" : "Host"));
    onRemoteStream(live);
    onStatus("in-call");
    onError("");
  }

  function attach(call) {
    mediaCall = call;
    const got = (stream) => showRemote(stream, call, call.metadata?.name);
    call.on("stream", got);
    if (call.remoteStream) got(call.remoteStream);
    const hookPc = () => {
      const pc = call.peerConnection;
      if (!pc) return false;
      pc.addEventListener("track", (event) => {
        got(event.streams?.[0] || new MediaStream([event.track]));
      });
      return true;
    };
    if (!hookPc()) {
      const timer = setInterval(() => {
        if (destroyed || hookPc()) clearInterval(timer);
      }, 100);
    }
  }

  async function runHost() {
    if (lobby) {
      await lobby.ready;
      if (destroyed) return;
      peer = lobby.getPeer();
      if (!peer) throw new Error("Could not open this room. Create a new one.");
      lobby.setLocalStream(localStream);
      lobby.onRemote((stream, call) => showRemote(stream, call));
      lobby.onIncoming((call) => {
        mediaCall = call;
        onStatus("connecting");
      });
      if (lobby.getRemoteStream()) {
        showRemote(lobby.getRemoteStream(), lobby.getActiveCall());
      } else if (lobby.getActiveCall()) {
        attach(lobby.getActiveCall());
        onStatus("connecting");
      } else {
        onStatus("waiting");
      }
      return;
    }

    const opened = openPeer(peerIdForRoom(roomId));
    peer = opened.peer;
    peer.on("call", (call) => {
      if (destroyed) return;
      attach(call);
      onStatus("connecting");
      try {
        call.answer(localStream);
      } catch (err) {
        console.warn(err);
      }
    });
    await opened.ready;
    if (!destroyed) onStatus("waiting");
  }

  async function runGuest() {
    peer = await createPeer();
    if (destroyed) {
      peer.destroy();
      return;
    }

    const hostId = peerIdForRoom(roomId);
    onStatus("connecting");
    onError("");

    while (!destroyed && !inCall) {
      const call = peer.call(hostId, localStream, {
        metadata: { name: displayName },
      });
      if (!call) {
        onError("Waiting for the host…");
        await delay(JOIN_DELAY_MS);
        continue;
      }
      attach(call);
      const got = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), STREAM_WAIT_MS);
        const done = (stream) => {
          if (liveStream(stream)) {
            clearTimeout(timer);
            resolve(stream);
          }
        };
        call.on("stream", done);
        if (call.remoteStream) done(call.remoteStream);
      });
      if (destroyed) return;
      if (got) {
        showRemote(got, call, call.metadata?.name);
        return;
      }
      try {
        call.close();
      } catch {
        /* ignore */
      }
      onError("Waiting for the host…");
      await delay(JOIN_DELAY_MS);
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
      try {
        mediaCall?.close();
      } catch {
        /* ignore */
      }
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
