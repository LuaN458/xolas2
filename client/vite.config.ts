import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          plugins: [
            {
              name: 'fix-preload-cjs',
              closeBundle() {
                const preloadFile = path.resolve(__dirname, 'dist-electron/preload.cjs');
                if (fs.existsSync(preloadFile)) {
                  let code = fs.readFileSync(preloadFile, 'utf-8');
                  code = code.replace(/export\s+default\s+([a-zA-Z0-9_$]+)\(\);?/g, '$1();');
                  code = code.replace(/export\s+default\s+/g, '');
                  fs.writeFileSync(preloadFile, code, 'utf-8');
                }
              },
            },
          ],
          build: {
            rollupOptions: {
              output: {
                format: 'cjs',
                entryFileNames: 'preload.cjs',
                inlineDynamicImports: true,
              },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  server: {
    port: 5173,
  },
});
