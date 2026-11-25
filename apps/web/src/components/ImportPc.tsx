import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ExternalLink, FileText, Upload, X } from 'lucide-react';
import { EFFICIENCY_LEVELS, normalizeBrand, PSU_POWERS, type Efficiency, type PcPart, type PcProfile } from '@upgradezin/shared';
import { loadPc, readReportFile, type ReadResult } from '../pc.ts';
import { EFF_LABEL } from '../format.ts';
import { CATEGORY_ICONS } from './CategoryPicker.tsx';
import { PcSpecs } from './PcSpecs.tsx';

interface Props {
  onClose: () => void;
  /** Colocar as peças lidas na montagem. */
  onApply: (pc: PcProfile) => void;
  /** Peças que já estão na montagem e serão trocadas. */
  replacing?: string[];
  /** Texto do botão final (padrão: "Usar na Montagem"). */
  applyLabel?: string;
  /** PC já importado: abre direto na prévia (ex. para informar a fonte). */
  initial?: PcProfile | null;
}

const CPUZ_URL = 'https://www.cpuid.com/softwares/cpu-z.html';

const ERRORS: Record<Exclude<ReadResult, { ok: true }>['reason'], string> = {
  'not-cpuz': 'Esse arquivo não é um relatório do CPU-Z. Confira se salvou pelo botão "Save Report (.TXT)".',
  'too-big': 'Esse arquivo é grande demais para ser um relatório do CPU-Z.',
  empty: 'O relatório não trouxe nenhuma peça. Tente gerar de novo com o CPU-Z aberto como administrador.',
};

