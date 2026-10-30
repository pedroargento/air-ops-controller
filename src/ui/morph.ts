function syncAttributes(current: Element, next: Element): void {
  for (const { name } of [...current.attributes]) {
    if (!next.hasAttribute(name)) current.removeAttribute(name);
  }
  for (const { name, value } of [...next.attributes]) {
    if (current.getAttribute(name) !== value) current.setAttribute(name, value);
  }
  if (current instanceof HTMLInputElement && next instanceof HTMLInputElement) {
    current.checked = next.checked;
  }
}

function syncChildren(current: Node, next: Node): void {
  const incoming = [...next.childNodes];
  for (const [index, node] of incoming.entries()) {
    const existing = current.childNodes[index];
    if (existing === undefined) {
      current.appendChild(node);
    } else if (existing.nodeType !== node.nodeType || existing.nodeName !== node.nodeName) {
      current.replaceChild(node, existing);
    } else if (existing instanceof Element && node instanceof Element) {
      syncAttributes(existing, node);
      syncChildren(existing, node);
    } else if (existing.nodeValue !== node.nodeValue) {
      existing.nodeValue = node.nodeValue;
    }
  }
  while (current.childNodes.length > incoming.length) {
    const last = current.lastChild;
    if (last === null) break;
    current.removeChild(last);
  }
}

/**
 * Updates `target` to match `html` while keeping its existing elements. Panels change
 * every simulated second, and replacing them would swallow clicks mid-press and reset
 * what the player is typing, so an input's typed value is left alone.
 */
export function morphHtml(target: HTMLElement, html: string): void {
  if (target.dataset['html'] === html) return;
  target.dataset['html'] = html;
  const template = document.createElement('template');
  template.innerHTML = html;
  syncChildren(target, template.content);
}
