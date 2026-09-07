/**
 * Signaling server for 1-on-1 WebRTC calls.
 *
 * This process never sees media — it only:
 *   - creates / looks up rooms
 *   - enforces a hard cap of 2 participants
 *   - relays SDP offers/answers and ICE candidates between the two peers
 *   - notifies the remaining peer when someone leaves or disconnects
 */
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

if (process.env.NODE_ENV === "production") {
  const clientDist = path.resolve(__dirname, "../client/dist");
  app.use(express.static(clientDist));
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith("/socket.io")) return next();
    res.sendFile(path.join(clientDist, "index.html"), (err) => {
      if (err) next();
    });
  });
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, methods: ["GET", "POST"] },
});

/** @typedef {{ name: string }} Participant */
/** @type {Map<string, { participants: Map<string, Participant> }>} */
const rooms = new Map();

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateRoomId() {
  let id = "";
  for (let i = 0; i < 6; i += 1) {
    id += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return rooms.has(id) ? generateRoomId() : id;
}

function getRoomPublicState(room) {
  return {
    participantCount: room.participants.size,
    full: room.participants.size >= 2,
  };
}

function leaveRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  const room = rooms.get(roomId);
  socket.leave(roomId);
  socket.data.roomId = null;
  socket.data.displayName = null;

  if (!room) return;

  room.participants.delete(socket.id);
  socket.to(roomId).emit("peer-left", { socketId: socket.id });

  if (room.participants.size === 0) {
    rooms.delete(roomId);
  }
}

io.on("connection", (socket) => {
  socket.data.roomId = null;

  socket.on("create-room", (callback) => {
    const roomId = generateRoomId();
    rooms.set(roomId, { participants: new Map() });
    callback?.({ ok: true, roomId });
  });

  socket.on("check-room", ({ roomId }, callback) => {
    const id = String(roomId || "").trim().toUpperCase();
    const room = rooms.get(id);
    if (!room) {
      callback?.({ ok: false, error: "not-found" });
      return;
    }
    callback?.({ ok: true, roomId: id, ...getRoomPublicState(room) });
  });

  // Occupies a slot. Media/WebRTC still live entirely on the clients.
  socket.on("join-call", ({ roomId, name }, callback) => {
    const id = String(roomId || "").trim().toUpperCase();
    const displayName = String(name || "Guest").trim().slice(0, 40) || "Guest";
    const room = rooms.get(id);

    if (!room) {
      callback?.({ ok: false, error: "not-found" });
      return;
    }

    if (socket.data.roomId === id && room.participants.has(socket.id)) {
      callback?.({ ok: true, roomId: id, alreadyJoined: true });
      return;
    }

    if (room.participants.size >= 2) {
      callback?.({ ok: false, error: "full" });
      return;
    }

    if (socket.data.roomId) leaveRoom(socket);

    const peers = [...room.participants.entries()].map(([socketId, p]) => ({
      socketId,
      name: p.name,
    }));

    room.participants.set(socket.id, { name: displayName });
    socket.join(id);
    socket.data.roomId = id;
    socket.data.displayName = displayName;

    // The person already in the room creates the offer (they have a live PC).
    if (peers.length === 1) {
      socket.to(id).emit("peer-joined", {
        socketId: socket.id,
        name: displayName,
        shouldOffer: true,
      });
    }

    callback?.({
      ok: true,
      roomId: id,
      peer: peers[0] || null,
      shouldOffer: false,
    });
  });

  socket.on("offer", ({ offer }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !offer) return;
    socket.to(roomId).emit("offer", { offer, from: socket.id });
  });

  socket.on("answer", ({ answer }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !answer) return;
    socket.to(roomId).emit("answer", { answer, from: socket.id });
  });

  socket.on("ice-candidate", ({ candidate }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !candidate) return;
    socket.to(roomId).emit("ice-candidate", { candidate, from: socket.id });
  });

  socket.on("leave-call", (callback) => {
    leaveRoom(socket);
    callback?.({ ok: true });
  });

  socket.on("disconnect", () => {
    leaveRoom(socket);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Signaling server listening on http://localhost:${PORT}`);
});
