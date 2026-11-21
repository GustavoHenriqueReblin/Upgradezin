import type { StoreId } from '@upgradezin/shared';
import { storeDotBackground } from '../stores.ts';

/** Bolinha que identifica a loja (cor lisa ou degradê, do .env). */
export function StoreDot({ store }: { store: StoreId }) {
  return <span className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/15 dark:ring-white/15" style={{ background: storeDotBackground(store) }} />;
}
