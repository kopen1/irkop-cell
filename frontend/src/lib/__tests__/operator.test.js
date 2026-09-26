import { describe, it, expect } from 'vitest';
import { operatorOf, kodePrefixOf } from '../operator.js';

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
