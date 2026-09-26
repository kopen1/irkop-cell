export function Table({ columns, rows, empty, loading, onRowClick }) {
  if (loading) return null;
  if (!rows || rows.length === 0) return empty || null;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`${c.align === 'right' ? 'col-right' : ''} ${c.className || ''}`.trim()}
                style={c.width ? { width: c.width } : undefined}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            row._group ? (
              <tr key={row.key ?? `g${i}`} className="table-group-row">
                <td
                  colSpan={columns.length}
                  style={{ fontWeight: 700, background: 'var(--table-header)', color: 'var(--text-secondary)', textTransform: 'uppercase', fontSize: '0.72rem', letterSpacing: '0.5px' }}
                >
                  {row._group}
                </td>
              </tr>
            ) : (
              <tr
                key={row.key ?? i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.align === 'right' || c.className ? `${c.align === 'right' ? 'col-right' : ''} ${c.className || ''}` : ''}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            )
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RowActions({ children }) {
  return <div className="row-actions">{children}</div>;
}