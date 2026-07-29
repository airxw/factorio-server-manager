export default function TabSkeleton() {
  return (
    <div className="page">
      <div className="info-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div className="skeleton-bar" style={{ width: '30%', height: 20 }} />
            <div className="skeleton-bar" style={{ width: '50%', height: 14, marginTop: 4 }} />
          </div>
          <div className="skeleton-bar" style={{ width: '120px', height: 36 }} />
        </div>
      </div>
      <div className="info-card">
        <h3 className="card-title">
          <div className="skeleton-bar" style={{ width: '40%' }} />
        </h3>
        <div className="skeleton-bar" style={{ width: '100%', height: 20 }} />
        <div className="skeleton-bar" style={{ width: '80%', height: 20, marginTop: 8 }} />
        <div className="skeleton-bar" style={{ width: '90%', height: 20, marginTop: 8 }} />
      </div>
    </div>
  );
}