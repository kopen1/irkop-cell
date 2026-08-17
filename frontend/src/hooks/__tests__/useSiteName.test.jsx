// @vitest-environment jsdom
// Test hook useSiteName: satu sumber kebenaran nama website (GET /settings)
// dengan cache modul + fallback aman + live update via setSiteNameCache.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { api } from '../../lib/api';
import {
  useSiteName,
  loadSiteName,
  setSiteNameCache,
  resetSiteNameCache,
  DEFAULT_SITE_NAME,
} from '../useSiteName';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn() },
}));

beforeEach(() => {
  resetSiteNameCache();
  api.get.mockReset();
});

afterEach(cleanup);

describe('useSiteName', () => {
  it('memuat nama website dari GET /settings dan meng-cache (1 request untuk banyak pemakai)', async () => {
    api.get.mockResolvedValue({ nama_website: 'Toko Saya' });
    const { result } = renderHook(() => useSiteName());
    await waitFor(() => expect(result.current).toBe('Toko Saya'));
    expect(api.get).toHaveBeenCalledTimes(1);

    const { result: r2 } = renderHook(() => useSiteName());
    expect(r2.current).toBe('Toko Saya');
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('fallback aman ke Iirkop Cell saat GET /settings gagal', async () => {
    api.get.mockRejectedValue(new Error('network_error'));
    const { result } = renderHook(() => useSiteName());
    await waitFor(() => expect(result.current).toBe(DEFAULT_SITE_NAME));
    expect(result.current).toBe('Iirkop Cell');
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('setSiteNameCache memperbarui pemakai yang sedang terpasang (live)', async () => {
    api.get.mockResolvedValue({ nama_website: 'Toko Lama' });
    const { result } = renderHook(() => useSiteName());
    await waitFor(() => expect(result.current).toBe('Toko Lama'));

    act(() => setSiteNameCache('Toko Baru'));
    expect(result.current).toBe('Toko Baru');
  });

  it('setelah resetSiteNameCache, pemakai yang baru terpasang fetch ulang', async () => {
    api.get.mockResolvedValue({ nama_website: 'Toko Lama' });
    const { result, unmount } = renderHook(() => useSiteName());
    await waitFor(() => expect(result.current).toBe('Toko Lama'));
    expect(api.get).toHaveBeenCalledTimes(1);

    unmount();
    act(() => resetSiteNameCache());
    api.get.mockResolvedValue({ nama_website: 'Toko Segar' });

    const { result: r2 } = renderHook(() => useSiteName());
    await waitFor(() => expect(r2.current).toBe('Toko Segar'));
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('loadSiteName berbagi in-flight request (tidak dobel fetch)', async () => {
    let resolve;
    api.get.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const p1 = loadSiteName();
    const p2 = loadSiteName();
    resolve({ nama_website: 'X' });
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe('X');
    expect(b).toBe('X');
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});