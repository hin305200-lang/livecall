/**
 * 1:1 RTCPeerConnection helper.
 *
 * Direct (STUN) paths are tried first. TURN relays are used when the
 * two devices cannot reach each other across NATs, firewalls, or countries.
 */
import { PEER_ICE_CONFIG } from "./ice.js";

export function createPeerConnection({
  localStream,
  rtcConfig,
  onRemoteStream,
  onIceCandidate,
  onConnectionStateChange,
}) {
  const pc = new RTCPeerConnection(rtcConfig || PEER_ICE_CONFIG);
  const pendingIce = [];

  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) onIceCandidate?.(event.candidate);
  };

  const remote = new MediaStream();
  pc.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      onRemoteStream?.(event.streams[0]);
      return;
    }
    if (!remote.getTracks().includes(event.track)) remote.addTrack(event.track);
    onRemoteStream?.(remote);
  };

  pc.onconnectionstatechange = () => {
    onConnectionStateChange?.(pc.connectionState);
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    if (state === "connected" || state === "completed") {
      onConnectionStateChange?.("connected");
    } else if (state === "failed" || state === "disconnected") {
      onConnectionStateChange?.(state);
    }
  };

  async function flushQueuedIce() {
    while (pendingIce.length) {
      const candidate = pendingIce.shift();
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn("Failed to add ICE candidate", err);
      }
    }
  }

  return {
    pc,

    async createOffer({ iceRestart = false } = {}) {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart,
      });
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
      if (pc.signalingState === "stable") return;
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
      pc.oniceconnectionstatechange = null;
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
