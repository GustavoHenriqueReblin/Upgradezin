import { CATEGORIES, type CategoryId } from '@upgradezin/shared';
import { accountStorage } from './account.ts';
import { compareKeys } from './compare.ts';

/**
 * Peças escolhidas para comparar: uma lista só (na conta, quando logado), lida pelo botão Comparar, pelo atalho
 * do cabeçalho e pela página de comparação. Outras abas avisam pelo evento `storage` (ou pelo canal da conta).
 */

export interface CompareEntry { key: string; category: CategoryId }

const KEY = 'upgradezin.compare.v1';
/** Mais que isso por categoria vira uma tabela que não dá para ler. */
export const COMPARE_LIMIT = 5;
const legacyKey = (category: CategoryId) => `upgradezin.compare.${category}`;

const listeners = new Set<() => void>();
let memory: CompareEntry[] = [];
let cache: { raw: string | null; entries: CompareEntry[] } | undefined;

function parse(raw: string | null): CompareEntry[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    return list.filter((entry): entry is CompareEntry => {
      const ok = !!entry && typeof entry.key === 'string' && entry.key.trim() !== '' && entry.key.length <= 400 &&
        CATEGORIES.includes(entry.category) && !seen.has(entry.key);
      if (ok) seen.add(entry.key);
      return ok;
    });
  } catch {
    return [];
  }
}

/** Seleção antiga: uma chave por categoria com o texto da URL dentro ("peca=a&peca=b"). Vira a lista nova uma vez. */
function migrate(): CompareEntry[] | undefined {
  const entries = CATEGORIES.flatMap((category) => compareKeys(new URLSearchParams(accountStorage.getItem(legacyKey(category)) ?? ''))
    .slice(0, COMPARE_LIMIT).map((key) => ({ key, category })));
  if (!entries.length) return;
  accountStorage.setItem(KEY, JSON.stringify(entries));
  for (const category of CATEGORIES) if (accountStorage.getItem(legacyKey(category)) !== null) accountStorage.removeItem(legacyKey(category));
  return entries;
}

export function compareSelection(): CompareEntry[] {
  try {
    const raw = accountStorage.getItem(KEY);
    if (cache && cache.raw === raw) return cache.entries;
    const entries = raw === null ? migrate() ?? [] : parse(raw);
    cache = { raw: accountStorage.getItem(KEY), entries };
    return entries;
  } catch {
    return memory;
  }
}

const EMPTY: CompareEntry[] = [];
export const emptySelection = () => EMPTY;

function store(entries: CompareEntry[]) {
  memory = entries;
  try {
    if (entries.length) accountStorage.setItem(KEY, JSON.stringify(entries));
    else accountStorage.removeItem(KEY);
  } catch { /* A seleção vale enquanto a aba estiver aberta. */ }
  cache = undefined;
  for (const listener of listeners) listener();
}

export function subscribeCompare(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === KEY) {
      cache = undefined;
      listener();
    }
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export const countIn = (entries: CompareEntry[], category: CategoryId) => entries.filter((entry) => entry.category === category).length;

/** Marca ou desmarca. Devolve false quando a categoria já está no limite e nada mudou. */
export function toggleCompare(category: CategoryId, key: string): boolean {
  const entries = compareSelection();
  if (entries.some((entry) => entry.key === key)) {
    store(entries.filter((entry) => entry.key !== key));
    return true;
  }
  if (countIn(entries, category) >= COMPARE_LIMIT) return false;
  store([...entries, { key, category }]);
  return true;
}

export function removeCompare(key: string): void {
  store(compareSelection().filter((entry) => entry.key !== key));
}

/** Tira as peças de uma categoria (a aba aberta) ou, sem categoria, todas. */
export function clearCompare(category?: CategoryId): void {
  store(category ? compareSelection().filter((entry) => entry.category !== category) : []);
}

/** Junta peças (ex. de um link compartilhado) respeitando o limite; devolve quantas ficaram de fora. */
export function addToCompare(items: CompareEntry[]): number {
  const entries = [...compareSelection()];
  let skipped = 0;
  for (const item of items) {
    if (entries.some((entry) => entry.key === item.key)) continue;
    if (countIn(entries, item.category) >= COMPARE_LIMIT) skipped++;
    else entries.push(item);
  }
  store(entries);
  return skipped;
}
