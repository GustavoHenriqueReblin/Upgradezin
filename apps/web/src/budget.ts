import { groupOffers, type BudgetNote, type BudgetOption, type BudgetPlan, type BudgetRequest, type PcProfile, type Resolution } from '@upgradezin/shared';
import { itemFromGroup, toBuild, type BuildItem, type SavedBuild } from './build.ts';
import { applyPc } from './pc.ts';

/**
 * Montar pelo orçamento (docs/ARCHITECTURE.md §17.4): o pedido ao servidor e o plano virando montagem.
 * O motor fica em packages/shared/src/budget.ts; aqui só o que é da tela.
 */

export type BudgetMode = 'full' | 'upgrade';

/**
 * Montar pelo Orçamento escondido do site por enquanto (precisa de mais refino): sem o card da tela
 * inicial nem o "Tem um Valor em Mente?" do Identificar Gargalo. A rota e a tela continuam; para voltar, true.
 */
export const BUDGET_VISIBLE = false;

/** Valor que a tela sugere ao abrir (a pessoa digita o dela). */
export const BUDGET_DEFAULT: Record<BudgetMode, number> = { full: 8000, upgrade: 2500 };

/**
 * O que a tela do orçamento lembra entre uma visita e outra (só no navegador, por enquanto; com o login,
 * vai para a conta): a aba, o valor de cada aba, a tela do PC completo e em que abas a pessoa já montou.
 * O resultado não é guardado (os preços mudam): ao voltar, a última busca é refeita, com os preços de agora.
 */
export interface SavedBudget {
  mode?: BudgetMode;
  text: Record<BudgetMode, string>;
  res: Resolution;
  fast: boolean;
  /** Abas em que a pessoa montou: ao voltar, a busca é refeita sozinha. */
  ran: Partial<Record<BudgetMode, true>>;
}

const BUDGET_KEY = 'upgradezin.budget.v1';
const MODES: BudgetMode[] = ['full', 'upgrade'];
const RESOLUTIONS: Resolution[] = ['1080p', '1440p', '4k'];

export const defaultBudgetUi = (): SavedBudget => ({
  text: { full: BUDGET_DEFAULT.full.toLocaleString('pt-BR'), upgrade: BUDGET_DEFAULT.upgrade.toLocaleString('pt-BR') },
  res: '1080p',
  fast: false,
  ran: {},
});

/** Só o formato esperado volta (versão antiga, dado corrompido ou editado à mão fica com o padrão). */
export function sanitizeBudgetUi(raw: unknown): SavedBudget {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = defaultBudgetUi();
  if (MODES.includes(src.mode as BudgetMode)) out.mode = src.mode as BudgetMode;
  const text = (src.text && typeof src.text === 'object' ? src.text : {}) as Record<string, unknown>;
  for (const m of MODES) if (typeof text[m] === 'string' && (text[m] as string).length <= 20) out.text[m] = text[m] as string;
  if (RESOLUTIONS.includes(src.res as Resolution)) out.res = src.res as Resolution;
  if (typeof src.fast === 'boolean') out.fast = src.fast;
  const ran = (src.ran && typeof src.ran === 'object' ? src.ran : {}) as Record<string, unknown>;
  for (const m of MODES) if (ran[m] === true) out.ran[m] = true;
  return out;
}

/** Aba ao abrir pela tela inicial: a última usada (upgrade só com PC importado); sem histórico, upgrade se há PC. */
export function lastBudgetMode(pc: PcProfile | null, saved: SavedBudget = loadBudgetUi()): BudgetMode {
  if (saved.mode === 'upgrade' && !pc) return 'full';
  return saved.mode ?? (pc ? 'upgrade' : 'full');
}

export function loadBudgetUi(): SavedBudget {
  try {
    const raw = localStorage.getItem(BUDGET_KEY);
    return sanitizeBudgetUi(raw ? JSON.parse(raw) : {});
  } catch {
    return defaultBudgetUi();
  }
}

export function saveBudgetUi(s: SavedBudget): void {
  try {
    localStorage.setItem(BUDGET_KEY, JSON.stringify(s));
  } catch {
    // sem armazenamento: vale só enquanto a página estiver aberta
  }
}

/** "R$ 8.000,00", "8000", "8.000" → 8000. Centavos são ignorados. */
export function parseBudget(text: string): number | undefined {
  const n = Number(text.replace(/,\d{0,2}$/, '').replace(/\D/g, ''));
  return n > 0 ? n : undefined;
}

