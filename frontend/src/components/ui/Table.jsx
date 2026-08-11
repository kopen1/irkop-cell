export function Table({ columns, rows, empty, loading, onRowClick }) {
  if (loading) return null;
  if (!rows || rows.length === 0) return empty || null;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'col-right' : ''} style={c.width ? { width: c.width } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
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
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RowActions({ children }) {
  return <div className="row-actions">{children}</div>;
}