import { describe, it, expect } from 'vitest';
import { parseVCard, normalisasiTelepon, tebakJenisNomor, tipeAliasUntuk } from '../vcard.js';

const kartu = (...baris) => ['BEGIN:VCARD', 'VERSION:3.0', ...baris, 'END:VCARD'].join('\r\n');

describe('parseVCard', () => {
  it('baca satu kontak: FN + TEL', () => {
    const out = parseVCard(kartu('FN:John Doe', 'TEL;TYPE=CELL:+62 812-3456-7890'));
    expect(out).toHaveLength(1);
    expect(out[0].nama).toBe('John Doe');
    expect(out[0].telepon).toBe('+62 812-3456-7890');
  });

  it('baca banyak kontak dalam satu file', () => {
    const out = parseVCard(
      [kartu('FN:Andi', 'TEL;TYPE=CELL:0811'), kartu('FN:Budi', 'TEL;TYPE=CELL:0812')].join('\r\n')
    );
    expect(out.map((c) => c.nama)).toEqual(['Andi', 'Budi']);
  });

  it('pakai N kalau FN tidak ada, dan gabung nama dengan spasi', () => {
    const out = parseVCard(kartu('N:Doe;John;Alan;;;'));
    expect(out[0].nama).toBe('John Alan Doe');
  });

  it('simpan SEMUA nomor beserta jenisnya (HP, rekening, token)', () => {
    const out = parseVCard(
      kartu('FN:X', 'TEL;TYPE=HOME:021-5551234', 'TEL;TYPE=CELL:08123456789', 'TEL:2601234567890123456')
    );
    expect(out[0].jumlahTelepon).toBe(3);
    expect(out[0].nomor.map((n) => n.jenis)).toEqual(['rekening', 'hp', 'token']);
  });

  it('baca EMAIL bila ada', () => {
    const out = parseVCard(kartu('FN:X', 'EMAIL:x@y.z'));
    expect(out[0].email).toBe('x@y.z');
  });

  it('unescape pemisah vCard (\\, \\; \\n)', () => {
    const out = parseVCard(kartu('FN:Siti Aminah \\, S.Kom', 'TEL;TYPE=CELL:0812'));
    expect(out[0].nama).toBe('Siti Aminah , S.Kom');
  });

  it('decode quoted-printable termasuk UTF-8 multibyte', () => {
    const out = parseVCard(
      kartu('FN:Café Renard', 'TEL;TYPE=CELL;ENCODING=QUOTED-PRINTABLE:=2B33=39=31=32=30=C3=A9=32=30')
    );
    expect(out[0].nama).toBe('Café Renard');
    expect(out[0].telepon).toBe('+339120é20');
  });

  it('gabungkan soft line break quoted-printable dan line folding', () => {
    const teks = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Nama Lipat\r\nNOTE:baris panja=\r\nng dan lipat\r\n \r\n lanjut\r\nTEL;TYPE=CELL:0812\r\nEND:VCARD';
    const out = parseVCard(teks);
    expect(out).toHaveLength(1);
    expect(out[0].telepon).toBe('0812');
  });

  it('kontak tanpa nomor tetap terbaca (nama saja)', () => {
    const out = parseVCard(kartu('FN:Tanpa Nomor'));
    expect(out).toHaveLength(1);
    expect(out[0].nama).toBe('Tanpa Nomor');
    expect(out[0].telepon).toBe('');
  });

  it('file kosong / bukan vCard tidak menghasilkan data', () => {
    expect(parseVCard('')).toEqual([]);
    expect(parseVCard('bukan file kontak sama sekali')).toEqual([]);
  });
});

describe('normalisasiTelepon', () => {
  it('samakan format nomor Indonesia supaya duplikat terdeteksi', () => {
    expect(normalisasiTelepon('0812-3456-7890')).toBe('6281234567890');
    expect(normalisasiTelepon('+62 812 3456 7890')).toBe('6281234567890');
    expect(normalisasiTelepon('6281234567890')).toBe('6281234567890');
  });

  it('nomor non-Indonesia dibiarkan apa adanya (dibersihkan non-digit)', () => {
    expect(normalisasiTelepon('021-5551234')).toBe('0215551234');
  });

  it('kirim kosong tetap kosong', () => {
    expect(normalisasiTelepon('')).toBe('');
    expect(normalisasiTelepon(null)).toBe('');
  });
});

describe('tebakJenisNomor', () => {
  it('KENAIKAN: nomor seluler Indonesia (08 / 62 / +62) jadi hp', () => {
    expect(tebakJenisNomor('081234567890')).toBe('hp');
    expect(tebakJenisNomor('+62 812 111 222 333')).toBe('hp');
    expect(tebakJenisNomor('6281234567890')).toBe('hp');
  });

  it('nomor tetap (021, 031) TIDAK dianggap hp walau awalan 0', () => {
    expect(tebakJenisNomor('021-5551234')).toBe('rekening');
    expect(tebakJenisNomor('021-5551234', ['work'])).toBe('rekening');
  });

  it('nomor rekening 10-16 digit', () => {
    expect(tebakJenisNomor('1234567890', ['work'])).toBe('rekening');
    expect(tebakJenisNomor('1234567890123456')).toBe('rekening');
  });

  it('token listrik 17+ digit', () => {
    expect(tebakJenisNomor('2601234567890123456')).toBe('token');
  });

  it('label vCard menang: TYPE=CELL menandai apa pun sebagai hp', () => {
    expect(tebakJenisNomor('2601234567890123456', ['cell'])).toBe('hp');
  });
});

describe('tipeAliasUntuk', () => {
  it('hp -> no_hp, rekening & token -> no_rekening (tipe yang tersedia di backend)', () => {
    expect(tipeAliasUntuk('hp')).toBe('no_hp');
    expect(tipeAliasUntuk('rekening')).toBe('no_rekening');
    expect(tipeAliasUntuk('token')).toBe('no_rekening');
  });
});
