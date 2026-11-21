import type { SavedBuild } from './build.ts';

/** Montagem compartilhada por link (/m/<id>), gravada no servidor. */

const LINK = /^\/m\/([A-Za-z0-9]{6,16})\/?$/;

/** Código da montagem na URL atual, se a página foi aberta por um link de montagem. */
export const sharedIdFromUrl = (path = location.pathname): string | null => path.match(LINK)?.[1] ?? null;

export const shareUrl = (id: string) => `${location.origin}/m/${id}`;

export async function shareBuild(build: SavedBuild): Promise<string> {
  const res = await fetch('/api/builds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ build }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

export interface SharedBuild {
  build: SavedBuild;
  createdAt: string;
}

/** null = o link não existe (código errado ou apagado). */
export async function loadSharedBuild(id: string): Promise<SharedBuild | null> {
  const res = await fetch(`/api/builds/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as SharedBuild;
}
