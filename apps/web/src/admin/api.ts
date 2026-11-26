/** Chamadas ao /api/admin: mesma origem, cookie da sessão, e X-Admin: 1 em toda chamada que muda algo. */

export class AdminError extends Error {
  constructor(
    public status: number,
    public code: string,
    public data: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export async function adminApi<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const res = await fetch(`/api/admin${path}`, {
    method,
    credentials: 'same-origin',
    signal: init.signal,
    headers: {
      ...(method !== 'GET' ? { 'X-Admin': '1' } : {}),
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new AdminError(res.status, String(data.error ?? res.status), data);
  return data as T;
}

/** Envia um arquivo (corpo binário) a uma rota do admin. */
export async function adminUpload<T>(path: string, file: Blob): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Admin': '1', 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new AdminError(res.status, String(data.error ?? res.status), data);
  return data as T;
}
