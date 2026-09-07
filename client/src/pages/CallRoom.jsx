import { useEffect, useRef, useState } from "react";
import VideoTile from "../components/VideoTile.jsx";
import CallControls from "../components/CallControls.jsx";
import DeviceSelect from "../components/DeviceSelect.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
import { CopyIcon, CheckIcon } from "../components/Icons.jsx";
import { startSession } from "../lib/session.js";
import {
  classifyMediaError,
  listDevices,
  stopStream,
  supportsSpeakerSelect,
  switchDevice,
} from "../lib/media.js";

export default function CallRoom({
  displayName,
  roomId,
  isHost,
  localStream,
  lobby,
  selectedDevices,
  onSelectedDevices,
  onLeave,
}) {
  const [remoteStream, setRemoteStream] = useState(null);
  const [peerName, setPeerName] = useState("");
  const [status, setStatus] = useState(isHost ? "waiting" : "connecting");
  const [connectionState, setConnectionState] = useState("");
  const [error, setError] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [devices, setDevices] = useState({ cameras: [], mics: [], speakers: [] });

  const sessionRef = useRef(null);
  const streamRef = useRef(localStream);

  const shareUrl = `${window.location.origin}/?room=${roomId}`;
  const canPickSpeaker = supportsSpeakerSelect();

  useEffect(() => {
    streamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    listDevices().then(setDevices).catch(() => {});

    const session = startSession({
      isHost,
      roomId,
      localStream: streamRef.current,
      lobby,
      displayName,
      onStatus: setStatus,
      onError: setError,
      onPeerName: setPeerName,
      onRemoteStream: setRemoteStream,
      onConnectionState: setConnectionState,
    });
    sessionRef.current = session;

    return () => {
      session.destroy();
      sessionRef.current = null;
    };
    // Start the call once. Restarting would hang up a working connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleMic() {
    const next = !micOn;
    streamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = next;
    });
    setMicOn(next);
  }

  function toggleCam() {
    const next = !camOn;
    streamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = next;
    });
    setCamOn(next);
  }

  async function onSwitchCamera(id) {
    onSelectedDevices((prev) => ({ ...prev, videoDeviceId: id }));
    try {
      const track = await switchDevice(streamRef.current, "video", id);
      await sessionRef.current?.replaceTrack("video", track);
      if (track) track.enabled = camOn;
    } catch (err) {
      setError(classifyMediaError(err));
    }
  }

  async function onSwitchMic(id) {
    onSelectedDevices((prev) => ({ ...prev, audioDeviceId: id }));
    try {
      const track = await switchDevice(streamRef.current, "audio", id);
      await sessionRef.current?.replaceTrack("audio", track);
      if (track) track.enabled = micOn;
    } catch (err) {
      setError(classifyMediaError(err));
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not copy the link. Share the room code instead.");
    }
  }

  function endCall() {
    sessionRef.current?.destroy();
    sessionRef.current = null;
    stopStream(streamRef.current);
    onLeave();
  }

  const waiting = status === "waiting";
  const full = status === "full";

  return (
    <main className={`page call ${waiting || full ? "is-waiting" : ""}`}>
      {error && (
        <div className="call-banner">
          <ErrorBanner
            message={error}
            onRetry={full || status === "error" ? onLeave : undefined}
            retryLabel="Back to home"
          />
        </div>
      )}

      <div className="stage">
        {waiting || full ? (
          <VideoTile
            stream={localStream}
            muted
            mirror
            label={displayName}
            className="stage-local-large"
            overlay={!camOn ? "Camera off" : null}
          />
        ) : (
          <>
            <VideoTile
              stream={remoteStream}
              speakerId={selectedDevices.speakerDeviceId}
              label={peerName || (isHost ? "Guest" : "Host")}
              className="stage-remote"
              overlay={
                !remoteStream
                  ? connectionState === "failed"
                    ? "Connection failed"
                    : "Connecting…"
                  : null
              }
            />
            <VideoTile
              stream={localStream}
              muted
              mirror
              label={displayName}
              className="stage-pip"
              overlay={!camOn ? "Camera off" : null}
            />
          </>
        )}
      </div>

      {waiting && (
        <div className="wait-card">
          <p className="eyebrow">Waiting for the other person</p>
          <h2 className="mono room-code">{roomId}</h2>
          <p className="hint">Share this code. The other person can join from a different Wi‑Fi, phone data, or country — stay on this screen.</p>
          <button type="button" className="btn btn-secondary" onClick={copyLink}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy invite link"}
          </button>
        </div>
      )}

      {devicesOpen && (
        <div className="device-sheet card stack">
          <div className="sheet-head">
            <strong>Devices</strong>
            <button type="button" className="text-btn" onClick={() => setDevicesOpen(false)}>
              Close
            </button>
          </div>
          <DeviceSelect
            id="live-camera"
            label="Camera"
            value={selectedDevices.videoDeviceId}
            options={devices.cameras}
            onChange={onSwitchCamera}
          />
          <DeviceSelect
            id="live-mic"
            label="Microphone"
            value={selectedDevices.audioDeviceId}
            options={devices.mics}
            onChange={onSwitchMic}
          />
          {canPickSpeaker && (
            <DeviceSelect
              id="live-speaker"
              label="Speakers"
              value={selectedDevices.speakerDeviceId}
              options={devices.speakers}
              onChange={(id) => onSelectedDevices((prev) => ({ ...prev, speakerDeviceId: id }))}
            />
          )}
        </div>
      )}

      {!full && (
        <CallControls
          micOn={micOn}
          camOn={camOn}
          onToggleMic={toggleMic}
          onToggleCam={toggleCam}
          onOpenDevices={() => setDevicesOpen((v) => !v)}
          onEnd={endCall}
        />
      )}
    </main>
  );
}
