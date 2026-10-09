// Tiny DOM helpers. No framework.

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'draggable', 'readOnly', 'indeterminate']);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false && !PROPS.has(k)) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'testid') el.setAttribute('data-testid', String(v));
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'style' && typeof v === 'string') el.setAttribute('style', v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (PROPS.has(k)) (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: (Child | Child[])[]): void {
  for (const c of children) {
    if (Array.isArray(c)) append(el, c);
    else if (c === null || c === undefined || c === false) continue;
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function replaceChildren(el: Element, ...children: (Child | Child[])[]): void {
  clear(el);
  append(el, children);
}

/** Download a Blob through a temporary a[download] link. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Append children (null / false are skipped). */
export function addTo(el: Element, ...children: (Child | Child[])[]): void {
  append(el, children);
}
