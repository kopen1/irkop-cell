// Polyfill localStorage untuk environment test (Node 26 punya eksperimental
// localStorage yang undefined tanpa flag; jsdom tidak mengeksposnya di sini).
if (!globalThis.localStorage) {
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
      key: (i) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}
if (!globalThis.matchMedia) {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
}