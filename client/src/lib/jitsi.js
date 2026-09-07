export const JITSI_DOMAIN = "meet.element.io";
const LIB_SCRIPT = `https://${JITSI_DOMAIN}/libs/lib-jitsi-meet.min.js`;
const BOSH = `https://${JITSI_DOMAIN}/http-bind`;

export function jitsiRoomName(roomId) {
  return `mysavingslive${String(roomId || "").trim().toLowerCase()}`;
}

export function loadJitsiMeetJS() {
  if (window.JitsiMeetJS) return Promise.resolve(window.JitsiMeetJS);
  if (window.__jitsiMeetJsLoading) return window.__jitsiMeetJsLoading;

  window.__jitsiMeetJsLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = LIB_SCRIPT;
    script.async = true;
    script.onload = () => {
      if (window.JitsiMeetJS) resolve(window.JitsiMeetJS);
      else reject(new Error("Jitsi failed to load."));
    };
    script.onerror = () => reject(new Error("Could not load the video service. Check your network and try again."));
    document.body.appendChild(script);
  });

  return window.__jitsiMeetJsLoading;
}

function mediaTrack(jitsiTrack) {
  return jitsiTrack?.getTrack?.() || jitsiTrack?.track || null;
}

export async function createTracksFromStream(JitsiMeetJS, stream, deviceIds = {}) {
  const video = stream?.getVideoTracks?.()[0];
  const audio = stream?.getAudioTracks?.()[0];
  const infos = [];

  if (video) {
    infos.push({
      mediaType: "video",
      videoType: "camera",
      sourceType: "camera",
      stream: new MediaStream([video]),
      track: video,
    });
  }
  if (audio) {
    infos.push({
      mediaType: "audio",
      sourceType: "microphone",
      stream: new MediaStream([audio]),
      track: audio,
    });
  }

  if (infos.length) {
    try {
      return JitsiMeetJS.createLocalTracksFromMediaStreams(infos);
    } catch (err) {
      console.warn("Could not wrap the current camera stream", err);
    }
  }

  const devices = [];
  if (video) devices.push("video");
  if (audio) devices.push("audio");
  if (!devices.length) devices.push("audio", "video");

  return JitsiMeetJS.createLocalTracks({
    devices,
    cameraDeviceId: video?.getSettings?.().deviceId || deviceIds.videoDeviceId || undefined,
    micDeviceId: audio?.getSettings?.().deviceId || deviceIds.audioDeviceId || undefined,
    resolution: 1080,
  });
}

export async function joinJitsiRoom({
  displayName,
  roomId,
  stream,
  deviceIds,
  onRemoteStream,
  onParticipants,
  onError,
}) {
  const JitsiMeetJS = await loadJitsiMeetJS();
  if (!JitsiMeetJS.__mysavingsInit) {
    JitsiMeetJS.init({
      disableAudioLevels: true,
      disableThirdPartyRequests: true,
    });
    JitsiMeetJS.setLogLevel?.(JitsiMeetJS.logLevels?.ERROR);
    JitsiMeetJS.__mysavingsInit = true;
  }

  const roomName = jitsiRoomName(roomId);
  const connection = new JitsiMeetJS.JitsiConnection(null, null, {
    hosts: {
      domain: "meet.jitsi",
      muc: "muc.meet.jitsi",
    },
    serviceUrl: `${BOSH}?room=${encodeURIComponent(roomName)}`,
    clientNode: "http://jitsi.org/jitsimeet",
  });

  const localTracks = await createTracksFromStream(JitsiMeetJS, stream, deviceIds);
  const remoteByKey = new Map();
  let conference;

  function emitRemote() {
    const media = new MediaStream();
    for (const track of remoteByKey.values()) {
      const mt = mediaTrack(track);
      if (mt && mt.readyState !== "ended") media.addTrack(mt);
    }
    onRemoteStream?.(media.getTracks().length ? media : null);
  }

  function syncParticipants() {
    try {
      onParticipants?.(conference?.getParticipantCount?.() || 1);
    } catch {
      onParticipants?.(1);
    }
  }

  function leave() {
    try {
      conference?.getLocalTracks?.().forEach((track) => {
        try {
          conference.removeTrack(track);
        } catch {
          /* ignore */
        }
        try {
          track.dispose();
        } catch {
          /* ignore */
        }
      });
    } catch {
      /* ignore */
    }
    try {
      conference?.leave();
    } catch {
      /* ignore */
    }
    try {
      connection.disconnect();
    } catch {
      /* ignore */
    }
  }

  await new Promise((resolve, reject) => {
    const { CONNECTION_ESTABLISHED, CONNECTION_FAILED } = JitsiMeetJS.events.connection;
    let settled = false;
    const timer = window.setTimeout(() => finish(new Error("Meeting connection timed out. Check your network and try again.")), 20000);
    function finish(err) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    }
    connection.addEventListener(CONNECTION_ESTABLISHED, () => finish());
    connection.addEventListener(CONNECTION_FAILED, (...args) => {
      const text = args
        .map((part) => {
          if (!part || typeof part === "object") return part?.message || part?.name || "";
          return String(part);
        })
        .filter(Boolean)
        .join(" ");
      finish(new Error(text || "Could not connect to the meeting."));
    });
    connection.connect();
  });

  conference = connection.initJitsiConference(roomName, {
    p2p: { enabled: false },
    bridgeChannel: { preferSctp: true },
    startAudioMuted: 0,
    startVideoMuted: 0,
  });
  conference.setDisplayName(displayName || "Guest");

  conference.on(JitsiMeetJS.events.conference.TRACK_ADDED, (track) => {
    if (track.isLocal()) return;
    remoteByKey.set(`${track.getParticipantId()}-${track.getType()}`, track);
    emitRemote();
  });
  conference.on(JitsiMeetJS.events.conference.TRACK_REMOVED, (track) => {
    remoteByKey.delete(`${track.getParticipantId()}-${track.getType()}`);
    emitRemote();
  });
  conference.on(JitsiMeetJS.events.conference.USER_JOINED, syncParticipants);
  conference.on(JitsiMeetJS.events.conference.USER_LEFT, syncParticipants);
  conference.on(JitsiMeetJS.events.conference.CONFERENCE_FAILED, (reason) => {
    onError?.(new Error(reason || "The meeting failed."));
  });

  await new Promise((resolve, reject) => {
    conference.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED, resolve);
    conference.on(JitsiMeetJS.events.conference.CONFERENCE_FAILED, (reason) => {
      reject(new Error(reason || "Could not join the meeting."));
    });
    conference.join();
  });

  for (const track of localTracks) {
    await conference.addTrack(track);
  }
  syncParticipants();

  return {
    JitsiMeetJS,
    conference,
    connection,
    localTracks,
    leave,
  };
}
