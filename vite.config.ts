/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// transformers.js loads the ONNX Runtime .wasm from its CDN (env.backends.onnx.wasm.wasmPaths);
// the copy Vite would emit (~27 MB) is never used, so drop it from the build.
const dropOrtWasm = (): Plugin => ({
  name: 'drop-ort-wasm',
  generateBundle(_, bundle) {
    for (const k of Object.keys(bundle)) if (/ort-wasm.*\.wasm$/.test(k)) delete bundle[k];
  },
});

export default defineConfig({
  plugins: [react()],
  base: './',
  worker: { format: 'es', plugins: () => [dropOrtWasm()] },
  build: { rollupOptions: { plugins: [dropOrtWasm()] } },
  test: { environment: 'node' },
});
