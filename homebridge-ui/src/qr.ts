import qrcode from 'qrcode-generator';

import { el } from './dom.js';

/**
 * QR codes for the Telegram onboarding flow (SPEC section 11.2, item 10), rendered as inline SVG by
 * qrcode-generator at build time inside the UI bundle. The library is a dev dependency only; the
 * plugin itself never loads it.
 */

/** The SVG markup for `text`: white background, black modules, scalable to its container. */
export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ scalable: true, margin: 2 });
}

/** A QR code element for `text`, sized by the `.ns-qr` (or `.ns-qr-large`) style. */
export function qrElement(text: string, label: string, large = false): HTMLElement {
  const box = el('div', { class: large ? 'ns-qr ns-qr-large' : 'ns-qr', role: 'img', 'aria-label': label, 'data-qr': text });
  // The markup comes from qrcode-generator for a URL this page built; it holds only rect and path elements.
  box.innerHTML = qrSvg(text);
  return box;
}
