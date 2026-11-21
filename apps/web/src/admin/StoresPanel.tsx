import { useEffect, useState, type ReactNode } from 'react';
import { CATEGORIES, CATEGORY_DEFS, type AdminStoreConfig, type AdminStoreInput } from '@upgradezin/shared';
import { Check, Save } from 'lucide-react';
import { AdminError, adminApi } from './api.ts';
import { formatWhen, previewBackground } from './format.ts';
import { Switch } from './Switch.tsx';

/** Lojas: o que antes ficava em STORE_* no .env. Salvar vale na hora, sem reiniciar. */
export function StoresPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [stores, setStores] = useState<AdminStoreConfig[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    adminApi<AdminStoreConfig[]>('/stores')
      .then(setStores)
      .catch((err) => (err instanceof AdminError && err.status === 401 ? onUnauthorized() : setError(true)));
  }, [onUnauthorized]);

  if (!stores) return <p className="text-zinc-500">{error ? 'Não foi possível ler as lojas.' : 'Carregando…'}</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        Configuração de cada loja. Salvar passa a valer na hora (buscas, rotina e a tela de quem abrir o app de novo). O <code>.env</code> só é usado para criar a
        configuração na primeira vez.
      </p>
      {stores.map((s) => (
        <StoreForm key={s.id} store={s} onSaved={(n) => setStores((list) => list!.map((x) => (x.id === n.id ? n : x)))} onUnauthorized={onUnauthorized} />
      ))}
    </div>
  );
}

const toInput = (s: AdminStoreConfig): AdminStoreInput => ({
  enabled: s.configured ? s.enabled : true,
  name: s.name,
  url: s.url,
  search: s.search,
  categories: { ...s.categories },
  sweep: { ...s.sweep },
  colors: s.colors.join(','),
});

function StoreForm({ store, onSaved, onUnauthorized }: { store: AdminStoreConfig; onSaved: (s: AdminStoreConfig) => void; onUnauthorized: () => void }) {
  const [form, setForm] = useState<AdminStoreInput>(() => toInput(store));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(toInput(store));
  const set = (patch: Partial<AdminStoreInput>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  };
  const setPath = (field: 'categories' | 'sweep', cat: string, value: string) => set({ [field]: { ...form[field], [cat]: value } });

  const save = async () => {
    setBusy(true);
    setErrors([]);
    try {
      const r = await adminApi<AdminStoreConfig>(`/stores/${store.id}`, { method: 'PUT', body: form });
      onSaved(r);
      setForm(toInput(r));
      setSaved(true);
    } catch (err) {
      if (err instanceof AdminError && err.status === 401) return onUnauthorized();
      setErrors(err instanceof AdminError && Array.isArray(err.data.errors) ? (err.data.errors as string[]) : ['Não foi possível salvar agora.']);
    } finally {
      setBusy(false);
    }
  };

  const bg = previewBackground(form.colors);
  const input = 'w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950';
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <span className="h-3 w-3 rounded-full ring-1 ring-black/15 dark:ring-white/15" style={{ background: bg ?? '#71717a' }} />
        <h2 className="font-semibold">
          {form.name || 'Sem nome'} <span className="text-sm font-normal text-zinc-500">({store.id})</span>
        </h2>
        {!store.configured && <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">não configurada</span>}
        <span className="ml-auto">
          <Switch label={`Loja ${store.id} ligada`} on={form.enabled} onChange={(enabled) => set({ enabled })} />
        </span>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nome exibido">
          <input className={input} value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} />
        </Field>
        <Field label="Site (origem, com https)">
          <input className={input} value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://www.loja.com.br" />
        </Field>
        <Field label="Caminho da busca" hint="Com um marcador: {q} (fonte%20750W), {q+} (fonte+750W) ou {slug} (fonte-750w).">
          <input className={input} value={form.search} onChange={(e) => set({ search: e.target.value })} placeholder="/busca?q={q}" />
        </Field>
        <Field label="Cor" hint="Uma cor (#rrggbb) ou 2–3 separadas por vírgula para degradê. Vazio: cor padrão.">
          <input className={input} value={form.colors} onChange={(e) => set({ colors: e.target.value })} placeholder="#ffc300,#e30613" />
        </Field>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-zinc-600 dark:text-zinc-300">Caminhos por categoria</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-zinc-500">
              <tr>
                <th className="py-1 pr-2 font-medium">Categoria</th>
                <th className="py-1 pr-2 font-medium">Categoria na loja (filtro do adapter)</th>
                <th className="py-1 font-medium">Página da categoria (varredura da rotina)</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map((c) => (
                <tr key={c}>
                  <td className="py-1 pr-2 whitespace-nowrap">{CATEGORY_DEFS[c].name}</td>
                  <td className="py-1 pr-2">
                    <input className={input} value={form.categories[c] ?? ''} onChange={(e) => setPath('categories', c, e.target.value)} placeholder="hardware/fontes" />
                  </td>
                  <td className="py-1">
                    <input className={input} value={form.sweep[c] ?? ''} onChange={(e) => setPath('sweep', c, e.target.value)} placeholder="/hardware/fontes" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {errors.length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-red-600 dark:text-red-400">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <footer className="mt-3 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="flex items-center gap-1.5 rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-semibold text-accent-950 hover:bg-accent-400 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
        {saved && !dirty && (
          <span className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
            <Check className="h-4 w-4" /> Salvo, já valendo
          </span>
        )}
        {store.updatedAt && <span className="ml-auto text-xs text-zinc-500">alterada em {formatWhen(store.updatedAt)}</span>}
      </footer>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}
