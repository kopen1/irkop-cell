-- 0016: Betulkan total transaksi Tarik Tunai admin luar.
--
-- Sebelum perbaikan kode, transaksi tariktunai admin luar disimpan dengan
-- total = nominal (uang tunai yang diserahkan), sedangkan mutasi akun
-- penerima = nominal + fee admin. Akibatnya Total di daftar/detail transaksi
-- tidak cocok dengan saldo akun (mis. SeaBank masuk 505.000, total tertulis
-- 500.000).
--
-- Kode baru menyimpan total = nominal + fee. Migrasi ini membetulkan baris
-- lama. Penjaga EXISTS membuat migrasi aman dijalankan ulang: baris yang
-- sudah benar tidak cocok lagi karena mutasi akun penerima = total (bukan
-- total + laba).
--
-- Jalankan satu statement UPDATE di bawah ini di D1 Console.

UPDATE transaksi
   SET subtotal = subtotal + laba,
       total    = total + laba
 WHERE jenis = 'tariktunai'
   AND admin_type = 'luar'
   AND laba > 0
   AND deleted_at IS NULL
   AND subtotal = total
   AND EXISTS (
     SELECT 1 FROM mutasi_saldo ms
      WHERE ms.sumber_tipe = 'transaksi'
        AND ms.sumber_id = transaksi.id
        AND ms.jumlah = transaksi.total + transaksi.laba
        AND ms.nama_akun <> 'Laba'
   );