/** As peças que a pessoa já tem: as do relatório do CPU-Z, mais a fonte marcada como "Já Tenho" na montagem. */
export function ownedBuild(pc: PcProfile, build: SavedBuild): SavedBuild {
  const owned = applyPc({}, pc);
  if (!owned.psu && build.psu?.current) owned.psu = build.psu;
  return owned;
}

/** Pedido ao servidor. No upgrade, as peças atuais vão como specs (nunca o relatório). */
export function budgetRequest(budget: number, screen: Pick<BudgetRequest, 'res' | 'hz'>, owned?: SavedBuild, current?: BudgetRequest['current']): BudgetRequest {
  return { budget, res: screen.res, ...(screen.hz && { hz: screen.hz }), ...(owned && { owned: toBuild(owned) }), ...(current && { current }) };
}

/**
 * Rótulo de cada opção, sem chamar de "a melhor" o que só rende mais: a 1ª é a de mais desempenho no
 * valor; a de mais desempenho por real entre as que fecham no valor é a de melhor custo-benefício (pode
 * ser a 1ª); a que passa do valor diz isso.
 */
export function optionLabels(options: BudgetOption[]): string[] {
  const inBudget = options.map((o, i) => ({ o, i })).filter(({ o }) => !o.stretch && o.total > 0);
  const value = inBudget.length > 1 ? inBudget.reduce((a, b) => (b.o.fps / b.o.total > a.o.fps / a.o.total ? b : a)).i : -1;
  return options.map((o, i) => {
    const tags = [i === 0 ? 'Mais desempenho no valor' : undefined, i === value ? 'Melhor custo-benefício' : undefined, o.stretch ? 'Acima do valor' : undefined].filter(Boolean);
    return tags.join(' · ');
  });
}

/** As opções do plano, da melhor (1ª) para a pior. */
export const optionsOf = (plan: BudgetPlan): BudgetOption[] => (plan.status === 'ok' ? [plan, ...plan.alternatives] : []);

/**
 * Uma opção do plano na montagem: as peças compradas entram com as ofertas de todas as lojas (dá para
 * comparar e trocar); no upgrade, as peças atuais que ficam continuam como "Atual".
 */
export function planToBuild(plan: BudgetOption, base: SavedBuild = {}): SavedBuild {
  const next: SavedBuild = { ...base };
  for (const [slot, part] of Object.entries(plan.parts) as [keyof SavedBuild, BudgetOption['parts'][keyof SavedBuild]][]) {
    const group = part && groupOffers(part.offers)[0];
    if (group) next[slot] = { ...(itemFromGroup(group) as BuildItem), ...(part.qty && part.qty > 1 && { qty: part.qty }) };
  }
  if (plan.notes.includes('igpu') && next.gpu?.current) delete next.gpu;
  return next;
}

export const NOTE_TEXT: Record<BudgetNote, string> = {
  igpu: 'Sem placa de vídeo: o valor não fecha com uma. O vídeo integrado do processador roda o dia a dia e jogos leves; a placa entra no próximo upgrade.',
  'ram-16': '16 GB de memória para caber no valor. O recomendado é 32 GB: quando der, troque por um kit de 32 GB (2x 16 GB).',
  'ssd-500': 'SSD de 500 GB para caber no valor. Jogos atuais ocupam de 50 a 150 GB cada.',
  'psu-unknown': 'Você não informou a sua fonte: informe-a em Identificar Gargalo para o Upgradezin conferir se ela aguenta, ou inclua uma fonte nova.',
  'keeps-ram': 'A sua memória serve na placa-mãe nova e fica.',
  'ram-32': 'Sobrou para subir a memória para 32 GB, o recomendado para jogos atuais.',
  'ram-pair': 'Memória em 2 pentes avulsos iguais: sai mais barata que o kit com os mesmos 32 GB. Costumam funcionar juntos; só o kit garante a frequência anunciada com os dois.',
  bios: 'A sua placa-mãe aceita o processador novo depois de atualizar a BIOS: atualize com o processador atual ainda instalado, antes da troca.',
};

export async function fetchPlan(req: BudgetRequest, signal?: AbortSignal): Promise<BudgetPlan> {
  const r = await fetch('/api/budget/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal });
  if (!r.ok) throw new Error(`budget ${r.status}`);
  return (await r.json()) as BudgetPlan;
}
