import { accountStorage } from './account.ts';
import { BUILD_SLOTS, CATEGORY_DEFS, groupOffers, type BudgetMode as PriceMode, type BudgetNote, type BudgetOption, type BudgetPlan, type BudgetProfile, type BudgetRequest, type PcProfile, type Resolution } from '@upgradezin/shared';
import { itemFromGroup, toBuild, type BuildItem, type SavedBuild } from './build.ts';
import { applyPc } from './pc.ts';

/**
 * Montar pelo orçamento (docs/ARCHITECTURE.md §17.4): o pedido ao servidor e o plano virando montagem.
 * O motor fica em packages/shared/src/budget.ts; aqui só o que é da tela.
 */

export type BudgetMode = 'full' | 'upgrade';
/** Tipo de trabalho: os do motor ou "both" (uso geral / não sei: vai sem tipo, e o motor não assume uma carga). */
export type BudgetWorkload = NonNullable<BudgetRequest['workload']> | 'both';
const WORKLOADS = ['both', 'cpu', 'gpu', 'dev', 'video', 'ai'] as const satisfies readonly BudgetWorkload[];

/** Exibe os atalhos na tela inicial e no Identificar gargalo. */
export const BUDGET_VISIBLE = true;

/** Valor que a tela sugere ao abrir (a pessoa digita o dela). */
export const BUDGET_DEFAULT: Record<BudgetMode, number> = { full: 8000, upgrade: 2500 };

/**
 * O que a tela do orçamento lembra entre uma visita e outra (só no navegador, por enquanto; com o login,
 * vai para a conta): a aba, o valor de cada aba, a tela do PC completo e o tipo de recomendação.
 */
export interface SavedBudget {
  mode?: BudgetMode;
  priceMode?: PriceMode;
  profile?: BudgetProfile;
  /** Fora de Jogos: se o trabalho pesa mais no processador ou usa aceleração pela placa de vídeo. */
  workload?: BudgetWorkload;
  text: Record<BudgetMode, string>;
  res: Resolution;
  fast: boolean;
}

const BUDGET_KEY = 'upgradezin.budget.v1';
const MODES: BudgetMode[] = ['full', 'upgrade'];
const RESOLUTIONS: Resolution[] = ['1080p', '1440p', '4k'];

const budgetNumber = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatBudget(value: number): string {
  return budgetNumber.format(value);
}

export const defaultBudgetUi = (): SavedBudget => ({
  text: { full: formatBudget(BUDGET_DEFAULT.full), upgrade: formatBudget(BUDGET_DEFAULT.upgrade) },
  res: '1080p',
  fast: false,
});

/** Só o formato esperado volta (versão antiga, dado corrompido ou editado à mão fica com o padrão). */
export function sanitizeBudgetUi(raw: unknown): SavedBudget {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = defaultBudgetUi();
  if (MODES.includes(src.mode as BudgetMode)) out.mode = src.mode as BudgetMode;
  if (src.priceMode === 'buyable' || src.priceMode === 'ideal') out.priceMode = src.priceMode;
  if (src.profile === 'games' || src.profile === 'mixed' || src.profile === 'productivity') out.profile = src.profile;
  if (typeof src.workload === 'string' && (WORKLOADS as readonly string[]).includes(src.workload)) out.workload = src.workload as BudgetWorkload;
  const text = (src.text && typeof src.text === 'object' ? src.text : {}) as Record<string, unknown>;
  for (const m of MODES) {
    const saved = text[m];
    if (typeof saved !== 'string' || saved.length > 20) continue;
    const amount = parseBudget(saved);
    out.text[m] = amount === undefined ? saved : formatBudget(amount);
  }
  if (RESOLUTIONS.includes(src.res as Resolution)) out.res = src.res as Resolution;
  if (typeof src.fast === 'boolean') out.fast = src.fast;
  return out;
}

/** Aba ao abrir pela tela inicial: a última usada; o upgrade precisa de CPU ou GPU atual. */
export function lastBudgetMode(pc: PcProfile | null, saved: SavedBudget = loadBudgetUi()): BudgetMode {
  const canUpgrade = !!(pc?.cpu || pc?.gpu);
  if (saved.mode === 'upgrade' && !canUpgrade) return 'full';
  return saved.mode ?? (canUpgrade ? 'upgrade' : 'full');
}

export function loadBudgetUi(): SavedBudget {
  try {
    const raw = accountStorage.getItem(BUDGET_KEY);
    return sanitizeBudgetUi(raw ? JSON.parse(raw) : {});
  } catch {
    return defaultBudgetUi();
  }
}

export function saveBudgetUi(s: SavedBudget): void {
  try {
    accountStorage.setItem(BUDGET_KEY, JSON.stringify(s));
  } catch {
    // sem armazenamento: vale só enquanto a página estiver aberta
  }
}

