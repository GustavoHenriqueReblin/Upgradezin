import {
  BASE_SYSTEM_POWER,
  chipsetSupport,
  cpuFamily,
  cpuMemorySpeed,
  cpuPower,
  cpuTdp,
  GPU_POWER,
  MEMORY_LOCKED_CHIPSETS,
  recommendedPsuWatts,
} from './hardware.ts';
import { caseFits } from './pccase.ts';
import { chipsetPcie, ENTRY_CHIPSETS, GPU_PCIE_X8 } from './perf.ts';
import { SOCKET_BRAND, SOCKET_MEMORY, type Socket, type Specs } from './types.ts';

/**
 * Compatibilidade da montagem (docs/ARCHITECTURE.md §17.1). Função pura: recebe as
 * peças escolhidas e devolve os problemas de cada uma. Revalida a montagem inteira a
 * cada mudança, todas as peças contra todas.
 */

/** Ordem da montagem: cada peça restringe as seguintes. */
export const BUILD_SLOTS = ['motherboard', 'cpu', 'ram', 'gpu', 'psu', 'ssd', 'cooler', 'case'] as const;
export type BuildSlot = (typeof BUILD_SLOTS)[number];
export const MAX_BUILD_DRIVES = 24;

export interface BuildPart {
  specs: Specs;
  /** Unidades compradas (só memória: ex. 2 pentes avulsos iguais). Padrão 1. */
  qty?: number;
  /** Peça que a pessoa já tem (importada do CPU-Z). */
  current?: boolean;
}

/** Peças escolhidas até agora; a montagem pode estar incompleta. */
export type Build = Partial<Record<BuildSlot, BuildPart>> & { extraDrives?: BuildPart[] };

/**
 *   error   não funciona (vermelho)
 *   warn    funciona com ressalva ou falta algo (amarelo)
 *   unknown não deu para confirmar (cinza); nunca vira "ok" por padrão
 *   info    observação, não afeta o selo
 */
export type IssueLevel = 'error' | 'warn' | 'unknown' | 'info';
export type PartStatus = IssueLevel | 'ok';

export interface BuildIssue {
  level: IssueLevel;
  /** Código estável para a interface e os testes; o texto pode mudar. */
  code: string;
  /** Peças envolvidas: o selo de cada uma reflete o problema. */
  parts: BuildSlot[];
  message: string;
}

export interface BuildPower {
  /** Consumo máximo estimado do PC (W). */
  estimate: number;
  /** Potência de fonte recomendada (W), com margem. */
  recommended: number;
  /** Falta o processador ou a placa de vídeo (sem placa, a conta considera só o vídeo integrado). */
  partial: boolean;
}

export interface BuildCheck {
  issues: BuildIssue[];
  /** Selo de cada peça presente: o problema mais grave que a envolve. */
  status: Partial<Record<BuildSlot, PartStatus>>;
  power?: BuildPower;
}

const FF = { 'mini-itx': 'Mini-ITX', matx: 'Micro-ATX', atx: 'ATX', eatx: 'E-ATX' } as const;

/** Encaixes de mesma fixação de cooler: AM5 usa a do AM4; LGA1851 a do LGA1700; LGA1200 a do 115x. */
const COOLER_MOUNT: Record<Socket, string[]> = {
  AM5: ['AM5', 'AM4'],
  AM4: ['AM4', 'AM5'],
  LGA1851: ['LGA1851', 'LGA1700'],
  LGA1700: ['LGA1700', 'LGA1851'],
  LGA1200: ['LGA1200', 'LGA115X'],
  LGA1151: ['LGA115X', 'LGA1200'],
};

