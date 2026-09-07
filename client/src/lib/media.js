/** Human-readable messages for getUserMedia / device errors. */
export function classifyMediaError(err) {
  const name = err?.name || "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera or microphone access was denied. Allow permissions in your browser settings and try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera or microphone was found. Plug in a device and try again.";
    case "NotReadableError":
    case "TrackStartError":
      return "Your camera or microphone is already in use by another application.";
    case "OverconstrainedError":
      return "The selected device isn’t available. Pick a different camera or microphone.";
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

export async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    cameras: devices.filter((d) => d.kind === "videoinput"),
    mics: devices.filter((d) => d.kind === "audioinput"),
    speakers: devices.filter((d) => d.kind === "audiooutput"),
  };
}

function videoConstraints(deviceId) {
  const base = {
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 24 },
    facingMode: "user",
  };
  return deviceId ? { ...base, deviceId: { exact: deviceId }, facingMode: undefined } : base;
}

function audioConstraints(deviceId) {
  const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  return deviceId ? { ...base, deviceId: { exact: deviceId } } : base;
}

/**
 * Request a local MediaStream, falling back to audio-only if the camera fails.
 */
export async function getLocalStream({ videoDeviceId, audioDeviceId } = {}) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: videoConstraints(videoDeviceId),
      audio: audioConstraints(audioDeviceId),
    });
  } catch (err) {
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      throw err;
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: audioConstraints(audioDeviceId),
      });
    } catch {
      throw err;
    }
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
      ? { video: videoConstraints(deviceId), audio: false }
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
