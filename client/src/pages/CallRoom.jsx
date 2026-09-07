import { useCallback, useEffect, useRef, useState } from "react";
import VideoTile from "../components/VideoTile.jsx";
import CallControls from "../components/CallControls.jsx";
import DeviceSelect from "../components/DeviceSelect.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
import { CopyIcon, CheckIcon } from "../components/Icons.jsx";
import { getSocket } from "../lib/socket.js";
import { createPeerConnection } from "../lib/webrtc.js";
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
  localStream,
  selectedDevices,
  onSelectedDevices,
  onLeave,
}) {
  const [remoteStream, setRemoteStream] = useState(null);
  const [peerName, setPeerName] = useState("");
  const [status, setStatus] = useState("connecting");
  const [connectionState, setConnectionState] = useState("");
  const [error, setError] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [devices, setDevices] = useState({ cameras: [], mics: [], speakers: [] });

  const peerRef = useRef(null);
  const streamRef = useRef(localStream);
  const joinedRef = useRef(false);

  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  const canPickSpeaker = supportsSpeakerSelect();

  const teardownPeer = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    setRemoteStream(null);
    setPeerName("");
    setConnectionState("");
  }, []);

  const ensurePeer = useCallback(() => {
    if (peerRef.current) return peerRef.current;
    const socket = getSocket();
    const peer = createPeerConnection({
      localStream: streamRef.current,
      onRemoteStream: (stream) => setRemoteStream(stream),
      onIceCandidate: (candidate) => {
        socket.emit("ice-candidate", { candidate });
      },
      onConnectionStateChange: (state) => {
        setConnectionState(state);
        if (state === "failed") {
          setError("Connection failed. STUN may not be enough on this network — a TURN server is needed for some NATs.");
        }
        if (state === "connected" || state === "completed") {
          setStatus("in-call");
          setError("");
        }
        if (state === "disconnected") {
          setStatus("reconnecting");
        }
      },
    });
    peerRef.current = peer;
    return peer;
  }, []);

  useEffect(() => {
    streamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    const socket = getSocket();
    let cancelled = false;

    listDevices().then(setDevices).catch(() => {});

    // Signaling: join the Socket.io room, then either wait (first peer)
    // or answer an offer (second peer). The first peer creates the offer
    // when it receives `peer-joined`.

    function onOffer({ offer }) {
      const peer = ensurePeer();
      peer.handleOffer(offer).then((answer) => {
        socket.emit("answer", { answer });
      }).catch((err) => {
        console.error(err);
        setError("Could not answer the call.");
      });
    }

    function onAnswer({ answer }) {
      peerRef.current?.handleAnswer(answer).catch((err) => {
        console.error(err);
        setError("Could not complete the handshake.");
      });
    }

    function onIce({ candidate }) {
      // ICE can arrive before the join ack creates the PC — always ensure it exists.
      ensurePeer().addIceCandidate(candidate);
    }

    function onPeerJoined({ name, shouldOffer }) {
      setPeerName(name);
      setStatus("connecting");
      const peer = ensurePeer();
      if (shouldOffer) {
        peer.createOffer().then((offer) => {
          socket.emit("offer", { offer });
        }).catch((err) => {
          console.error(err);
          setError("Could not start the call.");
        });
      }
    }

    function onPeerLeft() {
      teardownPeer();
      setStatus("waiting");
      setError("");
    }

    socket.on("offer", onOffer);
    socket.on("answer", onAnswer);
    socket.on("ice-candidate", onIce);
    socket.on("peer-joined", onPeerJoined);
    socket.on("peer-left", onPeerLeft);

    socket.emit("join-call", { roomId, name: displayName }, (res) => {
      if (cancelled) return;
      if (!res?.ok) {
        if (res?.error === "full") {
          setError("Room is full. This call only supports two people.");
          setStatus("full");
        } else if (res?.error === "not-found") {
          setError("Room not found. It may have expired.");
          setStatus("error");
        } else {
          setError("Could not join the room.");
          setStatus("error");
        }
        return;
      }

      joinedRef.current = true;
      if (res.peer) {
        setPeerName(res.peer.name);
        setStatus("connecting");
        ensurePeer();
      } else {
        setStatus("waiting");
      }
    });

    return () => {
      cancelled = true;
      socket.off("offer", onOffer);
      socket.off("answer", onAnswer);
      socket.off("ice-candidate", onIce);
      socket.off("peer-joined", onPeerJoined);
      socket.off("peer-left", onPeerLeft);
      teardownPeer();
      if (joinedRef.current) socket.emit("leave-call");
    };
  }, [displayName, roomId, ensurePeer, teardownPeer]);

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
      await peerRef.current?.replaceTrack("video", track);
      if (track) track.enabled = camOn;
    } catch (err) {
      setError(classifyMediaError(err));
    }
  }

  async function onSwitchMic(id) {
    onSelectedDevices((prev) => ({ ...prev, audioDeviceId: id }));
    try {
      const track = await switchDevice(streamRef.current, "audio", id);
      await peerRef.current?.replaceTrack("audio", track);
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
    teardownPeer();
    stopStream(streamRef.current);
    getSocket().emit("leave-call");
    joinedRef.current = false;
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
