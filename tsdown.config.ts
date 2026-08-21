/**
 * tsdown config for dsh-profile-plugin: browser client bundle only.
 *
 * The Node host half is compiled by `tsc` (see package.json `build` script);
 * tsdown here only produces the browser client bundle, which wraps as a
 * __ModuleLoader__.load() factory. Externals resolve through the harness
 * module table (react, cordis, ui-slots, etc.).
 */
import { defineConfig } from 'tsdown'

const PACKAGE_ID = 'dsh-profile-plugin'

/** Specifiers the harness module table shares; stay as require() in the bundle. */
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-runtime/client',
])

export default defineConfig([
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
    css: { inject: true, minify: true },
    sourcemap: false,
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    deps: { neverBundle: [...CLIENT_EXTERNALS] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
