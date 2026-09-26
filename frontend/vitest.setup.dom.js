// Setup tambahan untuk project test 'dom' (jsdom).
import { configure } from '@testing-library/react';
import './vitest.setup.js';

// Default asyncUtilTimeout Testing Library hanya 1000ms; di perangkat lambat
// (Termux/ARM) dengan beberapa worker paralel itu sering jadi flaky. Naikkan.
configure({ asyncUtilTimeout: 10000 });