/** O cooler serve no encaixe? 'ok', 'no' ou undefined (o título não diz). */
export function coolerFits(c: Pick<Specs, 'coolerSockets' | 'coolerBrands'>, socket: Socket | undefined): 'ok' | 'no' | undefined {
  if (!socket) return undefined;
  const brand = SOCKET_BRAND[socket];
  const listed = (c.coolerSockets ?? []).filter((s) => (brand === 'amd' ? s.startsWith('AM') : s.startsWith('LGA')));
  // Lista encaixes do mesmo fabricante: vale a lista (ex. "LGA 1156/1155/1151/1150" não serve no LGA1700).
  if (listed.length) return listed.some((s) => COOLER_MOUNT[socket].includes(s)) ? 'ok' : 'no';
  if (c.coolerBrands?.length) return c.coolerBrands.includes(brand) ? 'ok' : 'no';
  return undefined;
}

const RANK: Record<PartStatus, number> = { ok: 0, info: 0, unknown: 1, warn: 2, error: 3 };

export const worst = (a: PartStatus, b: PartStatus): PartStatus => (RANK[b] > RANK[a] ? b : a);

const DDR = (m: string) => m.toUpperCase();
const PLATFORM = (s: string) => s.replace(/^LGA/, 'LGA ');

export function checkBuild(build: Build): BuildCheck {
  const issues: BuildIssue[] = [];
  const add = (level: IssueLevel, code: string, parts: BuildSlot[], message: string) => issues.push({ level, code, parts, message });

  const mb = build.motherboard?.specs;
  const cpu = build.cpu?.specs;
  const ram = build.ram?.specs;
  const ramQty = Math.max(1, build.ram?.qty ?? 1);
  const gpu = build.gpu?.specs;
  const psu = build.psu?.specs;
  const driveParts = [build.ssd, ...(build.extraDrives ?? [])].filter((part) => part !== undefined);
  const drives = driveParts.map((part) => part.specs);
  const cooler = build.cooler?.specs;
  const pcase = build.case?.specs;

  // ---- Placa-mãe × processador ----
  if (mb && cpu) {
    if (!mb.socket || !cpu.socket) add('unknown', 'socket-unknown', ['motherboard', 'cpu'], 'Não deu para confirmar se o processador encaixa na placa-mãe.');
    else if (mb.socket !== cpu.socket)
      add('error', 'socket-mismatch', ['motherboard', 'cpu'], `O processador é ${PLATFORM(cpu.socket)} e a placa-mãe é ${PLATFORM(mb.socket)}: não encaixa.`);
    else {
      const family = cpuFamily(cpu);
      const support = mb.chipset && family ? chipsetSupport(mb.chipset, family) : undefined;
      if (support === 'no')
        add('error', 'chipset-unsupported', ['motherboard', 'cpu'], `A placa-mãe ${mb.chipset} não aceita este processador, apesar do mesmo encaixe.`);
      else if (support === 'bios')
        add('warn', 'chipset-bios', ['motherboard', 'cpu'], `A placa-mãe ${mb.chipset} aceita este processador, mas pode precisar de atualização de BIOS antes de ligar.`);
      else if (!support)
        add('unknown', 'chipset-unknown', ['motherboard', 'cpu'], 'Não deu para confirmar se a placa-mãe aceita esta geração de processador.');
      // Placa de entrada com processador forte: liga, mas a regulagem de energia limita em carga longa.
      const tdp = cpu.tdp ?? cpuTdp(cpu);
      if (support !== 'no' && mb.chipset && ENTRY_CHIPSETS.has(mb.chipset) && tdp && tdp >= 105)
        add('info', 'board-vrm', ['motherboard', 'cpu'], `A placa-mãe ${mb.chipset} é de entrada e o processador tem TDP de ${tdp} W: em carga longa (renderizar, compilar) a placa esquenta e o processador pode baixar o clock. Em jogos raramente pesa.`);
    }
  }

  // ---- Memória × placa-mãe ----
  if (ram && mb) {
    if (!ram.memory || !mb.memory) add('unknown', 'memory-type-unknown', ['ram', 'motherboard'], 'Não deu para confirmar se a memória é do tipo da placa-mãe (DDR4 ou DDR5).');
    else if (ram.memory !== mb.memory)
      add('error', 'memory-type-mismatch', ['ram', 'motherboard'], `A memória é ${DDR(ram.memory)} e a placa-mãe usa ${DDR(mb.memory)}.`);

    // Total de pentes: pentes do produto × quantidade comprada.
    const modules = (ram.ramModules ?? 1) * ramQty;
    const what = ramQty > 1 ? `São ${modules} pentes` : `O kit tem ${modules} pentes`;
    // O título quase nunca diz os slots. Placa ATX tem 4 (Mini-ITX, 2, já vem da leitura do título);
    // Micro-ATX varia (2 ou 4) e fica sem confirmar.
    const slots = mb.memorySlots ?? (mb.formFactor === 'atx' ? 4 : undefined);
    if (modules > 2) {
      if (!slots) add('unknown', 'slots-unknown', ['ram', 'motherboard'], `${what}: confira se a placa-mãe tem slots suficientes.`);
      else if (modules > slots) add('error', 'slots-exceeded', ['ram', 'motherboard'], `${what} e a placa-mãe só tem ${slots} slots.`);
    }
    // Memória máxima da placa (ficha técnica).
    const total = ram.ramCapacity ? ram.ramCapacity * ramQty : undefined;
    if (total && mb.memoryMaxGb && total > mb.memoryMaxGb)
      add('error', 'memory-max-exceeded', ['ram', 'motherboard'], `São ${total} GB de memória e a placa-mãe aceita até ${mb.memoryMaxGb} GB.`);
  }

  // Abaixo de 32 GB: só observação (não muda o selo). Jogos atuais em Full HD já passam de 16 GB.
  const ramTotal = ram?.ramCapacity ? ram.ramCapacity * ramQty : undefined;
  if (ramTotal && ramTotal < 32)
    add('info', 'memory-capacity', ['ram'], `${ramTotal} GB funciona, mas já fica justo: jogos atuais em Full HD passam de 16 GB com navegador e Discord abertos. O recomendado é 32 GB.`);

  // Pentes avulsos iguais: em geral funcionam juntos, mas só o kit garante a frequência anunciada com todos.
  if (ram && ramQty > 1)
    add('info', 'memory-separate-modules', ['ram'], 'Pentes comprados separados costumam funcionar juntos, mas só um kit com todos os pentes garante a frequência anunciada.');

  // ---- Memória × processador ----
  if (ram && cpu) {
    const accepted = cpu.socket ? SOCKET_MEMORY[cpu.socket] : undefined;
    if (ram.memory && accepted && !accepted.includes(ram.memory))
      add('error', 'memory-cpu-mismatch', ['ram', 'cpu'], `Este processador só usa ${accepted.map(DDR).join(' ou ')}; a memória é ${DDR(ram.memory)}.`);
    else if (ram.memory && ram.ramSpeed) {
      const official = cpuMemorySpeed(cpu, ram.memory);
      if (official && ram.ramSpeed > official) {
        if (mb?.chipset && MEMORY_LOCKED_CHIPSETS.has(mb.chipset))
          add('warn', 'memory-speed-locked', ['ram', 'motherboard'], `A placa-mãe ${mb.chipset} limita a memória a ${official} MHz: os ${ram.ramSpeed} MHz não serão usados.`);
        else
          add('info', 'memory-speed-profile', ['ram'], `Para rodar a ${ram.ramSpeed} MHz, ative o perfil XMP/EXPO na BIOS (o padrão do processador é ${official} MHz).`);
      }
    }
  }
  // A placa diz até quantos MHz a memória roda (ficha técnica); acima disso, roda no máximo dela.
  if (ram?.ramSpeed && mb?.memoryMaxMhz && ram.ramSpeed > mb.memoryMaxMhz && !issues.some((i) => i.code === 'memory-speed-locked'))
    add('info', 'memory-speed-board', ['ram', 'motherboard'], `A placa-mãe vai até ${mb.memoryMaxMhz} MHz: a memória de ${ram.ramSpeed} MHz roda a ${mb.memoryMaxMhz} MHz.`);

  // ---- Vídeo ----
  if (cpu && !gpu) {
    // Observação, não ressalva: a placa de vídeo é uma peça da montagem (o espaço dela avisa que é obrigatória).
    if (cpu.igpu === false) add('info', 'needs-gpu', ['cpu'], 'Este processador não tem vídeo integrado: a montagem precisa de uma placa de vídeo.');
    else if (cpu.igpu === undefined) add('unknown', 'igpu-unknown', ['cpu'], 'Não deu para confirmar se o processador tem vídeo integrado.');
  }
  if (cpu?.cooler === false && !cooler) add('warn', 'needs-cooler', ['cpu'], 'Este processador não acompanha cooler: é preciso comprar um à parte.');

  // ---- Cooler × processador ----
  if (cooler && cpu) {
    const fit = coolerFits(cooler, cpu.socket);
    if (fit === 'no')
      add('error', 'cooler-socket', ['cooler', 'cpu'], `O cooler não serve no encaixe ${cpu.socket ? PLATFORM(cpu.socket) : 'do processador'}.`);
    else if (fit === undefined) add('unknown', 'cooler-socket-unknown', ['cooler', 'cpu'], 'Não deu para confirmar se o cooler serve no encaixe do processador.');
    // TDP: o do CPU-Z (PC importado) ou o de referência do modelo (o título raramente traz).
    const tdp = cpu.tdp ?? cpuTdp(cpu);
    if (cooler.coolerTdp && tdp && cooler.coolerTdp < tdp)
      add('warn', 'cooler-tdp', ['cooler', 'cpu'], `O cooler é para até ${cooler.coolerTdp} W e o processador tem TDP de ${tdp} W: ele esquenta e perde desempenho.`);
    else if (!cooler.coolerTdp && tdp && tdp >= 125 && cooler.coolerType === 'water' && cooler.radiator === 120)
      add('info', 'cooler-small-radiator', ['cooler', 'cpu'], `Radiador de 120 mm é pouco para um processador de ${tdp} W: em carga longa ele esquenta e baixa o clock. Para ele, 240 mm ou mais.`);
  }

  // ---- Gabinete ----
  if (pcase && mb?.formFactor) {
    const fits = caseFits(pcase.caseFormFactor, mb.formFactor);
    if (fits === false) add('error', 'case-board', ['case', 'motherboard'], `A placa-mãe ${FF[mb.formFactor]} não cabe num gabinete ${FF[pcase.caseFormFactor!]}.`);
    else if (fits === undefined) add('unknown', 'case-board-unknown', ['case', 'motherboard'], 'Não deu para confirmar se a placa-mãe cabe no gabinete.');
  }
  // Medidas físicas: vêm da ficha técnica da loja (specsheet.ts), quando ela informa. Sem a medida
  // dos dois lados, fica a observação para conferir (não muda o selo: o título nunca traz isso).
  if (pcase && gpu) {
    if (gpu.gpuLength && pcase.caseMaxGpu) {
      const room = pcase.caseMaxGpu - gpu.gpuLength;
      if (room < 0)
        add('error', 'case-gpu-length', ['case', 'gpu'], `A placa de vídeo tem ${gpu.gpuLength} mm e o gabinete aceita até ${pcase.caseMaxGpu} mm: não cabe.`);
      else if (room < 10)
        add('warn', 'case-gpu-tight', ['case', 'gpu'], `A placa de vídeo (${gpu.gpuLength} mm) cabe com só ${room} mm de folga (o gabinete aceita até ${pcase.caseMaxGpu} mm): ventoinha ou radiador na frente pode tomar esse espaço.`);
    } else add('info', 'case-gpu-unknown', ['case', 'gpu'], 'Confira o comprimento da placa de vídeo contra o espaço do gabinete: a loja não informou as duas medidas.');
  }
  if (pcase && cooler?.coolerType === 'air') {
    if (cooler.coolerHeight && pcase.caseMaxCooler) {
      if (cooler.coolerHeight > pcase.caseMaxCooler)
        add('error', 'case-cooler-height', ['case', 'cooler'], `O cooler tem ${cooler.coolerHeight} mm de altura e o gabinete aceita até ${pcase.caseMaxCooler} mm: a tampa não fecha.`);
    } else add('info', 'case-cooler-unknown', ['case', 'cooler'], 'Confira a altura do cooler contra o gabinete: a loja não informou as duas medidas.');
  }
  if (pcase && cooler?.coolerType === 'water' && cooler.radiator) {
    if (pcase.caseRadiators?.length) {
      if (!pcase.caseRadiators.includes(cooler.radiator))
        add('error', 'case-radiator-unsupported', ['case', 'cooler'], `O gabinete aceita radiador de ${pcase.caseRadiators.join(', ')} mm; o do water cooler é de ${cooler.radiator} mm.`);
    } else if (cooler.radiator >= 280)
      add('info', 'case-radiator', ['case', 'cooler'], `Confira se o gabinete tem espaço para radiador de ${cooler.radiator} mm (no topo ou na frente).`);
  }

  // ---- SSD ----
  // Encaixe (ficha técnica): M.2 em placa sem M.2, 2,5" (SATA) em placa sem porta SATA.
  if (mb) {
    const m2 = drives.filter((s) => s.ssdForm === 'm2' || s.ssdInterface === 'nvme').length;
    const sata = drives.filter((s) => s.ssdForm !== 'm2' && s.ssdInterface !== 'nvme' && (s.ssdForm === '2.5' || s.ssdInterface === 'sata')).length;
    if (mb.m2Slots !== undefined && m2 > mb.m2Slots)
      add('error', 'ssd-no-m2', ['ssd', 'motherboard'], `A montagem precisa de ${m2} slot(s) M.2. A placa-mãe tem ${mb.m2Slots}.`);
    if (mb.sataPorts !== undefined && sata > mb.sataPorts)
      add('error', 'ssd-no-sata', ['ssd', 'motherboard'], `A montagem precisa de ${sata} porta(s) SATA. A placa-mãe tem ${mb.sataPorts}.`);
    if (m2 && sata && mb.m2SharesSata)
      add('warn', 'ssd-shares-sata', ['ssd', 'motherboard'], 'A ficha indica que um slot M.2 pode desativar portas SATA. Confira quais conexões usar no manual da placa-mãe.');
    if (m2 && gpu && mb.m2SharesGpu)
      add('info', 'ssd-shares-gpu', ['ssd', 'motherboard', 'gpu'], 'A ficha indica que um slot M.2 pode reduzir as linhas da placa de vídeo. Confira no manual qual slot usar.');
  }
  const ssd = drives.filter((s) => s.ssdInterface === 'nvme').sort((a, b) => (b.ssdPcie ?? 0) - (a.ssdPcie ?? 0))[0];
  if (ssd?.ssdInterface === 'nvme' && ssd.ssdPcie && mb && (mb.m2Pcie || mb.chipset)) {
    // Geração do M.2: a da ficha da placa; sem ela, a do chipset.
    const slot = mb.m2Pcie ?? chipsetPcie(mb.chipset);
    if (slot && ssd.ssdPcie > slot)
      add('info', 'ssd-pcie', ['ssd', 'motherboard'], `O SSD é PCIe ${ssd.ssdPcie}.0 e a placa-mãe${mb.chipset ? ` ${mb.chipset}` : ''} tem M.2 PCIe ${slot}.0: funciona, na velocidade da ${slot}.0.`);
  }

  // ---- Placa de vídeo × placa-mãe ----
  // Placa de vídeo x8 (RX 6600, RTX 4060…) em slot PCIe 3.0: metade da banda; perde um pouco, mais quando falta VRAM.
  if (gpu && mb) {
    const lanes = gpu.gpuPcieLanes ?? (gpu.gpuModel && GPU_PCIE_X8.has(gpu.gpuModel) ? 8 : undefined);
    const board = mb.pcieGen ?? chipsetPcie(mb.chipset);
    if (lanes && lanes <= 8 && board === 3 && (gpu.gpuPcieGen ?? 4) > 3)
      add('info', 'gpu-pcie-lanes', ['gpu', 'motherboard'], `A placa de vídeo usa só ${lanes} linhas PCIe (x${lanes}) e a placa-mãe é PCIe 3.0: funciona, com um pouco menos de desempenho (mais quando falta memória de vídeo).`);
  }

  // ---- Fonte ----
  let power: BuildPower | undefined;
  const cpuW = cpu ? cpuPower(cpu) : undefined;
  // Consumo da placa de vídeo: o de referência do chip; sem ele, o da ficha técnica.
  const referenceGpuW = gpu?.gpuModel ? GPU_POWER[gpu.gpuModel] : undefined;
  const gpuW = gpu?.gpuTdp === undefined ? referenceGpuW : Math.max(gpu.gpuTdp, referenceGpuW ?? 0);
  if ((cpu && cpuW !== undefined && (!gpu || gpuW !== undefined)) || (!cpu && gpuW !== undefined)) {
    const estimate = (cpuW ?? 0) + (gpuW ?? 0) + BASE_SYSTEM_POWER;
    // A fonte que o fabricante da placa de vídeo recomenda (ficha técnica) vale como piso.
    power = { estimate, recommended: recommendedPsuWatts(estimate, gpuW ?? 0, gpu?.gpuPsu ?? 0, !!psu?.atx), partial: !gpu || !cpu };
  }
  if (psu) {
    if (cpu || gpu) {
      if (!psu.watts || !power || !cpu)
        add('unknown', 'power-unknown', ['psu'], cpu ? 'Não deu para estimar o consumo da montagem.' : 'Escolha o processador para calcular a fonte necessária.');
      else if (psu.watts < power.estimate)
        add('error', 'psu-too-weak', ['psu'], `A fonte de ${psu.watts} W fica abaixo do consumo máximo estimado (${power.estimate} W).`);
      else if (psu.watts < power.recommended)
        add('warn', 'psu-tight', ['psu'], `A fonte de ${psu.watts} W fica no limite; o recomendado é a partir de ${power.recommended} W.`);
    }
    // Conector: pela ficha técnica quando a loja informa; senão, pelo consumo do chip (as placas de 285 W ou mais costumam usar).
    if (!psu.pcie5 && gpu?.gpu16Pin)
      add('info', 'gpu-connector', ['gpu', 'psu'], 'Esta placa de vídeo usa o conector 12V-2x6 e a fonte não tem: a ligação é pelo adaptador que vem com a placa (confira se acompanha).');
    else if (!psu.pcie5 && gpu?.gpu16Pin === undefined && gpuW !== undefined && gpuW >= 285)
      add('info', 'gpu-connector', ['gpu', 'psu'], 'Algumas versões desta placa de vídeo usam o conector 12V-2x6; sem ele na fonte, a ligação é pelo adaptador que costuma vir com a placa.');
  }

  // Peças que já estão funcionando juntas no PC da pessoa: um problema só entre elas não vale (ex. "pode precisar de BIOS").
  // A fonte é exceção: fonte fraca para o PC atual é justamente o que a pessoa precisa saber.
  const allDrivesCurrent = driveParts.length > 0 && driveParts.every((part) => part.current);
  const relevant = issues.filter((i) => i.parts.includes('psu') || !i.parts.every((p) => p === 'ssd' ? allDrivesCurrent : build[p]?.current));
  issues.length = 0;
  issues.push(...relevant);

  const status: Partial<Record<BuildSlot, PartStatus>> = {};
  for (const slot of BUILD_SLOTS) if (build[slot]) status[slot] = 'ok';
  for (const i of issues) for (const p of i.parts) if (status[p]) status[p] = worst(status[p]!, i.level);

  return { issues, status, power };
}
