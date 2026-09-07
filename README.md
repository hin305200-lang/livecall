# Pair — 1-on-1 video calling

Live at [https://mysavings.site](https://mysavings.site).

Create a room, share the code, and meet in a live 1-on-1 video call. Meetings use the Jitsi SFU so both people can see each other across Wi‑Fi, mobile data, and countries.

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
2. **Device setup** — local camera preview plus camera, microphone, and (where supported) speaker pickers.
3. **Call** — both people join the same meeting room. Video is mixed on Jitsi’s servers (TURN + SFU), so a direct peer path is not required.

## Project layout

```
client/                 React + Vite UI
  src/lib/media.js      getUserMedia, device lists
  src/lib/jitsi.js      Jitsi Meet embed
  src/pages/            Landing, device setup, call room
```

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
