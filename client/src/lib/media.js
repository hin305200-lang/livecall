/** Human-readable messages for getUserMedia / device errors. */
export function classifyMediaError(err) {
  const name = err?.name || "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera or microphone access was denied. Allow permissions in your browser settings and try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera or microphone was found. Allow camera access in the browser, then pick OBS from the Camera list.";
    case "NotReadableError":
    case "TrackStartError":
      return "That camera is busy. Pick OBS Virtual Camera in the Camera list — not the laptop webcam OBS is already using.";
    case "OverconstrainedError":
      return "The selected camera isn’t available. Pick another camera from the list.";
    case "SecurityError":
      return "This browser blocked media access. Use HTTPS or localhost.";
    default:
      return err?.message || "Could not access your camera or microphone.";
  }
}

export function stopStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

export function supportsSpeakerSelect() {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

export function isObsCamera(device) {
  return /obs/i.test(`${device?.label || ""}`);
}

export function isVirtualCamera(device) {
  const label = `${device?.label || ""}`.toLowerCase();
  return /obs|virtual\s*cam|vcam|unity capture|streamlabs|mmhmm|snap camera|ecamm|manycam|prism|ndi|elgato|camo|dummy|loopback|capture card/.test(label);
}

export function isBuiltinCamera(device) {
  const label = `${device?.label || ""}`.toLowerCase();
  return /facetime|built-?in|integrated|continuity|iphone|ipad|desk view/.test(label);
}

export function findObsCamera(cameras = []) {
  return (
    cameras.find(isObsCamera) ||
    cameras.find(isVirtualCamera) ||
    cameras.find((device) => device.label && !isBuiltinCamera(device) && cameras.some(isBuiltinCamera)) ||
    null
  );
}

export function sortCameras(cameras = []) {
  return [...cameras].sort((a, b) => scoreCamera(a) - scoreCamera(b));
}

function scoreCamera(device) {
  if (isObsCamera(device)) return 0;
  if (isVirtualCamera(device)) return 1;
  if (!isBuiltinCamera(device) && device.label) return 2;
  return 3;
}

export function pickDefaultCamera(cameras, preferVirtual = false) {
  if (!cameras?.length) return "";
  if (preferVirtual) {
    const virtual = findObsCamera(cameras);
    if (virtual) return virtual.deviceId;
  }
  return cameras[0].deviceId;
}

export function deviceLabel(devices, deviceId) {
  return devices.find((d) => d.deviceId === deviceId)?.label || "";
}

export async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    cameras: sortCameras(devices.filter((d) => d.kind === "videoinput")),
    mics: devices.filter((d) => d.kind === "audioinput"),
    speakers: devices.filter((d) => d.kind === "audiooutput"),
  };
}

function audioConstraints(deviceId) {
  const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  return deviceId ? { ...base, deviceId: { ideal: deviceId } } : base;
}

const HD_VIDEO = {
  width: { ideal: 1920, min: 640 },
  height: { ideal: 1080, min: 360 },
  frameRate: { ideal: 30, min: 15 },
};

function videoAttempts(deviceId) {
  if (!deviceId) {
    return [
      { ...HD_VIDEO },
      { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      true,
    ];
  }
  return [
    { ...HD_VIDEO, deviceId: { ideal: deviceId } },
    { ...HD_VIDEO, deviceId: { exact: deviceId } },
    { deviceId: { ideal: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    { deviceId: { ideal: deviceId } },
    true,
  ];
}

async function boostVideoTrack(stream) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track?.applyConstraints) return;
  const height = track.getSettings?.().height || 0;
  if (height >= 720) return;
  try {
    await track.applyConstraints({
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    });
  } catch {
    try {
      await track.applyConstraints({
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      });
    } catch {
      /* keep whatever we got */
    }
  }
}

async function gum(video, audioDeviceId) {
  return navigator.mediaDevices.getUserMedia({
    video,
    audio: audioConstraints(audioDeviceId),
  });
}

function currentVideo(stream) {
  const track = stream?.getVideoTracks?.()[0];
  return {
    track,
    label: track?.label || "",
    deviceId: track?.getSettings?.().deviceId || "",
  };
}

function cameraOrder(cameras, videoDeviceId, preferVirtual) {
  const ordered = [];
  const add = (device) => {
    if (device && !ordered.some((d) => d.deviceId === device.deviceId)) ordered.push(device);
  };

  add(cameras.find((d) => d.deviceId && d.deviceId === videoDeviceId));
  if (preferVirtual) add(findObsCamera(cameras));
  cameras.forEach(add);
  return ordered;
}

/**
 * Open a camera, preferring OBS / virtual cameras when asked.
 * Always requests permission first so the browser reveals device names.
 */
export async function getLocalStream({
  videoDeviceId,
  audioDeviceId,
  preferVirtual = false,
} = {}) {
  let stream = null;
  let lastErr;

  const tryOpen = async (video) => {
    try {
      return await gum(video, audioDeviceId);
    } catch (err) {
      lastErr = err;
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") throw err;
      return null;
    }
  };

  if (videoDeviceId) {
    for (const video of videoAttempts(videoDeviceId)) {
      stream = await tryOpen(video);
      if (stream) break;
    }
  }

  if (!stream) stream = await tryOpen(true);

  if (!stream) {
    const listed = await listDevices().catch(() => ({ cameras: [] }));
    for (const camera of listed.cameras) {
      if (!camera.deviceId) continue;
      stream = await tryOpen({ ...HD_VIDEO, deviceId: { ideal: camera.deviceId } });
      if (stream) break;
    }
  }

  if (!stream) {
    throw lastErr || new Error("Could not access your camera or microphone.");
  }

  await boostVideoTrack(stream);

  const listed = await listDevices().catch(() => ({ cameras: [] }));
  const wanted = cameraOrder(listed.cameras, videoDeviceId, preferVirtual)[0];
  const active = currentVideo(stream);
  const alreadyWanted =
    wanted &&
    ((wanted.deviceId && active.deviceId && wanted.deviceId === active.deviceId) ||
      (wanted.label && active.label && wanted.label === active.label));

  if (wanted?.deviceId && !alreadyWanted) {
    for (const video of videoAttempts(wanted.deviceId)) {
      const next = await tryOpen(video);
      if (next) {
        stopStream(stream);
        await boostVideoTrack(next);
        return next;
      }
    }
  }

  return stream;
}

/**
 * Swap a camera or mic while keeping the same MediaStream object
 * (so <video srcObject> keeps working) and return the new track
 * so the caller can replaceTrack() on the RTCPeerConnection.
 */
export async function switchDevice(stream, kind, deviceId) {
  const constraints =
    kind === "video"
      ? { video: videoAttempts(deviceId)[0], audio: false }
      : { video: false, audio: audioConstraints(deviceId) };

  const next = await navigator.mediaDevices.getUserMedia(constraints);
  const newTrack = kind === "video" ? next.getVideoTracks()[0] : next.getAudioTracks()[0];
  const oldTrack = kind === "video" ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0];

  if (oldTrack) {
    stream.removeTrack(oldTrack);
    oldTrack.stop();
  }
  if (newTrack) stream.addTrack(newTrack);

  next.getTracks().forEach((t) => {
    if (t !== newTrack) t.stop();
  });

  return newTrack || null;
}
