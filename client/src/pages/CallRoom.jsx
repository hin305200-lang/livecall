import { useEffect, useRef, useState } from "react";
import CallControls from "../components/CallControls.jsx";
import DeviceSelect from "../components/DeviceSelect.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
import VideoTile from "../components/VideoTile.jsx";
import { CopyIcon, CheckIcon } from "../components/Icons.jsx";
import { createTracksFromStream, joinJitsiRoom } from "../lib/jitsi.js";
import {
  findObsCamera,
  getLocalStream,
  isObsCamera,
  isVirtualCamera,
  listDevices,
} from "../lib/media.js";

export default function CallRoom({
  displayName,
  roomId,
  isHost,
  localStream,
  selectedDevices,
  onLocalStream,
  onLeave,
}) {
  const [error, setError] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [copied, setCopied] = useState(false);
  const [participantCount, setParticipantCount] = useState(1);
  const [joined, setJoined] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [callDevices, setCallDevices] = useState({ cameras: [], mics: [], speakers: [] });
  const [remoteStream, setRemoteStream] = useState(null);
  const [preview, setPreview] = useState(localStream);

  const sessionRef = useRef(null);
  const tracksRef = useRef([]);
  const previewRef = useRef(localStream);
  const leftRef = useRef(false);
  const shareUrl = `${window.location.origin}/?room=${roomId}`;
  const waiting = joined && participantCount < 2;
  const localLabel = preview?.getVideoTracks?.()[0]?.label || selectedDevices.videoLabel || "";
  const sendingObs = isObsCamera({ label: localLabel }) || isVirtualCamera({ label: localLabel });

  previewRef.current = preview;

  function leaveOnce() {
    if (leftRef.current) return;
    leftRef.current = true;
    try {
      sessionRef.current?.leave?.();
    } catch {
      /* ignore */
    }
    sessionRef.current = null;
    onLeave();
  }

  async function refreshDeviceList() {
    try {
      setCallDevices(await listDevices());
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        if (!localStream) {
          throw new Error("Camera was not started. Go back and choose OBS Virtual Camera.");
        }
        if (isHost) {
          const label = localStream?.getVideoTracks?.()[0]?.label || "";
          if (!isObsCamera({ label }) && !isVirtualCamera({ label })) {
            throw new Error(
              "OBS is not the camera. In OBS click Start Virtual Camera, then choose OBS Virtual Camera before joining.",
            );
          }
        }

        const session = await joinJitsiRoom({
          displayName,
          roomId,
          stream: localStream,
          deviceIds: selectedDevices,
          onRemoteStream: (media) => {
            if (!cancelled) setRemoteStream(media);
          },
          onParticipants: (count) => {
            if (!cancelled) setParticipantCount(Number(count) || 1);
          },
          onError: (err) => {
            if (!cancelled) setError(err?.message || "The meeting failed.");
          },
        });

        if (cancelled) {
          session.leave();
          return;
        }

        sessionRef.current = session;
        tracksRef.current = session.localTracks || [];
        setJoined(true);
        await refreshDeviceList();
      } catch (err) {
        if (!cancelled) setError(err?.message || "Could not start the meeting.");
      }
    }

    start();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDeviceList);

    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDeviceList);
      try {
        sessionRef.current?.leave?.();
      } catch {
        /* ignore */
      }
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function localTrack(kind) {
    return tracksRef.current.find((track) => track.getType?.() === kind);
  }

  async function toggleMic() {
    const track = localTrack("audio");
    if (!track) return;
    if (track.isMuted()) await track.unmute();
    else await track.mute();
    setMicOn(!track.isMuted());
  }

  async function toggleCam() {
    const track = localTrack("video");
    if (!track) return;
    if (track.isMuted()) await track.unmute();
    else await track.mute();
    setCamOn(!track.isMuted());
  }

  async function changeCallDevice(kind, deviceId) {
    const session = sessionRef.current;
    if (!session?.conference) return;
    const listed = await listDevices();
    setCallDevices(listed);

    if (isHost && kind === "video") {
      const camera = listed.cameras.find((d) => d.deviceId === deviceId);
      if (camera && !isObsCamera(camera) && !isVirtualCamera(camera)) {
        setError("Pick OBS Virtual Camera so the other person sees OBS, not your webcam.");
        return;
      }
    }

    const nextIds = {
      ...selectedDevices,
      ...(kind === "video" ? { videoDeviceId: deviceId } : {}),
      ...(kind === "audio" ? { audioDeviceId: deviceId } : {}),
    };
    if (kind === "video") nextIds.videoLabel = listed.cameras.find((d) => d.deviceId === deviceId)?.label || "";
    if (kind === "audio") nextIds.audioLabel = listed.mics.find((d) => d.deviceId === deviceId)?.label || "";

    const nextStream = await getLocalStream({
      ...nextIds,
      preferVirtual: isHost,
      requireObs: isHost && kind === "video",
    });
    const newTracks = await createTracksFromStream(session.JitsiMeetJS, nextStream, nextIds);
    const old = localTrack(kind);
    const next = newTracks.find((track) => track.getType?.() === kind);
    if (old && next) await session.conference.replaceTrack(old, next);
    else if (next) await session.conference.addTrack(next);

    tracksRef.current = [
      ...tracksRef.current.filter((track) => track.getType?.() !== kind),
      next,
    ].filter(Boolean);

    const prev = previewRef.current;
    setPreview(nextStream);
    onLocalStream?.(nextStream);
    if (prev && prev !== nextStream && prev !== localStream) {
      prev.getTracks().forEach((track) => {
        if (track !== nextStream.getVideoTracks()[0] && track !== nextStream.getAudioTracks()[0]) {
          track.stop();
        }
      });
    }
    setError("");
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
    leaveOnce();
  }

  const cameraOptions = callDevices.cameras;
  const obsReady = findObsCamera(callDevices.cameras) || sendingObs;

  return (
    <main className="page call">
      {error && (
        <div className="call-banner">
          <ErrorBanner message={error} onRetry={onLeave} retryLabel="Back to home" />
        </div>
      )}

      <div className="stage">
        <VideoTile
          stream={remoteStream || preview}
          muted={!remoteStream}
          mirror={false}
          speakerId={selectedDevices.speakerDeviceId}
          label={
            remoteStream
              ? "The other person"
              : sendingObs
                ? `${displayName || "You"} · OBS`
                : displayName || "You"
          }
          className={remoteStream ? "stage-remote" : "stage-local-large is-contain"}
        />
        {remoteStream && preview && (
          <VideoTile
            stream={preview}
            muted
            mirror={false}
            label={sendingObs ? "OBS" : displayName || "You"}
            className={`stage-pip${sendingObs ? " is-contain" : ""}`}
          />
        )}
        {waiting && (
          <div className="wait-card">
            <p className="eyebrow">{sendingObs ? "Sending OBS" : "Waiting for the other person"}</p>
            <h2 className="mono room-code">{roomId}</h2>
            <p className="hint">
              {sendingObs
                ? "The other person will see this OBS scene when they join."
                : "Share this code. They can join from any Wi‑Fi, phone data, or country."}
            </p>
            <button type="button" className="btn btn-secondary" onClick={copyLink}>
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied" : "Copy invite link"}
            </button>
          </div>
        )}
      </div>

      {showDevices && (
        <div className="card stack device-sheet">
          <div className="sheet-head">
            <p className="eyebrow">Camera & mic</p>
            <button type="button" className="text-btn" onClick={() => setShowDevices(false)}>
              Close
            </button>
          </div>
          <DeviceSelect
            id="call-camera"
            label="Camera"
            value={selectedDevices.videoDeviceId}
            options={cameraOptions.length ? cameraOptions : callDevices.cameras}
            onChange={(id) => changeCallDevice("video", id)}
            emptyLabel={isHost && !obsReady ? "Start OBS Virtual Camera" : "No cameras found"}
          />
          <p className="hint">
            {isHost
              ? "The other person sees this camera. It must be OBS Virtual Camera."
              : "This is the camera the other person sees."}
          </p>
          <DeviceSelect
            id="call-mic"
            label="Microphone"
            value={selectedDevices.audioDeviceId}
            options={callDevices.mics}
            onChange={(id) => changeCallDevice("audio", id)}
            emptyLabel="No microphones found"
          />
        </div>
      )}

      <CallControls
        micOn={micOn}
        camOn={camOn}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onOpenDevices={() => {
          setShowDevices((open) => !open);
          refreshDeviceList();
        }}
        onEnd={endCall}
      />
    </main>
  );
}
