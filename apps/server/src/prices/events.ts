import { EventEmitter } from 'node:events';
import type { CategoryId, StoreId } from '@upgradezin/shared';

/**
 * Aviso interno de coleta gravada no banco (rotina, varredura, busca de qualquer pessoa). As telas
 * de resultado abertas escutam (GET /api/watch) e recebem a lista nova da loja sem buscar de novo.
 */
export interface Collected {
  store: StoreId;
  category: CategoryId;
  at: string;
}

const bus = new EventEmitter();
// Uma escuta por tela aberta: o padrão do Node (10) avisaria à toa.
bus.setMaxListeners(0);

export const emitCollected = (e: Collected) => bus.emit('collected', e);

export function onCollected(fn: (e: Collected) => void): () => void {
  bus.on('collected', fn);
  return () => bus.off('collected', fn);
}
