import { Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { RequireAuth, RequirePermission, AdminOnly } from './components/layout/Guard';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import TransaksiPage from './pages/TransaksiPage';
import KasirPage from './pages/KasirPage';
import LaporanPage from './pages/LaporanPage';
import DaftarBarangPage from './pages/DaftarBarangPage';
import ServiceHpPage from './pages/ServiceHpPage';
import KasbonPage from './pages/KasbonPage';
import PelangganPage from './pages/PelangganPage';
import PengeluaranPage from './pages/PengeluaranPage';
import GajiPage from './pages/GajiPage';
import PengaturanPage from './pages/PengaturanPage';
import { Icon } from './components/ui/Icon';

function NotFound() {
  return (
    <div className="page">
      <div className="state-block" style={{ paddingTop: 'var(--space-7)' }}>
        <span className="state-icon"><Icon name="alert" size={26} /></span>
        <div className="state-title">Halaman tidak ditemukan</div>
        <div className="state-desc">Alamat yang Anda buka tidak tersedia. Periksa kembali navigasi.</div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<RequirePermission permission="dashboard"><DashboardPage /></RequirePermission>} />
        <Route path="/transaksi" element={<RequirePermission permission="transaksi"><TransaksiPage /></RequirePermission>} />
        <Route path="/kasir" element={<RequirePermission permission="kasir"><KasirPage /></RequirePermission>} />
        <Route path="/laporan" element={<RequirePermission permission="laporan"><LaporanPage /></RequirePermission>} />
        <Route path="/daftar-barang" element={<RequirePermission permission="daftar_barang"><DaftarBarangPage /></RequirePermission>} />
        <Route path="/service-hp" element={<RequirePermission permission="laporan_service_hp"><ServiceHpPage /></RequirePermission>} />
        <Route path="/kasbon" element={<RequirePermission permission="kasbon"><KasbonPage /></RequirePermission>} />
        <Route path="/pelanggan" element={<RequirePermission permission="pelanggan"><PelangganPage /></RequirePermission>} />
        <Route path="/pengeluaran" element={<RequirePermission permission="pengeluaran"><PengeluaranPage /></RequirePermission>} />
        <Route path="/gaji" element={<AdminOnly><GajiPage /></AdminOnly>} />
        <Route path="/pengaturan" element={<AdminOnly><PengaturanPage /></AdminOnly>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}