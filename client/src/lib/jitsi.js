// meet.jit.si now requires an 8x8 login to start a room, which blocks embeds.
export const JITSI_DOMAIN = "meet.element.io";
const JITSI_SCRIPT = `https://${JITSI_DOMAIN}/external_api.js`;

export function jitsiRoomName(roomId) {
  return `mysavingslive${String(roomId || "").trim().toLowerCase()}`;
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
