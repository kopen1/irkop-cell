import { defineConfig } from 'vitest/config';

// Test logika murni (src/lib) tidak perlu DOM -> environment 'node' (jauh lebih murah).
// Test komponen/halaman (.jsx) tetap jsdom.
export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.js'],
    testTimeout: 30000,
    hookTimeout: 30000,
    projects: [
        {
          test: {
            name: 'logika',
            environment: 'node',
            pool: 'threads',
            setupFiles: ['./vitest.setup.js'],
            testTimeout: 30000,
            hookTimeout: 30000,
            sequence: { groupOrder: 1 },
            include: ['src/lib/__tests__/*.test.js'],
          },
        },
        {
          test: {
            name: 'dom',
            environment: 'jsdom',
            pool: 'threads',
            setupFiles: ['./vitest.setup.dom.js'],
            testTimeout: 30000,
            hookTimeout: 30000,
            sequence: { groupOrder: 2 },
            environmentOptions: {
              jsdom: { url: 'http://localhost/' },
            },
            include: ['src/**/*.test.jsx'],
          },
        },
    ],
  },
});
