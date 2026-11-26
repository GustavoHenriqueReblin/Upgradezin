export const html = (value: unknown): string => String(value).replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export function publicLink(value?: string): string | undefined {
  try {
    const url = new URL(value ?? '');
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href;
  } catch {
    return undefined;
  }
}

export function pageHtml(template: string, page: { title: string; description: string; canonical?: string; body: string; client?: boolean; noindex?: boolean; data?: object }): string {
  const head = [
    `<title>${html(page.title)} · Upgradezin</title>`,
    `<meta name="description" content="${html(page.description)}">`,
    page.canonical && `<link rel="canonical" href="${html(page.canonical)}">`,
    '<meta property="og:site_name" content="Upgradezin">',
    `<meta property="og:title" content="${html(page.title)}">`,
    `<meta property="og:description" content="${html(page.description)}">`,
    page.canonical && `<meta property="og:url" content="${html(page.canonical)}">`,
    page.noindex && '<meta name="robots" content="noindex">',
    page.data && `<script type="application/ld+json">${JSON.stringify(page.data).replaceAll('<', '\\u003c')}</script>`,
  ].filter(Boolean).join('\n    ');
  const shell = page.client ? template : template.replace(/<script\b[^>]*\btype="module"[^>]*>\s*<\/script>/g, '');
  // A versão HTML continua disponível com JavaScript desativado, sem aparecer antes da montagem do React.
  const content = page.client
    ? `<div id="root"></div><noscript>${page.body}</noscript>`
    : `<div id="root">${page.body}</div>`;
  return shell.replace(/<title>[^<]*<\/title>/, () => head).replace('<div id="root"></div>', () => content);
}

export const publicNav = '<nav aria-label="Navegação"><a href="/">Upgradezin</a><a href="/catalogo">Catálogo</a><a href="/guias">Guias e comparativos</a></nav>';
export const publicBody = (body: string) => `<main class="public-page">${publicNav}${body}</main>`;
