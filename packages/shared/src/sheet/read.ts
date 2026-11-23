import { extractGpuModel } from '../gpu.ts';
import type { CategoryId } from '../types.ts';
import { SHEET_FIELDS, type SheetValues } from './fields.ts';
import { dec, firstInt, isNo, isYes, numberWith, pick, sheetDoc, thousands, type SheetDoc } from './text.ts';

/**
 * Leitor da ficha técnica: do texto da ficha (sheetText) tira os campos fixos da categoria
 * (fields.ts). Cada loja e cada fabricante escreve de um jeito; o leitor procura os rótulos de
 * sempre ("Soquete", "Socket", "CPU Socket"…) e, para alguns campos, o padrão no texto todo. O que
 * não achar fica de fora: nunca chuta.
 *
 * READER_VERSION: mudou o leitor ou os campos, sobe o número: o servidor relê as fichas guardadas.
 */
export const READER_VERSION = 8;

type Reader = (doc: SheetDoc) => SheetValues;

/** Junta só o que foi lido (sem undefined). */
function clean(values: Record<string, unknown>): SheetValues {
  const out: SheetValues = {};
  for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && !Number.isFinite(v))) out[k] = v as never;
  return out;
}

const inRange = (n: number | undefined, min: number, max: number) => (n !== undefined && n >= min && n <= max ? n : undefined);

/** Primeira ocorrência no texto todo. */
const textMatch = (doc: SheetDoc, re: RegExp) => doc.all.match(re);

// ---------- comuns ----------

/** "asus rog" -> "Asus Rog"; siglas curtas em maiúsculas ("amd" -> "AMD"). */
const titleCase = (s: string) => s.replace(/\b[a-z0-9][\w!-]*/g, (w) => (w.length <= 3 && /^[a-z]+$/.test(w) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)));

const brand = (doc: SheetDoc) =>
  pick(doc, [/^marcar?$/, /^fabricante$/, /^brand$/], (v) => {
    const s = v.split(/\||\s-\s|\s+modelo\b/)[0]!.trim();
    return s && s.length <= 40 ? titleCase(s) : undefined;
  });

const model = (doc: SheetDoc) =>
  pick(doc, [/^part ?number$|^p\/n$/, /^modelo( \/ part number| \/ codigo)?$/, /^model$/], (v) => {
    const s = v.split('|')[0]!.trim();
    return s && s.length <= 60 ? s.toUpperCase() : undefined;
  });

// ---------- soquete ----------

/** "LGA 1700", "FCLGA1700", "Socket AM4" -> "LGA1700", "AM4". */
function sockets(s: string): string[] {
  const out = new Set<string>();
  // LGA1718 é o nome físico do AM5.
  for (const m of s.matchAll(/\b(?:fc)?lga\s*-?\s*(\d{3,4})\b|\b(am[2345]\+?|tr4|strx4|str5|sp3|sp5)\b/g)) out.add(m[1] ? (m[1] === '1718' ? 'AM5' : `LGA${m[1]}`) : m[2]!.toUpperCase());
  return [...out];
}

/** Soquete pelo chipset da placa-mãe (o chipset é de uma plataforma só). */
function socketOfChipset(chipset: string | undefined): string | undefined {
  if (!chipset) return undefined;
  if (/^[abx](3|4|5)\d0$/.test(chipset.toLowerCase())) return 'AM4';
  if (/^[abx](6|8)\d0e?$/.test(chipset.toLowerCase())) return 'AM5';
  if (/^[hbzqw](6|7)\d0$/.test(chipset.toLowerCase())) return 'LGA1700';
  if (/^[hbz]8\d0$/.test(chipset.toLowerCase())) return 'LGA1851';
  if (/^[hbz](4|5)\d0$/.test(chipset.toLowerCase())) return 'LGA1200';
  if (/^[hbz]3\d0$/.test(chipset.toLowerCase())) return 'LGA1151';
  return undefined;
}
const socketOf = (s: string) => sockets(s)[0];

// ---------- CPU ----------

const ARCH = /\b(zen\s*\d\+?|raptor lake(?: refresh)?|alder lake|arrow lake|comet lake|rocket lake|coffee lake|kaby lake|meteor lake|lunar lake|skylake|vermeer|matisse|cezanne|renoir|raphael|granite ridge|phoenix|picasso)\b/;
const archName = (s: string) => {
  const m = s.match(ARCH);
  if (!m) return undefined;
  return m[1]!.replace(/zen\s*(\d)/, 'zen $1').replace(/\b\w/g, (c) => c.toUpperCase());
};

