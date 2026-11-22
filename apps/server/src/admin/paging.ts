import { ADMIN_PAGE_SIZE, ADMIN_PAGE_SIZE_MAX } from '@upgradezin/shared';

/** Página pedida (1 em diante) e tamanho (padrão ADMIN_PAGE_SIZE, até ADMIN_PAGE_SIZE_MAX), com o OFFSET do SQL. */
export function pageOf(f: { page?: number; pageSize?: number }): { page: number; pageSize: number; offset: number } {
  const pageSize = Math.min(Math.max(1, f.pageSize ?? ADMIN_PAGE_SIZE), ADMIN_PAGE_SIZE_MAX);
  const page = Math.max(1, f.page ?? 1);
  return { page, pageSize, offset: (page - 1) * pageSize };
}
