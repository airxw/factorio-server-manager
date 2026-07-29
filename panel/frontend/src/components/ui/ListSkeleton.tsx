interface ListSkeletonProps {
  rows?: number;
  columns?: number;
}

export default function ListSkeleton({ rows = 5, columns = 4 }: ListSkeletonProps) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i}>
                <div className="skeleton-bar" style={{ width: `${30 + Math.random() * 40}%` }} />
              </th>
            ))}
            <th className="col-actions">
              <div className="skeleton-bar" style={{ width: '60%' }} />
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, ri) => (
            <tr key={ri}>
              {Array.from({ length: columns }).map((_, ci) => (
                <td key={ci}>
                  <div className="skeleton-bar" style={{ width: ci === 0 ? '40%' : `${60 + Math.random() * 30}%` }} />
                </td>
              ))}
              <td className="col-actions">
                <div className="skeleton-bar" style={{ width: '80%' }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}