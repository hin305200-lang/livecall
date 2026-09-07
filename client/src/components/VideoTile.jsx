import { useEffect, useRef } from "react";

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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream || null;
  }, [stream]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !speakerId || typeof el.setSinkId !== "function") return;
    el.setSinkId(speakerId).catch((err) => {
      console.warn("Could not set speaker", err);
    });
  }, [speakerId, stream]);

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
      {label && <span className="video-label">{label}</span>}
    </div>
  );
}
