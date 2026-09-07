import { useCallback, useEffect, useRef, useState } from "react";
import VideoTile from "../components/VideoTile.jsx";
import CallControls from "../components/CallControls.jsx";
import DeviceSelect from "../components/DeviceSelect.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
import { CopyIcon, CheckIcon } from "../components/Icons.jsx";
import { createPeer, replaceCallTrack } from "../lib/peer.js";
import { peerIdForRoom } from "../lib/rooms.js";
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

  const peerRef = useRef(null);
  const callRef = useRef(null);
  const streamRef = useRef(localStream);

  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  const canPickSpeaker = supportsSpeakerSelect();

  const teardownCall = useCallback(() => {
    try {
      callRef.current?.close();
    } catch {
      /* already closed */
    }
    callRef.current = null;
    setRemoteStream(null);
    setPeerName("");
    setConnectionState("");
  }, []);

  const teardownAll = useCallback(() => {
    teardownCall();
    try {
      peerRef.current?.destroy();
    } catch {
      /* already destroyed */
    }
    peerRef.current = null;
  }, [teardownCall]);

  useEffect(() => {
    streamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    let cancelled = false;

    listDevices().then(setDevices).catch(() => {});

    function wireCall(call) {
      callRef.current = call;
      if (call.metadata?.name) setPeerName(call.metadata.name);

      call.on("stream", (stream) => {
        if (cancelled) return;
        setRemoteStream(stream);
        setStatus("in-call");
        setError("");
      });

      call.on("close", () => {
        if (cancelled) return;
        teardownCall();
        setStatus(isHost ? "waiting" : "error");
        if (!isHost) setError("The other person left.");
      });

      const pc = call.peerConnection;
      if (pc) {
        pc.onconnectionstatechange = () => {
          if (cancelled) return;
          const state = pc.connectionState;
          setConnectionState(state);
          if (state === "failed") {
            setError("Connection failed. STUN may not be enough on this network — a TURN server is needed for some NATs.");
          }
          if (state === "connected" || state === "completed") {
            setStatus("in-call");
            setError("");
          }
          if (state === "disconnected") setStatus("reconnecting");
        };
      }
    }

    async function start() {
      try {
        if (isHost) {
          const peer = await createPeer(peerIdForRoom(roomId));
          if (cancelled) {
            peer.destroy();
            return;
          }
          peerRef.current = peer;
          peer.on("error", (err) => {
            if (cancelled) return;
            if (err?.type === "unavailable-id") {
              setError("This room is already in use. Create a new room.");
              setStatus("error");
              return;
            }
            setError(err?.message || "Could not start the room.");
          });
          peer.on("call", (call) => {
            if (callRef.current?.open) {
              call.close();
              return;
            }
            setPeerName(call.metadata?.name || "Guest");
            setStatus("connecting");
            call.answer(streamRef.current);
            wireCall(call);
          });
          setStatus("waiting");
          return;
        }

        const peer = await createPeer();
        if (cancelled) {
          peer.destroy();
          return;
        }
        peerRef.current = peer;
        peer.on("error", (err) => {
          if (cancelled) return;
          if (err?.type === "peer-unavailable") {
            setError("Room not found. Create a room first, or check the code.");
            setStatus("error");
            return;
          }
          setError(err?.message || "Could not join the room.");
          setStatus("error");
        });

        const call = peer.call(peerIdForRoom(roomId), streamRef.current, {
          metadata: { name: displayName },
        });
        if (!call) {
          setError("Room not found. Create a room first, or check the code.");
          setStatus("error");
          return;
        }
        wireCall(call);
      } catch (err) {
        if (cancelled) return;
        if (err?.type === "unavailable-id") {
          setError("This room is already in use. Create a new room.");
        } else if (err?.type === "peer-unavailable") {
          setError("Room not found. Create a room first, or check the code.");
        } else {
          setError(err?.message || "Could not connect.");
        }
        setStatus("error");
      }
    }

    start();

    return () => {
      cancelled = true;
      teardownAll();
    };
  }, [displayName, roomId, isHost, teardownCall, teardownAll]);

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
      await replaceCallTrack(callRef.current, "video", track);
      if (track) track.enabled = camOn;
    } catch (err) {
      setError(classifyMediaError(err));
    }
  }

  async function onSwitchMic(id) {
    onSelectedDevices((prev) => ({ ...prev, audioDeviceId: id }));
    try {
      const track = await switchDevice(streamRef.current, "audio", id);
      await replaceCallTrack(callRef.current, "audio", track);
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
    teardownAll();
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
              label={peerName || "Connecting…"}
              className="stage-remote"
              overlay={!remoteStream ? (connectionState === "failed" ? "Connection failed" : "Connecting…") : null}
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
          <p className="hint">Share this code or link. Only one other person can join.</p>
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
      {!waiting && !full && connectionState && (
        <span className={`status-pill ${connectionState}`}>{connectionState}</span>
      )}
    </main>
  );
}
