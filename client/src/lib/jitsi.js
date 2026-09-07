const JITSI_SCRIPT = "https://meet.jit.si/external_api.js";

export function jitsiRoomName(roomId) {
  return `MySavingsLive${String(roomId || "").trim().toUpperCase()}`;
}

export function loadJitsiApi() {
  if (window.JitsiMeetExternalAPI) return Promise.resolve(window.JitsiMeetExternalAPI);
  if (window.__jitsiApiLoading) return window.__jitsiApiLoading;

  window.__jitsiApiLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = JITSI_SCRIPT;
    script.async = true;
    script.onload = () => {
      if (window.JitsiMeetExternalAPI) resolve(window.JitsiMeetExternalAPI);
      else reject(new Error("Jitsi failed to load."));
    };
    script.onerror = () => reject(new Error("Could not load the video service. Check your network and try again."));
    document.body.appendChild(script);
  });

  return window.__jitsiApiLoading;
}
