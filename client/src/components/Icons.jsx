export function MicIcon({ muted = false }) {
  if (muted) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 8v3a4 4 0 0 0 6.3 3.27M16 11V8a4 4 0 0 0-7.3-2.27" />
        <path d="M5 5l14 14" />
        <path d="M12 19v3M8 22h8" />
        <path d="M4.5 12a7.5 7.5 0 0 0 10.2 6.96" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3M8 22h8" />
    </svg>
  );
}

export function CamIcon({ off = false }) {
  if (off) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H14a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 14 19H5.5A2.5 2.5 0 0 1 3 16.5z" />
        <path d="M16.5 10.5l5-3v9l-5-3" />
        <path d="M4 5l16 14" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H14a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 14 19H5.5A2.5 2.5 0 0 1 3 16.5z" />
      <path d="M16.5 10.5l5-3v9l-5-3" />
    </svg>
  );
}

export function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h3l1.2 4.2-2 1.2a12 12 0 0 0 6.4 6.4l1.2-2L21 14v3c0 1.1-.9 2-2 2C9.6 19 5 14.4 5 5c0-1.1.9-2 2-2z" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M4.9 6.3l1.6 1.6M17.5 16.1l1.6 1.6M3 12h2.2M18.8 12H21M4.9 17.7l1.6-1.6M17.5 7.9l1.6-1.6" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="8" width="11" height="13" rx="2" />
      <path d="M5 16V5a2 2 0 0 1 2-2h9" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l5 5 9-11" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
