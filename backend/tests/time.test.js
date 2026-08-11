import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wibDateToUtcRange,
  utcToWibDate,
  isValidCalendarDate,
  isoToWib,
} from '../src/lib/time.js';

test('batas hari WIB: 2026-08-10 WIB = 2026-08-09T17:00:00Z s/d 2026-08-10T17:00:00Z', () => {
  const { startUtc, endUtc } = wibDateToUtcRange('2026-08-10');
  assert.equal(startUtc, '2026-08-09T17:00:00.000Z');
  assert.equal(endUtc, '2026-08-10T17:00:00.000Z');
});

test('transaksi pukul 16:59 WIB masuk tanggal kemarin, 17:00 masuk tanggal hari ini', () => {
  assert.equal(utcToWibDate('2026-08-09T10:00:00Z'), '2026-08-09');
  assert.equal(utcToWibDate('2026-08-09T10:00:00.000Z'), '2026-08-09');
  assert.equal(utcToWibDate('2026-08-09T17:00:00Z'), '2026-08-10');
  assert.equal(utcToWibDate('2026-08-10T07:00:00Z'), '2026-08-10');
});

test('validasi format tanggal', () => {
  assert.equal(isValidCalendarDate('2026-08-10'), true);
  assert.equal(isValidCalendarDate('2026-13-10'), false);
  assert.equal(isValidCalendarDate('2026-02-30'), false);
  assert.equal(isValidCalendarDate('10/08/2026'), false);
});

test('format tampilan ISO ke +07:00', () => {
  assert.match(isoToWib('2026-08-10T02:00:00.000Z'), /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000\+07:00/);
});