import { CATEGORIES, STORES, storeSearchUrl, type AdminStoreConfig, type AdminStoreInput, type CategoryId, type StoreId, type StoreInfo } from '@upgradezin/shared';
import type { Db } from './db/db.ts';
import './config.ts'; // carrega o .env antes de ler as variáveis

/**
 * Lojas: o código só conhece IDs (s1, s2, s3). O que identifica cada loja fica no banco
 * (tabela store_configs), editado no admin. Na primeira vez, o servidor copia para o banco o
 * que estiver no .env (depois disso, STORE_* do .env não valem mais):
 *   STORE_S1_NAME=Nome exibido
 *   STORE_S1_URL=https://www.loja.com.br              (origem do site)
 *   STORE_S1_SEARCH=/busca/{slug}                     (caminho da busca: {q}, {q+} ou {slug})
 *   STORE_S1_CATEGORIES=psu:caminho/fontes,motherboard:caminho/placas   (opcional)
 *   STORE_S1_COLOR="#22c55e"                          (opcional: cor da loja na tela; no .env, # sem aspas vira comentário)
 *   STORE_S1_COLOR="#ffc300,#e30613"                  (duas ou três cores, separadas por vírgula: a bolinha vira degradê)
 *   STORE_S1_SWEEP=psu:/caminho/fontes,cooler:/caminho/air /caminho/water (página de cada categoria, lida pela rotina de preços; mais de uma: separadas por espaço)
 * Loja sem NAME, URL ou SEARCH fica desligada. Testes e `pnpm scan` sem banco usam o .env direto.
 */
export interface StoreConfig {
  id: StoreId;
  /** Desligada no admin: fica de fora das buscas e da rotina, mas a configuração continua guardada. */
  enabled: boolean;
  name: string;
  /** Origem do site, sem barra no fim. */
  url: string;
  /** Caminho da busca com marcador. */
  search: string;
  /** Caminho da categoria na própria loja, quando o adapter filtra por ele. */
  categories: Partial<Record<CategoryId, string>>;
  /** Cores na tela (#rrggbb): uma (lisa) ou 2–3 (degradê na bolinha). */
  colors: string[];
  /**
   * Página de cada categoria no site (começa com /), lida pela rotina de preços. Um ou mais
   * caminhos separados por espaço (lista da categoria dividida em mais de uma página na loja).
   */
  sweep: Partial<Record<CategoryId, string>>;
}

/** "psu:a/b,ssd:c" -> { psu: 'a/b', ssd: 'c' }, só categorias conhecidas. */
function categoryMap(value: string): Partial<Record<CategoryId, string>> {
  const out: Partial<Record<CategoryId, string>> = {};
  for (const pair of value.split(',')) {
    const i = pair.indexOf(':');
    const [cat, path] = [pair.slice(0, i).trim(), pair.slice(i + 1).trim()];
    if (i > 0 && path && isCategory(cat)) out[cat] = path;
  }
  return out;
}

const isCategory = (c: string): c is CategoryId => (CATEGORIES as readonly string[]).includes(c);
/** Caminho dentro do próprio site (/...), nunca outra origem. */
const isSitePath = (v: string) => /^\/[^/]/.test(v);
const MARKER = /\{(q|q\+|slug)\}/;
/** "/a  /b" -> ['/a', '/b']. */
const pathList = (v: string) => v.split(/\s+/).filter(Boolean);
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * "#a,#b" -> ['#a', '#b']: até 3 cores. Só rgb/rrggbb, com ou sem # (no .env, # sem aspas começa
 * um comentário), porque o valor vai para o estilo da página; uma cor inválida anula a lista.
 */
