import Peer from "peerjs";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * PeerJS closes the whole media call when its extra data channel drops.
 * That kills video even though both people are still there.
 */
export function disableAuxHangup(call) {
  if (!call) return;
  const orig = call._initializeDataChannel;
  if (typeof orig === "function" && !call.__auxPatched) {
    call.__auxPatched = true;
    call._initializeDataChannel = function patchedInit(dc) {
      orig.call(this, dc);
      if (this.dataChannel) this.dataChannel.onclose = () => {};
    };
  }
  if (call.dataChannel) call.dataChannel.onclose = () => {};
}

export function shieldCall(call) {
  disableAuxHangup(call);
  if (!call || call.__shielded) return;
  call.__shielded = true;
  const origClose = call.close.bind(call);
  call.__origClose = origClose;
  call.close = function shieldedClose() {
    if (call.__keepMedia) return;
    origClose();
  };
}

export function keepCallMedia(call) {
  if (call) call.__keepMedia = true;
}

export function forceCloseCall(call) {
  if (!call) return;
  call.__keepMedia = false;
  try {
    (call.__origClose || call.close).call(call);
  } catch {
    /* ignore */
  }
}

const origCall = Peer.prototype.call;
Peer.prototype.call = function patchedCall(peerId, stream, options) {
  const conn = origCall.call(this, peerId, stream, options);
  shieldCall(conn);
  return conn;
};

export function openPeer(id) {
  const peer = new Peer(id || undefined, {
    debug: 0,
    secure: true,
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
