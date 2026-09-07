export default function DeviceSelect({ id, label, value, options, onChange, disabled, emptyLabel }) {
  const unlabeled = options.length > 0 && options.every((d) => !d.label);
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || options.length === 0}
      >
        {options.length === 0 && <option value="">{emptyLabel || "None found"}</option>}
        {options.map((device, i) => (
          <option key={device.deviceId || i} value={device.deviceId}>
            {device.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
      {unlabeled && (
        <small className="hint">Allow camera access to see device names.</small>
      )}
    </label>
  );
}
