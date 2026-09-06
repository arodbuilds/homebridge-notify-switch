import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Bundles the custom settings UI (homebridge-ui/src) into a single script the Homebridge UI serves
 * from homebridge-ui/public. No framework; libphonenumber-js is the only third party code in the
 * bundle (SPEC section 12, item 9). Targets the browsers the Homebridge UI itself supports.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(root, 'homebridge-ui/src/main.ts')],
  outfile: resolve(root, 'homebridge-ui/public/index.js'),
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'iife',
  target: 'es2020',
  legalComments: 'none',
  logLevel: 'info',
});
