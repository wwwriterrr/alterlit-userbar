// Содержимое уведомлений — HTML с сайта (ссылки, выделение). Вставляем только
// разрешённые теги и безопасные ссылки, всё прочее превращается в текст.

const ALLOWED = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'BR', 'P', 'SPAN', 'DIV', 'BLOCKQUOTE']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT']);

function safeHref(href: string | null) {
  if (!href) return null;
  try {
    const url = new URL(href, location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:' ? href : null;
  } catch {
    return null;
  }
}

function clean(node: Node, into: Node) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      into.appendChild(document.createTextNode(child.textContent ?? ''));
      continue;
    }
    if (!(child instanceof Element) || DROP.has(child.tagName)) continue;
    if (!ALLOWED.has(child.tagName)) {
      clean(child, into); // неизвестный тег — оставляем только содержимое
      continue;
    }
    const el = document.createElement(child.tagName.toLowerCase());
    if (child.tagName === 'A') {
      const href = safeHref(child.getAttribute('href'));
      if (href) el.setAttribute('href', href);
      // как задумал автор уведомления: target="_blank" — в новой вкладке
      if (href && child.getAttribute('target') === '_blank') {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener');
      }
    }
    clean(child, el);
    into.appendChild(el);
  }
}

/** HTML уведомления → безопасный HTML. */
export function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = document.createElement('div');
  clean(doc.body, out);
  return out.innerHTML;
}
