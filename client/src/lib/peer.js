import Peer from "peerjs";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PEER_OPTIONS = {
  debug: 0,
  secure: true,
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      {
        urls: [
          "turn:eu-0.turn.peerjs.com:3478",
          "turn:us-0.turn.peerjs.com:3478",
        ],
        username: "peerjs",
        credential: "peerjsp",
      },
    ],
    sdpSemantics: "unified-plan",
  },
};

export function openPeer(id) {
  const peer = new Peer(id || undefined, PEER_OPTIONS);

  const ready = new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish(reject, new Error("Could not reach the connection service. Check your network and try again."));
    }, 15000);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (fn === reject) {
        try {
          peer.destroy();
        } catch {
          /* ignore */
        }
      }
      fn(value);
    };

    peer.once("open", () => finish(resolve, peer));
    peer.once("error", (err) => finish(reject, err));
  });

  return { peer, ready };
}

export async function createPeer(id) {
  const { ready } = openPeer(id);
  return ready;
}

export async function createPeerRetry(id, attempts = 8) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await createPeer(id);
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      await delay(err?.type === "unavailable-id" ? 1500 : 800);
    }
  }
  throw lastErr;
}
