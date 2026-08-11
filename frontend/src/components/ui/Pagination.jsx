export function Pagination({ offset = 0, total = 0, limit = 100, onPage }) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <div className="flex items-center justify-between mt-4 text-sm">
      <span className="text-secondary">
        Menampilkan {offset + 1}–{Math.min(offset + limit, total)} dari {total}
      </span>
      <div className="flex gap-2">
        <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(Math.max(0, offset - limit))}>
          Sebelumnya
        </button>
        <button className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(offset + limit)}>
          Berikutnya
        </button>
      </div>
    </div>
  );
}