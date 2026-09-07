# Pair — 1-on-1 video calling

Peer-to-peer video calls in the browser. React + Vite on the client, Express + Socket.io for signaling, WebRTC for media.

Two people per room. No accounts.

## Run locally

You need Node.js 18+. Camera/microphone access requires **localhost** or **HTTPS**.

```bash
# from the project root
npm install
npm run install:all
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

| Process | URL |
| --- | --- |
| Client (Vite) | http://localhost:5173 |
| Signaling server | http://localhost:3001 |

To try a call: open the app in two browser windows (or a phone on the same Wi-Fi at `http://<your-lan-ip>:5173`). Create a room in one, join with the code in the other.

### Production-style (single origin)

```bash
npm run install:all
npm run build
npm start
```

Serves the built client from the signaling server at [http://localhost:3001](http://localhost:3001).

## How it works

1. **Landing** — enter a display name, create a room or join with a 6-character code / `?room=CODE` link.
2. **Device setup** — local camera preview plus camera, microphone, and (where supported) speaker pickers via `enumerateDevices()`.
3. **Call** — both peers join the Socket.io room. The person already in the room creates a WebRTC offer; the joiner answers. ICE candidates are relayed through the server. Max **2** participants; a third sees “Room is full”.

Media never goes through the server. Socket.io only carries SDP and ICE.

### NAT traversal (STUN vs TURN)

The client uses Google’s public STUN servers:

- `stun:stun.l.google.com:19302`
- `stun:stun1.l.google.com:19302`

**STUN is not enough on every network.** Peers behind symmetric NATs or strict firewalls cannot establish a direct path. For production you need a **TURN** server (e.g. [coturn](https://github.com/coturn/coturn)) and extra `iceServers` entries:

```js
{
  urls: "turn:turn.example.com:3478",
  username: "user",
  credential: "secret",
}
```

Without TURN, some calls will fail with `connectionState === "failed"` even though signaling succeeded.

## Project layout

```
client/                 React + Vite UI
  src/lib/media.js      getUserMedia, device lists, mid-call switching
  src/lib/webrtc.js     RTCPeerConnection wrapper (STUN, ICE queue)
  src/lib/socket.js     Socket.io client
  src/pages/            Landing, device setup, call room
server/index.js         Express + Socket.io signaling (max 2 per room)
```

## Notes

- iOS Safari does not support `HTMLMediaElement.setSinkId()` — the speaker picker is hidden there.
- If permission is denied, the setup screen explains how to recover instead of failing silently.
- Leaving or disconnecting stops local tracks, closes the peer connection, and notifies the other person.
