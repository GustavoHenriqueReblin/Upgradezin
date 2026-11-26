import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Build, UpgradeAction } from '@upgradezin/shared';
import { picksBody } from './UpgradePicks.tsx';

afterEach(() => vi.unstubAllGlobals());

const owned: Build = { cpu: { specs: { cpuModel: '5800X3D', socket: 'AM4' } }, gpu: { specs: { gpuModel: 'RX 6600', vram: 8 } } };
const pc = { owned, res: '1440p' as const, hz: 144, current: { cpu: 132, gpu: 95 } };

describe('dicas do Identificar gargalo: o pedido', () => {
  it('processador e placa de vídeo levam o PC da pessoa para o motor do orçamento; memória, fonte e SSD não precisam', () => {
    const gpu: UpgradeAction = { slot: 'gpu', label: 'Ver placas de vídeo', filters: { vram: [8, 12] } };
    expect(picksBody(gpu, pc)).toEqual({ slot: 'gpu', filters: { vram: [8, 12] }, owned, res: '1440p', hz: 144, current: { cpu: 132, gpu: 95 } });
    const psu: UpgradeAction = { slot: 'psu', label: 'Ver fontes', filters: {}, context: { certified: true, minWatts: 550 } };
    expect(picksBody(psu, pc)).toEqual({ slot: 'psu', filters: {}, context: { certified: true, minWatts: 550 } });
    // Sem o PC (ainda carregando), vai só a dica: o servidor devolve vazio para processador e placa de vídeo.
    expect(picksBody(gpu)).toEqual({ slot: 'gpu', filters: { vram: [8, 12] } });
  });
});
