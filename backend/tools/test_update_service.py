import json, urllib.request, urllib.error, sqlite3

c = sqlite3.connect('backend/.dev-data/irkop.db')
row = c.execute("SELECT id FROM transaksi WHERE kode_transaksi='TX-20261002-001'").fetchone()
print('tx_id:', row)
if not row:
    raise SystemExit('Transaksi tidak ditemukan')

tx_id = row[0]
base = 'http://localhost:8787'

# login
req = urllib.request.Request(
    base + '/api/auth/login',
    data=json.dumps({'username': 'admin', 'password': 'admin1234'}).encode(),
    headers={'Content-Type': 'application/json'},
    method='POST',
)
with urllib.request.urlopen(req) as r:
    token = json.loads(r.read())['token']
print('token ok')

payload = {
    "items": [],
    "metode_bayar": "tunai",
    "pelanggan_id": None,
    "service": {
        "nama_device": "Infinix smart 3 pro",
        "deskripsi_kerusakan": "Service",
        "biaya": 50000,
        "harga_modal": 0,
        "parts": [],
        "tanggal_masuk": "2026-10-02",
        "tanggal_garansi": None,
        "catatan": None
    }
}
req = urllib.request.Request(
    base + '/api/transaksi/' + str(tx_id),
    data=json.dumps(payload).encode(),
    headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
    method='PUT',
)
try:
    with urllib.request.urlopen(req) as r:
        print('PUT success:', r.status, r.read().decode()[:300])
except urllib.error.HTTPError as e:
    print('PUT error:', e.code, e.read().decode()[:300])
