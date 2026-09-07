import { useEffect, useRef, useState } from "react";

export default function VideoTile({
  stream,
  muted = false,
  mirror = false,
  speakerId,
  label,
  overlay,
  className = "",
}) {
  const ref = useRef(null);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setNeedsTap(false);
    if (el.srcObject !== stream) el.srcObject = stream || null;
    if (!stream) return undefined;

    const tryPlay = () => {
      const play = el.play();
      if (play && typeof play.then === "function") {
        play.then(() => setNeedsTap(false)).catch(() => setNeedsTap(true));
      }
    };

    tryPlay();
    el.addEventListener("loadedmetadata", tryPlay);
    return () => el.removeEventListener("loadedmetadata", tryPlay);
  }, [stream]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !speakerId || typeof el.setSinkId !== "function") return;
    el.setSinkId(speakerId).catch((err) => {
      console.warn("Could not set speaker", err);
    });
  }, [speakerId, stream]);

  function tapToPlay() {
    const el = ref.current;
    if (!el) return;
    el.play()
      .then(() => setNeedsTap(false))
      .catch(() => {});
  }

  return (
    <div className={`video-tile ${className} ${mirror ? "is-mirror" : ""}`}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        // Local preview must be muted so autoplay is allowed.
      />
      {!stream && <div className="video-empty">No video</div>}
      {overlay && <div className="video-overlay">{overlay}</div>}
      {needsTap && stream && (
        <button type="button" className="video-overlay" onClick={tapToPlay}>
          Tap to play
        </button>
      )}
      {label && <span className="video-label">{label}</span>}
    </div>
  );
}
