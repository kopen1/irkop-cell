// Dashboard (PRD 5.1): omzet harian, jumlah transaksi, kasbon aktif,
// saldo kasir, transaksi terbaru.
//
// Sumber data = API Contract Team 1 (backend truth):
//   GET /api/kasir/current   → saldo sistem per akun
//   GET /api/transaksi       → items + total_nilai (agregat resmi backend)
//   GET /api/kasbon          → daftar kasbon (filter status belum_lunas)
// Frontend TIDAK menghitung omzet/saldo; hanya menampilkan nilai resmi backend.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { useAsync } from '../hooks/useAsync';
import { todayWIB, formatRupiah, formatDateTime, labelMetode } from '../lib/format';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Table } from '../components/ui/Table';
import { Button } from '../components/ui/Button';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';
import { KonfirmasiBadge, KasirStatusBadge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';

export default function DashboardPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [date] = useState(todayWIB());

  const kasir = useAsync(() => api.get('/kasir/current'), { deps: [] });
  const transaksiToday = useAsync(
    () => api.get('/transaksi', { date, limit: 10 }),
    { deps: [date] }
  );
  const kasbon = useAsync(
    () => api.get('/kasbon', { limit: 100 }).then((r) => r.items),
    { deps: [] }
  );

  if (kasir.status === 'loading' || transaksiToday.status === 'loading' || kasbon.status === 'loading') {
    return <Loader />;
  }

  const hasError = [kasir, transaksiToday, kasbon].find((s) => s.status === 'error');
  if (hasError) {
    return (
      <div className="page">
        <ErrorState error={hasError.error} onRetry={() => { kasir.run(); transaksiToday.run(); kasbon.run(); }} />
      </div>
    );
  }

  const data = transaksiToday.data || {};
  const transaksiList = (data.items || []).slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const kasbonAktif = (kasbon.data || []).filter((k) => k.status === 'belum_lunas').length;
  const kasirData = kasir.data || {};

  const stats = [
    { label: 'Omzet Hari Ini', value: formatRupiah(data.total_nilai || 0), icon: 'money' },
    { label: 'Transaksi Hari Ini', value: String(data.total_items ?? 0), icon: 'transaksi' },
    { label: 'Kasbon Aktif', value: String(kasbonAktif), icon: 'kasbon' },
    { label: 'Status Kasir', value: (kasirData.status && { belum_buka: 'Belum Buka', buka: 'Buka', tutup: 'Tutup' }[kasirData.status]) || '-', icon: 'kasir' },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        subtitle={`Ringkasan operasional hari ini (${date}) — data sumber: backend`}
        actions={
          <Button variant="secondary" onClick={() => navigate('/transaksi')}>
            <Icon name="transaksi" size={16} /> Lihat Transaksi
          </Button>
        }
      />

      <div className="stat-grid">
        {stats.map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid-2 mt-4">
        <Card title="Saldo Kasir" subtitle="Saldo sistem per akun (isi sesi hari ini)">
          {kasirData.saldo?.length ? (
            <div className="table-wrap">
              <table className="table" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th>Akun</th>
                    <th className="col-right">Saldo Sistem</th>
                    <th className="col-right">Mutasi</th>
                  </tr>
                </thead>
                <tbody>
                  {kasirData.saldo.map((s) => (
                    <tr key={s.nama_akun}>
                      <td>{s.nama_akun}</td>
                      <td className="col-right num">{formatRupiah(s.saldo_sistem)}</td>
                      <td className="col-right num text-success">+{formatRupiah(s.mutasi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Kasir belum buka" description="Lakukan Opening pada halaman Kasir untuk memulai sesi harian." />
          )}
        </Card>

        <Card title="Transaksi Terbaru" subtitle="Transaksi hari ini">
          {transaksiList.length ? (
            <Table
              onRowClick={(r) => can('transaksi') && navigate(`/transaksi?detail=${encodeURIComponent(r.id)}`)}
              columns={[
                { key: 'id', header: 'ID', render: (r) => <span className="num">{r.id}</span> },
                { key: 'jam', header: 'Jam', render: (r) => <span className="text-xs">{formatDateTime(r.created_at)}</span> },
                { key: 'metode_bayar', header: 'Bayar', render: (r) => labelMetode(r.metode_bayar) },
                { key: 'konfirmasi', header: 'Konfirmasi', render: (r) => <KonfirmasiBadge status={r.konfirmasi_pembayaran} /> },
                { key: 'total', header: 'Total', align: 'right', render: (r) => <span className="num">{formatRupiah(r.total)}</span> },
              ]}
              rows={transaksiList.map((t) => ({ ...t, key: t.id }))}
            />
          ) : (
            <EmptyState title="Belum ada transaksi hari ini" description="Transaksi baru akan tampil di sini setelah dicatat." icon="transaksi" />
          )}
        </Card>
      </div>

      {kasirData.status && (
        <div className="mt-4" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <KasirStatusBadge status={kasirData.status} />
          {kasirData.status === 'belum_buka' && can('kasir') && (
            <Button variant="secondary" size="sm" onClick={() => navigate('/kasir')}>Buka Kasir</Button>
          )}
        </div>
      )}
    </div>
  );
}