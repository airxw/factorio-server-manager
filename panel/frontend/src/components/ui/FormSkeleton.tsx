interface FormSkeletonProps {
  fields?: number;
}

export default function FormSkeleton({ fields = 6 }: FormSkeletonProps) {
  return (
    <form className="form-card">
      <div className="card-title">
        <div className="skeleton-bar" style={{ width: '30%' }} />
      </div>
      <div className="form-row">
        {Array.from({ length: Math.min(fields, 4) }).map((_, i) => (
          <label key={i} className="form-field">
            <span className="form-label">
              <div className="skeleton-bar" style={{ width: '50%' }} />
            </span>
            <div className="skeleton-bar" style={{ height: 36, width: '100%' }} />
            <span className="form-hint">
              <div className="skeleton-bar" style={{ width: '60%' }} />
            </span>
          </label>
        ))}
      </div>
      {fields > 4 && (
        <div className="form-row">
          {Array.from({ length: Math.min(fields - 4, 4) }).map((_, i) => (
            <label key={i} className="form-field">
              <span className="form-label">
                <div className="skeleton-bar" style={{ width: '50%' }} />
              </span>
              <div className="skeleton-bar" style={{ height: 36, width: '100%' }} />
            </label>
          ))}
        </div>
      )}
      <div className="form-actions">
        <div className="skeleton-bar" style={{ height: 36, width: '100px' }} />
        <div className="skeleton-bar" style={{ height: 36, width: '100px' }} />
      </div>
    </form>
  );
}