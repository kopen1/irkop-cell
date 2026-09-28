import { describe, it, expect } from 'vitest';
import { operatorOf, kodePrefixOf, kodeLokalDariServer, operatorPrefix, parseGbHari } from '../operator.js';

describe('operatorOf', () => {
  it('kode voucher menentukan operator', () => {
    expect(operatorOf('Vi7', 'Indosat 7GB', 'Voucher')).toBe('Indosat');
    expect(operatorOf('Vs6', 'Tsel', 'Voucher')).toBe('Telkomsel');
    expect(operatorOf('Vt8', 'Three', 'Voucher')).toBe('Three');
    expect(operatorOf('VX7', 'XL', 'Voucher')).toBe('XL');
    expect(operatorOf('Vsm7', 'Smart', 'Voucher')).toBe('Smartfren');
    expect(operatorOf('VA7', 'Axis', 'Voucher')).toBe('Axis');
    expect(operatorOf('LA5', 'Lyca 5GB', 'Voucher')).toBe('Lyca');
  });

  it('nama dengan kata "perdana" tidak dianggap Dana', () => {
    expect(operatorOf('', 'Perdana Axis 3gb', 'Aksesoris')).toBe('Axis');
    expect(operatorOf('', 'perdana Byu 3Gb', 'Aksesoris')).toBe('by.U');
    expect(operatorOf('', 'perdana Sm 3/30hari', 'Aksesoris')).toBe('Smartfren');
    expect(operatorOf('', 'perdana Three 3Gb', 'Aksesoris')).toBe('Three');
    expect(operatorOf('', 'Perdana Telkomsel 3gb', 'Aksesoris')).toBe('Telkomsel');
    expect(operatorOf('', 'perdana indosat 3Gb', 'Aksesoris')).toBe('Indosat');
    expect(operatorOf('', 'perdana Xl 3gb', 'Aksesoris')).toBe('XL');
  });

  it('Dana asli tetap terdeteksi', () => {
    expect(operatorOf('', 'Dana 50k', 'Saldo')).toBe('Dana');
    expect(operatorOf('', 'GoPay 100k', 'Saldo')).toBe('GoPay');
  });
});

describe('kodePrefixOf', () => {
  it('prefix voucher untuk label grup', () => {
    expect(kodePrefixOf('VI1005', 'Voucher')).toBe('vi');
    expect(kodePrefixOf('VA7', 'Voucher')).toBe('va');
    expect(kodePrefixOf('LA5', 'Voucher')).toBe('la');
    expect(kodePrefixOf('VSMKTI12', 'Voucher')).toBe('vsm');
  });

  it('di luar voucher tidak ada prefix', () => {
    expect(kodePrefixOf('D50', 'Saldo')).toBe('');
    expect(kodePrefixOf('PLS-001', 'Aksesoris')).toBe('');
  });
});

