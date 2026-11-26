import { createHash, randomBytes } from 'node:crypto';
import type { SearchActivity } from '@upgradezin/shared';

/** Muda a cada subida do servidor: o apelido não liga a mesma pessoa entre reinícios nem volta ao IP. */
const SALT = randomBytes(16);

/** Apelido curto de quem fez a busca, a partir do IP (o IP não é guardado). */
export const personOf = (ip: string): string => createHash('sha256').update(SALT).update(ip).digest('base64url').slice(0, 8);

/** Últimas buscas do site, em memória (reiniciar zera). */
export class ActivityLog {
  private items: SearchActivity[] = [];
  constructor(private max = 500) {}

  record(e: Omit<SearchActivity, 'person'> & { ip: string }, email?: string): void {
    const { ip, ...rest } = e;
    this.items.push({ ...rest, person: email ?? personOf(ip) });
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }

  /** Mais recentes primeiro. */
  recent(limit = 100): SearchActivity[] {
    return this.items.slice(-limit).reverse();
  }

  people(): number {
    return new Set(this.items.map((i) => i.person)).size;
  }
}
