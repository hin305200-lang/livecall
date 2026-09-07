/**
 * 1:1 RTCPeerConnection helper.
 *
 * STUN (Google’s public servers) is enough for many home NATs, but
 * users behind symmetric NATs / strict firewalls will fail to connect
 * unless you add a TURN server in iceServers. See the README.
 */
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export function createPeerConnection({
  localStream,
  onRemoteStream,
  onIceCandidate,
  onConnectionStateChange,
}) {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  const pendingIce = [];

  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) onIceCandidate?.(event.candidate);
  };

  pc.ontrack = (event) => {
    // Prefer the remote MediaStream when the browser provides one.
    if (event.streams && event.streams[0]) {
      onRemoteStream?.(event.streams[0]);
      return;
    }
    onRemoteStream?.(new MediaStream([event.track]));
  };

  pc.onconnectionstatechange = () => {
    onConnectionStateChange?.(pc.connectionState);
  };

  async function flushQueuedIce() {
    while (pendingIce.length) {
      const candidate = pendingIce.shift();
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn("Failed to add ICE candidate", err);
      }
    }
  }

  return {
    pc,

    async createOffer() {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      return pc.localDescription;
    },

    async handleOffer(offer) {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await flushQueuedIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      return pc.localDescription;
    },

    async handleAnswer(answer) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      await flushQueuedIce();
    },

    async addIceCandidate(candidate) {
      if (!pc.remoteDescription) {
        pendingIce.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn("Failed to add ICE candidate", err);
      }
    },

    async replaceTrack(kind, newTrack) {
      const sender = pc.getSenders().find((s) => s.track?.kind === kind);
      if (sender) {
        await sender.replaceTrack(newTrack);
        return;
      }
      if (newTrack && localStream) pc.addTrack(newTrack, localStream);
    },

    close() {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      try {
        pc.getSenders().forEach((s) => {
          try {
            pc.removeTrack(s);
          } catch {
            /* already stopped */
          }
        });
        pc.close();
      } catch {
        /* ignore */
      }
    },
  };
}