const cpu: Reader = (doc) => {
  // "até 4.6 GHz", e o número sozinho quando a unidade está no rótulo ("... (GHz): Up to 5.3").
  const ghz = (v: string) => inRange(numberWith(v, /ghz/) ?? (/^\s*(ate|up to)?\s*\d[.,]\d+\s*$/.test(v) ? dec(v.replace(/[^\d.,]/g, '')) : undefined), 0.8, 7);
  const base = pick(
    doc,
    [/frequencia base do performance|performance-core base|p-core base/, /^frequencia base|^base clock|^clock (base|basico)|frequencia baseada|^frequencia$|^frequencia de operacao|^velocidade (do )?clock|^clock$|^core clock|^velocidade base/, /frequencia base/],
    (v) => ghz(v.split(/\(|\bate\b/)[0]!),
  );
  const boost = pick(
    doc,
    [/^(frequencia )?(max(imo)?\.? )?turbo max|^max(\.|imo)? boost|boost clock|^clock de max boost|frequencia (max(ima)?\.? )?turbo|^max turbo frequency|turbo max/, /performance-core max turbo|p-core max turbo|turbo max\.? do performance/, /single core turbo|turbo boost|max turbo|core turbo/],
    (v, l) => (/efficient|e-core/.test(l) ? undefined : ghz(v)),
  ) ?? pick(doc, [/^frequencia base|^velocidade clock|^clock/], (v) => ghz(v.match(/(?:ate|turbo|\()\s*([\d.,]+\s*ghz)/)?.[1] ?? ''));
  const cores = pick(doc, [/^(total )?(numero de |n[o°º]\.? de )?(cpu )?(nucleos|cores)( de cpu)?$|^cpu cores$|^total cores$|^cores$|^numero de nucleos/, /nucleos|cores/], (v, l) =>
    /gpu|grafic|performance|efficient|cuda|p-core|e-core/.test(l) ? undefined : inRange(firstInt(v), 1, 128),
  );
  const threads = pick(doc, [/^(total )?(numero de |n[o°º]\.? de )?threads$/, /threads/], (v) => inRange(firstInt(v), 1, 256));
  const l3 =
    // "Esconderijo: Cache inteligente Intel de 20 MB" (tradução automática de "Cache"), "Cache Inteligente Intel (L3) [MB]".
    pick(doc, [/cache l3|l3 cache|\(l3\)|cache inteligente|^esconderijo/], (v) => inRange(numberWith(v, /mb/), 1, 1024)) ??
    // "Intel Smart Cache LLC: 30MB" (LLC = o último nível, o L3).
    pick(doc, [/smart cache( llc)?$|\bllc\b|^cache$|^cache \d+ ?mb/],(v, l) => inRange(numberWith(`${l} ${v}`.replace(/cache l2.*/, ''), /mb/), 1, 1024));
  const l2 = pick(doc, [/cache l2|l2 cache|total l2/], (v, l) => inRange(numberWith(/l2/.test(v) && !/l2/.test(l) ? v.split(/l2/).pop()! : v, /mb/), 0.5, 256));
  // "Voltagem / TDP: 125W"; "Processor Base Power(W): 125" (a unidade no rótulo).
  const tdp = pick(doc, [/^tdp|\btdp\b|default tdp|tdp padrao|processor base power|potencia (basica|base) do processador|^potencia termica/], (v, l) =>
    /max|turbo|pico/.test(l) ? undefined : inRange(numberWith(v, /w(?:atts?)?\b/) ?? (/\(w\)/.test(l) ? firstInt(v) : undefined), 5, 500),
  );
  // "Soquete: 1700": só o número de um soquete Intel.
  const socket =
    pick(doc, [/soquete|socket/], (v) => socketOf(v) ?? (/^\s*(1150|1151|1155|1200|1700|1851|2066)\s*$/.test(v) ? `LGA${v.trim()}` : undefined)) ??
    socketOf(textMatch(doc, /(?:soquete|socket)[^\n]{0,30}/)?.[0] ?? '');
  const architecture = pick(doc, [/arquitetura|codinome|architecture/], (v) => archName(v)) ?? archName(doc.all);
  // Vídeo integrado: o modelo ("Radeon Graphics", "UHD Graphics 770") ou "Não".
  const igpu =
    pick(doc, [/^modelo grafico|^modelo da placa de video|^nome da gpu/, /^graficos? (integrados?|do processador)|^graficos$|^video integrado|^grafico integrado|^recursos graficos/], (v) => {
      if (isNo(v) || /nao possui|sem video/.test(v)) return 'Não';
      const m = v.match(/(radeon[^|,;]*?graphics|radeon\s*\d{3}m|radeon\s+vega\s*\d*|(?:intel\s*)?(?:uhd|iris xe|hd)\s*graphics\s*\d*|graficos uhd intel\s*\d*|placa de video amd radeon|arc graphics)/);
      if (m)
        return titleCase(m[1]!.replace(/graficos uhd intel/, 'UHD Graphics').replace(/placa de video amd radeon/, 'Radeon Graphics'))
          .replace(/(\d)m\b/i, '$1M')
          .replace(/\bUhd\b/, 'UHD')
          .replace(/\bHd\b/, 'HD')
          .trim();
      // "Nome da GPU: Gráficos Intel" (Core Ultra).
      if (/^graficos intel$|^intel graphics$/.test(v.trim())) return 'Intel Graphics';
      return /^sim/.test(v) ? 'Sim' : undefined;
    }) ?? (/sem video integrado|nao acompanha video integrado|nao possui video|nao conta com video integrado|s\/video integrado|requer placa de video/.test(doc.all) ? 'Não' : undefined);
  // Tipos de memória: junta os rótulos de memória ("Velocidade de memória: DDR5: 4800MHz" / "DDR4: 3200MHz").
  const memPairs = doc.pairs.filter((p) => /tipos? de memoria|memory types?|^memoria$|tipo de memoria do sistema|velocidade (maxima )?(de |da )?memoria|^ddr[345]$/.test(p.label));
  const ramTypes = [...new Set(memPairs.flatMap((p) => [...`${p.label} ${p.value}`.matchAll(/ddr([345])/g)].map((m) => `DDR${m[1]}`)))];
  const ramType = ramTypes.length ? ramTypes.sort().join(', ') : undefined;
  return clean({ socket, architecture, cores, threads, baseGhz: base, boostGhz: boost && base && boost < base ? undefined : boost, l2Mb: l2, l3Mb: l3, tdpW: tdp, igpu, ramType });
};

// ---------- placa-mãe ----------

const CHIPSET = /\b(a320|a520|a620|b350|b450|b550|b650e?|b840|b850|x370|x470|x570|x670e?|x870e?|h310|h410|h470|h510|h610|h670|h810|b360|b365|b460|b560|b660|b760|b860|z370|z390|z490|z590|z690|z790|z890|q670|w680)\b/;
const formOf = (s: string) => {
  if (/\be-?atx\b/.test(s)) return 'E-ATX';
  if (/\bmicro[- ]?atx\b|\bm-?atx\b|\bmatx\b|\bu-?atx\b/.test(s)) return 'Micro-ATX';
  if (/\bmini[- ]?itx\b|\bitx\b/.test(s)) return 'Mini-ITX';
  if (/\batx\b/.test(s)) return 'ATX';
  return undefined;
};

const motherboard: Reader = (doc) => {
  const chipset =
    pick(doc, [/^chipset$/], (v) => v.match(CHIPSET)?.[1]?.toUpperCase()) ??
    doc.all.match(new RegExp(`chipset[^\\n]{0,30}?${CHIPSET.source}`))?.[1]?.toUpperCase() ??
    // Só no modelo ("PRO-A620AM-B-EVO", "B760M-K").
    pick(doc, [/^modelo$|^model$|part ?number/], (v) => v.match(new RegExp(`(?:^|[^a-z0-9])${CHIPSET.source.slice(2, -2)}(?!\\d)`))?.[1]?.toUpperCase());
  const socket = pick(doc, [/soquete|socket|^cpu|processador/], (v, l) => socketOf(`${l} ${v}`)) ?? socketOf(doc.all) ?? socketOfChipset(chipset);
  // Também "Configuração: M-ATX", "Informações do PCB: mATX", "Fator de forma Micro ATX: 24,4 cm x 20,1 cm" (no rótulo)
  // e a linha só com o formato ("M-ATX").
  const formFactor =
    pick(doc, [/formato|fator de forma|form factor|^tipo$|dimens|^configuracao$|pcb/], (v, l) => formOf(v) ?? (/fator de forma|form factor/.test(l) ? formOf(l) : undefined)) ??
    formOf(doc.all.match(/(fator de forma|formato)[^\n]{0,40}/)?.[0] ?? '') ??
    formOf(doc.lines.find((l) => /^(e-?atx|m-?atx|matx|micro[- ]?atx|mini[- ]?itx|atx)$/.test(l)) ?? '');
  const memText = [...doc.pairs.filter((p) => /memoria|memory|dimm/.test(`${p.section} ${p.label}`)).map((p) => `${p.label} ${p.value}`), doc.all].join('\n');
  const ramType = memText.match(/ddr([345])/)?.[0]?.toUpperCase();
  // Também "Possui 4 slots para memória DDR5", "quatro soquetes de memória", "4 DIMMs", "Slots DIMM: 2".
  const WORDS: Record<string, number> = { dois: 2, duas: 2, quatro: 4, oito: 8 };
  const slotsM =
    // (Não o 4 de "DDR4" com "Slots DIMM: 2" na linha de baixo.)
    memText.match(/(?<!ddr)(\d)[ \t]*(?:x|\*)?\s*(?:slots?|soquetes?|memorias?)\s*(?:(?:de )?memoria\s*)?(?:ddr\d\s*)?(?:u?dimm|ddr\d)/) ??
    memText.match(/(?<!ddr)(\d)\s*x?\s*(?:u?dimms?|ddr\d)\b/) ??
    memText.match(/slots? de memoria:?\s*(\d)/) ??
    memText.match(/(\d)\s*(?:slots?|soquetes?)\s*(?:para|de)\s*memoria/) ??
    memText.match(/slots? dimm:?\s*(\d)/) ??
    memText.match(/\b(dois|duas|quatro|oito)\s*(?:slots?|soquetes?)\s*(?:para |de )?memoria/);
  const ramSlots = inRange(slotsM ? (WORDS[slotsM[1]!] ?? Number(slotsM[1])) : undefined, 1, 8);
  // "máx. 64 GB", "Máx. capacidade de memória do sistema: 96 GB", "up to 192 GB", "Máximo suportado 96GB".
  // Também "Memória Máxima (GB): 64" (a unidade no rótulo).
  const maxM =
    memText.match(/(?:max\w*\.?|ate|up to|capacidade)[^\d\n]{0,45}?(\d{2,3})\s*gb/) ??
    memText.match(/(\d{2,3})\s*gb\s*(?:de memoria|max)/) ??
    memText.match(/max\w*[^\n\d]{0,20}\(gb\)\s*:?\s*(\d{2,3})\b/);
  const ramMaxGb = inRange(maxM ? Number(maxM[1]) : undefined, 16, 512);
  // "6.800 (OC) / OC+ MHz": o milhar com ponto.
  const mhz = [...memText.replace(/\b(\d)\.(\d{3})\b/g, '$1$2').matchAll(/(\d{4})\+?\s*(?:\(oc\)|mhz|mt\/s)/g)].map((m) => Number(m[1])).filter((n) => n >= 1600 && n <= 12000);
  const ramMaxMhz = mhz.length ? Math.max(...mhz) : undefined;
  // PCIe do slot x16 principal: a maior versão citada com x16.
  // Também "1x PCIEX16 4.0" e "PCI_E1 Gen PCIe 4.0 suporta até x16".
  const x16 = [
    ...doc.all.matchAll(
      /pci-?\s*e(?:xpress)?\s*(?:gen\s*)?(\d)(?:\.0)?(?:\s*\/\s*\d\.0)?\s*x\s*16|x16[^\n]{0,40}?pcie\s*(\d)\.0|pci-?e(?:xpress)?\s*x16[^\n]{0,50}?pcie\s*(\d)\.0|x16\s*gen\s*(\d)|pciex16\s*(\d)\.0|pcie\s*(\d)\.0[^\n]{0,40}x16|pci-?\s*e\w*\s*(?:x\s*)?x\s*16\s*\(?\s*(\d)\.0|gen\s*(\d)\s*x\s*16/g,
    ),
  ].map((m) => Number(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7] ?? m[8]));
  const pcieX16 = x16.length ? `${Math.max(...x16)}.0` : undefined;
  // M.2: total declarado ("2x M.2", "Suporta 2 slots M.2") ou os slots numerados (M.2_1, M2_2).
  // Também "1 x Tomada Ultra M.2", "1 x Soquete Ultra M.2" (não o "M.2_WIFI", que é da placa de rede).
  const m2Total = [...doc.all.matchAll(/(\d)\s*(?:x\s*)?(?:slots?\s*|soquetes?\s*|conectores?\s*|tomadas?\s*)?(?:ultra\s*)?m\.?2\b/g)].map((m) => Number(m[1]));
  const m2Named = new Set([...doc.all.matchAll(/\bm\.?2_([a-z\d])\b|\bm2[a-z]?_(?:cpu|sb|\d)/g)].map((m) => m[0]));
  const m2Slots = inRange(m2Total.length ? Math.max(...m2Total) : m2Named.size || (/\bm\.2\b/.test(doc.all) ? 1 : undefined), 1, 8);
  // Também "PCIe até Gen3 x4", "PCI Express até Gen3", "slot M.2 4.0", "1 slot M.2 PCIe 3.0".
  const m2v = [
    ...doc.all.matchAll(/m\.?2[^\n]{0,80}?pcie\s*(?:gen\s*)?(\d)(?:\.0)?\s*x\s*[24]|m\.?2[^\n]{0,80}?pci(?:-?e|\s*express)\s*(?:ate\s*)?gen\s*(\d)|\bm\.?2\s*(?:pcie\s*)?(\d)\.0\b|\bm\.?2\b[^\n]{0,15}?pcie\s*(\d)\.0/g),
  ].map((m) => Number(m[1] ?? m[2] ?? m[3] ?? m[4]));
  const m2Pcie = m2v.length ? `${Math.max(...m2v)}.0` : undefined;
  // "4x portas SATA", "2*SATA3", "2x slot SATA 6G".
  // Também "SATA 6Gb/s: 4", "Número de conectores SATA III: 4" e "4 interfaces de disco rígido SATA" (não "SATA: 6 Gb/s").
  const sataM = [
    ...doc.all.matchAll(/(\d)\s*[x*]?\s*(?:portas?|conectores?|slots?)?\s*sata|sata[^:\n]{0,25}:\s*(\d{1,2})\b(?!\s*(?:[.,]\d)?\s*gb?)|(\d)\s*interfaces?[^\n]{0,30}?sata/g),
  ].map((m) => Number(m[1] ?? m[2] ?? m[3]));
  const sataPorts = inRange(sataM.length ? Math.max(...sataM) : undefined, 0, 12);
  const lanM = doc.all.match(/(10|5|2[.,]5|1)\s*g(?:b|bps|be)?\b[^\n]{0,20}?(?:lan|ethernet)|(?:lan|ethernet|rede)[^\n]{0,50}?\b(10|5|2[.,]5|1)\s*g(?:b|bps|be)?\b/);
  // Pelo chip ("Intel I219V", "Realtek 8125") ou pela velocidade ("10/100/1000", "GbE").
  const lan = lanM
    ? `${(lanM[1] ?? lanM[2])!.replace(',', '.')} Gb`
    : /(?:rtl|realtek)\s*8125|\bi22[56]/.test(doc.all)
      ? '2.5 Gb'
      : /gigabit|giga lan|1000 ?mbps|1000 ?mbit|10\/100\/1000|(?:rtl|realtek)\s*8111|\bi21[019]|\bgbe\b/.test(doc.all)
        ? '1 Gb'
        : undefined;
  const wifiM = doc.all.match(/wi-?fi\s*(7|6e|6|5)\b/);
  const wifi = wifiM ? `Wi-Fi ${wifiM[1]!.toUpperCase()}` : undefined;
  const bt = doc.all.match(/bluetooth[^\d\n]{0,12}(\d\.\d)/)?.[1];
  return clean({ chipset, socket, formFactor, ramType, ramSlots, ramMaxGb, ramMaxMhz, pcieX16, m2Slots, m2Pcie, sataPorts, lan, wifi, bluetooth: bt });
};

// ---------- placa de vídeo ----------

const gpu: Reader = (doc) => {
  const chip =
    pick(doc, [/^gpu$|^chip|processador grafico|^chipset$|^gpu \/|^modelo da gpu|^graphics/], (v) => extractGpuModel(v)?.model) ??
    doc.lines.map((l) => extractGpuModel(l)?.model).find(Boolean);
  // Sem rótulo com dois-pontos ("- Memória de Vídeo 12GB GDDR6") ou só na frase ("RTX 5060 8GB GDDR7").
  const vramGb =
    pick(doc, [/memoria de video|tamanho (da|de) memoria|capacidade de memoria|^memoria$|memory size|^capacidade$|^vram/], (v) => inRange(numberWith(v, /gb\b/), 1, 48)) ??
    inRange(Number(doc.all.match(/memoria de video[^\n\d]{0,10}(\d{1,2})\s*gb/)?.[1] ?? doc.all.match(/\b(\d{1,2})\s*gb,?\s*(?:de\s*(?:memoria\s*)?)?g?ddr\d/)?.[1]), 1, 48);
  const memType =
    pick(doc, [/tipo (de |da )?memoria|memory type|tipo dram|memoria/], (v) => v.match(/g?ddr\d+x?/)?.[0]?.toUpperCase().replace(/^DDR/, 'GDDR')) ??
    (doc.all.match(/\bgddr\d+x?\b/)?.[0] ?? doc.all.match(/\d\s*gb,?\s*(ddr\d)\b/)?.[1])?.toUpperCase().replace(/^DDR/, 'GDDR');
  const busBits =
    pick(doc, [/interface (de|da) memoria|barramento de memoria|memory bus|memoria de interface|interface de memoria \(barramento\)|bus width|^interface$|^memoria$/], (v) => inRange(numberWith(v, /-?\s*bits?/), 32, 1024)) ??
    inRange(Number(doc.all.match(/(?:interface de memoria|barramento|bus)[^\n\d]{0,30}(\d{2,4})\s*-?\s*bits?\b/)?.[1] ?? doc.all.match(/\b(64|96|128|160|192|256|320|384|512)\s*-?\s*bits?\b/)?.[1]), 32, 1024);
  const mhzOf = (v: string, re: RegExp) => {
    const m = v.match(re);
    return inRange(m ? thousands(m[1]!) : undefined, 300, 4000);
  };
  // Também o número sozinho com a unidade no rótulo ("Boost Clock (MHz): 2595").
  const mhzIn = (v: string, l: string) => mhzOf(v, /(\d[\d.,]*)\s*mhz/) ?? (/mhz/.test(l) ? mhzOf(v, /^\s*(\d[\d.,]*)\s*$/) : undefined);
  const boostMhz =
    pick(doc, [/boost/], mhzIn) ??
    pick(doc, [/clock|velocidade do clock|frequencia/], (v) => mhzOf(v, /boost\s*:?\s*(?:ate\s*)?(\d[\d.,]*)\s*mhz/) ?? mhzOf(v, /(\d[\d.,]*)\s*mhz\s*\(?boost/)) ??
    pick(doc, [/^clock$|^clock do motor|core clock|velocidade do clock de gpu|clock do nucleo|clock grafico|gpu clock/], (v) => mhzOf(v, /(\d[\d.,]*)\s*mhz/)) ??
    mhzOf(doc.all, /(\d[\d.,]*)\s*mhz\s*\(?boost/) ??
    mhzOf(doc.all, /boost(?: clock)?\s*:?\s*(?:ate\s*)?(\d[\d.,]*)\s*mhz/);
  const baseMhz = pick(doc, [/clock|base/], (v, l) => (/base/.test(l) ? mhzIn(v, l) :mhzOf(v, /base\s*:?\s*(?:ate\s*)?(\d[\d.,]*)\s*mhz/)));
  // "Consumo de energia: 600W" em algumas fichas é a fonte recomendada: acima de 450 W não é a placa.
  const tdpW = pick(doc, [/^tdp|potencia (da placa|total|grafica|da placa grafica)|consumo (de energia|da placa|maximo)|total board power|tbp|power consumption|^consumo$/], (v) =>
    inRange(numberWith(v, /w(?:atts?)?\b/), 20, 450),
  );
  // Também "Minimum System Power Requirement (W): 550" (a unidade no rótulo).
  const psuW = pick(doc, [/psu recomendada|fonte (de alimentacao )?recomendada|recommended psu|^fonte|alimentacao recomendada|consumo de energia|power supply requirement|system power requirement/], (v, l) =>
    inRange(numberWith(v, /w(?:atts?)?\b/) ?? (/\(w\)/.test(l) ? firstInt(v) : undefined), 300, 1600),
  );
  // Comprimento: a maior medida das dimensões da placa (em cm, se a ficha usa cm).
  const lengthOf = (v: string) => {
    if (/caixa|embalagem|box/.test(v)) return undefined;
    // Em polegadas e cm na mesma frase: vale o cm.
    const part = /cent[ií]metros|\bcm\b/.test(v) && /polegada|"/.test(v) ? v.slice(v.search(/polegada/) + 1) : v;
    const cm = /\d\s*(?:cm|centimetros?)\b/.test(part) && !/\d\s*mm/.test(part);
    let nums = [...part.matchAll(/(\d{2,3}(?:[.,]\d+)?)/g)].map((m) => dec(m[1]!) * (cm ? 10 : 1)).filter((n) => n >= 100 && n <= 450);
    // Sem unidade e com números que só fazem sentido em cm ("Dimensão do cartão 35 x 14 x 6,7"): placa de 10 a 45 cm.
    if (!nums.length && !/\d\s*(?:mm|cm)\b/.test(part)) nums = [...part.matchAll(/(\d{2}(?:[.,]\d+)?)\s*x/g)].map((m) => dec(m[1]!) * 10).filter((n) => n >= 100 && n <= 450);
    return nums.length ? Math.round(Math.max(...nums)) : undefined;
  };
  const lengthMm =
    // Também "Board size: 331.9 x 150 x 70.4 mm".
    pick(doc, [/dimens|card size|board size|product size|tamanho d[aoe] (placa|cartao|produto)|^comprimento|^tamanho$|^length/], lengthOf) ??
    lengthOf(doc.lines.find((l) => /^dimens/.test(l) && /\d/.test(l)) ?? '');
  // Não o conector de energia ("1x PCIe 8-pin cable").
  const pcieM = doc.all.match(/pci[- ]?e(?:xpress)?\s*:?\s*(?:gen\s*)?(\d)(?!\s*-?\s*pin)(?:\.\d)?(?:\s*(?:x\s*(\d+)|(\d+)\s*x))?/);
  const lanes = doc.all.match(/uses?\s*x\s*(\d+)|\(x(\d+)\)/);
  const pcie = pcieM ? `${pcieM[1]}.0${lanes ? ` x${lanes[1] ?? lanes[2]}` : pcieM[2] || pcieM[3] ? ` x${pcieM[2] ?? pcieM[3]}` : ''}` : undefined;
  const power16Pin = /12v-?2x6|12vhpwr|16\s*-?\s*pin|12\s*\+\s*4\s*pin/.test(doc.all) ? true : /conector[^\n]{0,40}\b[68]\s*-?\s*pin|8 ?pin|\b[68]\s*pinos/.test(doc.all) ? false : undefined;
  // Também "Thermal Solution: 3 Fan".
  const fansM = doc.all.match(/(\d)\s*x?\s*(?:ventoinhas|ventiladores|fans?)\b|\b(dual|triple|tri|twin)[- ]?fan|(tres|duas) ventoinhas/);
  const fans = fansM ? (fansM[1] ? Number(fansM[1]) : /triple|tri|tres/.test(fansM[0]) ? 3 : 2) : undefined;
  return clean({ chip, vramGb, memType, busBits, baseMhz, boostMhz, tdpW, psuW, lengthMm, pcie, power16Pin, fans: inRange(fans, 1, 4) });
};

// ---------- memória ----------

const ram: Reader = (doc) => {
  // Sem rótulo: "- 32 GB (2 x 16 GB)".
  const capV =
    pick(doc, [/^capacidade|quantidade de memoria|tamanho do modulo|^tamanho$|^capacity|densidade/], (v) => (/\d\s*gb/.test(v) ? v : undefined)) ??
    doc.lines.find((l) => /^\d{1,3}\s*gb(\s*\(\d\s*x\s*\d{1,3}\s*gb\))?$/.test(l)) ??
    '';
  const kit = capV.match(/(\d)\s*x\s*(\d{1,3})\s*gb/);
  const total = numberWith(capV, /gb/);
  const capacityGb = inRange(kit && total === Number(kit[2]) ? Number(kit[1]) * Number(kit[2]) : total, 1, 512);
  const modules = kit ? Number(kit[1]) : capacityGb ? 1 : undefined;
  const type =
    pick(doc, [/^tipo|^padrao|^interface|tipo de memoria/], (v) => v.match(/\bddr([345])/)?.[0]?.toUpperCase()) ??
    pick(doc, [/padrao|velocidade|compatibilidade|classificacao/], (v) => (/pc5-/.test(v) ? 'DDR5' : /pc4-/.test(v) ? 'DDR4' : /pc3-/.test(v) ? 'DDR3' : undefined)) ??
    doc.all.match(/\bddr([345])\b/)?.[0]?.toUpperCase();
  const mhz =
    pick(doc, [/frequencia|velocidade|speed/], (v) => inRange(numberWith(v, /mhz|mt\/s/) ?? (/^\d{4}$/.test(v.trim()) ? Number(v) : undefined), 800, 12000)) ??
    inRange(Number(doc.all.match(/ddr\d-(\d{4})/)?.[1] ?? doc.lines.find((l) => /^\d{4}\s*(mhz|mt\/s)$/.test(l))?.match(/\d{4}/)?.[0]), 800, 12000);
  const cl =
    pick(doc, [/latencia|^cas|^cl\b|cl \(ddi\)/], (v) => inRange(Number(v.match(/c(?:l)?\s*(\d{2})\b/)?.[1] ?? v.match(/^(\d{2})\b/)?.[1]), 4, 60)) ??
    inRange(Number(doc.all.match(/\bcl\s*(\d{2})\b/)?.[1]), 4, 60);
  return clean({ capacityGb, modules, type, mhz, cl });
};

// ---------- SSD ----------

const ssd: Reader = (doc) => {
  const capacityGb = pick(doc, [/^capacidades?|^capacity/], (v) => {
    const tb = numberWith(v, /tb\b/);
    const gb = numberWith(v, /gb\b/);
    return inRange(tb ? Math.round(tb * 1000) : gb, 60, 16000);
  });
  const formOfSsd = (v: string) => {
    if (/m\.?2/.test(v)) return `M.2${v.match(/22(30|42|60|80|110)/) ? ` 22${v.match(/22(30|42|60|80|110)/)![1]}` : ''}`;
    if (/2[.,]5/.test(v)) return '2,5"';
    if (/msata/.test(v)) return 'mSATA';
    return undefined;
  };
  const formFactor = pick(doc, [/formato|fator de forma|form factor/], formOfSsd) ?? formOfSsd(doc.all.match(/(m\.2\s*22\d{2,3}|\b2[.,]5\s*(?:"|pol|''|´´))/)?.[0] ?? '');
  const ifaceOf = (v: string) => {
    const gen = v.match(/(?:pcie|pci-e|gen)\s*(?:gen\s*)?(\d)(?:\.0)?/);
    if (gen) return `NVMe PCIe ${gen[1]}.0`;
    // "Interface: PCIe" sem a versão.
    if (/pci-?\s*e|pcie/.test(v)) return 'NVMe PCIe';
    if (/nvme/.test(v)) return 'NVMe';
    if (/sata/.test(v)) return 'SATA';
    return undefined;
  };
  const iface = pick(doc, [/^interface|^padrao|^tipo/], ifaceOf) ?? ifaceOf(doc.all.match(/pcie\s*(?:gen\s*)?\d[^\n]{0,10}|nvme|sata/)?.[0] ?? '');
  const speed = (v: string) => inRange(numberWith(v, /mb/, { thousands: true }), 50, 20000);
  // "Leitura / gravação sequencial: 7300/7000MB/s".
  const both = pick(doc, [/leitura\s*\/\s*(gravacao|escrita)/], (v, l) => (/aleatori|4k/.test(l) ? undefined : v.match(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)\s*mb/)));
  const readMbs = (both ? speed(`${both[1]} mb`) : undefined) ?? pick(doc, [/leitura/, /read/], (v, l) => (/aleatori|4k|iops/.test(`${l} ${v}`) && !/mb/.test(v) ? undefined : speed(v)));
  const writeMbs = (both ? speed(`${both[2]} mb`) : undefined) ?? pick(doc, [/gravacao|escrita/, /write/], (v, l) => (/aleatori|4k/.test(l) && !/mb/.test(v) ? undefined : speed(v)));
  return clean({ capacityGb, formFactor, interface: iface, readMbs, writeMbs });
};

// ---------- fonte ----------

/** Conectores da fonte: soma as linhas de cada tipo ("2x PCIe 6+2", "PCI-e 6+2 pinos (GPU): 4", "3 x Cabos SATA (… Total: 12 conectores)"). */
function psuConnectors(doc: SheetDoc) {
  const counts = { eps: 0, pcie8: 0, pcie16: 0, sata: 0 };
  const seen = { eps: false, pcie8: false, pcie16: false, sata: false };
  // "Conectores: 1x 20+4 Pinos ATX, 2x 4+4 Pinos CPU, 2x Sata com 4 portas": um item por pedaço.
  const segments = doc.lines.flatMap((l) => (l.match(/\d\s*x\s*\S/g) ?? []).length >= 2 ? l.replace(/^[^:]{1,30}:\s*/, '').split(/,\s*(?=\d)/) : [l]);
  for (const raw of segments) {
    // O tipo pela linha inteira ("SATA: 6"); a contagem sem o rótulo.
    // O rótulo pode ter número ("Conector PCIe 6+2 Pinos: 4x", "Conector CPU 4+4 Pinos: 1x").
    const l = raw.replace(/^[^:\d]{1,40}:\s*(?=\d)/, '').replace(/^[^:]{1,50}:\s*(?=\d{1,2}\s*x?\s*$|\d{1,2}\s*x\b)/, '');
    const kind: keyof typeof counts | null = /12v-?2x6|12vhpwr|16\s*pin|\b12\s*\+\s*4|p16\b/.test(raw)
      ? 'pcie16'
      : /pci-?\s*e|pcie|\bgpu\b|\bvga\b/.test(raw)
        ? 'pcie8'
        : /\beps\b|\bcpu\b|\bcpu\s*\d|\bp8\b|\bp4\b|atx\s*12v\s*\(?4\s*\+\s*4|auxiliar|\b4\s*\+\s*4\b/.test(raw) && !/24|20\s*\+\s*4/.test(raw)
          ? 'eps'
          : /\bs-?ata\b/.test(raw) && !/hdd|ssd|disco/.test(raw)
            ? 'sata'
            : null;
    if (!kind) continue;
    // Adaptador ("PCI-E 16 pinos para PCI-E 8 pinos x 2"): não é conector da fonte.
    if (/\bpara\s+pci-?\s*e/.test(raw)) continue;
    const lead = l.match(/^(\d{1,2})\s*x\b/) ?? l.match(/^(\d{1,2})\s*x?\s+(?=[a-z])/) ?? l.match(/^(\d{1,2})\s*$/);
    // "PCIe 6+2 Pin x 8 : 650mm", "x4 = 2x (500+120mm)", "CPU (4+4Pin) x2 peças", "(4+4 pinos) - 2", "1pç".
    const tail =
      l.match(/\bx\s*(\d{1,2})\s*$/) ??
      l.match(/:\s*(\d{1,2})\s*$/) ??
      l.match(/\bx\s*(\d{1,2})\s*(?:[:=]|p[cç]s?\b|pe[cç]as?\b)/) ??
      l.match(/[-–]\s*(\d{1,2})\s*$/) ??
      l.match(/\b(\d{1,2})\s*p[cç]s?\b/);
    // "2 cabos 4 conectores", "3 cabos 9 conectores": o total de conectores ("2 cabos com 4 conectores" multiplica, abaixo).
    const conns = l.match(/\bcabos?\s+(\d{1,2})\s*conectores\b/);
    // "1x P4+4, 1x P8": vários itens do mesmo tipo na linha.
    const items = [...l.matchAll(/(\d{1,2})\s*x\s*(?=[a-z])/g)];
    let n = conns ? Number(conns[1]) : items.length >= 2 && kind === 'eps' ? items.reduce((s, m) => s + Number(m[1]), 0) : lead ? Number(lead[1]) : tail ? Number(tail[1]) : 0;
    if (!n) continue;
    const total = l.match(/total:?\s*(\d{1,2})/);
    // "9 x SATA (3 cabos com 3 conectores cada)": o 9 já são os conectores.
    const cablesInside = /\(\s*\d{1,2}\s*cabos?\b/.test(l);
    // "3 x Cabos SATA (com 4 conectores cada)": cabos vezes conectores; "6 x SATA (3 cabos com 3…)": já são os conectores.
    const per = l.match(/com\s*(\d)\s*(?:conectores?|portas?)\s*(?:cada|por cabo)?/);
    const cables = /^\d{1,2}\s*x?\s*cabos?\b/.test(l);
    const token = kind === 'sata' ? /\bs-?ata\b/g : kind === 'pcie8' ? /6\s*\+\s*2/g : null;
    const reps = token ? (l.match(token) ?? []).length : 1;
    // "4 SATA: 3x cabos (…)": 3 cabos de 4.
    const perLabel = raw.match(/^(\d)\s*s-?ata\s*:\s*(\d{1,2})\s*x?\s*cabos?\b/);
    if (perLabel) n = Number(perLabel[1]) * Number(perLabel[2]);
    else if (total) n = Number(total[1]);
    else if (conns || cablesInside) {
      /* já é o total */
    } else if (per && (cables || /\bcabo|com \d (conectores|portas)/.test(l))) n *= Number(per[1]);
    else if (reps > 1) n *= reps;
    counts[kind] += n;
    seen[kind] = true;
  }
  return {
    eps: seen.eps ? inRange(counts.eps, 1, 4) : undefined,
    pcie8: seen.pcie8 ? inRange(counts.pcie8, 0, 12) : undefined,
    pcie16: seen.pcie16 ? inRange(counts.pcie16, 0, 4) : undefined,
    sata: seen.sata ? inRange(counts.sata, 0, 20) : undefined,
  };
}

const psu: Reader = (doc) => {
  // Sem rótulo de potência: o primeiro "850W" do texto (o nome do produto abre a ficha), fora pico e trilhos.
  const watts =
    pick(doc, [/^potencia( nominal| total| watt| continua)?|capacidade de saida|^watts?$|potencia em watts/], (v) => inRange(numberWith(v, /w(?:atts)?\b/), 200, 2500)) ??
    inRange(Number(doc.lines.filter((l) => !/combinad|pico|peak|excursion|12v|5v|ventoinha|fan/.test(l)).join('\n').match(/\b(\d{3,4})\s*w(?:atts)?\b/)?.[1]), 200, 2500);
  const effOf = (v: string) => {
    // Também "Cybernetics" (grafia comum) e "Cybenetics Efficiency: Gold".
    // O nível pode vir depois de um "80 Plus" repetido ("Classificação 80 Plus: 80 Plus Gold"): o com nível primeiro.
    const m =
      v.match(/80\s*plus\s*(titanium|platinum|platina|gold|ouro|silver|prata|bronze|white|branco|standard)/) ??
      v.match(/80\s*plus\s*(titanium|platinum|platina|gold|ouro|silver|prata|bronze|white|branco|standard)?|cyber?netics\s*(?:efficiency\s*)?(diamond|titanium|platinum|gold|silver|bronze)/);
    if (!m) return undefined;
    const t = (m[1] ?? m[2] ?? 'white').replace('ouro', 'gold').replace('platina', 'platinum').replace('prata', 'silver').replace('branco', 'white').replace('standard', 'white');
    return `${m[2] ? 'Cybenetics' : '80 Plus'} ${t[0]!.toUpperCase()}${t.slice(1)}`;
  };
  // Com 80 Plus e Cybenetics na mesma ficha, vale o 80 Plus (o selo mais comum).
  const effs = doc.pairs.filter((p) => /certifica|eficiencia|80 ?plus|cyber?netics|selo/.test(p.label)).map((p) => effOf(`${p.label} ${p.value}`)).filter((x): x is string => !!x);
  const efficiency = effs.find((x) => x.startsWith('80 Plus')) ?? effs[0] ?? effOf(doc.all) ?? (/sem certifica|nao possui certifica/.test(doc.all) ? 'Sem certificação' : undefined);
  const modOf = (v: string) =>
    /semi[- ]?modular|^semi\b/.test(v) ? 'Semi' : /full[- ]?modular|100% modular|totalmente modular|completamente/.test(v) ? 'Total' : /nao modular|^nao$|non[- ]?modular/.test(v) ? 'Não' : /^sim/.test(v) ? 'Total' : undefined;
  // "Modular: Semi"; "Cabos/conectores full modular: …" (no rótulo).
  const modular = pick(doc, [/modular|^tipo$|^cabos$/], (v, l) => modOf(/modular/.test(l) && /^sim|^nao|^semi/.test(v) ? v : `${v}`) ?? (/modular/.test(l) ? modOf(l.replace(/^.*?\b(semi|full|totalmente|100%)/, '$1')) : undefined)) ?? modOf(doc.all.match(/(semi[- ]?modular|full[- ]?modular|100% modular|totalmente modular|nao modular)/)?.[0] ?? '');
  const stdOf = (v: string) => {
    if (/\bsfx[- ]?l\b/.test(v)) return 'SFX-L';
    if (/\bsfx\b/.test(v)) return 'SFX';
    const atx = v.match(/atx\s*(?:12v)?\s*(?:v|ver\.?|versao)?\s*(\d)[.,](\d+)/);
    if (atx) return `ATX ${atx[1]}.${atx[2]}`;
    if (/\batx\b/.test(v)) return 'ATX';
    return undefined;
  };
  // Prefere o que tem versão ("ATX 3.1") ao "ATX" sozinho de outro rótulo.
  const stds = doc.pairs.filter((p) => /^padrao|fator de forma|^formato|^tipo$|^versao|especificacao|compativel|atx12v/.test(p.label)).map((p) => stdOf(`${p.label} ${p.value}`)).filter((x): x is string => !!x);
  // Sem rótulo: a versão em qualquer lugar do texto; senão "ATX"/"SFX" solto ("Fonte Pcyes Atx 500w").
  const standard =
    stds.find((x) => x !== 'ATX') ?? stds[0] ?? stdOf(doc.all.match(/\b(sfx[- ]?l?|atx\s*(?:12v)?\s*(?:v|ver\.?)?\s*\d[.,]\d+)\b/)?.[0] ?? '') ?? stdOf(doc.all.match(/\b(sfx|atx)\b/)?.[0] ?? '');
  return clean({ watts, efficiency, modular, standard, ...psuConnectors(doc) });
};

// ---------- gabinete ----------

const caseReader: Reader = (doc) => {
  const formFactor = pick(doc, [/^tipo|formato|fator de forma|^modelo do gabinete|tamanho do gabinete|classe de tamanho/], (v) => {
    const m = v.match(/(full|mid|mini|micro)[- ]?tower|(meio|mini) torre|torre (media|grande)|\bsff\b|cubo|cube|desktop/);
    if (!m) return undefined;
    return m[1] ? `${m[1][0]!.toUpperCase()}${m[1].slice(1)} Tower` : /meio|media/.test(m[0]) ? 'Mid Tower' : /grande/.test(m[0]) ? 'Full Tower' : /mini/.test(m[0]) ? 'Mini Tower' : m[0].toUpperCase();
  }) ?? (() => {
    const m = doc.all.match(/\b(full|mid|mini|micro)[- ]?tower\b/);
    return m ? `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} Tower` : undefined;
  })();
  // Um formato por linha com sim/não ("Compatibilidade com placas-mãe mATX: Sim" / "… EATX: Não"): só os "sim".
  const yesNo = doc.pairs.filter((p) => /placas?[- ]mae\s+(e-?atx|atx|m-?atx|micro[- ]?atx|mini[- ]?itx|itx)$/.test(p.label) && /^(sim|nao)\b/.test(p.value));
  // Os formatos no valor ou no próprio rótulo ("Placas-mãe Micro-ATX / ITX: …"); a fonte ATX não conta.
  const mbText = (yesNo.length ? yesNo.filter((p) => isYes(p.value)).map((p) => p.label.replace(/^.*placas?[- ]mae\s+/, '')).join(' | ') : undefined) ?? (
    pick(doc, [/placas?[- ]mae|motherboard|compatibilidade (de|com) placa|suporte (a|de|para) placa|form factor/], (v, l) => {
      const t = `${l.replace(/^.*?(placas?[- ]mae|motherboard|placa|form factor)/, '')} | ${v.replace(/fonte[^|]*/g, '')}`;
      return /itx|atx/.test(t) ? t : undefined;
    }) ??
    doc.all.match(/[^\n]*\b(?:e-?atx|m-?atx|micro[- ]?atx|mini[- ]?itx|atx)\b[^\n]*/)?.[0] ??
    ''
  ).replace(/fonte[^|]*/, '');
  const mbFormats = [
    /\be-?atx\b/.test(mbText) && 'E-ATX',
    /(?<![-\w])atx\b/.test(mbText.replace(/\b(e|m|micro|mini)[- ]?atx\b/g, '')) && 'ATX',
    /\bm-?atx\b|\bmicro[- ]?atx\b|\bmatx\b/.test(mbText) && 'Micro-ATX',
    /\bmini[- ]?itx\b|\bitx\b/.test(mbText) && 'Mini-ITX',
  ].filter(Boolean) as string[];
  let inClearance = false;
  let maxGpuMm: number | undefined;
  let maxCoolerMm: number | undefined;
  let maxPsuNote = '';
  for (let i = 0; i < doc.lines.length; i++) {
    const l0 = doc.lines[i]!;
    const l = /^[^0-9]*:\s*$/.test(l0) && doc.lines[i + 1] ? `${l0} ${doc.lines[i + 1]}` : l0;
    if (/compatibilidade|maxim|clearance|folga|limite|liberac|espaco/.test(l0) && !/\d/.test(l0)) inClearance = true;
    else if (inClearance && !/\d\s*mm/.test(l0)) inClearance = false;
    const limit = inClearance || /max|ate\b|suport|compat|limite|liberac|liquidac|espaco|superior da|≤|<=/.test(l);
    // Medida em mm ou cm, com decimal ("163,5 mm", "31,5 cm").
    const mm = (m: RegExpMatchArray | null) => (m ? Math.round(dec(m[1]!) * (/cm/.test(m[2]!) ? 10 : 1)) : undefined);
    const g = l.match(/(?:gpu|vga|placas?\s+de\s+video|placas?\s+graficas?|graphics card)(?:(?!cooler|processador|cpu\b|radiador|fonte)[^0-9]){0,40}?(\d{2,3}(?:[.,]\d+)?)\s*(mm|cm)\b/);
    // "GPU: 350 mm" (o rótulo sozinho já é o limite).
    if (g && (limit || /comprimento/.test(l) || /^(gpu|vga|placa de video)\s*:/.test(l)) && !maxGpuMm) maxGpuMm = inRange(mm(g), 150, 600);
    const c = l.match(/(?:cooler|cpu|processador)[^0-9]{0,40}?(\d{2,3}(?:[.,]\d+)?)\s*(mm|cm)\b/);
    // "Tamanho máximo do cooler: 157 mm", "Suporte para cooler: até 157 mm" (sem "CPU"; não as ventoinhas "cooler traseiro").
    const cpuCooler = /cpu|processador|altura/.test(l) || (/(tamanho|altura) maxim\w* d[oe] cooler|suporte (para|a|de) cooler|cooler\s*:?\s*ate\b/.test(l) && !/traseir|frontal|superior|lateral|inferior|\d\s*x/.test(l));
    if (c && (limit || /altura/.test(l)) && cpuCooler && !/radiador|\bliquid[ao]s?\b|water|fan\b|ventoinha/.test(l) && !maxCoolerMm) maxCoolerMm = inRange(mm(c), 50, 200);
    if (/fonte|psu/.test(l)) maxPsuNote = l;
  }
  void maxPsuNote;
  // "478 x 230 x 493 mm (Gabinete) / 555 x 293 x 535 mm (Caixa)", "(C) 400 x (L) 200 x (A) 455 mm",
  // "415*280*377 mm": as três primeiras medidas antes da embalagem. Gabinete tem pelo menos 250 mm num lado.
  const dimsOf = (v: string): string | undefined => {
    const part = v.split(/\s\/\s|\(?(?:caixa|embalage[mn])/)[0]!;
    const n = String.raw`(?:\(?[a-z]\)\s*)?(\d{2,4}(?:[.,]\d+)?)\s*(?:mm|cm)?\s*(?:\(?[a-z]\))?`;
    const m = part.match(new RegExp(`${n}\\s*[x*]\\s*${n}\\s*[x*]\\s*${n}`));
    if (!m) return undefined;
    const k = /\d\s*cm\b/.test(part) && !/mm/.test(part) ? 10 : 1;
    const nums = [m[1], m[2], m[3]].map((x) => Math.round(dec(x!) * k));
    return Math.max(...nums) >= 250 && Math.min(...nums) >= 80 && Math.max(...nums) <= 900 ? nums.join(' x ') : undefined;
  };
  const notCase = /embalage[mn]|caixa|ventoinha|fan\b|radiador|tela|display|lcd/;
  const dimFromPairs =
    pick(doc, [/dimens|tamanho|medidas|\([clpa] x [clpa] x [clpa]\)/], (v, l) => (notCase.test(l) ? undefined : dimsOf(v))) ??
    doc.pairs.filter((p) => /^dimens|^medidas/.test(p.section) && !notCase.test(`${p.section} ${p.label}`)).map((p) => dimsOf(p.value)).find(Boolean);
  // Ficha numa linha só: "Dimensões 464 x 303 x 476 mm (DWH)", "dimensions (wxhxd) 220 x 460 x 375 (mm)", "Tamanho 350x270x350mm".
  const dimFromText = (() => {
    for (const m of doc.all.matchAll(/(?:dimens\w*|dimensions|tamanho(?: total)?|medidas)(?![^\n]{0,25}(?:embalage[mn]|caixa))[^\n\d]{0,30}([^\n]{0,60})/g)) {
      const d = dimsOf(m[1]!);
      if (d) return d;
    }
    return undefined;
  })();
  // Medidas separadas ("Dimensões:" / "Largura: 200 mm" / "Altura: 450 mm" / "Profundidade: 400 mm").
  // Na seção "Dimensões" ou logo depois do rótulo dela (até 5 pares).
  const dimAt = doc.pairs.findIndex((p) => (/^dimens/.test(p.label) || /^dimens/.test(p.section)) && !/ventoinha|fan/.test(p.section));
  const near = dimAt >= 0 ? doc.pairs.slice(dimAt, dimAt + 6) : [];
  const sep = ['altura', 'largura', 'profundidade|comprimento'].map((k) => {
    // "Altura", "Comprimento (Profundidade)".
    const p = near.find((x) => new RegExp(`^(${k})(\\s*\\(.*\\))?$`).test(x.label));
    const n = p ? numberWith(p.value, /mm|cm/) : undefined;
    return n ? Math.round(n * (/\d\s*cm/.test(p!.value) ? 10 : 1)) : undefined;
  });
  const dimensions = dimFromPairs ?? (sep.every((n) => n && n >= 100) ? sep.join(' x ') : undefined) ?? dimFromText;
  // Frente: mesh (entra ar), vidro ou fechada. Do painel frontal ou do material; no texto, só frases sobre a frente.
  // Rótulo da frente ou frase sobre a frente ("painel frontal em mesh"). Não pelo material: o vidro de
  // "Materiais: aço, vidro temperado" costuma ser só a lateral (um gabinete Airflow, de frente em malha, viraria "Vidro").
  const frontText =
    pick(doc, [/painel frontal|^frente|^frontal|estilo do painel/], (v) => (/mesh|malha|perfurad|vidro|glass|fechad|acrilico|solid|plastico|aco\b/.test(v) ? v : undefined)) ??
    doc.all.match(/(?:painel )?front(?:al)?[^\n]{0,30}(?:mesh|malha|perfurad|vidro)|(?:mesh|malha|vidro temperado)[^\n]{0,15}front/)?.[0] ??
    '';
  const front = /mesh|malha|perfurad/.test(frontText) ? 'Mesh' : /vidro|glass/.test(frontText) ? 'Vidro' : /fechad|acrilico|solid|plastico|aco\b/.test(frontText) ? 'Fechada' : undefined;
  // Ventoinhas que vêm instaladas: soma as linhas ("Top: 2 x 120 mm" / "Rear: 1 x 120 mm"); "Não possui" = 0.
  // Quantas ventoinhas num trecho: "3 x 120 mm", "120 mm PWM ARGB x3", "1x ventoinha de 120 mm", "1 Fan Traseiro".
  // Uma posição por trecho; das alternativas ("3 x 120 mm / 2 x 140 mm", "ou") vale a primeira, e a
  // quantidade entre parênteses ("3x Fans 120mm (3x pré-instalados)") vale mais que a suportada.
  const fanCount = (v: string): number => {
    let n = 0;
    for (const seg0 of v.split(/\s\|\s|;/)) {
      const marked = seg0.match(/\(\s*(\d{1,2})\s*x?\s*[^)]{0,40}?(?:pre-?instalad|inclus|incluid)/) ?? seg0.match(/\((?:inclus|incluid|pre-?instalad)\w*\s*(\d{1,2})\b/);
      if (marked) {
        n += Number(marked[1]);
        continue;
      }
      const seg = seg0.split(/\bou\b|\s\/\s/)[0]!;
      const lead = [...seg.matchAll(/\b(\d{1,2})\s*x\s*(?=\d{2,3}\s*(?:mm|cm|mil)?)/g)].reduce((s, m) => s + Number(m[1]), 0);
      const tail = seg.match(/\d{2,3}\s*(?:mm|cm)[^|]*?\bx\s*(\d)\b(?!\s*(?:\d|mm|cm))/);
      const named = seg.match(/\b(\d{1,2})\s*x?\s*(?:ventoinhas?|fans?|coolers?|ventiladores?)\b/) ?? seg.match(/\b(\d{1,2})\s*x\s+[a-z]/);
      n += lead || (tail ? Number(tail[1]) : named ? Number(named[1]) : 0);
    }
    return n;
  };
  const INCLUDED = /ventoinhas? (inclusas?|incluidas?|instaladas?|pre-instaladas?)|fans? (inclusos?|inclusas?|incluidos?|instalados?|pre-instalados?)|ventiladores? (pre-)?instalados?|coolers? inclusos?|ventilacao inclusa|pre-installed/;
  const POSITION = /^(painel |montagem |parte )?(frente|frontal|front|traseir[ao]|rear|superior|topo|top|teto|base|inferior|bottom|fundo|lateral|side|psu|cobertura|parte)\b/;
  const countIncluded = (v: string) => (isNo(v) || /nao possui|nao acompanha|sem /.test(v) ? 0 : inRange(fanCount(v) || firstInt(v), 0, 12));
  // "Ventoinhas inclusas: Frente: 2 x 120 mm" e as outras posições nas linhas seguintes ("Traseira: 1 x 140 mm").
  const includedBlock = (() => {
    const i = doc.lines.findIndex((l) => /:/.test(l) && INCLUDED.test(l.split(':')[0]!));
    if (i < 0) return undefined;
    const first = doc.lines[i]!.replace(/^[^:]*:\s*/, '');
    // O total já no rótulo ("Ventoinhas inclusas: 3x Fans ARGB") vale; as linhas seguintes só detalham onde.
    if (first && !POSITION.test(first) && fanCount(first) > 0) return first;
    const parts = [first];
    for (let j = i + 1; j < doc.lines.length && POSITION.test(doc.lines[j]!); j++) parts.push(doc.lines[j]!);
    return parts.filter(Boolean).join(' | ') || undefined;
  })();
  // Linhas que dizem "incluso"/"pré-instalado": as de posição ("Cooler traseiro: 1 x 120mm (INCLUSO)") somam;
  // as outras repetem a mesma informação em lugares diferentes da página, então vale a maior.
  const includedLines = (() => {
    const seen = new Set<string>();
    let sum = 0;
    let max = 0;
    for (const l of doc.lines) {
      if (!/inclus|incluid|pre-?instalad/.test(l) || /nao (inclu|acompanha)|opcional|parafuso|cabo|suporte (vesa|ajustavel)/.test(l)) continue;
      const key = l.slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      const n = fanCount(l);
      // Também atrás de um rótulo ("Refrigeração: Frontal: 120 mm x 3 (Incluso 3x …)").
      if (/^(?:[^:\d]{1,25}:\s*)?(?:\w+\s){0,2}?(painel |cooler |coolers |fans? |ventoinhas? )?(frente|frontal|frontais|traseir[ao]|superior|topo|top|base|inferior|lateral)/.test(l)) sum += n;
      else max = Math.max(max, n);
    }
    return sum || max || undefined;
  })();
  const fansIncluded =
    (includedBlock !== undefined ? countIncluded(includedBlock) : undefined) ??
    pick(doc, [INCLUDED], countIncluded) ??
    inRange(includedLines, 1, 12) ??
    // Item do conteúdo da embalagem, numa linha só: "4 x Ventoinhas".
    inRange(Number(doc.lines.map((l) => l.match(/^(\d{1,2})\s*x\s*(?:ventoinhas?|fans?|ventiladores?)(?:\s+[a-z]+){0,3}$/)?.[1]).find(Boolean)), 1, 12) ??
    // "Fans não inclusos", "Acompanha cooler: não" (antes das frases soltas: "suporte para 6 fans (fans não inclusos)").
    (/(nao acompanha|sem) (fans|ventoinhas|coolers)|nao possui (fans|ventoinhas)|(fans|ventoinhas)[^\n]{0,20}nao (inclu|acompanha)|acompanha (cooler|fan|ventoinha)s?\s*:?\s*nao/.test(doc.all) ? 0 : undefined) ??
    // "Inclui 3 ventoinhas … pré-instaladas", "(com 3 fans ARGB)", "3 coolers inclusos".
    inRange(Number(doc.all.match(/inclui\s*(\d{1,2})\s*(?:ventoinhas|fans|coolers)|(\d{1,2})\s*(?:ventoinhas|fans|coolers)[^\n]{0,30}(?:pre-?instalad|(?<!nao )inclus)|\bcom\s*(\d{1,2})\s*(?:fans|ventoinhas)\b/)?.slice(1).find(Boolean)), 1, 12);
  const fansMaxList = doc.lines.filter((l) => /suporte (a|de|para) (ventoinhas?|fans?|coolers?)|ventoinhas? suportadas?|fans? suportados?|max(imo)? de ventoinhas/.test(l));
  const fansMax = inRange(fansMaxList.map((l) => [...l.matchAll(/(\d+)\s*x/g)].reduce((s, m) => s + Number(m[1]), 0)).find((n) => n > 0), 1, 20);
  const radiators = new Set<number>();
  let inRad = false;
  for (const l of doc.lines) {
    const item = /^(?:\d\s*x\s*)?\d{3}\s*mm$/.test(l);
    if (/refrigeracao\s+liquida|radiador|water\s*cooler|watercooler/.test(l)) inRad = true;
    else if (inRad && !item && !/^(topo|top|superior|frontal|frente|front|traseira|traseiro|rear|lateral|side|inferior|bottom|fundo|lado|parte)\b/.test(l)) inRad = false;
    if (!inRad) continue;
    // "Water Cooler - Topo (mm): 240": a unidade no rótulo.
    const re = /\(mm\)/.test(l) ? /\b(\d{3}(?:\s*\/\s*\d{3})*)\b/g : /\b(\d{3}(?:\s*\/\s*\d{3})*)\s*mm/g;
    // Texto corrido: sem as medidas de placa de vídeo e de cooler da mesma frase ("… radiadores de até 360mm … uma GPU de 420mm").
    const text = l.length > 120 ? l.replace(/(?:gpu|vga|placas? de video|cooler (?:de )?(?:cpu|processador))[^0-9|]{0,25}\d{3}\s*mm/g, '') : l;
    for (const m of text.matchAll(re)) for (const n of m[1]!.split('/').map(Number)) if ([120, 140, 240, 280, 360, 420].includes(n)) radiators.add(n);
  }
  return clean({
    formFactor,
    mbFormats: mbFormats.length ? mbFormats.join(',') : undefined,
    maxGpuMm,
    maxCoolerMm,
    dimensions,
    front,
    fansIncluded,
    fansMax,
    radiators: radiators.size ? [...radiators].sort((a, b) => a - b).join(',') : undefined,
  });
};

// ---------- cooler ----------

const cooler: Reader = (doc) => {
  const water = /radiador|\bbomba\b|\bpump\b|water\s*cooler|watercooler|refrigeracao liquida|\btubo\b(?! de calor)|^bloco\b/m.test(doc.all);
  const type = water ? 'water' : /dissipador|heatpipe|tubo de calor|air ?cooler|ventoinha|\bfan\b/.test(doc.all) ? 'ar' : undefined;
  let heightMm: number | undefined;
  if (!water) {
    heightMm = pick(doc, [/^altura/, /dimens|tamanho do dissipador|tamanho do cooler/], (v, l) => {
      if (/ventoinha|fan|embalagem|caixa/.test(l)) return undefined;
      if (/altura/.test(l)) return inRange(numberWith(v, /mm/), 20, 200);
      const marked = v.match(/(\d{2,3}(?:[.,]\d+)?)\s*(?:mm\s*)?\(\s*a\s*\)/);
      if (marked) return inRange(Math.round(dec(marked[1]!)), 20, 200);
      if (!/mm/.test(v)) return undefined;
      const nums = [...v.split(/\||ventoinha|fan/)[0]!.matchAll(/(\d{2,3}(?:[.,]\d+)?)/g)].map((m) => Math.round(dec(m[1]!)));
      if (nums.length < 3) return undefined;
      const ordered = /\(\s*[clp]\s*x\s*[lp]\s*x\s*a\s*\)/.test(l + v) ? nums[2] : Math.max(...nums.slice(0, 3)) >= 130 ? Math.max(...nums.slice(0, 3)) : nums[2];
      return inRange(ordered, 20, 200);
    });
    // Ficha numa linha só: "Dimensões do produto 120 x 73,8 x 154,5 mm Dimensões do ventilador …".
    if (!heightMm) {
      const m = doc.all.match(/dimens\w* do (?:produto|dissipador|cooler)\s*:?\s*([\d.,]+)\s*x\s*([\d.,]+)\s*x\s*([\d.,]+)\s*mm/);
      if (m) {
        const nums = [m[1], m[2], m[3]].map((x) => Math.round(dec(x!)));
        heightMm = inRange(Math.max(...nums) >= 130 ? Math.max(...nums) : nums[2], 20, 200);
      }
    }
  }
  // Radiador: o tamanho ("Radiador de 360mm", "Tamanho do radiador: 240 mm") ou, pelas medidas
  // ("402 x 120 x 27 mm"), quantas ventoinhas de 120/140 cabem no comprimento.
  let radiatorMm: number | undefined;
  if (water) {
    const named = doc.all.match(/radiador[^\n\d]{0,30}(120|140|240|280|360|420)\s*m/) ?? doc.all.match(/\b(120|140|240|280|360|420)\s*mm\b(?!\s*x)/);
    // "396 x 120 x 27", "277.5mm x 119.2mm x 27mm", "(C) 277 x (L) 119,6 x (A) 27 mm", "143 x 315 x 30 mm".
    const DIMS = /(\d{2,3})(?:[.,]\d+)?\s*(?:mm)?\s*(?:\([a-z]\))?\s*[x*]\s*(?:\([a-z]\)\s*)?(\d{2,3})(?:[.,]\d+)?/;
    // Comprimento e largura, em qualquer ordem: a maior medida e a seguinte.
    const lenWid = (v: string): [number, number] | undefined => {
      const m = v.match(DIMS);
      if (!m) return undefined;
      const [a, b] = [Number(m[1]), Number(m[2])];
      return a >= b ? [a, b] : [b, a];
    };
    // Formato de radiador: comprido, largo como uma ventoinha (115-145). Sem a palavra "radiador", 150+ (não um de 120).
    const radShaped = (v: string, minLen = 150) => {
      const lw = lenWid(v);
      return !!lw && lw[0] >= minLen && lw[1] >= 115 && lw[1] <= 145;
    };
    // As medidas do radiador: no rótulo ou na seção dele, ou as primeiras medidas logo depois de ele aparecer,
    // ou, sem a palavra, as únicas medidas com formato de radiador ("Dimensões (mm): 396 x 120 x 27").
    // Não as medidas "incluindo ventilador" (a espessura muda, e a largura pode ser a da ventoinha de 140).
    const notRad = /bomba|bloco|ventoinha|ventilador|fan\b|tubo|tela/;
    const radAt = doc.pairs.findIndex((p) => /radiador/.test(`${p.section} ${p.label} ${p.value}`));
    const dimLine =
      doc.pairs.find((p) => /radiador/.test(`${p.section} ${p.label}`) && !notRad.test(p.label) && /dimens|tamanho|medidas/.test(p.label + p.value) && radShaped(p.value, 115)) ??
      (radAt >= 0 ? doc.pairs.slice(radAt, radAt + 4).find((p) => /dimens|tamanho|medidas/.test(p.label) && !notRad.test(p.label) && radShaped(p.value)) : undefined) ??
      doc.pairs.find((p) => /dimens|tamanho|medidas/.test(p.label) && !notRad.test(`${p.section} ${p.label}`) && radShaped(p.value));
    // Só o comprimento: "Dimensões do radiador: Comprimento: 275 mm" (ventoinha de 120).
    const lenOnly = doc.pairs.find((p) => /radiador/.test(`${p.section} ${p.label}`) && /comprimento/.test(`${p.label} ${p.value}`) && !notRad.test(p.label));
    const len1 = lenOnly ? inRange(numberWith(lenOnly.value, /mm/), 150, 500) : undefined;
    // "Radiador: Comprimento: 397*120*27mm": as medidas inteiras no lugar do comprimento.
    const lw = (dimLine && lenWid(dimLine.value)) ?? (lenOnly && radShaped(lenOnly.value, 115) ? lenWid(lenOnly.value) : undefined) ?? (len1 ? ([len1, 120] as [number, number]) : undefined);
    if (lw) {
      const [len, wid] = lw;
      const fan = wid >= 135 ? 140 : 120;
      const n = Math.round((len - 30) / fan);
      if (n >= 1 && n <= 3) radiatorMm = n * fan;
    }
    if (!radiatorMm && named) radiatorMm = Number(named[1]);
  }
  const tdpW = pick(doc, [/^tdp|tdp suportado|tdp maximo|capacidade (termica|de dissipacao)|dissipacao/], (v) => inRange(numberWith(v, /w\b/), 50, 500));
  // O maior valor em dB ("17 ~ 32 dBA"); com o "dB" só no rótulo ("Nível de ruído (dB(A)): 28" ou
  // "@ 25% / 50% / 100%:" / "17,3 / 29,4 / 36,9"), os números do valor.
  const noiseIn = (v: string, unitInLabel = false) => {
    const all = [...v.matchAll(/(\d{1,2}(?:[.,]\d+)?)\s*(?:~|-|a)?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*)?db/g)].map((m) => dec(m[2] ?? m[1]!));
    if (!all.length && unitInLabel) all.push(...[...v.matchAll(/(?<![\d.,])(\d{1,2}(?:[.,]\d+)?)(?![\d.,]|\s*(?:%|rpm|mm|v\b|w\b|a\b))/g)].map((m) => dec(m[1]!)));
    return inRange(all.length ? Math.max(...all) : undefined, 5, 70);
  };
  const noiseDba =
    pick(doc, [/ruido|noise|nivel de som|acustic/], (v, l) => noiseIn(v, /db/.test(l))) ??
    // Sem dois-pontos: "Nível de ruído 36.9 dBA ± 10%".
    noiseIn(doc.lines.filter((l) => /ruido|noise/.test(l) && !/:/.test(l)).join(' | '));
  const sockText = doc.pairs.filter((p) => /soquete|socket|compatib|plataforma|suporte|intel|amd/.test(p.label)).map((p) => `${p.label}: ${p.value}`).join(' \n ') || doc.all;
  // "LGA 1700/1851", "Intel: 1851 / 1700 / 1200": cada número de soquete Intel vira LGA.
  const expanded = sockText
    .replace(/lga\s*\d{3,4}(?:\s*[/,]\s*(?:lga\s*)?\d{3,4})+/g, (m) => m.replace(/lga\s*/g, '').split(/[/,]/).map((x) => `lga${x.trim()}`).join(' '))
    .replace(/intel\W{0,6}((?:\d{3,4}\s*(?:[/,]|e\b)?\s*)+)/g, (_m, nums: string) => nums.split(/[/,]|\be\b/).map((x) => (/^(775|115\d|1200|1366|1700|1851|2011|2066)$/.test(x.trim()) ? `lga${x.trim()}` : '')).join(' '));
  const s = sockets(expanded);
  const fansM = doc.all.match(/(\d)\s*x\s*(?:ventoinhas?|fans?|ventiladores?)\b/) ?? doc.all.match(/(?:ventoinhas?|fans?)[^\n\d]{0,15}(\d)\b(?!\d|\s*mm)/);
  return clean({ type, heightMm, radiatorMm, tdpW, noiseDba, sockets: s.length ? s.join(',') : undefined, fans: inRange(fansM ? Number(fansM[1]) : undefined, 1, 6) });
};

const READERS: Record<CategoryId, Reader> = { cpu, motherboard, gpu, ram, ssd, psu, case: caseReader, cooler };

/** Lê os campos da ficha (texto de sheetText). Só o que está na lista da categoria. */
export function readSheet(category: CategoryId, text: string): SheetValues {
  const doc = sheetDoc(text);
  const values = { brand: brand(doc), model: model(doc), ...READERS[category](doc) };
  const keys = new Set(['brand', 'model', ...SHEET_FIELDS[category].map((f) => f.key)]);
  return clean(Object.fromEntries(Object.entries(values).filter(([k]) => keys.has(k))));
}
