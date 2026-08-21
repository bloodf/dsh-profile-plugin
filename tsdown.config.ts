/**
 * tsdown config for @dsh-local/company-profiles: Node host half + browser client bundle.
 *
 * The client bundle wraps as a __ModuleLoader__.load() factory; externals
 * resolve through the harness module table (react, cordis, ui-slots, etc.).
 */
import { defineConfig } from 'tsdown'

const PACKAGE_ID = '@dsh-local/company-profiles'

/** Specifiers the harness module table shares; stay as require() in the bundle. */
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
])

export default defineConfig([
  // ── Node host half ────────────────────────────────────────────────────
  {
    name: PACKAGE_ID,
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    dts: false,
    clean: false,
    fixedExtension: false,
  },
  // ── Browser client bundle ─────────────────────────────────────────────
  {
    name: `${PACKAGE_ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    sourcemap: true,
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    external: [...CLIENT_EXTERNALS],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
