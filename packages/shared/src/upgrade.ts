import type { BuildSlot } from './compat.ts';
import type { PcProfile } from './cpuz.ts';
import { BASE_SYSTEM_POWER, chipsetSupport, cpuPower, cpuTdp, GPU_POWER, PSU_HEADROOM, roundUp50 } from './hardware.ts';
import { chipsetPcie, cpuLinesAbove, cpuNeeded, cpuPerf, ENTRY_CHIPSETS, GPU_PCIE_X8, GPU_PERF, gpuMatching, gpuPerf, IGPU_PERF, resolutionOf, SOCKET_TOP, type Resolution } from './perf.ts';
import { GPU_MAKERS, type GpuMaker, type MemoryType, type Socket, type Specs } from './types.ts';
import { gpuSeriesOf } from './gpu.ts';

/**
 * Gargalo e sugestões de upgrade a partir do PC importado (docs/ARCHITECTURE.md §17.3).
 * Regras simples e explicáveis, sem base externa: tabela de desempenho aproximado (perf.ts),
 * fatos de plataforma (hardware.ts) e o que o relatório do CPU-Z mostra.
 */

/** Campos com o mesmo nome dos filtros da busca: a sugestão abre a busca já filtrada. */
export interface UpgradeFilters {
  sockets?: Socket[];
  cpuLines?: string[];
  gpuMakers?: GpuMaker[];
  gpuModels?: string[];
  memory?: MemoryType[];
  ramCapacity?: number[];
  ramModules?: number[];
  ramSpeed?: number[];
  ssdInterfaces?: ('nvme' | 'sata')[];
  ssdCapacity?: number[];
}

export interface UpgradeAction {
  slot: BuildSlot;
  label: string;
  filters: UpgradeFilters;
}

/** free: ajuste sem gastar; upgrade: peça nova que vale a pena; attention: algo a conferir; info: limite a conhecer. */
export type TipKind = 'free' | 'upgrade' | 'attention' | 'info';

export interface UpgradeTip {
  id: string;
  kind: TipKind;
  title: string;
  text: string;
  action?: UpgradeAction;
}

export type Verdict = 'gpu' | 'cpu' | 'balanced' | 'unknown';

export interface Balance {
  verdict: Verdict;
  /** Desempenho do processador e da placa de vídeo (escala de perf.ts). */
  cpu?: number;
  gpu?: number;
  /** Processador ÷ o que a placa de vídeo pede: >1 sobra processador, <1 falta. */
  ratio?: number;
  res: Resolution;
  hz?: number;
  /** O que não deu para avaliar (modelo fora da tabela). */
  missing?: string;
}

export interface PcAnalysis {
  balance: Balance;
  tips: UpgradeTip[];
}

/** Acima disto a placa de vídeo é o gargalo; abaixo do inverso, o processador. */
export const GPU_BOUND = 1.2;
export const CPU_BOUND = 0.8;

/** Séries vendidas novas hoje (sugestões só entre elas). */
const CURRENT_SERIES = new Set(['RTX 50', 'RTX 40', 'RTX 30', 'RX 9000', 'RX 7000', 'RX 6000', 'Arc B', 'Arc A']);
/** Gerações atuais, citadas no texto da sugestão. */
const LATEST_SERIES = new Set(['RTX 50', 'RTX 40', 'RX 9000', 'RX 7000', 'Arc B']);

const RES_LABEL: Record<Resolution, string> = { '1080p': 'Full HD', '1440p': 'Quad HD (1440p)', '4k': '4K' };

