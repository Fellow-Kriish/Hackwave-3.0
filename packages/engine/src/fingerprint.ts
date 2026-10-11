import type { Locator } from 'playwright';

export interface Landmark {
  role: string;
  name: string | null;
}

/** What a locator cache entry remembers about an element: role, name, landmark, nearby text, href or type. */
export interface Fingerprint {
  role: string;
  name: string;
  landmark: Landmark | null;
  /** Headings, legends and labels in the element's container: never free text, so input values stay out. */
  siblingText: string[];
  href: string | null;
  type: string | null;
}

/** The nearest named ancestor that getByRole can address, used as a scope when a name alone is not unique. */
export interface Container {
  role: string;
  name: string;
}

export interface ElementDescription {
  fingerprint: Fingerprint;
  container: Container | null;
}

/** The accessible name, as Playwright computes it, from the element's own aria snapshot line. */
export async function accessibleName(locator: Locator): Promise<string> {
  const line = (await locator.ariaSnapshot({ timeout: 2000 })).split('\n')[0] ?? '';
  const match = /^- [a-z]+ "((?:[^"\\]|\\.)*)"/.exec(line.trim()) ?? /^- '[a-z]+ "((?:[^"\\]|\\.)*)"/.exec(line.trim());
  return match?.[1]?.replace(/\\(.)/g, '$1') ?? '';
}

/** Fingerprint and nearest named container of one element (the locator must match exactly one). */
export async function describeElement(locator: Locator, role: string): Promise<ElementDescription> {
  const name = await accessibleName(locator);
  // No named helpers inside this callback: tsx compiles with esbuild's keepNames, which wraps every named
  // function in a __name() call that exists in Node but not in the page (lint enforces this).
  const dom = await locator.evaluate((element, ownName) => {
    const LANDMARKS = ['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'region', 'search', 'dialog', 'alertdialog', 'form'];
    const CONTAINERS = ['article', 'region', 'dialog', 'alertdialog', 'form', 'group', 'navigation', 'complementary', 'banner', 'main', 'contentinfo'];
    const IMPLICIT: Record<string, string> = { ARTICLE: 'article', NAV: 'navigation', MAIN: 'main', ASIDE: 'complementary', DIALOG: 'dialog', FIELDSET: 'group' };
    const SECTIONING = 'article, aside, main, nav, section';
    let landmark: { role: string; name: string | null } | null = null;
    let container: { role: string; name: string } | null = null;
    let containerElement: Element | null = null;
    for (let el = element.parentElement; el; el = el.parentElement) {
      const label = el.getAttribute('aria-label')?.trim();
      const labelledBy = el.getAttribute('aria-labelledby');
      const legend = el.tagName === 'FIELDSET' ? el.querySelector(':scope > legend') : null;
      const name = label
        ? label
        : labelledBy
          ? labelledBy
              .split(/\s+/)
              .map((id) => (document.getElementById(id)?.textContent ?? '').replace(/\s+/g, ' ').trim())
              .join(' ')
              .trim()
          : (legend?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const tag = el.tagName;
      const topLevel = !el.parentElement?.closest(SECTIONING);
      const role =
        el.getAttribute('role') ||
        IMPLICIT[tag] ||
        (tag === 'HEADER' && topLevel ? 'banner' : null) ||
        (tag === 'FOOTER' && topLevel ? 'contentinfo' : null) ||
        (tag === 'SECTION' && name ? 'region' : null) ||
        (tag === 'FORM' && name ? 'form' : null);
      if (!role) continue;
      if (!landmark && LANDMARKS.includes(role)) landmark = { role, name: name || null };
      if (!container && CONTAINERS.includes(role) && name) {
        container = { role, name };
        containerElement = el;
      }
      if (landmark && container) break;
    }
    // The element's own text and its own label (a field's "Card number") say nothing about where it sits; only
    // the headings and labels around it tell one field of a form from the next.
    const own = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    const ownLabel = ownName.replace(/\s+/g, ' ').trim().toLowerCase();
    const siblingText: string[] = [];
    const around = containerElement ?? element.closest('article, li, fieldset, form, section, [role="dialog"], [role="group"]');
    if (around) {
      for (const node of around.querySelectorAll('h1, h2, h3, h4, h5, h6, legend, label')) {
        const value = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (value && value !== own && value.toLowerCase() !== ownLabel && value.length <= 80 && !siblingText.includes(value)) siblingText.push(value);
        if (siblingText.length >= 4) break;
      }
    }
    return { landmark, container, siblingText, href: element.getAttribute('href'), type: element.getAttribute('type') };
  }, name);
  return {
    fingerprint: { role, name, landmark: dom.landmark, siblingText: dom.siblingText, href: dom.href, type: dom.type },
    container: dom.container,
  };
}
