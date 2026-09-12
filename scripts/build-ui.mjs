import { build } from 'esbuild';
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Bundles the custom settings UI (homebridge-ui/src) into a single script the Homebridge UI serves
 * from homebridge-ui/public. No framework; libphonenumber-js is the only third party code in the
 * bundle (SPEC section 12, item 9). Targets the browsers the Homebridge UI itself supports.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The page banner is served from the plugin's own public folder, never from an external host (SPEC section 11.2, item 28).
// The copy is made here so assets/ stays the one source of the artwork; the copy is gitignored and published with the bundle.
copyFileSync(resolve(root, 'assets/notify-switch-banner.png'), resolve(root, 'homebridge-ui/public/notify-switch-banner.png'));

await build({
  entryPoints: [resolve(root, 'homebridge-ui/src/main.ts')],
  outfile: resolve(root, 'homebridge-ui/public/index.js'),
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'iife',
  target: 'es2020',
  legalComments: 'none',
  // The brand mark is inlined as text so the footer draws it with no file to load (SPEC section 11.2, item 20).
  loader: { '.svg': 'text' },
  logLevel: 'info',
});
