// Pengaturan (PRD 5.11) — pusat konfigurasi: nama website, NotifHook,
// user & permission, akun uang, log/audit. ADMIN ONLY.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useTheme, THEMES } from '../context/ThemeContext';
import { formatDateTime, HALAMAN_PERMISSION } from '../lib/format';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Field, Input, Select } from '../components/ui/Field';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { Table } from '../components/ui/Table';
import { Loader, ErrorState, EmptyState } from '../components/ui/States';
import { Badge, UserStatusBadge, AkunTipeBadge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';

export default function PengaturanPage() {
  const [tab, setTab] = useState('umum');
  const tabs = [
    { key: 'umum', label: 'Umum' },
    { key: 'notifhook', label: 'NotifHook' },
    { key: 'users', label: 'User & Permission' },
    { key: 'akun', label: 'Akun Uang' },
    { key: 'log', label: 'Log / Audit' },
  ];

  return (
    <div className="page">
      <PageHeader title="Pengaturan" subtitle="Konfigurasi aplikasi. Halaman ini khusus Admin." />
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.key} type="button" className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'umum' && <UmumTab />}
      {tab === 'notifhook' && <NotifHookTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'akun' && <AkunTab />}
      {tab === 'log' && <LogTab />}
    </div>
  );
}

/* ---------------- Umum ---------------- */
function UmumTab() {
  const toast = useToast();
  const { theme, setTheme } = useTheme();
  const [nama, setNama] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/settings').then((s) => {
      setNama(s.nama_website || '');
      if (s.default_theme) setTheme(s.default_theme);
    }).catch(() => {}).finally(() => setLoaded(true));
  }, [setTheme]);

  if (!loaded) return <Loader />;

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/settings', { nama_website: nama.trim(), default_theme: theme });
      toast.success('Pengaturan umum disimpan.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Identitas & Tampilan">
      <div className="flex flex-col gap-4" style={{ maxWidth: 480 }}>
        <Field label="Nama website">
          <Input type="text" value={nama} onChange={(e) => setNama(e.target.value)} />
        </Field>
        <Field label="Tema tampilan" hint="Perubahan tema tidak mengubah aturan bisnis/data.">
          <div className="flex flex-col gap-2">
            {THEMES.map((t) => (
              <button key={t.id} type="button" className={`theme-option-row ${theme === t.id ? 'active' : ''}`} onClick={() => setTheme(t.id)}>
                <span className="flex items-center gap-2">
                  <span className="theme-swatch" style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[1]} 50%)` }} />
                  <span style={{ fontSize: '0.85rem' }}>{t.label}</span>
                </span>
                {theme === t.id && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
        </Field>
        <div>
          <Button onClick={save} loading={busy}>Simpan</Button>
        </div>
      </div>
    </Card>
  );
}

/* ---------------- NotifHook ---------------- */
function NotifHookTab() {
  const toast = useToast();
  const [cfg, setCfg] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formSource, setFormSource] = useState({ source_name: '', matcher_type: 'package_name', matcher_value: '', enabled: 1 });

  const load = async () => {
    setLoaded(false);
    const s = await api.get('/settings').catch(() => ({ notifhook: {} }));
    setCfg(s);
    setLoaded(true);
  };

  useEffect(() => {
    load();
  }, []);

  if (!loaded) return <Loader />;
  const nh = cfg?.notifhook || {};
  const sources = nh.sources || [];

  const toggleAuto = async (enabled) => {
    setBusy(true);
    try {
      await api.put('/settings', { notifhook: { ...nh, auto_input: enabled } });
      toast.success(enabled ? 'Auto-input NotifHook aktif.' : 'Auto-input NotifHook nonaktif.');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    setBusy(true);
    try {
      const r = await api.post('/settings/generate');
      toast.success('API key baru dibuat.');
      setCfg((c) => ({ ...c, notifhook: { ...nh, api_key: r.api_key } }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const addSource = async () => {
    if (!formSource.source_name.trim() || !formSource.matcher_value.trim()) {
      toast.warning('source_name & matcher_value wajib diisi.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/settings/notifhook-source', formSource);
      toast.success('Sumber notifikasi ditambahkan.');
      setFormSource({ source_name: '', matcher_type: 'package_name', matcher_value: '', enabled: 1 });
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card title="Webhook & Health">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">Auto-input transaksi dari notifikasi</span>
            <Button variant={nh.auto_input ? 'primary' : 'secondary'} size="sm" onClick={() => toggleAuto(!nh.auto_input)} disabled={busy}>
              {nh.auto_input ? 'Aktif' : 'Nonaktif'}
            </Button>
          </div>
          <Field label="Endpoint Worker">
            <Input readOnly value={nh.endpoint || 'belum dikonfigurasi'} />
          </Field>
          <Field label="API key" hint="Jangan dibagikan. Generate untuk membuat key baru (webhook lama tidak berlaku).">
            <div className="input-group">
              <Input readOnly value={nh.api_key ? '••••••••••••' : 'belum ada'} />
              <Button variant="secondary" onClick={regenerate} loading={busy}>Generate Ulang</Button>
            </div>
          </Field>
          <div className="flex items-center gap-2">
            <Badge tone={nh.health?.terakhir_menerima_notif ? 'success' : 'warning'}>
              {nh.health?.terakhir_menerima_notif ? `Notif terakhir diterima: ${formatDateTime(nh.health.terakhir_menerima_notif)}` : 'Belum ada notif masuk'}
            </Badge>
          </div>
        </div>
      </Card>

      <Card title="Sumber Notifikasi" subtitle="Sumber dikonfigurasi Admin; nilai DANA/SeaBank/OrderKuota TIDAK ditebak developer (PRD 12.6).">
        {sources.length ? (
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>Sumber</th>
                  <th>Type</th>
                  <th>Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.source_name || s.id}>
                    <td style={{ fontWeight: 600 }}>{s.source_name}</td>
                    <td><code className="text-sm">{s.matcher_type}</code></td>
                    <td><code className="text-sm">{s.matcher_value}</code></td>
                    <td>{s.enabled ? <Badge tone="success">Aktif</Badge> : <Badge tone="neutral">Nonaktif</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">Belum ada sumber notifikasi. Tambahkan setelah mengetahui package/rule aplikasi pembayaran nyata.</p>
        )}
        <div className="grid-2 mt-4">
          <Field label="Source name" required>
            <Input value={formSource.source_name} placeholder="mis. DANA" onChange={(e) => setFormSource((f) => ({ ...f, source_name: e.target.value }))} />
          </Field>
          <Field label="Matcher type" required>
            <Select value={formSource.matcher_type} onChange={(e) => setFormSource((f) => ({ ...f, matcher_type: e.target.value }))}>
              <option value="package_name">package_name</option>
              <option value="custom_rule">custom_rule</option>
            </Select>
          </Field>
          <Field label={formSource.matcher_type === 'package_name' ? 'Package name' : 'Rule'} required>
            <Input value={formSource.matcher_value} placeholder={formSource.matcher_type === 'package_name' ? 'com.dana…' : 'rule…'} onChange={(e) => setFormSource((f) => ({ ...f, matcher_value: e.target.value }))} />
          </Field>
          <div style={{ alignSelf: 'flex-end' }}>
            <Button onClick={addSource} loading={busy}>Tambah Sumber</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- Users ---------------- */
function UsersTab() {
  const toast = useToast();
  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const load = useMemo(
    () => async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const data = await api.get('/users', { limit: 200 });
        setState({ status: 'success', data, error: null });
      } catch (err) {
        setState({ status: 'error', data: null, error: err });
      }
    },
    []
  );
  useEffect(() => {
    load();
  }, [load]);

  const [editUser, setEditUser] = useState(null);
  const [permUser, setPermUser] = useState(null);

  const users = Array.isArray(state.data) ? state.data : (state.data?.items || []);

  return (
    <Card title="Manajemen User">
      <div className="mb-4">
        <Button onClick={() => setEditUser({})}>
          <Icon name="plus" size={16} /> Tambah Karyawan
        </Button>
      </div>
      {state.status === 'loading' ? (
        <Loader />
      ) : state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={load} />
      ) : users.length === 0 ? (
        <EmptyState title="Belum ada user" icon="user" />
      ) : (
        <Table
          columns={[
            { key: 'nama', header: 'Nama', render: (r) => <span style={{ fontWeight: 600 }}>{r.nama}</span> },
            { key: 'username', header: 'Username', render: (r) => <span className="font-mono text-sm">{r.username}</span> },
            { key: 'role', header: 'Role', render: (r) => <Badge tone={r.role === 'admin' ? 'accent' : 'info'}>{r.role === 'admin' ? 'Admin' : 'Karyawan'}</Badge> },
            { key: 'aktif', header: 'Status', render: (r) => <UserStatusBadge aktif={r.aktif} /> },
            { key: 'last_login_at', header: 'Login terakhir', render: (r) => <span className="text-xs text-muted">{r.last_login_at ? formatDateTime(r.last_login_at) : '—'}</span> },
            {
              key: 'aksi',
              header: '',
              render: (r) => (
                <div className="row-actions">
                  <Button variant="ghost" size="sm" aria-label="Atur permission" onClick={() => setPermUser(r)}>
                    <Icon name="key" size={15} />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="Edit user" onClick={() => setEditUser(r)}>
                    <Icon name="edit" size={15} />
                  </Button>
                </div>
              ),
            },
          ]}
          rows={users.map((u) => ({ ...u, key: u.id }))}
        />
      )}

      <Modal open={Boolean(permUser)} onClose={() => setPermUser(null)} title={`Akses halaman — ${permUser?.nama}`}>
        <PermissionForm
          user={permUser}
          onCancel={() => setPermUser(null)}
          onSaved={(m) => {
            setPermUser(null);
            toast.success(m);
            load();
          }}
        />
      </Modal>

      <Modal open={Boolean(editUser)} onClose={() => setEditUser(null)} title={editUser?.id ? 'Edit User' : 'Tambah Karyawan'}>
        <UserForm
          user={editUser}
          onCancel={() => setEditUser(null)}
          onSaved={(m) => {
            setEditUser(null);
            toast.success(m);
            load();
          }}
        />
      </Modal>
    </Card>
  );
}

function PermissionForm({ user, onCancel, onSaved }) {
  const [selected, setSelected] = useState(() => Array.isArray(user?.permissions) ? user.permissions : (user?.permissions?.halaman || []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (user?.id && !user.permissions) {
      api.get('/users').then((r) => {
        const u = (r.items || []).find((x) => x.id === user.id);
        if (u) setSelected(u.permissions || []);
      }).catch(() => {});
    }
  }, [user]);

  const toggle = (key) => {
    setSelected((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.put(`/users/${user.id}/permissions`, { halaman: selected });
      onSaved('Permission disimpan.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-secondary">
        Atur halaman yang dapat diakses {user?.role === 'admin' ? user?.nama : `Karyawan ${user?.nama}`}. Admin otomatis mengakses semua.
      </p>
      {user?.role === 'karyawan' && (
        <p className="text-sm" style={{ background: 'var(--danger-soft)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)' }}>
          HARD RULE: akses Gaji Karyawan tidak pernah dapat diberikan ke Karyawan (PRD 3.2) — tidak muncul di daftar & ditolak backend.
        </p>
      )}
      <div className="grid-2">
        {HALAMAN_PERMISSION.map((h) => (
          <label key={h.key} className="flex items-center gap-2 text-sm" style={{ padding: 'var(--space-2)' }}>
            <input type="checkbox" checked={selected.includes(h.key)} disabled={user?.role === 'admin'} onChange={() => toggle(h.key)} />
            {h.label}
          </label>
        ))}
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Batal</Button>
        <Button onClick={save} loading={busy}>Simpan</Button>
      </div>
    </div>
  );
}

function UserForm({ user, onCancel, onSaved }) {
  const [form, setForm] = useState(() => ({
    nama: user?.nama || '',
    username: user?.username || '',
    password: '',
    role: user?.role || 'karyawan',
    aktif: user ? Boolean(user.aktif ?? user.aktif === 1) : true,
  }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(user?.id);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.nama.trim()) return setError('Nama wajib diisi.');
    if (!form.username.trim()) return setError('Username wajib diisi.');
    if (!isEdit && !form.password) return setError('Password awal wajib diisi untuk user baru.');
    setBusy(true);
    try {
      const body = {
        nama: form.nama.trim(),
        username: form.username.trim(),
        role: form.role,
        aktif: form.aktif ? 1 : 0,
        ...(!isEdit ? { password: form.password } : form.password ? { password: form.password } : {}),
      };
      if (isEdit) await api.put(`/users/${user.id}`, body);
      else await api.post('/users', body);
      onSaved(isEdit ? 'User diperbarui.' : 'User ditambahkan.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Nama" required>
        <Input type="text" value={form.nama} onChange={set('nama')} />
      </Field>
      <Field label="Username / email" required>
        <Input type="text" value={form.username} onChange={set('username')} />
      </Field>
      <Field label={isEdit ? 'Password baru (kosongkan jika tidak berubah)' : 'Password awal'} required={!isEdit}>
        <Input type="password" value={form.password} onChange={set('password')} />
      </Field>
      <Field label="Role">
        <Select value={form.role} onChange={set('role')}>
          <option value="karyawan">Karyawan</option>
          <option value="admin">Admin</option>
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.aktif} onChange={(e) => setForm((f) => ({ ...f, aktif: e.target.checked }))} />
        Aktif (nonaktifkan bukan hapus — riwayat transaksi tetap tersimpan)
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={onCancel}>Batal</Button>
        <Button type="submit" loading={busy}>Simpan</Button>
      </div>
    </form>
  );
}

/* ---------------- Akun Uang ---------------- */
function AkunTab() {
  const toast = useToast();
  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const load = useMemo(
    () => async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const data = await api.get('/akun');
        setState({ status: 'success', data, error: null });
      } catch (err) {
        setState({ status: 'error', data: null, error: err });
      }
    },
    []
  );
  useEffect(() => {
    load();
  }, [load]);

  const [createOpen, setCreateOpen] = useState(false);
  const [toggleTarget, setToggleTarget] = useState(null);
  const [toggleBusy, setToggleBusy] = useState(false);

  const akunList = state.data?.items || [];

  const doToggle = async () => {
    setToggleBusy(true);
    try {
      await api.put(`/akun/${toggleTarget.id}`, { aktif: toggleTarget.aktif ? 0 : 1 });
      toast.success(toggleTarget.aktif ? `${toggleTarget.nama_akun} dinonaktifkan.` : `${toggleTarget.nama_akun} diaktifkan.`);
      setToggleTarget(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setToggleBusy(false);
    }
  };

  return (
    <Card title="Master Akun Uang" subtitle="Daftar akun seed bukan daftar permanen; Admin bebas menambah/mengelola (PRD 12.7).">
      <div className="mb-4">
        <Button onClick={() => setCreateOpen(true)}>
          <Icon name="plus" size={16} /> Tambah Akun
        </Button>
      </div>
      {state.status === 'loading' ? (
        <Loader />
      ) : state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={load} />
      ) : akunList.length === 0 ? (
        <EmptyState title="Belum ada akun" icon="wallet" />
      ) : (
        <Table
          columns={[
            { key: 'nama_akun', header: 'Nama Akun', render: (r) => <span style={{ fontWeight: 600 }}>{r.nama_akun}</span> },
            { key: 'tipe', header: 'Tipe', render: (r) => <AkunTipeBadge tipe={r.tipe} /> },
            { key: 'aktif', header: 'Status', render: (r) => <Badge tone={r.aktif ? 'success' : 'neutral'}>{r.aktif ? 'Aktif' : 'Nonaktif'}</Badge> },
            {
              key: 'aksi',
              header: '',
              render: (r) => (
                <div className="row-actions">
                  <Button variant="ghost" size="sm" onClick={() => setToggleTarget(r)}>
                    {r.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                  </Button>
                </div>
              ),
            },
          ]}
          rows={akunList.map((a) => ({ ...a, key: a.id }))}
        />
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Tambah Akun Uang">
        <AkunForm
          onCancel={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            toast.success('Akun ditambahkan.');
            load();
          }}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(toggleTarget)}
        title="Ubah Status Akun"
        danger={false}
        message={`Akun "${toggleTarget?.nama_akun}" akan ${toggleTarget?.aktif ? 'dinonaktifkan' : 'diaktifkan'}. Akun nonaktif tidak dapat dipakai membayar.`}
        confirmLabel="Ya, lanjutkan"
        loading={toggleBusy}
        onCancel={() => setToggleTarget(null)}
        onConfirm={doToggle}
      />
    </Card>
  );
}

function AkunForm({ onCancel, onSaved }) {
  const [form, setForm] = useState({ nama_akun: '', tipe: 'bank' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.nama_akun.trim()) return setError('Nama akun wajib diisi.');
    setBusy(true);
    try {
      await api.post('/akun', { nama_akun: form.nama_akun.trim(), tipe: form.tipe });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Nama akun" required>
        <Input type="text" value={form.nama_akun} placeholder="mis. BCA, ShopeePay…" onChange={(e) => setForm((f) => ({ ...f, nama_akun: e.target.value }))} />
      </Field>
      <Field label="Tipe">
        <Select value={form.tipe} onChange={(e) => setForm((f) => ({ ...f, tipe: e.target.value }))}>
          <option value="tunai">Tunai</option>
          <option value="bank">Bank</option>
          <option value="e_wallet">E-Wallet</option>
          <option value="digital">Digital</option>
          <option value="lainnya">Lainnya</option>
        </Select>
      </Field>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={onCancel}>Batal</Button>
        <Button type="submit" loading={busy}>Simpan</Button>
      </div>
    </form>
  );
}

/* ---------------- Log ---------------- */
function LogTab() {
  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const load = useMemo(
    () => async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const data = await api.get('/logs', { limit: 200 });
        setState({ status: 'success', data, error: null });
      } catch (err) {
        setState({ status: 'error', data: null, error: err });
      }
    },
    []
  );
  useEffect(() => {
    load();
  }, [load]);

  const logs = state.data?.items || [];

  return (
    <Card title="Log / Audit Trail" subtitle="Catatan aktivitas: siapa mengubah apa, kapan (WIB).">
      <div className="mb-3 text-right">
        <Button variant="secondary" size="sm" onClick={() => load()}>
          <Icon name="refresh" size={14} /> Muat ulang
        </Button>
      </div>
      {state.status === 'loading' ? (
        <Loader />
      ) : state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={load} />
      ) : logs.length === 0 ? (
        <EmptyState title="Belum ada log" icon="database" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Waktu (WIB)</th>
                <th>User</th>
                <th>Aksi</th>
                <th>Tabel</th>
                <th>Record</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="text-xs">{formatDateTime(l.created_at)}</td>
                  <td className="text-sm">{l.user_nama || l.user_id || 'sistem'}</td>
                  <td><Badge tone="info">{l.aksi}</Badge></td>
                  <td className="font-mono text-xs">{l.tabel_terkait}</td>
                  <td className="num text-xs">{l.record_id}</td>
                  <td className="text-xs">
                    {(l.data_before || l.data_after) ? 'lihat raw' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {state.status === 'success' && state.data?.total && (
        <p className="text-xs text-muted mt-3">Total entri: {state.data.total}. Menampilkan terbaru.</p>
      )}
    </Card>
  );
}