const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomId() {
  let id = "";
  for (let i = 0; i < 6; i += 1) {
    id += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return id;
}

/** PeerJS id for a room. Unique enough on the public broker. */
export function peerIdForRoom(roomId) {
  return `mysavings-${String(roomId || "").trim().toUpperCase()}`;
}
