import Peer from "peerjs";
import { PEER_ICE_CONFIG } from "./ice.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * PeerJS tears down the whole media call when its auxiliary data
 * channel closes. That is a false hang-up. Keep media alive.
 */
export function disableAuxHangup(call) {
  if (!call || call.__auxPatched) return;
  call.__auxPatched = true;
  const orig = call._initializeDataChannel;
  if (typeof orig === "function") {
    call._initializeDataChannel = function patchedInit(dc) {
      orig.call(this, dc);
      if (this.dataChannel) this.dataChannel.onclose = () => {};
    };
  }
  if (call.dataChannel) call.dataChannel.onclose = () => {};
}

const origCall = Peer.prototype.call;
Peer.prototype.call = function patchedCall(peerId, stream, options) {
  const conn = origCall.call(this, peerId, stream, options);
  disableAuxHangup(conn);
  return conn;
};

/**
 * Create a PeerJS peer and return it immediately so callers can attach
 * `call` listeners before the id is claimed.
 */
export function openPeer(id) {
  const peer = new Peer(id || undefined, {
    debug: 0,
    secure: true,
    config: PEER_ICE_CONFIG,
  });

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
