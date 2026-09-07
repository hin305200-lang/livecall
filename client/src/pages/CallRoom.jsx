import { useEffect, useRef, useState } from "react";
import CallControls from "../components/CallControls.jsx";
import DeviceSelect from "../components/DeviceSelect.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
import { CopyIcon, CheckIcon } from "../components/Icons.jsx";
import { JITSI_DOMAIN, jitsiRoomName, loadJitsiApi } from "../lib/jitsi.js";
import { isVirtualCamera } from "../lib/media.js";

function pickJitsiDevice(list, deviceId, label) {
  return (
    list.find((d) => d.deviceId && d.deviceId === deviceId) ||
    list.find((d) => d.label && label && d.label === label) ||
    null
  );
}

async function setJitsiDevice(api, kind, device) {
  if (!device) return;
  const setter =
    kind === "video"
      ? api.setVideoInputDevice
      : kind === "audio"
        ? api.setAudioInputDevice
        : api.setAudioOutputDevice;
  if (!setter) return;
  try {
    await setter.call(api, device.deviceId || device.label);
  } catch {
    if (device.label) await setter.call(api, device.label);
  }
}

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
  const [showDevices, setShowDevices] = useState(false);
  const [callDevices, setCallDevices] = useState({ cameras: [], mics: [], speakers: [] });
  const [activeDevices, setActiveDevices] = useState({
    videoDeviceId: selectedDevices.videoDeviceId || "",
    audioDeviceId: selectedDevices.audioDeviceId || "",
    speakerDeviceId: selectedDevices.speakerDeviceId || "",
  });

  const mountRef = useRef(null);
  const apiRef = useRef(null);
  const leftRef = useRef(false);
  const joinedRef = useRef(false);
  const selectedRef = useRef(selectedDevices);
  const shareUrl = `${window.location.origin}/?room=${roomId}`;
  const waiting = joined && participantCount < 2;

  selectedRef.current = selectedDevices;

  function leaveOnce() {
    if (leftRef.current) return;
    leftRef.current = true;
    onLeave();
  }

  async function syncCallDevices(api) {
    try {
      const available = await api.getAvailableDevices();
      setCallDevices({
        cameras: available?.videoInput || [],
        mics: available?.audioInput || [],
        speakers: available?.audioOutput || [],
      });
      return available;
    } catch {
      return null;
    }
  }

  async function applySelectedDevices(api, selected = selectedRef.current) {
    const available = (await syncCallDevices(api)) || {};
    const video =
      pickJitsiDevice(available.videoInput || [], selected.videoDeviceId, selected.videoLabel) ||
      (isVirtualCamera({ label: selected.videoLabel })
        ? (available.videoInput || []).find(isVirtualCamera)
        : null);
    const audio = pickJitsiDevice(available.audioInput || [], selected.audioDeviceId, selected.audioLabel);
    const speaker = pickJitsiDevice(available.audioOutput || [], selected.speakerDeviceId, selected.speakerLabel);

    await setJitsiDevice(api, "video", video || (selected.videoLabel ? { label: selected.videoLabel } : null));
    await setJitsiDevice(api, "audio", audio || (selected.audioLabel ? { label: selected.audioLabel } : null));
    await setJitsiDevice(api, "speaker", speaker || (selected.speakerLabel ? { label: selected.speakerLabel } : null));

    setActiveDevices({
      videoDeviceId: video?.deviceId || selected.videoDeviceId || "",
      audioDeviceId: audio?.deviceId || selected.audioDeviceId || "",
      speakerDeviceId: speaker?.deviceId || selected.speakerDeviceId || "",
    });

    try {
      const muted = await api.isVideoMuted?.();
      if (muted) api.executeCommand("toggleVideo");
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    let cancelled = false;
    let api;

    async function start() {
      try {
        const JitsiMeetExternalAPI = await loadJitsiApi();
        if (cancelled || !mountRef.current) return;

        const height = Math.max(window.innerHeight, mountRef.current.clientHeight || 0, 640);
        const selected = selectedRef.current;

        api = new JitsiMeetExternalAPI(JITSI_DOMAIN, {
          roomName: jitsiRoomName(roomId),
          parentNode: mountRef.current,
          width: "100%",
          height,
          lang: "en",
          userInfo: { displayName: displayName || "Guest" },
          devices: {
            ...(selected.videoLabel ? { videoInput: selected.videoLabel } : {}),
            ...(selected.audioLabel ? { audioInput: selected.audioLabel } : {}),
            ...(selected.speakerLabel ? { audioOutput: selected.speakerLabel } : {}),
          },
          configOverwrite: {
            prejoinConfig: { enabled: false },
            disableInitialGUM: false,
            disableDeepLinking: true,
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            disableInviteFunctions: true,
            hideConferenceSubject: true,
            disableLocalVideoFlip: true,
            resolution: 1080,
            toolbarButtons: ["microphone", "camera", "hangup", "settings", "tileview"],
            p2p: { enabled: false },
            constraints: {
              video: {
                height: { ideal: 1080 },
                width: { ideal: 1920 },
              },
            },
          },
          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            SHOW_BRAND_WATERMARK: false,
            DEFAULT_BACKGROUND: "#0c0c0b",
            DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
            VERTICAL_FILMSTRIP: true,
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
          await applySelectedDevices(api);
        });
        api.addListener("deviceListChanged", async () => {
          const available = await syncCallDevices(api);
          const selected = selectedRef.current;
          if (!isVirtualCamera({ label: selected.videoLabel })) return;
          const video =
            pickJitsiDevice(available?.videoInput || [], selected.videoDeviceId, selected.videoLabel) ||
            (available?.videoInput || []).find(isVirtualCamera);
          if (video) await setJitsiDevice(api, "video", video);
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

  async function changeCallDevice(kind, deviceId) {
    const api = apiRef.current;
    if (!api) return;
    const list = kind === "video" ? callDevices.cameras : kind === "audio" ? callDevices.mics : callDevices.speakers;
    const device = list.find((d) => d.deviceId === deviceId);
    await setJitsiDevice(api, kind, device || { deviceId });
    setActiveDevices((prev) => ({
      ...prev,
      ...(kind === "video"
        ? { videoDeviceId: deviceId }
        : kind === "audio"
          ? { audioDeviceId: deviceId }
          : { speakerDeviceId: deviceId }),
    }));
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
            value={activeDevices.videoDeviceId}
            options={callDevices.cameras}
            onChange={(id) => changeCallDevice("video", id)}
            emptyLabel="No cameras found"
          />
          <p className="hint">OBS: start Virtual Camera in OBS, then pick OBS Virtual Camera.</p>
          <DeviceSelect
            id="call-mic"
            label="Microphone"
            value={activeDevices.audioDeviceId}
            options={callDevices.mics}
            onChange={(id) => changeCallDevice("audio", id)}
            emptyLabel="No microphones found"
          />
          {callDevices.speakers.length > 0 && (
            <DeviceSelect
              id="call-speaker"
              label="Speakers"
              value={activeDevices.speakerDeviceId}
              options={callDevices.speakers}
              onChange={(id) => changeCallDevice("speaker", id)}
              emptyLabel="No speakers found"
            />
          )}
        </div>
      )}

      <CallControls
        micOn={micOn}
        camOn={camOn}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onOpenDevices={() => {
          setShowDevices((open) => !open);
          if (apiRef.current) syncCallDevices(apiRef.current);
        }}
        onEnd={endCall}
      />
    </main>
  );
}
