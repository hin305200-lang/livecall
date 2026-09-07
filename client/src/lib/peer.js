import Peer from "peerjs";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

/**
 * GitHub Pages is static, so signaling uses the public PeerJS broker
 * instead of our local Socket.io server.
 */
export function createPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = new Peer(id, {
      host: "0.peerjs.com",
      port: 443,
      path: "/",
      secure: true,
      config: ICE_SERVERS,
    });

    const onError = (err) => {
      peer.off("open", onOpen);
      reject(err);
    };
    const onOpen = () => {
      peer.off("error", onError);
      resolve(peer);
    };

    peer.once("open", onOpen);
    peer.once("error", onError);
  });
}

export function replaceCallTrack(call, kind, newTrack) {
  const sender = call?.peerConnection?.getSenders().find((s) => s.track?.kind === kind);
  if (sender) return sender.replaceTrack(newTrack);
  return Promise.resolve();
}
