import { CamIcon, MicIcon, PhoneIcon, SettingsIcon } from "./Icons.jsx";

export default function CallControls({
  micOn,
  camOn,
  onToggleMic,
  onToggleCam,
  onOpenDevices,
  onEnd,
}) {
  return (
    <div className="controls">
      <button
        type="button"
        className={`ctrl ${micOn ? "" : "is-off"}`}
        onClick={onToggleMic}
        aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
        title={micOn ? "Mute" : "Unmute"}
      >
        <MicIcon muted={!micOn} />
      </button>
      <button
        type="button"
        className={`ctrl ${camOn ? "" : "is-off"}`}
        onClick={onToggleCam}
        aria-label={camOn ? "Turn camera off" : "Turn camera on"}
        title={camOn ? "Camera off" : "Camera on"}
      >
        <CamIcon off={!camOn} />
      </button>
      <button
        type="button"
        className="ctrl"
        onClick={onOpenDevices}
        aria-label="Switch devices"
        title="Devices"
      >
        <SettingsIcon />
      </button>
      <button
        type="button"
        className="ctrl is-end"
        onClick={onEnd}
        aria-label="End call"
        title="End call"
      >
        <PhoneIcon />
      </button>
    </div>
  );
}
