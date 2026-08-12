import { defineConfig } from 'vitest/config';
import { devtools } from '@tanstack/devtools-vite';

import { tanstackRouter } from '@tanstack/router-plugin/vite';

import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';

// `pnpm build:analyze` (mode: 'analyze') writes dist/stats.html — check it against
// the 300KB gzipped eager-chunk budget (NFR-PERF-4) before merging anything that
// adds a dependency or moves an import across the auth-gate boundary (System Design §2.6).
const config = defineConfig(({ mode }) => ({
    resolve: { tsconfigPaths: true },
    plugins: [
        devtools(),
        tailwindcss(),
        tanstackRouter({ target: 'react', autoCodeSplitting: true, routesDirectory: './src/app/router' }),
        viteReact(),
        mode === 'analyze' && visualizer({ filename: 'dist/stats.html', gzipSize: true, brotliSize: true }),
    ],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        css: true,
    },
}));

export default config;
