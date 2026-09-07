import { useState } from "react";
import { emitAck } from "../lib/socket.js";
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

  async function createRoom(e) {
    e.preventDefault();
    const display = trimmedName();
    if (!display) {
      setError("Enter a display name to continue.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await emitAck("create-room");
      if (!res?.ok) {
        setError("Could not create a room. Is the signaling server running?");
        return;
      }
      onDisplayName(display);
      onReady(res.roomId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom(e) {
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
    try {
      const res = await emitAck("check-room", { roomId: id });
      if (!res?.ok) {
        setError("Room not found. Check the code or create a new room.");
        return;
      }
      if (res.full) {
        setError("Room is full. This call only supports two people.");
        return;
      }
      onDisplayName(display);
      onReady(res.roomId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
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
