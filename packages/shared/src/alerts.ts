import { effectiveCash, isOwnRetailOffer, type CategoryId, type Offer } from './types.ts';

/**
 * Alertas de preço. O servidor guarda os alertas da conta, confere o preço depois das coletas e grava uma notificação
 * quando a condição vale; o site só lê as notificações. Regras e textos ficam aqui para os dois lados usarem os mesmos.
 */

export type AlertKind = 'target' | 'drop' | 'stock';
export const ALERT_KINDS: readonly AlertKind[] = ['target', 'drop', 'stock'];
export const ALERT_LIMIT = 30;

export interface PriceAlert {
  key: string;
  category: CategoryId;
  title: string;
  kind: AlertKind;
  /** Preço-alvo: avisa quando o preço à vista chegar nele ou abaixo. */
  target?: number;
  /** Qualquer queda: o preço de referência (o de quando começou a acompanhar ou o da última queda avisada). */
  base?: number;
  /** Último preço conferido (sem valor = sem estoque). */
  price?: number;
  checkedAt?: number;
  /** Pronto para avisar. Preço-alvo e estoque desarmam ao avisar e rearmam quando a condição deixa de valer. */
  armed: boolean;
  createdAt: number;
}

export interface AlertNotification {
  id: number;
  key: string;
  category: CategoryId;
  title: string;
  kind: AlertKind;
  /** O preço que disparou (sem valor = voltou ao estoque sem preço conhecido). */
  price?: number;
  /** O alvo (preço-alvo) ou o preço anterior (queda). */
  reference?: number;
  at: number;
  read: boolean;
}

/** Preço à vista de agora, com cupom, da oferta mais barata em estoque das próprias lojas (sem valor = sem estoque). */
export function alertPrice(offers: readonly Offer[]): number | undefined {
  const prices = offers.filter((o) => o.inStock && isOwnRetailOffer(o)).map(effectiveCash);
  return prices.length ? Math.min(...prices) : undefined;
}

type Rule = Pick<PriceAlert, 'kind' | 'target' | 'base'>;
export const alertMet = (alert: Rule, price: number | undefined): boolean =>
  price !== undefined && (alert.kind === 'target' ? price <= alert.target! : alert.kind === 'drop' ? price < alert.base! : true);

/**
 * Confere um alerta com o preço de agora. `fired`: vale uma notificação (preço e referência).
 * Queda: o preço avisado vira a nova referência (avisa de novo só se cair mais). Preço-alvo e estoque avisam uma vez
 * e só rearmam quando a condição deixa de valer.
 */
export function evaluateAlert<A extends PriceAlert>(alert: A, price: number | undefined, now: number): { alert: A; fired?: { price?: number; reference?: number } } {
  const { price: _, ...rest } = alert;
  const next = { ...rest, ...(price !== undefined && { price }), checkedAt: now } as A;
  const met = alertMet(alert, price);
  if (alert.kind === 'drop') return met ? { alert: { ...next, base: price }, fired: { price, reference: alert.base } } : { alert: next };
  if (met && alert.armed) return { alert: { ...next, armed: false }, fired: { ...(price !== undefined && { price }), ...(alert.kind === 'target' && { reference: alert.target }) } };
  return { alert: { ...next, armed: !met } };
}

const brl = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** O que o alerta espera. */
export function alertText(alert: Rule): string {
  if (alert.kind === 'target') return `Avisa quando chegar a ${brl(alert.target!)}.`;
  if (alert.kind === 'drop') return `Avisa quando baixar de ${brl(alert.base!)}.`;
  return 'Avisa quando voltar ao estoque.';
}

/** O que aconteceu (texto da notificação). */
export function notificationText(n: Pick<AlertNotification, 'kind' | 'price' | 'reference'>): string {
  if (n.kind === 'target') return `Chegou a ${brl(n.price!)} (seu alvo: ${brl(n.reference!)}).`;
  if (n.kind === 'drop') return `Baixou para ${brl(n.price!)} (era ${brl(n.reference!)}).`;
  return n.price !== undefined ? `Voltou ao estoque por ${brl(n.price)}.` : 'Voltou ao estoque.';
}
