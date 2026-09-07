import { useEffect, useRef, useState } from "react";
import CallControls from "../components/CallControls.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
import { CopyIcon, CheckIcon } from "../components/Icons.jsx";
import { JITSI_DOMAIN, jitsiRoomName, loadJitsiApi } from "../lib/jitsi.js";

export default function CallRoom({
  displayName,
  roomId,
  selectedDevices,
  onLeave,
}) {
  const [error, setError] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [copied, setCopied] = useState(false);
  const [participantCount, setParticipantCount] = useState(1);
  const [joined, setJoined] = useState(false);

  const mountRef = useRef(null);
  const apiRef = useRef(null);
  const leftRef = useRef(false);
  const joinedRef = useRef(false);
  const shareUrl = `${window.location.origin}/?room=${roomId}`;
  const waiting = joined && participantCount < 2;

  function leaveOnce() {
    if (leftRef.current) return;
    leftRef.current = true;
    onLeave();
  }

  useEffect(() => {
    let cancelled = false;
    let api;

    async function start() {
      try {
        const JitsiMeetExternalAPI = await loadJitsiApi();
        if (cancelled || !mountRef.current) return;

        const height = Math.max(window.innerHeight, mountRef.current.clientHeight || 0, 640);

        api = new JitsiMeetExternalAPI(JITSI_DOMAIN, {
          roomName: jitsiRoomName(roomId),
          parentNode: mountRef.current,
          width: "100%",
          height,
          lang: "en",
          userInfo: { displayName: displayName || "Guest" },
          configOverwrite: {
            prejoinConfig: { enabled: false },
            disableInitialGUM: false,
            disableDeepLinking: true,
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            disableInviteFunctions: true,
            hideConferenceSubject: true,
            toolbarButtons: ["microphone", "camera", "hangup", "settings", "tileview"],
            p2p: { enabled: false },
            constraints: {
              video: {
                height: { ideal: 720, max: 720, min: 180 },
              },
            },
          },
          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            SHOW_BRAND_WATERMARK: false,
            DEFAULT_BACKGROUND: "#0c0c0b",
            DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
          },
        });

        if (cancelled) {
          api.dispose();
          return;
        }

        apiRef.current = api;

        const iframe = api.getIFrame?.();
        if (iframe) {
          iframe.style.width = "100%";
          iframe.style.height = "100%";
          iframe.style.border = "0";
          iframe.setAttribute(
            "allow",
            "camera; microphone; display-capture; autoplay; clipboard-write; fullscreen",
          );
        }

        const syncCount = () => {
          try {
            const count = api.getNumberOfParticipants();
            setParticipantCount(Number(count) || 1);
          } catch {
            /* ignore */
          }
        };

        api.addListener("videoConferenceJoined", async () => {
          joinedRef.current = true;
          setJoined(true);
          setError("");
          syncCount();
          try {
            if (selectedDevices.videoDeviceId) {
              await api.setVideoInputDevice(selectedDevices.videoDeviceId);
            }
            if (selectedDevices.audioDeviceId) {
              await api.setAudioInputDevice(selectedDevices.audioDeviceId);
            }
            if (selectedDevices.speakerDeviceId) {
              await api.setAudioOutputDevice?.(selectedDevices.speakerDeviceId);
            }
          } catch (err) {
            console.warn("Could not select devices", err);
          }
        });
        api.addListener("participantJoined", syncCount);
        api.addListener("participantLeft", syncCount);
        api.addListener("audioMuteStatusChanged", ({ muted }) => setMicOn(!muted));
        api.addListener("videoMuteStatusChanged", ({ muted }) => setCamOn(!muted));
        api.addListener("readyToClose", leaveOnce);
        api.addListener("videoConferenceLeft", () => {
          if (!cancelled && joinedRef.current) leaveOnce();
        });
      } catch (err) {
        if (!cancelled) setError(err?.message || "Could not start the meeting.");
      }
    }

    start();

    return () => {
      cancelled = true;
      try {
        api?.dispose();
      } catch {
        /* ignore */
      }
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleMic() {
    apiRef.current?.executeCommand("toggleAudio");
  }

  function toggleCam() {
    apiRef.current?.executeCommand("toggleVideo");
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
    try {
      apiRef.current?.executeCommand("hangup");
    } catch {
      /* ignore */
    }
    try {
      apiRef.current?.dispose();
    } catch {
      /* ignore */
    }
    apiRef.current = null;
    leaveOnce();
  }

  return (
    <main className="page call">
      {error && (
        <div className="call-banner">
          <ErrorBanner message={error} onRetry={onLeave} retryLabel="Back to home" />
        </div>
      )}

      <div className="stage">
        <div ref={mountRef} className="jitsi-root" />
        {waiting && (
          <div className="wait-card">
            <p className="eyebrow">Waiting for the other person</p>
            <h2 className="mono room-code">{roomId}</h2>
            <p className="hint">Share this code. They can join from any Wi‑Fi, phone data, or country.</p>
            <button type="button" className="btn btn-secondary" onClick={copyLink}>
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied" : "Copy invite link"}
            </button>
          </div>
        )}
      </div>

      <CallControls
        micOn={micOn}
        camOn={camOn}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onOpenDevices={() => apiRef.current?.executeCommand("toggleTileView")}
        onEnd={endCall}
      />
    </main>
  );
}
