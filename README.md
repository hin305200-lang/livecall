# Pair — 1-on-1 video calling

Peer-to-peer video calls in the browser. Live at [https://mysavings.site](https://mysavings.site).

React + Vite on the client, WebRTC for media. Signaling uses PeerJS so the app can run on GitHub Pages (no Node server required in production).

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

To try a call: open the app in two browser windows. Create a room in one, join with the code in the other.

## Production (GitHub Pages)

Pushes to `main` build the client and deploy it to [https://mysavings.site](https://mysavings.site).

```bash
npm run install:all
npm run build --prefix client
```

## How it works

1. **Landing** — enter a display name, create a room or join with a 6-character code / `?room=CODE` link.
2. **Device setup** — local camera preview plus camera, microphone, and (where supported) speaker pickers via `enumerateDevices()`.
3. **Call** — the room creator waits; the joiner connects over WebRTC. Max **2** participants.

### NAT traversal (STUN vs TURN)

The client uses Google’s public STUN servers:

- `stun:stun.l.google.com:19302`
- `stun:stun1.l.google.com:19302`

**STUN is not enough on every network.** Peers behind symmetric NATs or strict firewalls cannot establish a direct path. For production you need a **TURN** server (e.g. [coturn](https://github.com/coturn/coturn)).

Without TURN, some calls will fail with `connectionState === "failed"` even though signaling succeeded.

## Project layout

```
client/                 React + Vite UI
  src/lib/media.js      getUserMedia, device lists, mid-call switching
  src/lib/peer.js       PeerJS signaling (works on static hosting)
  src/pages/            Landing, device setup, call room
.github/workflows/      Deploy client build to GitHub Pages
```

## Notes

- iOS Safari does not support `HTMLMediaElement.setSinkId()` — the speaker picker is hidden there.
- If permission is denied, the setup screen explains how to recover instead of failing silently.
- Leaving or disconnecting stops local tracks, closes the peer connection, and notifies the other person.
