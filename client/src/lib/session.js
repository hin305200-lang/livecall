import { loadIceConfig } from "./ice.js";
import { createPeer, openPeer } from "./peer.js";
import { peerIdForRoom } from "./rooms.js";
import { createPeerConnection } from "./webrtc.js";

const JOIN_DELAY_MS = 1200;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function send(conn, msg) {
  if (conn?.open) conn.send(msg);
}

function serializeCandidate(candidate) {
  if (!candidate) return null;
  if (typeof candidate.toJSON === "function") return candidate.toJSON();
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment,
  };
}

/**
 * Claim the host PeerJS id during device setup so guests can already
 * find the room. Incoming data connections are queued until the call starts.
 */
export function createHostLobby(roomId) {
  let destroyed = false;
  let peer = null;
  let queued = [];
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
      peer.on("connection", (c) => {
        if (destroyed) {
          try {
            c.close();
          } catch {
            /* ignore */
          }
          return;
        }
        if (handler) handler(c);
        else queued.push(c);
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
    onConnection(fn) {
      handler = fn;
      const waiting = queued;
      queued = [];
      waiting.forEach(fn);
    },
    destroy() {
      destroyed = true;
      handler = null;
      queued = [];
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
 * 1:1 call session.
 * PeerJS DataConnection carries SDP/ICE; RTCPeerConnection carries media.
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
  let destroyed = false;
  let peer;
  let conn;
  let rtc;
  let rtcConfig;
  let inCall = false;
  let guestLoop = false;
  let restartingIce = false;
  const failAttempt = [];

  function cleanupRtc() {
    rtc?.close();
    rtc = null;
  }

  function ensureRtc() {
    if (rtc) return rtc;
    rtc = createPeerConnection({
      localStream,
      rtcConfig,
      onRemoteStream: (stream) => {
        inCall = true;
        onRemoteStream(stream);
        onStatus("in-call");
        onError("");
      },
      onIceCandidate: (candidate) => {
        send(conn, { type: "ice", candidate: serializeCandidate(candidate) });
      },
      onConnectionStateChange: async (state) => {
        onConnectionState(state);
        if (state === "connected" || state === "completed") {
          inCall = true;
          onStatus("in-call");
          onError("");
        }
        if (state === "failed") {
          if (isHost && conn?.open && rtc && !restartingIce) {
            restartingIce = true;
            try {
              const offer = await rtc.createOffer({ iceRestart: true });
              send(conn, {
                type: "offer",
                offer: { type: offer.type, sdp: offer.sdp },
              });
              onError("Reconnecting…");
              return;
            } catch {
              /* fall through */
            } finally {
              setTimeout(() => {
                restartingIce = false;
              }, 5000);
            }
          }
          onError("Connection failed. Wait a few seconds and try again, or use a different browser.");
        }
        if (state === "disconnected") onStatus("reconnecting");
      },
    });
    return rtc;
  }

  async function handleSignal(msg) {
    if (destroyed || !msg?.type) return;
    if (msg.type === "hello") {
      onPeerName(msg.name || "Guest");
      return;
    }
    if (msg.type === "full") {
      guestLoop = false;
      onStatus("full");
      onError("Room is full. This call only supports two people.");
      return;
    }
    if (msg.type === "bye") {
      handlePeerLeft();
      return;
    }
    if (msg.type === "offer") {
      send(conn, { type: "hello", name: displayName });
      const answer = await ensureRtc().handleOffer(msg.offer);
      send(conn, {
        type: "answer",
        answer: { type: answer.type, sdp: answer.sdp },
      });
      return;
    }
    if (msg.type === "answer") {
      await rtc?.handleAnswer(msg.answer);
      return;
    }
    if (msg.type === "ice" && msg.candidate) {
      await ensureRtc().addIceCandidate(msg.candidate);
    }
  }

  function handlePeerLeft() {
    cleanupRtc();
    inCall = false;
    onRemoteStream(null);
    onPeerName("");
    onConnectionState("");
    if (isHost) {
      conn = null;
      onStatus("waiting");
      onError("");
      return;
    }
    onStatus("error");
    onError("The other person left.");
  }

  function bindConn(c, { createOffer }) {
    conn = c;

    c.on("data", (msg) => {
      handleSignal(msg).catch((err) => console.warn("Signal error", err));
    });

    c.on("close", () => {
      if (destroyed || conn !== c) return;
      conn = null;
      if (!inCall) {
        cleanupRtc();
        if (isHost) {
          onStatus("waiting");
          onError("");
          return;
        }
        onStatus("connecting");
        onError("Still trying to reach the host…");
        return;
      }
      handlePeerLeft();
    });

    const onOpen = async () => {
      if (destroyed || conn !== c) return;
      send(c, { type: "hello", name: displayName });
      if (!createOffer) return;
      onStatus("connecting");
      const offer = await ensureRtc().createOffer();
      if (destroyed || conn !== c) return;
      send(c, {
        type: "offer",
        offer: { type: offer.type, sdp: offer.sdp },
      });
    };

    if (c.open) onOpen();
    else c.on("open", onOpen);
  }

  function acceptHostConnection(c) {
    if (destroyed) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
      return;
    }
    if (conn && !conn.open) {
      conn = null;
      cleanupRtc();
    }
    if (conn?.open || inCall) {
      c.on("open", () => {
        send(c, { type: "full" });
        setTimeout(() => c.close(), 150);
      });
      if (c.open) {
        send(c, { type: "full" });
        setTimeout(() => c.close(), 150);
      }
      return;
    }
    bindConn(c, { createOffer: true });
  }

  async function runHost() {
    if (lobby) {
      await lobby.ready;
      if (destroyed) return;
      peer = lobby.getPeer();
      if (!peer) throw new Error("Could not open this room. Create a new one.");
      lobby.onConnection(acceptHostConnection);
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
      peer.on("connection", acceptHostConnection);
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

  function tryConnect(hostId) {
    return new Promise((resolve, reject) => {
      failAttempt.length = 0;
      const c = peer.connect(hostId, { reliable: true });
      if (!c) {
        reject(new Error("unavailable"));
        return;
      }

      // Listen for SDP before "open" so the host's offer is never missed.
      bindConn(c, { createOffer: false });

      let settled = false;
      const finish = (fn) => (arg) => {
        if (settled) return;
        settled = true;
        failAttempt.length = 0;
        clearTimeout(timer);
        fn(arg);
      };
      const timer = setTimeout(
        finish(() => {
          try {
            c.close();
          } catch {
            /* ignore */
          }
          reject(new Error("timeout"));
        }),
        4000,
      );
      c.once("open", finish(resolve));
      c.once("error", finish(reject));
      failAttempt.push(
        finish((err) => {
          try {
            c.close();
          } catch {
            /* ignore */
          }
          reject(err);
        }),
      );
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

    let attempt = 0;
    while (!destroyed && guestLoop) {
      if (conn?.open || inCall) return;
      attempt += 1;
      try {
        await tryConnect(hostId);
        if (destroyed) return;
        onError("");
        // Stay in the loop until media connects or the handshake drops.
        while (!destroyed && guestLoop && conn?.open && !inCall) {
          await delay(400);
        }
        if (inCall || destroyed || !guestLoop) return;
      } catch {
        if (destroyed || !guestLoop) return;
        onError("Waiting for the host to join the call…");
        await delay(JOIN_DELAY_MS);
      }
    }
  }

  const started = (async () => {
    rtcConfig = await loadIceConfig();
    if (destroyed) return;
    return isHost ? runHost() : runGuest();
  })();
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
      await rtc?.replaceTrack(kind, track);
    },
    destroy() {
      destroyed = true;
      guestLoop = false;
      send(conn, { type: "bye" });
      try {
        conn?.close();
      } catch {
        /* ignore */
      }
      cleanupRtc();
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
