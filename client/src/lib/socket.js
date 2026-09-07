import { io } from "socket.io-client";

/**
 * Always connect to the current origin.
 * Vite proxies /socket.io → the Express server in development, so LAN
 * phones only need the Vite port. In production, Express serves both.
 */
let socket;

export function getSocket() {
  if (!socket) {
    socket = io({
      autoConnect: true,
      transports: ["websocket", "polling"],
    });
  }
  return socket;
}

/** Emit an event and wait for the Socket.io ack, or reject on timeout. */
export function emitAck(event, payload, timeoutMs = 5000) {
  const sock = getSocket();
  if (sock.disconnected) sock.connect();

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("The signaling server did not respond. Is it running on port 3001?"));
    }, timeoutMs);

    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };

    if (payload === undefined) sock.emit(event, finish);
    else sock.emit(event, payload, finish);
  });
}