describe('kodeLokalDariServer', () => {
  const ubah = (operator, nama_produk, kode_produk) =>
    kodeLokalDariServer({ kategori: 'cetak_voucher', operator, nama_produk, kode_produk });

  it('voucher: hari 1 -> GB jadi 2 digit', () => {
    expect(ubah('indosat', 'Act Freedom Mini 3GB 1 Hari', 'Vindosat00301')).toBe('vi03');
    expect(ubah('indosat', 'Freedom Mini 7GB 1Hari', 'Vindosat00701')).toBe('vi07');
    expect(ubah('xl', 'Flex Mini 5GB 1Hari', 'Vxl5001')).toBe('vx05');
    expect(ubah('tri', 'Happy 6GB 1Hari', 'Vtri601')).toBe('vt06');
  });

  it('voucher: 28/30 hari -> GB saja, tanpa hari', () => {
    expect(ubah('indosat', 'Freedom internet 7GB 28 Hari', 'Vindosat7')).toBe('vi7');
    expect(ubah('indosat', 'Freedom Internet 15GB 28Hari', 'Vindosat15')).toBe('vi15');
    expect(ubah('telkomsel', 'Tsel 6GB 28Hari', 'Vtelkomsel6')).toBe('vs6');
    expect(ubah('smartfren', 'Nonstop 7GB 28Hari', 'Vsmartfren7')).toBe('vsm7');
  });

  it('voucher: masa aktif lain -> kuota 2 digit + hari 2 digit', () => {
    expect(ubah('indosat', 'Freedom Mini 10GB 5 Hari', 'Vindosat1005')).toBe('vi1005');
    expect(ubah('indosat', 'Freedom Mini 5GB 7 Hari', 'Vindosat0507')).toBe('vi0507');
    expect(ubah('indosat', 'Freedom 12GB 14 Hari', 'Vindosat1214')).toBe('vi1214');
    expect(ubah('tri', 'Happy 3GB 14 Hari', 'Vtri314')).toBe('vt0314');
  });

  it('pulsa: kode server dipakai apa adanya (sudah sama dengan kode lokal)', () => {
    expect(kodeLokalDariServer({ kategori: 'pulsa', operator: 'axis', nama_produk: 'Axis 10.000', kode_produk: 'A10' })).toBe('A10');
    expect(kodeLokalDariServer({ kategori: 'pulsa', operator: 'indosat', nama_produk: 'Indosat 5.000', kode_produk: 'I5' })).toBe('I5');
  });

  it('kode tidak bisa diturunkan (tanpa GB / operator asing) -> fallback ke kode server', () => {
    expect(ubah('indosat', 'Freedom Unlimited', 'Vindosatu7')).toBe('Vindosatu7');
    expect(ubah('operator-hantu', 'X 7GB 28Hari', 'Xsomething7')).toBe('Xsomething7');
  });

  it('cocok dengan kode lokal yang sudah dipakai (regresi konvensi)', () => {
    // Data nyata dari katalog: nama -> kode yang sudah dipakai pengguna.
    const nyata = [
      ['indosat', 'Indosat Freedom Mini 3GB 1Hari', 'vi03'],
      ['indosat', 'Indosat Freedom Mini 7GB 1Hari', 'vi07'],
      ['indosat', 'Indosat Freedom Mini 10GB 5Hari', 'vi1005'],
      ['indosat', 'Indosat Freedom Internet 7GB 28Hari', 'vi7'],
      ['indosat', 'Indosat Freedom Internet 15GB 28Hari', 'vi15'],
      ['indosat', 'Indosat Freedom Mini 5GB 7Hari', 'vi0507'],
      ['indosat', 'Indosat Freedom 12GB 14Hari', 'vi1214'],
      ['telkomsel', 'Tsel Jateng 4GB+3GB 1Hari', 'vs04'],
      ['telkomsel', 'Tsel Jateng 6GB+12GB 28Hari', 'vs6'],
      ['smartfren', 'Smartfren Nonstop 7GB 28Hari', 'vsm7'],
      ['tri', 'Tri Happy 6GB+2GB 1Hari', 'vt06'],
      ['tri', 'Tri Happy Java 7GB 28Hari', 'vt7'],
      ['xl', 'XL Flex Mini 5GB 1Hari', 'vx05'],
      ['xl', 'XL Flex 7GB 28Hari', 'vx7'],
      ['axis', 'Axis Aigo 7GB 28Hari', 'va7'],
    ];
    for (const [operator, nama, kodeLokal] of nyata) {
      expect(kodeLokalDariServer({ kategori: 'cetak_voucher', operator, nama_produk: nama, kode_produk: 'X' }))
        .toBe(kodeLokal);
    }
  });
});

describe('operatorPrefix & parseGbHari', () => {
  it('prefix operator voucher', () => {
    expect(operatorPrefix('indosat')).toBe('i');
    expect(operatorPrefix('Three')).toBe('t');
    expect(operatorPrefix('tidak-ada')).toBe('');
  });

  it('ambil GB & hari; tanpa "hari" dianggap 28', () => {
    expect(parseGbHari('3GB 1 Hari')).toEqual({ gb: 3, hari: 1 });
    expect(parseGbHari('7GB 28Hari')).toEqual({ gb: 7, hari: 28 });
    expect(parseGbHari('1,5GB Harian')).toEqual({ gb: 1, hari: 1 });
    expect(parseGbHari('Freedom internet')).toEqual({ gb: 0, hari: 28 });
  });
});
