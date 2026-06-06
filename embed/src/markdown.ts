import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function isSafeImageUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isSafeLinkUrl(value: string): boolean {
  try {
    const url = new URL(value, window.location.href);
    return SAFE_URL_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

export function renderSafeMarkdown(markdown: string): string {
  const html = micromark(markdown, {
    allowDangerousHtml: false,
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()]
  });

  const template = document.createElement('template');
  template.innerHTML = html;

  for (const image of template.content.querySelectorAll('img')) {
    const src = image.getAttribute('src') || '';
    if (!isSafeImageUrl(src)) return '<p class="preview-error">图片只允许安全 HTTPS 地址。</p>';
    image.setAttribute('loading', 'lazy');
    image.setAttribute('referrerpolicy', 'no-referrer');
  }

  for (const link of template.content.querySelectorAll('a')) {
    const href = link.getAttribute('href') || '';
    if (!isSafeLinkUrl(href)) {
      link.removeAttribute('href');
      continue;
    }
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noreferrer');
  }

  return template.innerHTML;
}

