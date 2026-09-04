export function ActionErrorMessage({
  error,
  incidentId,
  className = "form-error",
  id,
}: {
  error?: string;
  incidentId?: string;
  className?: string;
  id?: string;
}) {
  if (!error) return null;
  return (
    <p className={className} id={id} role="alert">
      {error}
      {incidentId && (
        <span className="incident-reference">
          错误编号：<code>{incidentId}</code>
        </span>
      )}
    </p>
  );
}
