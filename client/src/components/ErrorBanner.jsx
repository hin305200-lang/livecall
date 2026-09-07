export default function ErrorBanner({ message, onRetry, retryLabel = "Try again" }) {
  if (!message) return null;
  return (
    <div className="banner" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}
