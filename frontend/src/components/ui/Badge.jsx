import { labelKonfirmasi, labelMetode } from '../../lib/format';

// Badge status: memetakan nilai API → warna yang konsisten (tidak menebak makna).
export function Badge({ tone, children, className = '' }) {
  return <span className={`badge badge-${tone || 'neutral'} ${className}`}>{children}</span>;
}

const konfirmasiTone = {
  tidak_perlu: 'neutral',
  menunggu: 'warning',
  otomatis: 'success',
  manual: 'info',
};

export function MetodeBadge({ metode }) {
  return <Badge tone="info">{labelMetode(metode)}</Badge>;
}

export function KonfirmasiBadge({ status }) {
  return <Badge tone={konfirmasiTone[status] || 'neutral'}>{labelKonfirmasi(status)}</Badge>;
}

const kasirStatusTone = { belum_buka: 'neutral', buka: 'success', tutup: 'danger' };

export function KasirStatusBadge({ status }) {
  const label = { belum_buka: 'Belum Buka', buka: 'Buka', tutup: 'Tutup' }[status] || status;
  return <Badge tone={kasirStatusTone[status] || 'neutral'}>{label}</Badge>;
}

const pelunasanTone = { belum_lunas: 'warning', lunas: 'success' };

export function PelunasanBadge({ status }) {
  const label = { belum_lunas: 'Belum Lunas', lunas: 'Lunas' }[status] || status;
  return <Badge tone={pelunasanTone[status] || 'neutral'}>{label}</Badge>;
}

const serviceTone = { masuk: 'info', proses: 'warning', selesai: 'accent', diambil: 'neutral' };

export function ServiceStatusBadge({ status }) {
  const label = { masuk: 'Masuk', proses: 'Proses', selesai: 'Selesai', diambil: 'Diambil' }[status] || status;
  return <Badge tone={serviceTone[status] || 'neutral'}>{label}</Badge>;
}

export function UserStatusBadge({ aktif }) {
  return <Badge tone={aktif ? 'success' : 'danger'}>{aktif ? 'Aktif' : 'Nonaktif'}</Badge>;
}

const akunTone = { tunai: 'accent', bank: 'info', e_wallet: 'info', digital: 'neutral', lainnya: 'neutral' };

export function AkunTipeBadge({ tipe }) {
  const label = { tunai: 'Tunai', bank: 'Bank', e_wallet: 'E-Wallet', digital: 'Digital', lainnya: 'Lainnya' }[tipe] || tipe;
  return <Badge tone={akunTone[tipe] || 'neutral'}>{label}</Badge>;
}