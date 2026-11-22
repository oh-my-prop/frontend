// Tiny DOM builder for the public pages. createElement/textContent only (no
// innerHTML) and no inline style attributes, because the CSP forbids them.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

// Replace a placeholder's content with a single status line (loading, empty, offline).
export function showMessage(container, text, tone = 'info') {
  container.replaceChildren(el('p', { class: `status-msg ${tone}`, role: tone === 'error' ? 'alert' : 'status', text }));
}
