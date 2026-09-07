import { useEffect, useRef, useState } from "react";
import VideoTile from "../components/VideoTile.jsx";
import DeviceSelect from "../components/DeviceSelect.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
import { ArrowIcon } from "../components/Icons.jsx";
import {
  classifyMediaError,
  deviceLabel,
  findObsCamera,
  getLocalStream,
  isObsCamera,
  isVirtualCamera,
  listDevices,
  pickDefaultCamera,
  stopStream,
  supportsSpeakerSelect,
} from "../lib/media.js";

function withDeviceLabels(prev, listed, preferVirtual) {
  const videoDeviceId = prev.videoDeviceId || pickDefaultCamera(listed.cameras, preferVirtual);
  const audioDeviceId = prev.audioDeviceId || listed.mics[0]?.deviceId || "";
  const speakerDeviceId = prev.speakerDeviceId || listed.speakers[0]?.deviceId || "";
  return {
    videoDeviceId,
    videoLabel: deviceLabel(listed.cameras, videoDeviceId) || prev.videoLabel || "",
    audioDeviceId,
    audioLabel: deviceLabel(listed.mics, audioDeviceId) || prev.audioLabel || "",
    speakerDeviceId,
    speakerLabel: deviceLabel(listed.speakers, speakerDeviceId) || prev.speakerLabel || "",
  };
}

function cameraOptionLabel(device, index) {
  const name = device.label || `Camera ${index + 1}`;
  if (isObsCamera(device) || isVirtualCamera(device)) return `${name} (OBS)`;
  return name;
}

export default function DeviceSetup({
  displayName,
  roomId,
  isHost,
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
  const pickedCameraRef = useRef(Boolean(selectedDevices.videoDeviceId));
  const selectedRef = useRef(selectedDevices);
  const canPickSpeaker = supportsSpeakerSelect();
  const usingVirtual = isObsCamera({
    label: selectedDevices.videoLabel || stream?.getVideoTracks?.()[0]?.label || "",
  }) || isVirtualCamera({
    label: selectedDevices.videoLabel || stream?.getVideoTracks?.()[0]?.label || "",
  });

  selectedRef.current = selectedDevices;

  async function refreshDevices(opts = {}) {
    try {
      const listed = await listDevices();
      setDevices(listed);

      const obs = findObsCamera(listed.cameras);
      const prev = selectedRef.current;
      const shouldTakeObs = Boolean(isHost && obs && !pickedCameraRef.current && prev.videoDeviceId !== obs.deviceId);
      const next = withDeviceLabels(
        shouldTakeObs ? { ...prev, videoDeviceId: obs.deviceId, videoLabel: obs.label } : prev,
        listed,
        isHost,
      );
      onSelectedDevices(next);
      if (shouldTakeObs && opts.previewObs) {
        await startPreview(next);
      }
    } catch (err) {
      setError(classifyMediaError(err));
    }
  }

  async function startPreview(nextIds = selectedRef.current) {
    setLoading(true);
    setError("");
    try {
      const media = await getLocalStream({
        ...nextIds,
        preferVirtual: isHost,
      });
      if (cancelledRef.current) {
        stopStream(media);
        return;
      }
      const videoLabel = media.getVideoTracks()[0]?.label || nextIds.videoLabel || "";
      const audioLabel = media.getAudioTracks()[0]?.label || nextIds.audioLabel || "";
      const listed = await listDevices();
      const matchedCamera =
        listed.cameras.find((d) => d.label && d.label === videoLabel) ||
        listed.cameras.find((d) => d.deviceId && d.deviceId === media.getVideoTracks()[0]?.getSettings?.().deviceId);
      onSelectedDevices({
        ...nextIds,
        videoDeviceId: matchedCamera?.deviceId || nextIds.videoDeviceId || "",
        videoLabel: videoLabel || matchedCamera?.label || "",
        audioLabel,
      });
      setDevices(listed);
      setStream((prev) => {
        stopStream(prev);
        streamRef.current = media;
        return media;
      });
      onPreviewStream?.(media);
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
    const onChange = () => refreshDevices({ previewObs: true });
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
    pickedCameraRef.current = true;
    const next = {
      ...selectedRef.current,
      videoDeviceId: id,
      videoLabel: deviceLabel(devices.cameras, id),
    };
    onSelectedDevices(next);
    await startPreview(next);
  }

  async function onMic(id) {
    const next = {
      ...selectedRef.current,
      audioDeviceId: id,
      audioLabel: deviceLabel(devices.mics, id),
    };
    onSelectedDevices(next);
    await startPreview(next);
  }

  function joinCall() {
    if (!stream?.getVideoTracks?.().length && !stream?.getAudioTracks?.().length) {
      setError("Turn on your camera or microphone before joining.");
      return;
    }
    transferRef.current = true;
    onJoin(stream);
  }

  function goBack() {
    stopStream(stream);
    onBack();
  }

  const cameraOptions = devices.cameras.map((device, index) => ({
    ...device,
    label: cameraOptionLabel(device, index),
  }));

  return (
    <main className="page setup">
      <header className="topbar">
        <button type="button" className="text-btn" onClick={goBack}>
          ← Back
        </button>
        <div>
          <p className="eyebrow">Room {roomId}</p>
          <h1>{isHost ? "Choose your OBS camera" : "Check your setup"}</h1>
          <p className="hint">
            {isHost
              ? "Allow camera access, then pick OBS from the Camera list. The other person will see that video."
              : "Then join the call. The meeting works on different Wi‑Fi, mobile data, and countries."}
          </p>
        </div>
      </header>

      <ErrorBanner message={error} onRetry={() => startPreview()} />

      <div className="setup-grid">
        <VideoTile
          stream={stream}
          muted
          mirror={!usingVirtual}
          speakerId={selectedDevices.speakerDeviceId}
          label={
            loading
              ? "Starting camera…"
              : usingVirtual
                ? `${displayName || "You"} · OBS`
                : displayName || "You"
          }
          overlay={!stream && !loading ? "Camera off" : null}
          className={`setup-preview${usingVirtual ? " is-contain" : ""}`}
        />

        <div className="card stack">
          <DeviceSelect
            id="camera"
            label="Camera"
            value={selectedDevices.videoDeviceId}
            options={cameraOptions}
            onChange={onCamera}
            emptyLabel="Allow camera access to see cameras"
          />
          <p className="hint">
            {isHost
              ? "If the preview is your webcam, open the Camera list and choose the OBS device. Virtual Camera can stay started in OBS."
              : "Using OBS? Choose the OBS device in Camera after you allow access."}
          </p>
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
              onChange={(id) =>
                onSelectedDevices((prev) => ({
                  ...prev,
                  speakerDeviceId: id,
                  speakerLabel: deviceLabel(devices.speakers, id),
                }))
              }
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
