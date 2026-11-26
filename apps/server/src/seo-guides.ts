/** Comparações com perguntas e critérios próprios. A lista é editorial para limitar páginas repetidas. */
export const COMPARISONS = {
  'rtx-4060-vs-rx-7600': {
    kind: 'gpu', models: ['RTX 4060', 'RX 7600'], titles: ['GeForce RTX 4060', 'Radeon RX 7600'],
    advice: 'As duas miram jogos em Full HD e têm 8 GB. Compare o preço final e considere o DLSS da GeForce ou o FSR nos jogos que você usa. Para jogar acima de Full HD com texturas pesadas, também vale comparar opções com mais memória.',
  },
  'rtx-5060-vs-rx-9060-xt-16gb': {
    kind: 'gpu', models: ['RTX 5060', 'RX 9060 XT'], titles: ['GeForce RTX 5060 8 GB', 'Radeon RX 9060 XT 16 GB'], vram: [8, 16],
    advice: 'A Radeon desta comparação é a versão de 16 GB. Essa folga pode ajudar com texturas pesadas. A RTX 5060 pode fazer sentido se custar menos ou se os jogos e aplicativos que você usa se beneficiarem de recursos da NVIDIA.',
  },
  'ryzen-5-5600-vs-core-i5-12400f': {
    kind: 'cpu', models: ['5600', '12400F'], titles: ['Ryzen 5 5600', 'Core i5-12400F'],
    advice: 'Ambos têm seis núcleos, doze threads e precisam de placa de vídeo dedicada. Para quem já tem uma placa-mãe AM4 compatível, o Ryzen permite reaproveitar a plataforma. Numa montagem nova, compare o custo de processador, placa-mãe e memória juntos.',
  },
  'ryzen-5-5600-vs-ryzen-5-7600': {
    kind: 'cpu', models: ['5600', '7600'], titles: ['Ryzen 5 5600', 'Ryzen 5 7600'],
    advice: 'O Ryzen 5 5600 usa AM4 e DDR4. O Ryzen 5 7600 exige AM5 e DDR5. Se você já tem um PC AM4, compare o ganho com o custo da troca de plataforma. Para montar do zero, o preço do conjunto ajuda a decidir quanto sobra para a GPU.',
  },
} as const;

export const GPU_GUIDE = {
  path: '/guias/placa-de-video-para-ryzen-5-5600',
  title: 'Qual placa de vídeo combina com Ryzen 5 5600?',
};
