/**
 * ICE config for PeerJS media calls.
 * Signaling goes through the PeerJS broker (WebSocket).
 * These STUN/TURN servers are for the video path when a direct
 * connection between two networks is blocked.
 *
 * Match PeerJS defaults (do not add iceCandidatePoolSize or
 * transport=tcp — those break or delay PeerJS negotiation).
 */
export const PEER_ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"],
      username: "peerjs",
      credential: "peerjsp",
    },
  ],
  sdpSemantics: "unified-plan",
};
