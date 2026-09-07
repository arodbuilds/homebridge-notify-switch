import markSvg from '../../assets/notify-switch-mark.svg';

import { el } from './dom.js';

/**
 * The Notify Switch mark (assets/notify-switch-mark.svg), inlined into the bundle by esbuild's text
 * loader so the page draws it without loading a file. The asset uses `currentColor`, so the mark takes
 * the surrounding text colour and follows the host's theme (SPEC section 11.2, item 20).
 */

/** The mark at `size` CSS pixels, decorative (`aria-hidden`), in the surrounding text colour. */
export function renderMark(size: number): SVGElement {
  const holder = el('span', { class: 'ns-mark' });
  holder.innerHTML = markSvg;
  const svg = holder.querySelector('svg');
  if (!svg) {
    throw new Error('notify-switch-mark.svg has no svg element');
  }
  // The asset is indented for people; the whitespace text nodes would otherwise leak into the footer's textContent.
  const walker = document.createTreeWalker(svg, NodeFilter.SHOW_TEXT);
  const blank: Node[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node.nodeValue ?? '').trim()) {
      blank.push(node);
    }
  }
  for (const node of blank) {
    node.parentNode?.removeChild(node);
  }
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('ns-mark-svg');
  return svg;
}
