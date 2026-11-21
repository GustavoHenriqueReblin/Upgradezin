import { EventEmitter } from 'node:events';
import type { AdminChange } from '@upgradezin/shared';

/**
 * Avisos de mudança para as telas do admin (canal ao vivo, /api/admin/live, evento `change`):
 * - `store`: uma loja começou ou terminou de ler uma página, entrou ou saiu de pausa;
 * - `admin`: alguém mudou algo pelo admin (rotinas, lojas, termos, backups, coletar agora, ler ficha);
 * - `activity`: uma busca no site.
 * Cada consulta que termina já vai no canal como `attempt` (prices/attempts.ts).
 * As telas recarregam o que mostram ao receber (com uma folga para juntar avisos seguidos).
 */
const bus = new EventEmitter();
bus.setMaxListeners(0);

export const emitChange = (kind: AdminChange) => bus.emit('change', kind);

export function onChange(fn: (kind: AdminChange) => void): () => void {
  bus.on('change', fn);
  return () => bus.off('change', fn);
}
