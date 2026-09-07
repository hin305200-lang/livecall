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

Calls try a **direct** path first (STUN). If the two devices are on different Wi‑Fi, mobile data, or countries, media is **relayed** through TURN so the call can still connect.

Built-in relays:

- `turn:eu-0.turn.peerjs.com:3478` (UDP + TCP)
- `turn:us-0.turn.peerjs.com:3478` (UDP + TCP)

Optional extra TURN (baked in at build time):

- `VITE_ICE_URL` — URL that returns `{ iceServers: [...] }`
- `VITE_METERED_DOMAIN` + `VITE_METERED_API_KEY` — [Metered](https://www.metered.ca/stun-turn/) credential API

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