/** "R$ 8.000,00", "8000", "8.000" → 8000. Uma vírgula separa os centavos. */
export function parseBudget(text: string): number | undefined {
  const value = text.trim().replace(/^R\$\s*/i, '');
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{0,2})?$/.test(value)) return undefined;
  const n = Number(value.replaceAll('.', '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Peças atuais do perfil e peças marcadas na montagem, com as quantidades escolhidas. */
export function ownedBuild(pc: PcProfile, build: SavedBuild): SavedBuild {
  const owned = applyPc({}, pc);
  for (const slot of BUILD_SLOTS) {
    const item = build[slot];
    if (slot !== 'ssd' && item?.current) owned[slot] = item;
  }
  return owned;
}

/** Pedido ao servidor. No upgrade, as peças atuais vão como specs (nunca o relatório). */
export function budgetRequest(budget: number, screen: Pick<BudgetRequest, 'res' | 'hz' | 'mode' | 'profile'> & { workload?: BudgetWorkload }, owned?: SavedBuild, current?: BudgetRequest['current']): BudgetRequest {
  // O tipo de trabalho só vale fora de Jogos; "os dois" vai sem tipo (o motor mistura as duas cargas).
  const workload = screen.profile && screen.profile !== 'games' && screen.workload !== 'both' ? screen.workload : undefined;
  return { budget, res: screen.res, ...(screen.hz && { hz: screen.hz }), ...(screen.mode && { mode: screen.mode }), ...(screen.profile && { profile: screen.profile }),
    ...(workload && { workload }),
    ...(owned && { owned: toBuild(owned) }), ...(current && { current }) };
}

/**
 * Rótulo de cada opção, sem chamar de "a melhor" o que só rende mais: a 1ª é a de mais desempenho no
 * valor; a de mais desempenho por real entre as que fecham no valor é a de melhor custo-benefício (pode
 * ser a 1ª); a que passa do valor diz isso.
 */
export function optionLabels(options: BudgetOption[]): string[] {
  const inBudget = options.map((o, i) => ({ o, i })).filter(({ o }) => !o.stretch && o.total > 0);
  const perReal = (o: BudgetOption) => (o.gain ?? o.objective ?? o.fps) / o.total;
  const value = inBudget.length > 1 ? inBudget.reduce((a, b) => (perReal(b.o) > perReal(a.o) ? b : a)).i : -1;
  const highest = inBudget.reduce((top, next) => (next.o.objective ?? next.o.fps) > (top.o.objective ?? top.o.fps) ? next : top, inBudget[0]!);
  return options.map((o, i) => {
    const tags = [i === 0 ? 'Recomendada no valor' : undefined, highest?.i === i && i !== 0 ? 'Maior desempenho no valor' : undefined, i === value ? 'Melhor custo-benefício' : undefined, o.stretch ? 'Acima do valor' : undefined].filter(Boolean);
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
  for (const [slot, part] of Object.entries(plan.parts) as [keyof BudgetOption['parts'], BudgetOption['parts'][keyof BudgetOption['parts']]][]) {
    const group = part && groupOffers(part.offers)[0];
    if (group) next[slot] = { ...(itemFromGroup(group) as BuildItem), ...(part.qty && part.qty > 1 && { qty: part.qty }) };
  }
  if (plan.notes.includes('igpu') && next.gpu?.current) delete next.gpu;
  if (plan.notes.includes('box-cooler')) delete next.cooler;
  return next;
}

/** Ganho comparável somente quando há uma estimativa positiva de referência. */
export function stretchGain(option: BudgetOption, first: BudgetOption): number | undefined {
  const baseline = first.objective ?? first.fps;
  const score = option.objective ?? option.fps;
  if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(score) || score <= baseline) return undefined;
  return Math.round((score / baseline - 1) * 100);
}

export const NOTE_TEXT: Record<BudgetNote, string> = {
  igpu: 'Esta opção usa o vídeo integrado do processador. O desempenho varia conforme o jogo e a memória instalada.',
  'ram-16': 'Esta opção inclui 16 GB de memória. Jogos pesados e uso de vários programas ao mesmo tempo podem se beneficiar de 32 GB.',
  'ssd-500': 'Esta opção inclui um SSD de 500 GB. Confira quanto espaço os seus jogos ocupam.',
  'psu-unknown': 'Você não informou a sua fonte: informe-a em Identificar gargalo para o Upgradezin conferir se ela aguenta, ou inclua uma fonte nova.',
  'keeps-ram': 'A sua memória serve na placa-mãe nova e fica.',
  'ram-pair': 'Esta opção usa dois pentes avulsos iguais. Confira a frequência que a placa-mãe aceita com os dois instalados.',
  bios: 'A sua placa-mãe aceita o processador novo depois de atualizar a BIOS: atualize com o processador atual ainda instalado, antes da troca.',
  'box-cooler': 'Esta opção usa o cooler que acompanha o processador, conforme o anúncio.',
  'vrm-unverified': 'Confira se a placa-mãe sustenta a potência do processador escolhido em cargas longas.',
  'psu-connector': 'A placa de vídeo pede um conector de 16 pinos. Confira se a fonte traz o cabo adequado.',
  'capacity-value': 'Esta opção tem mais memória ou espaço para jogos. Compare o preço com as outras opções.',
  'case-clearance': 'Confira a folga no gabinete. Um radiador frontal com ventoinhas pode reduzir o espaço para a placa de vídeo.',
  'cooling-estimate': 'O cooler foi dimensionado pela potência estimada do processador. A temperatura depende da ventilação e da carga.',
  'more-ram': 'Mais memória na placa-mãe atual: a que você tem fica abaixo do que o processador e o seu tipo de uso pedem.',
  'ram-added': 'A memória nova se soma à que você já tem, nos slots livres. Pentes de kits diferentes podem rodar na frequência do mais lento; se possível, use o mesmo modelo.',
  'keeps-ssd': 'O SSD atual continua no PC como disco extra, somando espaço ao novo.',
};

/** Erro do pedido: 'invalid' quando o servidor recusou os dados (tentar de novo não adianta), 'failed' no resto. */
export class BudgetError extends Error {
  constructor(readonly kind: 'invalid' | 'failed') {
    super(`budget ${kind}`);
  }
}

export async function fetchPlan(req: BudgetRequest, signal?: AbortSignal): Promise<BudgetPlan> {
  const r = await fetch('/api/budget/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal });
  if (!r.ok) throw new BudgetError(r.status === 400 ? 'invalid' : 'failed');
  return (await r.json()) as BudgetPlan;
}

/** Nome curto do que a opção compra de principal: placa de vídeo e processador; sem eles, as peças compradas. */
export function optionHeadline(opt: BudgetOption): string {
  const video = opt.parts.gpu?.offer.specs;
  const gpu = video?.gpuModel ? [video.gpuModel, video.vram && `${video.vram} GB`].filter(Boolean).join(' ') : opt.notes.includes('igpu') ? 'Vídeo integrado' : undefined;
  const c = opt.parts.cpu?.offer.specs;
  const cpu = c ? [c.cpuLine, c.cpuModel].filter(Boolean).join(' ') : undefined;
  if (gpu || cpu) return [gpu, cpu].filter(Boolean).join(' + ');
  const others = BUILD_SLOTS.filter((slot) => slot !== 'gpu' && slot !== 'cpu' && opt.parts[slot]).map((slot) => CATEGORY_DEFS[slot].name);
  return others.join(' + ') || 'Sem peças novas';
}

const RESULT_KEY = 'upgradezin.budget.result.v1';

/** Último resultado de cada aba, com a data: reabrir a tela (ou voltar de uma peça) mostra o que foi calculado. */
export interface SavedBudgetResult {
  at: number;
  plan: BudgetPlan;
  owned?: SavedBuild;
}

export function loadBudgetResult(mode: BudgetMode): SavedBudgetResult | undefined {
  try {
    const raw = accountStorage.getItem(RESULT_KEY);
    const saved = (raw ? JSON.parse(raw) : {}) as Partial<Record<BudgetMode, SavedBudgetResult>>;
    const entry = saved[mode];
    return entry && typeof entry.at === 'number' && entry.plan && typeof entry.plan.status === 'string' && typeof entry.plan.budget === 'number' ? entry : undefined;
  } catch {
    return undefined;
  }
}

/** Limite do servidor por chave é 512 KB; acima disso o resultado fica só na tela (cada peça já traz só as ofertas do mesmo produto). */
const RESULT_MAX = 400_000;

/** Grava (ou apaga, com undefined) o resultado de uma aba sem mexer no da outra. */
export function saveBudgetResult(mode: BudgetMode, result: SavedBudgetResult | undefined): void {
  try {
    const raw = accountStorage.getItem(RESULT_KEY);
    const saved = (raw ? JSON.parse(raw) : {}) as Partial<Record<BudgetMode, SavedBudgetResult>>;
    if (result) saved[mode] = result;
    else delete saved[mode];
    const text = JSON.stringify(saved);
    if (text.length > RESULT_MAX) return;
    if (Object.keys(saved).length) accountStorage.setItem(RESULT_KEY, text);
    else accountStorage.removeItem(RESULT_KEY);
  } catch {
    // sem armazenamento: o resultado vale só enquanto a tela estiver aberta
  }
}