export function parseColors(value: string): string[] {
  const list = value.split(',').map((v) => v.trim().replace(/^#/, '')).filter(Boolean).slice(0, 3);
  return list.every((h) => /^(?:[0-9a-f]{3}){1,2}$/i.test(h)) ? list.map((h) => `#${h.toLowerCase()}`) : [];
}

/** Do .env (tolerante: o que não vale é ignorado, como sempre foi). */
function fromEnv(id: StoreId): StoreConfig | null {
  const env = (k: string) => process.env[`STORE_${id.toUpperCase()}_${k}`]?.trim() ?? '';
  const name = env('NAME');
  const url = env('URL').replace(/\/+$/, '');
  const search = env('SEARCH');
  if (!name || !url || !search) return null;
  const categories = Object.fromEntries(Object.entries(categoryMap(env('CATEGORIES'))).map(([k, v]) => [k, v.toLowerCase()]));
  const sweep = Object.fromEntries(
    Object.entries(categoryMap(env('SWEEP')))
      .map(([k, v]) => [k, pathList(v).filter(isSitePath).join(' ')])
      .filter(([, v]) => v),
  );
  return { id, enabled: true, name, url, search, categories, colors: parseColors(env('COLOR')), sweep };
}

/**
 * Configuração vinda do admin: estrita (devolve o que está errado, em vez de ignorar).
 * Os valores vão para URLs que o servidor abre e para o estilo da página.
 */
export function validateStoreInput(id: StoreId, input: AdminStoreInput): { config: StoreConfig } | { errors: string[] } {
  const errors: string[] = [];
  const name = input.name.trim();
  if (!name || name.length > 60 || CONTROL.test(name)) errors.push('Nome: de 1 a 60 caracteres.');
  let url = '';
  try {
    const u = new URL(input.url.trim());
    if (u.protocol !== 'https:' || u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) throw new Error();
    url = u.origin;
  } catch {
    errors.push('Site: só a origem, com https (ex. https://www.loja.com.br).');
  }
  const search = input.search.trim();
  if (!isSitePath(search) || search.length > 200 || !MARKER.test(search) || CONTROL.test(search) || /\s/.test(search))
    errors.push('Busca: caminho começando com /, sem espaços, com {q}, {q+} ou {slug}.');
  const categories: StoreConfig['categories'] = {};
  for (const [k, v] of Object.entries(input.categories)) {
    const path = v.trim();
    if (!path) continue;
    if (!isCategory(k) || path.length > 200 || CONTROL.test(path)) errors.push(`Categoria na loja: valor inválido em "${k}".`);
    else categories[k] = path.toLowerCase();
  }
  const sweep: StoreConfig['sweep'] = {};
  for (const [k, v] of Object.entries(input.sweep)) {
    const paths = pathList(v);
    if (!paths.length) continue;
    if (!isCategory(k) || paths.length > 10 || paths.some((p) => !isSitePath(p) || p.length > 300 || CONTROL.test(p)))
      errors.push(`Página da categoria: "${k}" precisa de caminhos do site começando com /, separados por espaço (até 10).`);
    else sweep[k] = paths.join(' ');
  }
  const colors = parseColors(input.colors);
  if (input.colors.trim() && !colors.length) errors.push('Cor: 1 a 3 cores #rrggbb separadas por vírgula.');
  if (errors.length) return { errors };
  return { config: { id, enabled: input.enabled, name, url, search, categories, colors, sweep } };
}

const configs = new Map<StoreId, StoreConfig>();

/**
 * Lojas ligadas, na ordem de consulta. A lista é a mesma (o array é trocado no lugar): quem
 * guardou a referência vê as mudanças feitas no admin.
 */
export const ACTIVE_STORES: StoreId[] = [];

function apply(list: StoreConfig[]): void {
  configs.clear();
  for (const c of list) configs.set(c.id, c);
  ACTIVE_STORES.splice(0, ACTIVE_STORES.length, ...STORES.filter((id) => configs.get(id)?.enabled));
}

apply(STORES.map(fromEnv).filter((c): c is StoreConfig => !!c));

interface Row {
  id: string;
  enabled: number;
  name: string;
  url: string;
  search: string;
  categories: string;
  sweep: string;
  colors: string;
  updated_at: string;
}

const rowToConfig = (r: Row): StoreConfig => ({
  id: r.id as StoreId,
  enabled: !!r.enabled,
  name: r.name,
  url: r.url,
  search: r.search,
  categories: JSON.parse(r.categories),
  sweep: JSON.parse(r.sweep),
  colors: JSON.parse(r.colors),
});

function upsert(db: Db, c: StoreConfig, now: string): void {
  db.prepare(
    `INSERT INTO store_configs (id, enabled, name, url, search, categories, sweep, colors, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled, name = excluded.name, url = excluded.url, search = excluded.search,
       categories = excluded.categories, sweep = excluded.sweep, colors = excluded.colors, updated_at = excluded.updated_at`,
  ).run(c.id, c.enabled ? 1 : 0, c.name, c.url, c.search, JSON.stringify(c.categories), JSON.stringify(c.sweep), JSON.stringify(c.colors), now);
}

/**
 * Passa a usar o banco: na primeira vez (tabela vazia), copia para ele as lojas do .env; depois,
 * a configuração é a do banco. Devolve quantas lojas foram copiadas do .env agora.
 */
export function useStoreStorage(db: Db, now = new Date().toISOString()): number {
  const count = (db.prepare('SELECT count(*) AS n FROM store_configs').get() as { n: number }).n;
  let seeded = 0;
  if (count === 0) {
    for (const c of configs.values()) {
      upsert(db, c, now);
      seeded++;
    }
  }
  const rows = db.prepare('SELECT * FROM store_configs').all() as unknown as Row[];
  apply(rows.filter((r) => (STORES as readonly string[]).includes(r.id)).map(rowToConfig));
  if (!ACTIVE_STORES.length) console.warn('Nenhuma loja ligada: configure no admin (/admin) ou preencha STORE_S1_* … no .env antes da primeira vez.');
  return seeded;
}

/** Salva a configuração de uma loja (admin) e passa a valer na hora. */
export function saveStoreConfig(db: Db, id: StoreId, input: AdminStoreInput, now = new Date().toISOString()): { config: StoreConfig } | { errors: string[] } {
  const r = validateStoreInput(id, input);
  if ('errors' in r) return r;
  upsert(db, r.config, now);
  configs.set(id, r.config);
  apply([...configs.values()]);
  return r;
}

/** Todas as lojas que o código conhece, com a configuração de cada uma (ou null), para o admin. */
export function adminStores(db: Db): AdminStoreConfig[] {
  const at = new Map((db.prepare('SELECT id, updated_at FROM store_configs').all() as { id: string; updated_at: string }[]).map((r) => [r.id, r.updated_at]));
  return STORES.map((id) => {
    const c = configs.get(id);
    return c
      ? { id, configured: true, enabled: c.enabled, name: c.name, url: c.url, search: c.search, categories: c.categories, sweep: c.sweep, colors: c.colors, updatedAt: at.get(id) ?? null }
      : { id, configured: false, enabled: false, name: '', url: '', search: '', categories: {}, sweep: {}, colors: [], updatedAt: null };
  });
}

/** Loja ligada. */
export function storeConfig(id: StoreId): StoreConfig {
  const c = configs.get(id);
  if (!c?.enabled) throw new Error(`Loja ${id} não configurada`);
  return c;
}

/** Caminhos da página de uma categoria na loja (lidos pela rotina de preços, um depois do outro); vazio: a loja não tem. */
export function sweepPaths(id: StoreId, category: CategoryId): string[] {
  return pathList(storeConfig(id).sweep[category] ?? '');
}

/** URL completa da busca na loja para um termo. */
export function searchUrl(id: StoreId, category: CategoryId, term: string): string {
  const c = storeConfig(id);
  return storeSearchUrl(c.url + c.search, category, term);
}

/** O que a interface recebe (GET /api/stores). */
export function publicStores(): StoreInfo[] {
  return ACTIVE_STORES.map((id) => {
    const c = storeConfig(id);
    return { id, name: c.name, search: c.url + c.search, ...(c.colors[0] ? { color: c.colors[0] } : {}), ...(c.colors.length > 1 ? { colors: c.colors } : {}) };
  });
}