const listNames = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}`);

export function analyzePc(pc: PcProfile, opts: { psu?: Specs } = {}): PcAnalysis {
  const tips: UpgradeTip[] = [];
  const cpu = pc.cpu?.specs;
  const gpu = pc.gpu?.specs;
  const ram = pc.ram;
  const mb = pc.motherboard?.specs;
  const monitor = [...pc.monitors].sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];
  const res = resolutionOf(monitor?.width, monitor?.height);
  const hz = monitor?.maxHz;
  const psu = opts.psu ?? pc.psu?.specs;
  /** Fonte sem PFC ativo e sem certificação: costuma entregar menos do que promete. */
  const basicPsu = !!psu && psu.activePfc === false && (!psu.efficiency || psu.efficiency === 'white');
  const psuWatts = psu?.watts;
  const pcie = chipsetPcie(mb?.chipset);
  const boardName = pc.motherboard?.title ?? `placa-mãe ${mb?.chipset ?? ''}`.trim();
  const cpuW = cpu ? cpuPower(cpu) : undefined;

  // ---------- Equilíbrio processador × placa de vídeo ----------
  const cpuP = cpuPerf(cpu);
  const gpuP = gpu ? gpuPerf(gpu) : cpu?.igpu ? IGPU_PERF : undefined;
  const balance: Balance = { verdict: 'unknown', res, ...(hz && { hz }) };
  if (cpuP === undefined) balance.missing = pc.cpu ? `o processador ${pc.cpu.title}` : 'o processador';
  else if (gpuP === undefined) balance.missing = pc.gpu ? `a placa de vídeo ${pc.gpu.title}` : 'a placa de vídeo';
  else {
    const ratio = cpuP / cpuNeeded(gpuP, res, hz);
    Object.assign(balance, { cpu: cpuP, gpu: gpuP, ratio: Math.round(ratio * 100) / 100 });
    balance.verdict = ratio >= GPU_BOUND ? 'gpu' : ratio <= CPU_BOUND ? 'cpu' : 'balanced';
  }

  const cpuName = pc.cpu?.title ?? 'processador';
  const gpuName = pc.gpu ? pc.gpu.specs.gpuModel ?? pc.gpu.title : 'o vídeo integrado';
  const screen = `${RES_LABEL[res]}${hz && hz >= 120 ? ` a ${hz} Hz` : ''}`;

  if (balance.verdict === 'gpu' && cpuP !== undefined && gpuP !== undefined) {
    // Placas na faixa do que o processador aguenta, bem acima da atual.
    const target = gpuMatching(cpuP, res, hz);
    const lo = Math.max(gpuP * 1.3, target * 0.85);
    const hi = Math.max(lo * 1.15, target * 1.15);
    const fits = (m: string) => !psuWatts || !cpuW || cpuW + (GPU_POWER[m] ?? 999) + BASE_SYSTEM_POWER <= psuWatts;
    const range = Object.entries(GPU_PERF)
      .filter(([m, p]) => p >= lo && p <= hi && CURRENT_SERIES.has(gpuSeriesOf(m) ?? ''))
      .sort((a, b) => a[1] - b[1]);
    // Placa-mãe PCIe 3.0: as placas de 8 linhas perdem desempenho nela; ficam de fora se houver outras.
    const x16 = pcie === 3 ? range.filter(([m]) => !GPU_PCIE_X8.has(m)) : range;
    const leftOut = pcie === 3 && x16.length && x16.length < range.length ? range.find(([m]) => GPU_PCIE_X8.has(m))?.[0] : undefined;
    const usable = x16.length ? x16 : range;
    const ok = usable.filter(([m]) => fits(m));
    const pool = ok.length ? ok : usable;
    const models = pool.map(([m]) => m);
    // No texto, as de geração atual mais perto do ideal; a busca mostra a faixa toda.
    const named = pool
      .filter(([m]) => LATEST_SERIES.has(gpuSeriesOf(m) ?? ''))
      .sort((a, b) => Math.abs(a[1] - target) - Math.abs(b[1] - target))
      .slice(0, 4)
      .sort((a, b) => a[1] - b[1])
      .map(([m]) => m);
    const makers = GPU_MAKERS.filter((mk) => models.some((m) => (mk === 'nvidia' ? /^(RTX|GTX)/ : mk === 'amd' ? /^RX/ : /^Arc/).test(m)));
    // Fonte pela placa mais econômica da faixa ("a partir de").
    const leanest = models.length ? Math.min(...models.map((m) => GPU_POWER[m] ?? Infinity)) : undefined;
    const psuNeed = leanest !== undefined && Number.isFinite(leanest) && cpuW ? roundUp50((cpuW + leanest + BASE_SYSTEM_POWER) * PSU_HEADROOM) : undefined;
    const psuText = !models.length
      ? ''
      : basicPsu
        ? ' Sua fonte é simples (veja abaixo): troque-a junto com a placa.'
        : psuWatts
        ? ok.length
          ? ` Todas cabem na sua fonte de ${psuWatts} W.`
          : ` Sua fonte de ${psuWatts} W não aguenta essas placas: a troca inclui uma fonte a partir de ${psuNeed} W.`
        : psuNeed
          ? ` Elas pedem fonte a partir de ${psuNeed} W, conforme o modelo: marque a sua como "Já Tenho" na montagem para conferir.`
          : '';
    const vramNote = gpu?.vram && gpu.vram <= 4 ? ` Com ${gpu.vram} GB de memória de vídeo, jogos atuais já ficam limitados.` : '';
    tips.push({
      id: 'gpu-upgrade',
      kind: 'upgrade',
      title: pc.gpu ? 'Trocar a Placa de Vídeo' : 'Colocar uma Placa de Vídeo',
      text:
        `O ${cpuName} aguenta uma placa de vídeo bem mais forte que ${pc.gpu ? `a ${gpuName}` : gpuName} em ${screen}.` +
        (named.length ? ` Na faixa certa para ele: ${listNames(named)}.` : models.length ? ` Na faixa certa para ele: ${listNames(models.slice(0, 4))}.` : '') +
        vramNote +
        (leftOut ? ` A ${boardName} é PCIe 3.0, então ficaram de fora as placas que usam só 8 linhas (como a ${leftOut}), que perdem desempenho nela.` : '') +
        psuText,
      ...(models.length && { action: { slot: 'gpu', label: 'Ver Placas de Vídeo', filters: { gpuMakers: makers, gpuModels: models } } }),
    });
  }

  if (balance.verdict === 'cpu' && cpu?.socket && cpuP !== undefined && gpuP !== undefined) {
    const top = SOCKET_TOP[cpu.socket];
    const lines = cpuLinesAbove(cpu.socket, cpuP * 1.15).filter((l) => !mb?.chipset || chipsetSupport(mb.chipset, l.family) !== 'no');
    if (lines.length && cpuP < top.perf * 0.95) {
      tips.push({
        id: 'cpu-upgrade',
        kind: 'upgrade',
        title: 'Trocar o Processador',
        text: `A ${gpuName} fica esperando o ${cpuName} em ${screen}. Dá para subir sem trocar a placa-mãe: o melhor para jogos nesse encaixe é o ${top.name}.`,
        action: { slot: 'cpu', label: 'Ver Processadores', filters: { sockets: [cpu.socket], cpuLines: [...new Set(lines.map((l) => l.line))] } },
      });
    } else {
      const next: Socket[] = cpu.cpuBrand === 'amd' ? ['AM5'] : ['LGA1851', 'LGA1700'];
      tips.push({
        id: 'platform-upgrade',
        kind: 'upgrade',
        title: 'Trocar a Plataforma',
        text: `A ${gpuName} fica esperando o ${cpuName} em ${screen}, e esse encaixe não tem processador muito melhor. O próximo passo é trocar processador, placa-mãe e memória juntos.`,
        action: {
          slot: 'cpu',
          label: 'Ver Processadores Novos',
          filters: { sockets: next, ...(cpu.cpuBrand !== 'amd' && { cpuLines: ['Core i5', 'Core i7', 'Core Ultra 5', 'Core Ultra 7'] }) },
        },
      });
    }
  }

  // ---------- Placa-mãe ----------
  if (mb?.chipset && (ENTRY_CHIPSETS.has(mb.chipset) || pcie === 3)) {
    const parts: string[] = [];
    if (pcie === 3) parts.push('Placa de vídeo e SSD ficam em PCIe 3.0, uma geração atrás das placas atuais.');
    const tdp = cpu && (cpu.tdp ?? cpuTdp(cpu));
    if (ENTRY_CHIPSETS.has(mb.chipset) && tdp && tdp >= 105)
      parts.push(`A regulagem de energia (VRM) costuma ser simples para um processador de ${tdp} W: em carga longa, como renderizar ou compilar, a placa esquenta e o processador pode baixar o clock. Em jogos raramente pesa.`);
    const slots = mb.memorySlots;
    const used = ram?.specs.ramModules ?? ram?.modules.length;
    if (slots && used && used >= slots) parts.push(`Os ${slots} slots de memória estão ocupados: mais memória exige trocar o kit.`);
    const top = cpu?.socket ? SOCKET_TOP[cpu.socket] : undefined;
    const atTop = top && cpuP !== undefined && cpuP >= top.perf * 0.95;
    tips.push({
      id: 'motherboard',
      kind: 'info',
      title: ENTRY_CHIPSETS.has(mb.chipset) ? 'Placa-Mãe de Entrada' : 'Limites da Placa-Mãe',
      text:
        `A ${boardName} (chipset ${mb.chipset}) é uma placa ${ENTRY_CHIPSETS.has(mb.chipset) ? 'de entrada' : 'de geração anterior'}.${parts.length ? ` ${parts.join(' ')}` : ''}` +
        (atTop ? ` Com o ${cpuName} você já está no melhor processador para jogos desse encaixe, então trocar só a placa-mãe rende pouco: ela sai junto no próximo upgrade de plataforma.` : ' Trocar só a placa-mãe raramente vale: ela costuma sair junto com o processador no próximo upgrade.'),
    });
  }

  // ---------- Memória ----------
  if (ram) {
    const cap = ram.specs.ramCapacity ?? 0;
    const modules = ram.specs.ramModules ?? ram.modules.length;
    const memory = ram.specs.memory;
    if (ram.ratedSpeed && ram.runningSpeed && ram.runningSpeed < ram.ratedSpeed * 0.95) {
      const profile = ram.profile === 'expo' ? 'EXPO' : 'XMP';
      tips.push({
        id: 'ram-xmp',
        kind: 'free',
        title: `Ativar o ${profile} da Memória`,
        text: `Sua memória está rodando a ${ram.runningSpeed} MHz, mas foi feita para ${ram.ratedSpeed} MHz. Ative o perfil ${profile} na BIOS (às vezes chamado de DOCP ou "perfil de memória"): ganho de graça, principalmente em jogos.`,
      });
    }
    const reasons: string[] = [];
    if (cap && cap < 16) reasons.push(`${cap} GB já é pouco para jogos e navegador abertos juntos`);
    if (modules === 1) reasons.push('com um pente só a memória trabalha com metade da velocidade (single channel)');
    if (memory === 'ddr4' && ram.ratedSpeed && ram.ratedSpeed <= 2666 && cpu?.cpuBrand === 'amd') reasons.push(`${ram.ratedSpeed} MHz é lento para Ryzen, que rende mais com 3200 MHz ou mais`);
    if (reasons.length && memory) {
      const want = Math.max(16, cap >= 16 ? cap : 16);
      tips.push({
        id: 'ram-upgrade',
        kind: 'upgrade',
        title: 'Melhorar a Memória',
        text: `${reasons.map((r, i) => (i ? r : r[0]!.toUpperCase() + r.slice(1))).join('; ')}. Um kit com 2 pentes resolve.`,
        action: {
          slot: 'ram',
          label: 'Ver Memórias',
          filters: {
            memory: [memory],
            ramModules: [2],
            ramCapacity: want >= 32 ? [32, 64] : [16, 32],
            ...(memory === 'ddr4' && cpu?.cpuBrand === 'amd' && { ramSpeed: [3200, 3600] }),
          },
        },
      });
    }
  }

  // ---------- Armazenamento ----------
  const system = pc.drives.find((d) => d.system);
  if (system) {
    const faster = pc.drives.find((d) => !d.system && (d.kind === 'nvme' || (d.kind === 'ssd' && system.kind === 'hdd')) && d.capacityGb >= system.capacityGb);
    if (system.kind === 'hdd') {
      tips.push({
        id: 'system-hdd',
        kind: faster ? 'free' : 'upgrade',
        title: faster ? 'Passar o Windows para o SSD' : 'Colocar o Windows num SSD',
        text: faster
          ? `O Windows está num HD, e você já tem um ${faster.kind === 'nvme' ? 'SSD NVMe' : 'SSD'} (${faster.name}). Instalar o sistema nele deixa tudo mais rápido: ligar, abrir programas e carregar jogos.`
          : 'O Windows está num HD. Um SSD é o upgrade que mais muda a sensação de velocidade: ligar, abrir programas e carregar jogos.',
        ...(!faster && { action: { slot: 'ssd', label: 'Ver SSDs', filters: { ssdInterfaces: ['nvme', 'sata'], ssdCapacity: [500, 1000] } } }),
      });
    } else {
      if (faster && system.kind === 'ssd' && faster.kind === 'nvme') {
        tips.push({
          id: 'system-nvme',
          kind: 'free',
          title: 'Usar o NVMe para o Windows',
          text: `O Windows está num SSD SATA (${system.name}), mas você tem um NVMe maior e mais rápido (${faster.name}). Vale instalar o sistema nele${system.freePercent !== undefined && system.freePercent < 20 ? ', até porque o disco do sistema está com só ' + Math.round(system.freePercent) + '% livre' : ''}.`,
        });
      } else if (system.freePercent !== undefined && system.freePercent < 15) {
        tips.push({
          id: 'system-full',
          kind: 'attention',
          title: 'Disco do Sistema Quase Cheio',
          text: `O disco do Windows está com só ${Math.round(system.freePercent)}% livre. Abaixo de 10–15% o sistema fica lento e as atualizações falham: libere espaço ou mova jogos para outro disco.`,
        });
      }
    }
  }

  // ---------- Monitor ----------
  if (hz && hz >= 100) {
    tips.push({
      id: 'monitor-hz',
      kind: 'free',
      title: `Conferir os ${hz} Hz do Monitor`,
      text: `Seu monitor aceita até ${hz} Hz, mas o Windows às vezes deixa em 60. Confira em Configurações → Sistema → Tela → Tela avançada, e use o cabo DisplayPort ou um HDMI que suporte a taxa.`,
    });
  }

  // ---------- Estabilidade ----------
  if (pc.wheaErrors && pc.wheaErrors > 0) {
    tips.push({
      id: 'whea',
      kind: 'attention',
      title: 'Erros de Hardware Registrados',
      text: `O Windows registrou ${pc.wheaErrors} ${pc.wheaErrors === 1 ? 'erro corrigido' : 'erros corrigidos'} de hardware. Costuma vir de memória ou processador no limite (perfil de memória, overclock, undervolt). Se o PC trava ou reinicia, comece por aí.`,
    });
  }

  // ---------- Fonte ----------
  // Fonte sem PFC ativo e sem certificação: costuma entregar menos do que promete.
  if (basicPsu) {
    tips.push({
      id: 'psu-basic',
      kind: 'attention',
      title: 'Fonte Simples',
      text: `Fonte sem PFC ativo e sem certificação 80 Plus de bronze para cima costuma entregar menos do que a potência do rótulo e protege pouco as peças. Antes de uma placa de vídeo mais forte, troque a fonte.`,
      action: { slot: 'psu', label: 'Ver Fontes', filters: {} },
    });
  }
  if (psuWatts && cpuW) {
    const estimate = cpuW + (gpu?.gpuModel ? (GPU_POWER[gpu.gpuModel] ?? 0) : 0) + BASE_SYSTEM_POWER;
    if (psuWatts < estimate) {
      tips.push({
        id: 'psu-weak',
        kind: 'attention',
        title: 'Fonte Abaixo do Consumo',
        text: `Sua fonte de ${psuWatts} W fica abaixo do consumo máximo estimado do PC (${estimate} W). Pode desligar em jogos pesados: o recomendado é ${roundUp50(estimate * PSU_HEADROOM)} W.`,
        action: { slot: 'psu', label: 'Ver Fontes', filters: {} },
      });
    }
  }

  const ORDER: Record<TipKind, number> = { upgrade: 0, free: 1, attention: 2, info: 3 };
  tips.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  return { balance, tips };
}
