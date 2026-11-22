import { extractGpuModel } from '../gpu.ts';
import type { CategoryId } from '../types.ts';
import { SHEET_FIELDS, type SheetValues } from './fields.ts';
import { dec, firstInt, isNo, numberWith, pick, sheetDoc, thousands, type SheetDoc } from './text.ts';

/**
 * Leitor da ficha técnica: do texto da ficha (sheetText) tira os campos fixos da categoria
 * (fields.ts). Cada loja e cada fabricante escreve de um jeito; o leitor procura os rótulos de
 * sempre ("Soquete", "Socket", "CPU Socket"…) e, para alguns campos, o padrão no texto todo. O que
 * não achar fica de fora: nunca chuta.
 *
 * READER_VERSION: mudou o leitor ou os campos, sobe o número: o servidor relê as fichas guardadas.
 */
export const READER_VERSION = 1;

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
  const ghz = (v: string) => inRange(numberWith(v, /ghz/) ?? (/^\s*(ate\s*)?\d[.,]\d+\s*$/.test(v) ? dec(v.replace(/[^\d.,]/g, '')) : undefined), 0.8, 7);
  const base = pick(
    doc,
    [/frequencia base do performance|performance-core base/, /^frequencia base|^base clock|^clock (base|basico)|frequencia baseada|^frequencia$|^velocidade (do )?clock|^clock$|^core clock|^velocidade base/, /frequencia base/],
    (v) => ghz(v.split(/\(|\bate\b/)[0]!),
  );
  const boost = pick(
    doc,
    [/^(frequencia )?(max(imo)?\.? )?turbo max|^max(\.|imo)? boost|boost clock|^clock de max boost|frequencia (max(ima)?\.? )?turbo|^max turbo frequency|turbo max/, /performance-core max turbo|turbo max\.? do performance/, /single core turbo|turbo boost/],
    (v, l) => (/efficient/.test(l) ? undefined : ghz(v)),
  ) ?? pick(doc, [/^frequencia base|^velocidade clock|^clock/], (v) => ghz(v.match(/(?:ate|turbo|\()\s*([\d.,]+\s*ghz)/)?.[1] ?? ''));
  const cores = pick(doc, [/^(total )?(numero de |n[o°º]\.? de )?(cpu )?(nucleos|cores)( de cpu)?$|^cpu cores$|^total cores$|^cores$|^numero de nucleos/, /nucleos|cores/], (v, l) =>
    /gpu|grafic|performance|efficient|cuda|p-core|e-core/.test(l) ? undefined : inRange(firstInt(v), 1, 128),
  );
  const threads = pick(doc, [/^(total )?(numero de |n[o°º]\.? de )?threads$/, /threads/], (v) => inRange(firstInt(v), 1, 256));
  const l3 =
    pick(doc, [/cache l3|l3 cache/], (v) => inRange(numberWith(v, /mb/), 1, 1024)) ??
    pick(doc, [/smart cache$|^cache$|^cache \d+ ?mb/], (v, l) => inRange(numberWith(`${l} ${v}`.replace(/cache l2.*/, ''), /mb/), 1, 1024));
  const l2 = pick(doc, [/cache l2|l2 cache|total l2/], (v, l) => inRange(numberWith(/l2/.test(v) && !/l2/.test(l) ? v.split(/l2/).pop()! : v, /mb/), 0.5, 256));
  const tdp = pick(doc, [/^tdp|default tdp|tdp padrao|processor base power|potencia (basica|base) do processador|^potencia termica/], (v) => inRange(numberWith(v, /w(?:atts?)?\b/), 5, 500));
  const socket = pick(doc, [/soquete|socket/], (v) => socketOf(v)) ?? socketOf(textMatch(doc, /(?:soquete|socket)[^\n]{0,30}/)?.[0] ?? '');
  const architecture = pick(doc, [/arquitetura|codinome|architecture/], (v) => archName(v)) ?? archName(doc.all);
  // Vídeo integrado: o modelo ("Radeon Graphics", "UHD Graphics 770") ou "Não".
  const igpu =
    pick(doc, [/^modelo grafico|^modelo da placa de video/, /^graficos? (integrados?|do processador)|^graficos$|^video integrado|^grafico integrado|^recursos graficos/], (v) => {
      if (isNo(v) || /nao possui|sem video/.test(v)) return 'Não';
      const m = v.match(/(radeon[^|,;]*?graphics|radeon\s*\d{3}m|radeon\s+vega\s*\d*|(?:intel\s*)?(?:uhd|iris xe|hd)\s*graphics\s*\d*|graficos uhd intel\s*\d*|placa de video amd radeon|arc graphics)/);
      if (m)
        return titleCase(m[1]!.replace(/graficos uhd intel/, 'UHD Graphics').replace(/placa de video amd radeon/, 'Radeon Graphics'))
          .replace(/(\d)m\b/i, '$1M')
          .replace(/\bUhd\b/, 'UHD')
          .replace(/\bHd\b/, 'HD')
          .trim();
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
    pick(doc, [/^chipset$/], (v) => v.match(CHIPSET)?.[1]?.toUpperCase()) ?? doc.all.match(new RegExp(`chipset[^\\n]{0,30}?${CHIPSET.source}`))?.[1]?.toUpperCase();
  const socket = pick(doc, [/soquete|socket|^cpu|processador/], (v, l) => socketOf(`${l} ${v}`)) ?? socketOf(doc.all) ?? socketOfChipset(chipset);
  const formFactor = pick(doc, [/formato|fator de forma|form factor|^tipo$|dimens/], (v) => formOf(v)) ?? formOf(doc.all.match(/(fator de forma|formato)[^\n]{0,40}/)?.[0] ?? '');
  const memText = [...doc.pairs.filter((p) => /memoria|memory|dimm/.test(`${p.section} ${p.label}`)).map((p) => `${p.label} ${p.value}`), doc.all].join('\n');
  const ramType = memText.match(/ddr([345])/)?.[0]?.toUpperCase();
  const slotsM =
    memText.match(/(\d)\s*(?:x|\*)?\s*(?:slots?|soquetes?|memorias?)\s*(?:de memoria\s*)?(?:ddr\d\s*)?(?:u?dimm|ddr\d)/) ??
    memText.match(/(\d)\s*x?\s*(?:u?dimm|ddr\d)\b/) ??
    memText.match(/slots? de memoria:?\s*(\d)/);
  const ramSlots = inRange(slotsM ? Number(slotsM[1]) : undefined, 1, 8);
  const maxM = memText.match(/(?:max(?:imo|ima)?\.?|ate|capacidade maxima[^\d]{0,30}?)\s*(\d{2,3})\s*gb/) ?? memText.match(/(\d{2,3})\s*gb\s*(?:de memoria|max)/);
  const ramMaxGb = inRange(maxM ? Number(maxM[1]) : undefined, 16, 512);
  const mhz = [...memText.matchAll(/(\d{4})\+?\s*(?:\(oc\)|mhz|mt\/s)/g)].map((m) => Number(m[1])).filter((n) => n >= 1600 && n <= 12000);
  const ramMaxMhz = mhz.length ? Math.max(...mhz) : undefined;
  // PCIe do slot x16 principal: a maior versão citada com x16.
  const x16 = [...doc.all.matchAll(/pci-?\s*e(?:xpress)?\s*(?:gen\s*)?(\d)(?:\.0)?(?:\s*\/\s*\d\.0)?\s*x\s*16|x16[^\n]{0,40}?pcie\s*(\d)\.0|pci-?e(?:xpress)?\s*x16[^\n]{0,50}?pcie\s*(\d)\.0|x16\s*gen\s*(\d)/g)].map(
    (m) => Number(m[1] ?? m[2] ?? m[3] ?? m[4]),
  );
  const pcieX16 = x16.length ? `${Math.max(...x16)}.0` : undefined;
  // M.2: total declarado ("2x M.2", "Suporta 2 slots M.2") ou os slots numerados (M.2_1, M2_2).
  const m2Total = [...doc.all.matchAll(/(\d)\s*(?:x\s*)?(?:slots?\s*|soquetes?\s*|conectores?\s*)?m\.?2\b/g)].map((m) => Number(m[1]));
  const m2Named = new Set([...doc.all.matchAll(/\bm\.?2_(\d)|\bm2[a-z]?_(?:cpu|sb|\d)/g)].map((m) => m[0]));
  const m2Slots = inRange(m2Total.length ? Math.max(...m2Total) : m2Named.size || (/\bm\.2\b/.test(doc.all) ? 1 : undefined), 1, 8);
  const m2v = [...doc.all.matchAll(/m\.?2[^\n]{0,80}?pcie\s*(?:gen\s*)?(\d)(?:\.0)?\s*x\s*[24]/g)].map((m) => Number(m[1]));
  const m2Pcie = m2v.length ? `${Math.max(...m2v)}.0` : undefined;
  const sataM = [...doc.all.matchAll(/(\d)\s*x?\s*(?:portas?|conectores?)?\s*sata/g)].map((m) => Number(m[1]));
  const sataPorts = inRange(sataM.length ? Math.max(...sataM) : undefined, 0, 12);
  const lanM = doc.all.match(/(10|5|2[.,]5|1)\s*g(?:b|bps|be)?\b[^\n]{0,20}?(?:lan|ethernet)|(?:lan|ethernet|rede)[^\n]{0,50}?\b(10|5|2[.,]5|1)\s*g(?:b|bps|be)?\b/);
  const lan = lanM ? `${(lanM[1] ?? lanM[2])!.replace(',', '.')} Gb` : /gigabit|giga lan|1000 ?mbps|rtl8111/.test(doc.all) ? '1 Gb' : /rtl8125/.test(doc.all) ? '2.5 Gb' : undefined;
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
  const vramGb = pick(doc, [/memoria de video|tamanho (da|de) memoria|capacidade de memoria|^memoria$|memory size|^capacidade$|^vram/], (v) => inRange(numberWith(v, /gb\b/), 1, 48));
  const memType =
    pick(doc, [/tipo (de |da )?memoria|memory type|tipo dram|memoria/], (v) => v.match(/g?ddr\d+x?/)?.[0]?.toUpperCase().replace(/^DDR/, 'GDDR')) ??
    (doc.all.match(/\bgddr\d+x?\b/)?.[0] ?? doc.all.match(/\d\s*gb,?\s*(ddr\d)\b/)?.[1])?.toUpperCase().replace(/^DDR/, 'GDDR');
  const busBits = pick(doc, [/interface (de|da) memoria|barramento de memoria|memory bus|memoria de interface|interface de memoria \(barramento\)|bus width|^interface$|^memoria$/], (v) =>
    inRange(numberWith(v, /-?\s*bits?/), 32, 1024),
  );
  const mhzOf = (v: string, re: RegExp) => {
    const m = v.match(re);
    return inRange(m ? thousands(m[1]!) : undefined, 300, 4000);
  };
  const boostMhz =
    pick(doc, [/boost/], (v) => mhzOf(v, /(\d[\d.,]*)\s*mhz/)) ??
    pick(doc, [/clock|velocidade do clock|frequencia/], (v) => mhzOf(v, /boost\s*:?\s*(?:ate\s*)?(\d[\d.,]*)\s*mhz/) ?? mhzOf(v, /(\d[\d.,]*)\s*mhz\s*\(boost/)) ??
    pick(doc, [/^clock$|^clock do motor|core clock|velocidade do clock de gpu/], (v) => mhzOf(v, /(\d[\d.,]*)\s*mhz/)) ??
    mhzOf(doc.all, /(\d[\d.,]*)\s*mhz\s*\(boost/) ??
    mhzOf(doc.all, /boost(?: clock)?\s*:?\s*(?:ate\s*)?(\d[\d.,]*)\s*mhz/);
  const baseMhz = pick(doc, [/clock|base/], (v, l) => (/base/.test(l) ? mhzOf(v, /(\d[\d.,]*)\s*mhz/) : mhzOf(v, /base\s*:?\s*(?:ate\s*)?(\d[\d.,]*)\s*mhz/)));
  // "Consumo de energia: 600W" em algumas fichas é a fonte recomendada: acima de 450 W não é a placa.
  const tdpW = pick(doc, [/^tdp|potencia (da placa|total|grafica|da placa grafica)|consumo (de energia|da placa|maximo)|total board power|tbp|power consumption|^consumo$/], (v) =>
    inRange(numberWith(v, /w(?:atts?)?\b/), 20, 450),
  );
  const psuW = pick(doc, [/psu recomendada|fonte (de alimentacao )?recomendada|recommended psu|^fonte|alimentacao recomendada|consumo de energia/], (v) => inRange(numberWith(v, /w(?:atts?)?\b/), 300, 1600));
  // Comprimento: a maior medida das dimensões da placa (em cm, se a ficha usa cm).
  const lengthMm = pick(doc, [/dimens|card size|product size|tamanho d[aoe] (placa|cartao|produto)|^comprimento|^tamanho$|^length/], (v) => {
    if (/caixa|embalagem|box/.test(v)) return undefined;
    const cm = /\d\s*cm\b/.test(v) && !/mm/.test(v);
    const nums = [...v.matchAll(/(\d{2,3}(?:[.,]\d+)?)/g)].map((m) => dec(m[1]!) * (cm ? 10 : 1)).filter((n) => n >= 100 && n <= 450);
    return nums.length ? Math.round(Math.max(...nums)) : undefined;
  });
  const pcieM = doc.all.match(/pci[- ]?e(?:xpress)?\s*:?\s*(?:gen\s*)?(\d)(?:\.\d)?(?:\s*(?:x\s*(\d+)|(\d+)\s*x))?/);
  const lanes = doc.all.match(/uses?\s*x\s*(\d+)|\(x(\d+)\)/);
  const pcie = pcieM ? `${pcieM[1]}.0${lanes ? ` x${lanes[1] ?? lanes[2]}` : pcieM[2] || pcieM[3] ? ` x${pcieM[2] ?? pcieM[3]}` : ''}` : undefined;
  const power16Pin = /12v-?2x6|12vhpwr|16\s*-?\s*pin|12\s*\+\s*4\s*pin/.test(doc.all) ? true : /conector[^\n]{0,40}\b[68]\s*-?\s*pin|8 ?pin|\b[68]\s*pinos/.test(doc.all) ? false : undefined;
  const fansM = doc.all.match(/(\d)\s*x?\s*(?:ventoinhas|ventiladores|fans)\b|\b(dual|triple|tri|twin)[- ]?fan|(tres|duas) ventoinhas/);
  const fans = fansM ? (fansM[1] ? Number(fansM[1]) : /triple|tri|tres/.test(fansM[0]) ? 3 : 2) : undefined;
  return clean({ chip, vramGb, memType, busBits, baseMhz, boostMhz, tdpW, psuW, lengthMm, pcie, power16Pin, fans: inRange(fans, 1, 4) });
};

// ---------- memória ----------

const ram: Reader = (doc) => {
  const capV = pick(doc, [/^capacidade|quantidade de memoria|tamanho do modulo|^tamanho$|^capacity/], (v) => (/\d\s*gb/.test(v) ? v : undefined)) ?? '';
  const kit = capV.match(/(\d)\s*x\s*(\d{1,3})\s*gb/);
  const total = numberWith(capV, /gb/);
  const capacityGb = inRange(kit && total === Number(kit[2]) ? Number(kit[1]) * Number(kit[2]) : total, 1, 512);
  const modules = kit ? Number(kit[1]) : capacityGb ? 1 : undefined;
  const type =
    pick(doc, [/^tipo|^padrao|^interface|tipo de memoria/], (v) => v.match(/\bddr([345])/)?.[0]?.toUpperCase()) ??
    pick(doc, [/padrao|velocidade|compatibilidade|classificacao/], (v) => (/pc5-/.test(v) ? 'DDR5' : /pc4-/.test(v) ? 'DDR4' : /pc3-/.test(v) ? 'DDR3' : undefined)) ??
    doc.all.match(/\bddr([345])\b/)?.[0]?.toUpperCase();
  const mhz =
    pick(doc, [/frequencia|velocidade|speed/], (v) => inRange(numberWith(v, /mhz|mt\/s/), 800, 12000)) ?? inRange(Number(doc.all.match(/ddr\d-(\d{4})/)?.[1]), 800, 12000);
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
  for (const raw of doc.lines) {
    // O tipo pela linha inteira ("SATA: 6"); a contagem sem o rótulo.
    const l = raw.replace(/^[^:\d]{1,40}:\s*(?=\d)/, '');
    const kind: keyof typeof counts | null = /12v-?2x6|12vhpwr|16\s*pin|\b12\s*\+\s*4|p16\b/.test(raw)
      ? 'pcie16'
      : /pci-?\s*e|pcie|\bgpu\b|\bvga\b/.test(raw)
        ? 'pcie8'
        : /\beps\b|\bcpu\b|\bp8\b|\bp4\b|atx\s*12v\s*\(?4\s*\+\s*4|auxiliar/.test(raw) && !/24|20\s*\+\s*4/.test(raw)
          ? 'eps'
          : /\bs-?ata\b/.test(raw) && !/hdd|ssd|disco/.test(raw)
            ? 'sata'
            : null;
    if (!kind) continue;
    const lead = l.match(/^(\d{1,2})\s*x\b/) ?? l.match(/^(\d{1,2})\s*x?\s+(?=[a-z])/) ?? l.match(/^(\d{1,2})\s*$/);
    const tail = l.match(/\bx\s*(\d{1,2})\s*$/) ?? l.match(/:\s*(\d{1,2})\s*$/);
    // "1x P4+4, 1x P8": vários itens do mesmo tipo na linha.
    const items = [...l.matchAll(/(\d{1,2})\s*x\s*(?=[a-z])/g)];
    let n = items.length >= 2 && kind === 'eps' ? items.reduce((s, m) => s + Number(m[1]), 0) : lead ? Number(lead[1]) : tail ? Number(tail[1]) : 0;
    if (!n) continue;
    const total = l.match(/total:?\s*(\d{1,2})/);
    // "3 x Cabos SATA (com 4 conectores cada)": cabos vezes conectores; "6 x SATA (3 cabos com 3…)": já são os conectores.
    const per = l.match(/com\s*(\d)\s*conectores?\s*(?:cada|por cabo)/);
    const cables = /^\d{1,2}\s*x?\s*cabos?\b/.test(l);
    const token = kind === 'sata' ? /\bs-?ata\b/g : kind === 'pcie8' ? /6\s*\+\s*2/g : null;
    const reps = token ? (l.match(token) ?? []).length : 1;
    if (total) n = Number(total[1]);
    else if (per && (cables || /\bcabo|com \d conectores por cabo/.test(l))) n *= Number(per[1]);
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
    const m = v.match(/80\s*plus\s*(titanium|platinum|platina|gold|ouro|silver|prata|bronze|white|branco|standard)?|cybenetics\s*(diamond|titanium|platinum|gold|silver|bronze)/);
    if (!m) return undefined;
    const t = (m[1] ?? m[2] ?? 'white').replace('ouro', 'gold').replace('platina', 'platinum').replace('prata', 'silver').replace('branco', 'white').replace('standard', 'white');
    return `${m[2] ? 'Cybenetics' : '80 Plus'} ${t[0]!.toUpperCase()}${t.slice(1)}`;
  };
  const efficiency = pick(doc, [/certifica|eficiencia|80 ?plus|cybenetics|selo/], (v, l) => effOf(`${l} ${v}`)) ?? effOf(doc.all) ?? (/sem certifica|nao possui certifica/.test(doc.all) ? 'Sem certificação' : undefined);
  const modOf = (v: string) =>
    /semi[- ]?modular/.test(v) ? 'Semi' : /full[- ]?modular|100% modular|totalmente modular|completamente/.test(v) ? 'Total' : /nao modular|^nao$|non[- ]?modular/.test(v) ? 'Não' : /^sim/.test(v) ? 'Total' : undefined;
  const modular = pick(doc, [/modular|^tipo$|^cabos$/], (v, l) => modOf(/modular/.test(l) && /^sim|^nao/.test(v) ? v : `${v}`)) ?? modOf(doc.all.match(/(semi[- ]?modular|full[- ]?modular|100% modular|totalmente modular|nao modular)/)?.[0] ?? '');
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
  const standard = stds.find((x) => x !== 'ATX') ?? stds[0] ?? stdOf(doc.all.match(/\b(sfx[- ]?l?|atx\s*(?:12v)?\s*(?:v|ver\.?)?\s*\d[.,]\d+)\b/)?.[0] ?? '');
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
  const mbText = (
    pick(doc, [/placa[- ]mae|motherboard|compatibilidade (de|com) placa|suporte (a|de) placa|form factor/], (v) => (/itx|atx/.test(v) ? v : undefined)) ??
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
    const limit = inClearance || /max|ate\b|suport|compat|limite|liberac|espaco|superior da/.test(l);
    const g = l.match(/(?:gpu|vga|placa\s+de\s+video|placa\s+grafica|graphics card)[^0-9]{0,40}?(\d{3})\s*mm/);
    if (g && (limit || /comprimento/.test(l)) && !maxGpuMm) maxGpuMm = inRange(Number(g[1]), 150, 600);
    const c = l.match(/(?:cooler|cpu|processador)[^0-9]{0,40}?(\d{2,3})\s*mm/);
    if (c && (limit || /altura/.test(l)) && /cpu|processador|altura/.test(l) && !/radiador|liquid|water|fan\b|ventoinha/.test(l) && !maxCoolerMm) maxCoolerMm = inRange(Number(c[1]), 50, 200);
    if (/fonte|psu/.test(l)) maxPsuNote = l;
  }
  void maxPsuNote;
  const dimV = pick(doc, [/dimens(oes|ao)( do (produto|gabinete))?|tamanho do (gabinete|produto)|medidas/], (v, l) => (/embalagem|caixa/.test(`${l} ${v}`) ? undefined : v));
  const dims = dimV ? [...dimV.matchAll(/(\d{2,4}(?:[.,]\d+)?)/g)].map((m) => dec(m[1]!)) : [];
  const cm = dimV ? /\bcm\b/.test(dimV) && !/mm/.test(dimV) : false;
  const dimensions = dims.length >= 3 ? dims.slice(0, 3).map((n) => Math.round(n * (cm ? 10 : 1))).join(' x ') : undefined;
  // Frente: mesh (entra ar), vidro ou fechada. Do painel frontal ou do material; no texto, só frases sobre a frente.
  const frontV = pick(doc, [/painel frontal|^frente|^frontal|^material/], (v) => v) ?? '';
  const frontText = frontV || (doc.all.match(/(?:painel )?front(?:al)?[^\n]{0,30}(?:mesh|malha|perfurad|vidro)|(?:mesh|malha|vidro temperado)[^\n]{0,15}front/)?.[0] ?? '');
  const front = /mesh|malha|perfurad/.test(frontText) ? 'Mesh' : /vidro|glass/.test(frontText) ? 'Vidro' : /fechad|acrilico|solid/.test(frontText) ? 'Fechada' : undefined;
  // Ventoinhas que vêm instaladas: soma as linhas ("Top: 2 x 120 mm" / "Rear: 1 x 120 mm"); "Não possui" = 0.
  const fansIncluded =
    pick(doc, [/ventoinhas? (inclusas?|instaladas?|pre-instaladas?)|fans? (inclusos?|inclusas?|incluidos?|instalados?)|ventilador(es)? pre-instalados?|coolers? inclusos?|pre-installed/], (v) => {
      if (isNo(v) || /nao possui|nao acompanha|sem /.test(v)) return 0;
      const items = [...v.matchAll(/(\d+)\s*x/g)].reduce((s, m) => s + Number(m[1]), 0);
      return inRange(items || firstInt(v), 0, 12);
    }) ?? (/(nao acompanha|sem) (fans|ventoinhas|coolers)|nao possui (fans|ventoinhas)/.test(doc.all) ? 0 : undefined);
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
    for (const m of l.matchAll(re)) for (const n of m[1]!.split('/').map(Number)) if ([120, 140, 240, 280, 360, 420].includes(n)) radiators.add(n);
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
    const isDims = (v: string) => /\d{3}(?:[.,]\d+)?\s*(?:\(c\)\s*)?x\s*\d{2,3}/.test(v);
    // As medidas do radiador: no rótulo ou na seção dele, ou as primeiras medidas logo depois de ele aparecer.
    const radAt = doc.pairs.findIndex((p) => /radiador/.test(`${p.section} ${p.label} ${p.value}`));
    const dimLine =
      doc.pairs.find((p) => /radiador/.test(`${p.section} ${p.label}`) && /dimens|tamanho|medidas/.test(p.label + p.value) && isDims(p.value)) ??
      (radAt >= 0 ? doc.pairs.slice(radAt, radAt + 4).find((p) => /dimens|tamanho|medidas/.test(p.label) && isDims(p.value) && Number(p.value.match(/\d{3}/)![0]) >= 150) : undefined);
    const dm = dimLine?.value.match(/(\d{3})(?:[.,]\d+)?\s*(?:\(c\)\s*)?x\s*(\d{2,3})(?:[.,]\d+)?/);
    if (dm) {
      const [len, wid] = [Number(dm[1]), Number(dm[2])];
      const fan = wid >= 135 ? 140 : 120;
      const n = Math.round((len - 30) / fan);
      if (n >= 1 && n <= 3) radiatorMm = n * fan;
    }
    if (!radiatorMm && named) radiatorMm = Number(named[1]);
  }
  const tdpW = pick(doc, [/^tdp|tdp suportado|tdp maximo|capacidade (termica|de dissipacao)|dissipacao/], (v) => inRange(numberWith(v, /w\b/), 50, 500));
  const noiseDba = pick(doc, [/ruido|noise|nivel de som|acustic/], (v) => {
    const all = [...v.matchAll(/(\d{1,2}(?:[.,]\d+)?)\s*(?:~|-|a)?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*)?db/g)].map((m) => dec(m[2] ?? m[1]!));
    return inRange(all.length ? Math.max(...all) : undefined, 5, 70);
  });
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