/** Importar o PC atual pelo relatório do CPU-Z: passo a passo, arquivo e o que foi lido. */
export function ImportPc({ onClose, onApply, replacing = [], applyLabel = 'Usar na Montagem', initial = null }: Props) {
  const [pc, setPc] = useState<PcProfile | null>(initial);
  // A fonte não está no relatório: vem do que a pessoa já informou antes (importar de novo não apaga).
  const [psu, setPsu] = useState<PsuForm>(() => formOf((initial ?? loadPc())?.psu));
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const read = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const r = await readReportFile(file);
      if (r.ok) setPc(r.pc);
      else setError(ERRORS[r.reason]);
    } catch {
      setError('Não foi possível ler esse arquivo.');
    }
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void read(e.dataTransfer.files[0]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Importar meu PC"
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl sm:p-6 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Importar Meu PC</h2>
            <p className="text-sm text-zinc-500">As peças que você tem hoje entram na montagem como "Atual". Depois é só trocar o que quiser.</p>
          </div>
          <button onClick={onClose} title="Fechar" className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!pc ? (
          <>
            <ol className="mb-4 space-y-2 text-sm">
              <Step n={1}>
                Baixe e abra o{' '}
                <a href={CPUZ_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-accent-600 hover:underline dark:text-accent-400">
                  CPU-Z <ExternalLink className="h-3 w-3" />
                </a>
                , programa gratuito que mostra as peças do PC.
              </Step>
              <Step n={2}>
                Na aba <b>About</b>, clique em <b>Save Report (.TXT)</b> e salve o arquivo.
              </Step>
              <Step n={3}>Arraste o arquivo para cá ou clique para escolher.</Step>
            </ol>

            <button
              onClick={() => input.current?.click()}
              data-button-layout="card"
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={drop}
              className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-sm transition-colors ${
                over ? 'border-accent-500 bg-accent-500/10' : 'border-zinc-300 hover:border-accent-500 dark:border-zinc-700'
              }`}
            >
              <Upload className="h-6 w-6 text-accent-600 dark:text-accent-400" />
              <span className="font-medium">Escolher o Relatório do CPU-Z</span>
              <span className="text-xs text-zinc-500">Arquivo .txt</span>
            </button>
            <input ref={input} type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => void read(e.target.files?.[0])} />

            {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
            <p className="mt-4 text-xs text-zinc-500">O arquivo é lido aqui no seu navegador e não é enviado para lugar nenhum. Números de série ficam de fora.</p>
          </>
        ) : (
          <>
            <PcSpecs pc={pc} />

            <PsuFields value={psu} onChange={setPsu} />
            {replacing.length > 0 && (
              <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">Substitui {listText(replacing)} que estão na montagem.</p>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button
                onClick={() => {
                  setPc(null);
                  setError(null);
                }}
                className="flex items-center gap-1.5 text-sm text-zinc-500 hover:underline"
              >
                <FileText className="h-4 w-4" /> Escolher Outro Arquivo
              </button>
              <button
                onClick={() => {
                  const part = psuPart(psu);
                  const { psu: _old, ...rest } = pc;
                  onApply(part ? { ...rest, psu: part } : rest);
                }}
                className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-accent-950 hover:bg-accent-400"
              >
                {applyLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Fonte (o CPU-Z não mostra) ----------

interface PsuForm {
  watts: string;
  brand: string;
  /** '' = não sei. */
  pfc: '' | 'yes' | 'no';
  /** '' = não sei; 'none' = sem certificação. */
  eff: '' | 'none' | Efficiency;
}

const PSU_WATTS = [300, 350, 400, ...PSU_POWERS, 1300, 1600];
/** Marcas comuns, para sugerir mesmo sem servidor; somadas às que a busca de fontes mostra (GET /api/brands). */
const PSU_BRAND_HINTS = ['Corsair', 'MSI', 'Gigabyte', 'XPG', 'Cooler Master', 'Thermaltake', 'Seasonic', 'EVGA', 'Redragon', 'Rise Mode', 'Mancer', 'Aerocool', 'PCYes', 'Montech', 'Lian Li', 'Super Flower', 'GameMax', 'Husky', 'Fortrek', 'C3Tech'];

/** Marcas sugeridas: as dos anúncios de fonte no banco (as mesmas do filtro da busca) mais as comuns, sem repetir. */
export function mergeBrands(fromDb: string[], hints: string[] = PSU_BRAND_HINTS): string[] {
  const byKey = new Map<string, string>();
  for (const b of [...fromDb, ...hints]) {
    const name = normalizeBrand(b);
    if (name && !byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
}

function usePsuBrands(): string[] {
  const [brands, setBrands] = useState(() => mergeBrands([]));
  useEffect(() => {
    let alive = true;
    fetch('/api/brands?category=psu')
      .then((r) => (r.ok ? (r.json() as Promise<string[]>) : []))
      .then((list) => alive && setBrands(mergeBrands(Array.isArray(list) ? list : [])))
      .catch(() => {}); // sem servidor: fica a lista comum
    return () => {
      alive = false;
    };
  }, []);
  return brands;
}

const formOf = (p: PcPart | undefined): PsuForm => ({
  watts: p?.specs.watts ? String(p.specs.watts) : '',
  brand: p?.brand ?? '',
  pfc: p?.specs.activePfc === true ? 'yes' : p?.specs.activePfc === false ? 'no' : '',
  eff: p?.specs.efficiency ?? (p && p.specs.watts && !p.specs.efficiency && p.title.includes('Sem Certificação') ? 'none' : ''),
});

/** Fonte informada: só com a potência (sem ela, nada a conferir). */
function psuPart(f: PsuForm): PcPart | undefined {
  const watts = Number(f.watts);
  if (!watts) return undefined;
  // Mesma grafia da busca ("corsair" -> "Corsair", "gamemax" -> "GameMax").
  const brand = normalizeBrand(f.brand.trim() || undefined);
  const eff = f.eff && f.eff !== 'none' ? f.eff : undefined;
  const title = ['Fonte', brand, `${watts}W`, eff ? `80 Plus ${EFF_LABEL[eff]}` : f.eff === 'none' ? 'Sem Certificação' : '', f.pfc === 'yes' ? 'PFC Ativo' : '']
    .filter(Boolean)
    .join(' ');
  return {
    title,
    brand,
    specs: { watts, ...(eff && { efficiency: eff }), ...(f.pfc && { activePfc: f.pfc === 'yes' }) },
  };
}

const field = 'w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950';

function PsuFields({ value, onChange }: { value: PsuForm; onChange: (f: PsuForm) => void }) {
  const set = (patch: Partial<PsuForm>) => onChange({ ...value, ...patch });
  const brands = usePsuBrands();
  const Icon = CATEGORY_ICONS.psu;
  return (
    <div className="mt-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center gap-2 text-sm">
        <Icon className="h-4 w-4 text-accent-600 dark:text-accent-400" strokeWidth={1.75} />
        <span className="font-medium">Fonte</span>
        <span className="text-xs text-zinc-500">O CPU-Z não lê a fonte. Opcional, mas com a potência dá para conferir se ela aguenta.</span>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-xs text-zinc-500">
          Potência
          <select className={`${field} mt-1`} value={value.watts} onChange={(e) => set({ watts: e.target.value })}>
            <option value="">Não sei</option>
            {PSU_WATTS.map((w) => (
              <option key={w} value={w}>
                {w} W
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-zinc-500">
          Marca
          <input className={`${field} mt-1`} list="psu-brands" placeholder="Ex.: Corsair" value={value.brand} onChange={(e) => set({ brand: e.target.value })} />
          <datalist id="psu-brands">
            {brands.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </label>
        <label className="text-xs text-zinc-500">
          PFC Ativo
          <select className={`${field} mt-1`} value={value.pfc} onChange={(e) => set({ pfc: e.target.value as PsuForm['pfc'] })}>
            <option value="">Não sei</option>
            <option value="yes">Sim</option>
            <option value="no">Não</option>
          </select>
        </label>
        <label className="text-xs text-zinc-500">
          Eficiência Mínima
          <select className={`${field} mt-1`} value={value.eff} onChange={(e) => set({ eff: e.target.value as PsuForm['eff'] })}>
            <option value="">Não sei</option>
            <option value="none">Sem certificação</option>
            {EFFICIENCY_LEVELS.map((l) => (
              <option key={l} value={l}>
                80 Plus {EFF_LABEL[l]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-xs font-semibold text-accent-700 dark:text-accent-300">{n}</span>
      <span>{children}</span>
    </li>
  );
}


const listText = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}`);
