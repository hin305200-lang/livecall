import { useEffect, useRef, useState } from "react";
import VideoTile from "../components/VideoTile.jsx";
import DeviceSelect from "../components/DeviceSelect.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
import { ArrowIcon } from "../components/Icons.jsx";
import {
  classifyMediaError,
  getLocalStream,
  listDevices,
  stopStream,
  supportsSpeakerSelect,
} from "../lib/media.js";

export default function DeviceSetup({
  displayName,
  roomId,
  selectedDevices,
  onSelectedDevices,
  onPreviewStream,
  onBack,
  onJoin,
}) {
  const [stream, setStream] = useState(null);
  const [devices, setDevices] = useState({ cameras: [], mics: [], speakers: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const streamRef = useRef(null);
  const transferRef = useRef(false);
  const cancelledRef = useRef(false);
  const canPickSpeaker = supportsSpeakerSelect();

  async function refreshDevices() {
    try {
      const listed = await listDevices();
      setDevices(listed);
      onSelectedDevices((prev) => ({
        videoDeviceId: prev.videoDeviceId || listed.cameras[0]?.deviceId || "",
        audioDeviceId: prev.audioDeviceId || listed.mics[0]?.deviceId || "",
        speakerDeviceId: prev.speakerDeviceId || listed.speakers[0]?.deviceId || "",
      }));
    } catch (err) {
      setError(classifyMediaError(err));
    }
  }

  async function startPreview(nextIds = selectedDevices) {
    setLoading(true);
    setError("");
    try {
      const media = await getLocalStream(nextIds);
      if (cancelledRef.current) {
        stopStream(media);
        return;
      }
      setStream((prev) => {
        stopStream(prev);
        streamRef.current = media;
        return media;
      });
      onPreviewStream?.(media);
      await refreshDevices();
    } catch (err) {
      if (!cancelledRef.current) {
        setStream((prev) => {
          stopStream(prev);
          streamRef.current = null;
          return null;
        });
        setError(classifyMediaError(err));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cancelledRef.current = false;
    startPreview();
    const onChange = () => refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => {
      cancelledRef.current = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
      if (!transferRef.current) stopStream(streamRef.current);
    };
    // Preview is acquired once on mount; device dropdowns swap tracks below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCamera(id) {
    const next = { ...selectedDevices, videoDeviceId: id };
    onSelectedDevices(next);
    await startPreview(next);
  }

  async function onMic(id) {
    const next = { ...selectedDevices, audioDeviceId: id };
    onSelectedDevices(next);
    await startPreview(next);
  }

  function joinCall() {
    if (!stream) {
      setError("Turn on your camera or microphone before joining.");
      return;
    }
    // Hand the live stream to the call so we don't re-prompt for permissions.
    transferRef.current = true;
    onJoin(stream);
  }

  function goBack() {
    stopStream(stream);
    onBack();
  }

  return (
    <main className="page setup">
      <header className="topbar">
        <button type="button" className="text-btn" onClick={goBack}>
          ← Back
        </button>
        <div>
          <p className="eyebrow">Room {roomId}</p>
          <h1>Check your setup</h1>
          <p className="hint">Then join the call and stay on that screen so the other person can connect.</p>
        </div>
      </header>

      <ErrorBanner message={error} onRetry={() => startPreview()} />

      <div className="setup-grid">
        <VideoTile
          stream={stream}
          muted
          mirror
          speakerId={selectedDevices.speakerDeviceId}
          label={loading ? "Starting camera…" : displayName || "You"}
          overlay={!stream && !loading ? "Camera off" : null}
          className="setup-preview"
        />

        <div className="card stack">
          <DeviceSelect
            id="camera"
            label="Camera"
            value={selectedDevices.videoDeviceId}
            options={devices.cameras}
            onChange={onCamera}
            emptyLabel="No cameras found"
          />
          <DeviceSelect
            id="mic"
            label="Microphone"
            value={selectedDevices.audioDeviceId}
            options={devices.mics}
            onChange={onMic}
            emptyLabel="No microphones found"
          />
          {canPickSpeaker && (
            <DeviceSelect
              id="speaker"
              label="Speakers"
              value={selectedDevices.speakerDeviceId}
              options={devices.speakers}
              onChange={(id) => onSelectedDevices((prev) => ({ ...prev, speakerDeviceId: id }))}
              emptyLabel="No speakers found"
            />
          )}
          {!canPickSpeaker && (
            <p className="hint">This browser doesn’t support choosing an output device.</p>
          )}

          <button className="btn btn-primary" type="button" onClick={joinCall} disabled={!stream}>
            Join call
            <ArrowIcon />
          </button>
        </div>
      </div>
    </main>
  );
}
