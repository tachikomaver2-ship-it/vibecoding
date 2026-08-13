export function ProgressBar({ value, color }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="progress" title={`进度 ${v}%`}>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${v}%`, background: color || '#3b82f6' }} />
      </div>
      <span className="progress-num">{v}%</span>
    </div>
  );
}
