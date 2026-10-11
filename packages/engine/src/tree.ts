import type { Page } from 'playwright';
import { OutcomeError } from './outcome';

const INTERACTIVE = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'option',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'treeitem',
]);
const LANDMARKS = new Set(['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'region', 'search', 'dialog', 'alertdialog']);
/** Kept only when they have a name: they are the scopes steps search within. */
const NAMED_CONTAINERS = new Set(['article', 'form', 'group']);
/** Kept with their text: what the page is announcing (validation errors, "added to cart"). */
const ANNOUNCEMENTS = new Set(['alert', 'status']);
/** Text-like nodes kept only inside an announcement, so an error list stays readable. */
const ANNOUNCEMENT_TEXT = new Set(['listitem', 'paragraph', 'text']);
/** Fields whose typed value is replaced by [filled]: the model never sees input values. */
const VALUE_FIELDS = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

interface Node {
  role: string;
  name: string | null;
  attrs: string;
  value: string | null;
}

/** Splits "role "name" [attrs]: value" (optionally YAML single-quoted) into its parts. */
function parseLine(rest: string): Node | null {
  let key: string;
  let after: string;
  if (rest.startsWith("'")) {
    let i = 1;
    key = '';
    while (i < rest.length) {
      if (rest[i] === "'") {
        if (rest[i + 1] === "'") {
          key += "'";
          i += 2;
          continue;
        }
        break;
      }
      key += rest[i];
      i++;
    }
    after = rest.slice(i + 1);
  } else {
    let i = 0;
    let quoted = false;
    for (; i < rest.length; i++) {
      const char = rest[i];
      if (quoted && char === '\\') {
        i++;
        continue;
      }
      if (char === '"') quoted = !quoted;
      else if (char === ':' && !quoted && (i === rest.length - 1 || rest[i + 1] === ' ')) break;
    }
    key = rest.slice(0, i);
    after = rest.slice(i);
  }
  const match = /^([a-z][a-z0-9]*|\/[a-z]+)(?: "((?:[^"\\]|\\.)*)")?((?: \[[^\]]*\])*)$/.exec(key.trim());
  if (!match?.[1]) return null;
  const value = after.startsWith(': ') ? after.slice(2).trim().replace(/^"(.*)"$/, '$1') : null;
  return { role: match[1], name: match[2]?.replace(/\\(.)/g, '$1') ?? null, attrs: match[3] ?? '', value };
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export interface PrunedTree {
  text: string;
  nodes: number;
}

/**
 * Tree budget, enforced before any model call: keep interactive, landmark and heading nodes (plus named
 * containers and announcements), truncate text, hard-cap the node count. Over the cap is refused, never cut.
 */
export function pruneAriaSnapshot(snapshot: string, limits: { maxNodes: number; maxTextChars: number }): PrunedTree {
  const lines: string[] = [];
  const stack: { indent: number; kept: boolean; announcement: boolean }[] = [];
  for (const raw of snapshot.split('\n')) {
    const match = /^(\s*)- (.*)$/.exec(raw);
    if (!match) continue;
    const indent = match[1]?.length ?? 0;
    while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? -1) >= indent) stack.pop();
    const node = parseLine(match[2] ?? '');
    const insideAnnouncement = stack.some((entry) => entry.announcement);
    const keep =
      node !== null &&
      (INTERACTIVE.has(node.role) ||
        LANDMARKS.has(node.role) ||
        node.role === 'heading' ||
        ANNOUNCEMENTS.has(node.role) ||
        (NAMED_CONTAINERS.has(node.role) && node.name !== null) ||
        (insideAnnouncement && ANNOUNCEMENT_TEXT.has(node.role)));
    if (node && keep) {
      const depth = stack.filter((entry) => entry.kept).length;
      let line = `${'  '.repeat(depth)}- ${node.role}`;
      if (node.name !== null) line += ` "${truncate(node.name, limits.maxTextChars)}"`;
      line += node.attrs;
      if (VALUE_FIELDS.has(node.role)) {
        if (node.value) line += ' [filled]';
      } else if (node.value) {
        line += `: ${truncate(node.value, limits.maxTextChars)}`;
      }
      lines.push(line);
    }
    stack.push({ indent, kept: Boolean(node && keep), announcement: Boolean(node && keep && ANNOUNCEMENTS.has(node.role)) });
  }
  if (lines.length > limits.maxNodes) {
    throw new OutcomeError(
      'unresolvable',
      'tree_too_large',
      `the pruned accessibility tree has ${lines.length} nodes, over the ${limits.maxNodes} limit; refusing to send it`,
    );
  }
  return { text: lines.join('\n'), nodes: lines.length };
}

/** Input value (lower-cased) to its key: used to mark screen names that are input values, never to send values. */
export function valueOwnersOf(inputs: Readonly<Record<string, string>>): Map<string, string> {
  return new Map(Object.entries(inputs).map(([key, value]) => [value.trim().toLowerCase(), key]));
}

/** Values shorter than this are left alone: replacing "1" or "12" everywhere would garble the text, not protect it. */
const MIN_REDACTED_LENGTH = 3;

/**
 * Free text from the page or the run (an alert, a failure reason) with every input value replaced by {key},
 * so it can be logged or put into a prompt. Longest values first, case-insensitive.
 */
export function redactValues(text: string, valueOwners: ReadonlyMap<string, string>): string {
  let redacted = text;
  for (const [value, key] of [...valueOwners].sort(([a], [b]) => b.length - a.length)) {
    if (value.length < MIN_REDACTED_LENGTH) continue;
    redacted = redacted.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), `{${key}}`);
  }
  return redacted;
}

/** "(= input product)" when a name on screen is the value of an input, so a model can use the key. */
export function inputMark(name: string, valueOwners: ReadonlyMap<string, string>): string {
  const owner = valueOwners.get(name.trim().toLowerCase());
  return owner ? ` (= input ${owner})` : '';
}

/**
 * The current screen for a model: the pruned body tree, with names that equal an input value marked.
 * The name is already on the screen, so nothing new is revealed; the mark only says which key it is.
 */
export async function screenTree(
  page: Page,
  limits: { maxNodes: number; maxTextChars: number },
  valueOwners: ReadonlyMap<string, string>,
): Promise<{ path: string; tree: PrunedTree }> {
  const snapshot = await page.locator('body').ariaSnapshot({ timeout: 3000 });
  const pruned = pruneAriaSnapshot(snapshot, limits);
  const text = pruned.text
    .split('\n')
    .map((line) => {
      const name = /^\s*- [a-z]+ "((?:[^"\\]|\\.)*)"/.exec(line)?.[1];
      return name === undefined ? line : `${line}${inputMark(name, valueOwners)}`;
    })
    .join('\n');
  return { path: new URL(page.url()).pathname, tree: { ...pruned, text } };
}
