/** Human-readable messages for getUserMedia / device errors. */
export function classifyMediaError(err) {
  const name = err?.name || "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera or microphone access was denied. Allow permissions in your browser settings and try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera or microphone was found. Plug in a device, or start OBS Virtual Camera, and try again.";
    case "NotReadableError":
    case "TrackStartError":
      return "That camera is already in use. If you are using OBS, start Virtual Camera in OBS and pick OBS Virtual Camera here.";
    case "OverconstrainedError":
      return "The selected device isn’t available. Pick OBS Virtual Camera or another camera.";
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

export function isVirtualCamera(device) {
  const label = `${device?.label || ""}`.toLowerCase();
  return /obs|virtual camera|virtual cam|\bvcam\b|unity capture|streamlabs|mmhmm|snap camera|ecamm|manycam|prism|ndi|elgato|camo/.test(label);
}

export function pickDefaultCamera(cameras, preferVirtual = false) {
  if (!cameras?.length) return "";
  if (preferVirtual) {
    const virtual = cameras.find(isVirtualCamera);
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
    cameras: devices.filter((d) => d.kind === "videoinput"),
    mics: devices.filter((d) => d.kind === "audioinput"),
    speakers: devices.filter((d) => d.kind === "audiooutput"),
  };
}

function audioConstraints(deviceId) {
  const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  return deviceId ? { ...base, deviceId: { exact: deviceId } } : base;
}

function videoAttempts(deviceId) {
  if (!deviceId) return [true];
  return [
    { deviceId: { exact: deviceId } },
    { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  ];
}

function cameraOrder(cameras, videoDeviceId, preferVirtual) {
  const ordered = [];
  const add = (device) => {
    if (device && !ordered.some((d) => d.deviceId === device.deviceId)) ordered.push(device);
  };

  add(cameras.find((d) => d.deviceId === videoDeviceId));
  if (preferVirtual || isVirtualCamera({ label: cameras.find((d) => d.deviceId === videoDeviceId)?.label })) {
    cameras.filter(isVirtualCamera).forEach(add);
  }
  cameras.forEach(add);
  return ordered;
}

/**
 * Request a local MediaStream, falling back across cameras (including OBS)
 * then audio-only if needed.
 */
export async function getLocalStream({
  videoDeviceId,
  audioDeviceId,
  preferVirtual = false,
} = {}) {
  const listed = await listDevices().catch(() => ({ cameras: [] }));
  const cameras = cameraOrder(listed.cameras, videoDeviceId, preferVirtual);
  let lastErr;

  const tryVideo = async (video) =>
    navigator.mediaDevices.getUserMedia({
      video,
      audio: audioConstraints(audioDeviceId),
    });

  for (const camera of cameras) {
    for (const video of videoAttempts(camera.deviceId)) {
      try {
        return await tryVideo(video);
      } catch (err) {
        lastErr = err;
        if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") throw err;
      }
    }
  }

  if (!cameras.length) {
    try {
      return await tryVideo(true);
    } catch (err) {
      lastErr = err;
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") throw err;
    }
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: audioConstraints(audioDeviceId),
    });
  } catch {
    throw lastErr || new Error("Could not access your camera or microphone.");
  }
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
