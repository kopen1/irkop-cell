import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/lib/db.js';

test('inChunks memecah daftar >90 nilai agar tidak melebihi batas bind D1', async () => {
  const db = createDb({ DB: {} });
  const calls = [];
  const nilai = Array.from({ length: 250 }, (_, i) => i + 1);
  const hasil = await db.inChunks(nilai, async (chunk) => {
    calls.push(chunk.length);
    return chunk;
  });
  assert.deepEqual(calls, [90, 90, 70]);
  assert.deepEqual(hasil, nilai);
});

test('inChunks daftar kosong tidak memanggil query', async () => {
  const db = createDb({ DB: {} });
  let dipanggil = false;
  const hasil = await db.inChunks([], async () => {
    dipanggil = true;
    return [];
  });
  assert.equal(dipanggil, false);
  assert.deepEqual(hasil, []);
});
