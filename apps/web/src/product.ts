/** Chave do produto no endereço (/produto/<chave>, codificada como em productPath). null: não é a página do produto. */
export function productKeyFromUrl(path = location.pathname): string | null {
  const m = /^\/produto\/([^/]+)\/?$/.exec(path);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}
