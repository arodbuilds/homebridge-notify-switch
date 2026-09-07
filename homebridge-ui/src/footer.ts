import { FOOTER } from './copy.js';
import { el } from './dom.js';

/**
 * Version and credit footer (SPEC section 11.2, item 20): the last element on the page, one line of
 * secondary text. The version is asked from the plugin's UI server, which reads it from the installed
 * package.json, so it always reflects the installed package. Both links open in a new tab; the site
 * link carries a `ref` parameter and nothing else is tracked.
 */

interface VersionResult {
  ok: boolean;
  message: string;
  version?: unknown;
}

function outLink(text: string, href: string): HTMLAnchorElement {
  return el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
}

function item(...children: Array<Node | string>): HTMLElement {
  return el('span', { class: 'ns-footer-item' }, ...children);
}

/** Renders the footer and fills in the version once the server answers. */
export function renderFooter(): HTMLElement {
  const version = item(FOOTER.name);
  const separator = (): string => ' · ';
  const footer = el('footer', { class: 'ns-footer form-text' },
    version, separator(),
    item(FOOTER.madeBy), separator(),
    item(outLink(FOOTER.site, FOOTER.siteUrl)), separator(),
    item(outLink(FOOTER.issues, FOOTER.issuesUrl)),
  );
  // Asked directly rather than through callServer so the page's spinner is not shown for it.
  Promise.resolve()
    .then(() => window.homebridge.request('/version', {}) as Promise<VersionResult>)
    .then((result) => {
      if (result && result.ok && typeof result.version === 'string' && result.version.length > 0) {
        version.textContent = `${FOOTER.name} v${result.version}`;
      }
    })
    .catch(() => undefined);
  return footer;
}
