// Header grup untuk list (.plist): kategori (tingkat 1) dan operator/kode
// (tingkat 2). Dipakai bersama oleh Daftar Barang & Harga Server agar tampilan
// sub-grup konsisten dan mudah dikenali lewat warnanya.
import { operatorColor } from '../../lib/operatorColor';

export function PlistKat({ children, jumlah }) {
  return (
    <div className="plist-kat">
      <span>{children}</span>
      {jumlah != null && <span className="plist-kat-count">{jumlah}</span>}
    </div>
  );
}

export function PlistSub({ nama, prefix, jumlah }) {
  const c = operatorColor(nama);
  return (
    <div className="plist-sub" style={{ '--sub-fg': c.fg, '--sub-bg': c.bg }}>
      <span className="plist-sub-bar" aria-hidden="true" />
      <span className="plist-sub-nama">{nama}</span>
      {prefix && <code className="plist-prefix">{prefix}*</code>}
      {jumlah != null && <span className="plist-sub-count">{jumlah}</span>}
    </div>
  );
}
