import { useState } from "react";
import { generateRoomId } from "../lib/rooms.js";
import { ArrowIcon } from "../components/Icons.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

export default function Landing({ displayName, onDisplayName, initialRoomId, onReady }) {
  const [name, setName] = useState(displayName);
  const [roomCode, setRoomCode] = useState(initialRoomId || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function trimmedName() {
    return name.trim().slice(0, 40);
  }

  function createRoom(e) {
    e.preventDefault();
    const display = trimmedName();
    if (!display) {
      setError("Enter a display name to continue.");
      return;
    }
    setBusy(true);
    setError("");
    onDisplayName(display);
    onReady(generateRoomId(), true);
    setBusy(false);
  }

  function joinRoom(e) {
    e.preventDefault();
    const display = trimmedName();
    const id = roomCode.trim().toUpperCase();
    if (!display) {
      setError("Enter a display name to continue.");
      return;
    }
    if (!id || id.length < 4) {
      setError("Enter a valid room code.");
      return;
    }
    setBusy(true);
    setError("");
    onDisplayName(display);
    onReady(id, false);
    setBusy(false);
  }

  return (
    <main className="page landing">
      <section className="landing-copy">
        <p className="eyebrow">Identity check</p>
        <h1>Video call verification</h1>
        <p className="lede">
          Create a room, share the code, and confirm in a live 1-on-1 call.
        </p>
      </section>

      <div className="landing-forms">
        <ErrorBanner message={error} />

        <form className="card stack" onSubmit={createRoom}>
          <label className="field" htmlFor="display-name">
            <span>Your name</span>
            <input
              id="display-name"
              autoComplete="name"
              maxLength={40}
              placeholder="Alex"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            Create a new room
            <ArrowIcon />
          </button>
        </form>

        <form className="card stack" onSubmit={joinRoom}>
          <label className="field" htmlFor="room-code">
            <span>Have a code?</span>
            <input
              id="room-code"
              className="mono"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck="false"
              placeholder="AB3K7Q"
              maxLength={8}
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            />
          </label>
          <button className="btn btn-secondary" type="submit" disabled={busy}>
            Join room
          </button>
        </form>
      </div>
    </main>
  );
}
