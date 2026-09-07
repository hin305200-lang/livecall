import { useEffect, useRef, useState } from "react";
import CallControls from "../components/CallControls.jsx";
import DeviceSelect from "../components/DeviceSelect.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
import { CopyIcon, CheckIcon } from "../components/Icons.jsx";
import { JITSI_DOMAIN, jitsiRoomName, loadJitsiApi } from "../lib/jitsi.js";
import { findObsCamera, isObsCamera, isVirtualCamera } from "../lib/media.js";

function labelsMatch(a, b) {
  return `${a || ""}`.trim().toLowerCase() === `${b || ""}`.trim().toLowerCase();
}

function pickByLabel(list, label) {
  if (!label) return null;
  return list.find((d) => labelsMatch(d.label, label)) || null;
}

async function setJitsiDevice(api, kind, device) {
  if (!device || !api) return;
  const label = device.label || "";
  const deviceId = device.deviceId || "";
  const setter =
    kind === "video"
      ? api.setVideoInputDevice
      : kind === "audio"
        ? api.setAudioInputDevice
        : api.setAudioOutputDevice;
  if (!setter) return;
  await setter.call(api, label, deviceId);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function currentVideoLabel(api) {
  try {
    const current = await api.getCurrentDevices();
    return current?.videoInput?.label || "";
  } catch {
    return "";
  }
}

async function unmuteVideo(api) {
  try {
    const muted = await api.isVideoMuted?.();
    if (muted) api.executeCommand("toggleVideo");
  } catch {
    /* ignore */
  }
}

export default function CallRoom({
  displayName,
  roomId,
  isHost,
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
    videoDeviceId: "",
    audioDeviceId: "",
    speakerDeviceId: "",
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

  async function forceHostObsCamera(api) {
    let lastObs = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const available = await syncCallDevices(api);
      const videos = available?.videoInput || [];
      const selected = selectedRef.current;
      const obs =
        pickByLabel(videos, selected.videoLabel) ||
        findObsCamera(videos) ||
        videos.find((d) => isObsCamera(d) || isVirtualCamera(d)) ||
        null;
      if (obs) {
        lastObs = obs;
        await setJitsiDevice(api, "video", obs);
        await unmuteVideo(api);
        const label = await currentVideoLabel(api);
        if (isObsCamera({ label }) || isVirtualCamera({ label }) || labelsMatch(label, obs.label)) {
          setActiveDevices((prev) => ({ ...prev, videoDeviceId: obs.deviceId }));
          return obs;
        }
      }
      await delay(400);
    }
    if (lastObs) {
      setActiveDevices((prev) => ({ ...prev, videoDeviceId: lastObs.deviceId }));
      return lastObs;
    }
    throw new Error(
      "Could not send OBS into the meeting. In OBS click Start Virtual Camera, then choose OBS Virtual Camera.",
    );
  }

  async function applyGuestDevices(api) {
    const available = (await syncCallDevices(api)) || {};
    const selected = selectedRef.current;
    const video = pickByLabel(available.videoInput || [], selected.videoLabel);
    const audio = pickByLabel(available.audioInput || [], selected.audioLabel);
    const speaker = pickByLabel(available.audioOutput || [], selected.speakerLabel);
    await setJitsiDevice(api, "video", video);
    await setJitsiDevice(api, "audio", audio);
    await setJitsiDevice(api, "speaker", speaker);
    await unmuteVideo(api);
    setActiveDevices({
      videoDeviceId: video?.deviceId || "",
      audioDeviceId: audio?.deviceId || "",
      speakerDeviceId: speaker?.deviceId || "",
    });
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
        const hostObsLabel =
          selected.videoLabel && (isObsCamera({ label: selected.videoLabel }) || isVirtualCamera({ label: selected.videoLabel }))
            ? selected.videoLabel
            : "OBS Virtual Camera";

        api = new JitsiMeetExternalAPI(JITSI_DOMAIN, {
          roomName: jitsiRoomName(roomId),
          parentNode: mountRef.current,
          width: "100%",
          height,
          lang: "en",
          userInfo: { displayName: displayName || "Guest" },
          devices: isHost
            ? {
                videoInput: hostObsLabel,
                ...(selected.audioLabel ? { audioInput: selected.audioLabel } : {}),
                ...(selected.speakerLabel ? { audioOutput: selected.speakerLabel } : {}),
              }
            : {
                ...(selected.videoLabel ? { videoInput: selected.videoLabel } : {}),
                ...(selected.audioLabel ? { audioInput: selected.audioLabel } : {}),
                ...(selected.speakerLabel ? { audioOutput: selected.speakerLabel } : {}),
              },
          configOverwrite: {
            prejoinConfig: { enabled: false },
            disableInitialGUM: Boolean(isHost),
            disableDeepLinking: true,
            startWithAudioMuted: false,
            startWithVideoMuted: Boolean(isHost),
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
          try {
            if (isHost) await forceHostObsCamera(api);
            else await applyGuestDevices(api);
          } catch (err) {
            if (!cancelled) setError(err?.message || "Could not use OBS as the camera.");
          }
        });
        api.addListener("deviceListChanged", async () => {
          await syncCallDevices(api);
          if (!isHost) return;
          const label = await currentVideoLabel(api);
          if (isObsCamera({ label }) || isVirtualCamera({ label })) return;
          try {
            await forceHostObsCamera(api);
          } catch {
            /* OBS may not be started yet */
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

  async function changeCallDevice(kind, deviceId) {
    const api = apiRef.current;
    if (!api) return;
    const list = kind === "video" ? callDevices.cameras : kind === "audio" ? callDevices.mics : callDevices.speakers;
    const device = list.find((d) => d.deviceId === deviceId);
    await setJitsiDevice(api, kind, device || { deviceId });
    if (kind === "video") await unmuteVideo(api);
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
          <p className="hint">The other person sees this camera. Hosts should pick OBS Virtual Camera.</p>
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
