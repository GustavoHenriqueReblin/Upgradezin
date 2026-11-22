# Changelog

Mudanças de cada versão. Versões no formato `MAIOR.MENOR.CORREÇÃO`: enquanto for 0.x, a versão menor sobe a cada conjunto de recursos e a de correção a cada ajuste. Para lançar uma versão nova, veja a seção "Versões" do [README](README.md).

## [Não lançado]

### Adicionado
- Página do produto (`/produto/<chave>`): melhor preço com "Ver na Loja" no topo (como no card da busca), onde comprar (preço de cada loja, cupom, estoque; como na busca, só o novo vendido pela própria loja, com produto aberto e outros vendedores atrás de um botão; o melhor preço e o histórico também ficam sem eles), ficha técnica com todos os campos da categoria (o que falta aparece como "não informado"; quem usa vê só o valor, não de qual loja veio) e histórico de preço. Junta os anúncios do mesmo produto nas lojas. No ar mesmo com o resto do site em manutenção; por enquanto aberta pelo admin (aba Fichas, "Ver página do produto").
- Fichas técnicas refeitas do zero, para todas as categorias: cada uma com seus campos fixos, só o indispensável para quem monta ou faz upgrade (placa-mãe: chipset, soquete, formato, memória, PCIe, M.2, SATA, rede; processador: soquete, arquitetura, núcleos, threads, clocks, cache, TDP, vídeo integrado; placa de vídeo: chip, VRAM, memória, barramento, clocks, consumo, comprimento; memória, SSD, fonte, gabinete e cooler com os seus). Uma tabela por categoria no banco, uma coluna por campo: mudar a lista de campos cria ou apaga a coluna sozinho. A ficha de um produto junta as páginas de todas as lojas que o vendem (mesmo part number), campo a campo, guardando de onde veio cada um. O texto da ficha fica guardado: melhorar o leitor relê tudo sem abrir as páginas de novo. A rotina de fichas lê todas as categorias, o que a coleta achou há menos tempo primeiro, e só abre página de produto sem ficha completa.
- Admin, aba Fichas: a rotina de fichas (saiu da aba Produtos), a cobertura por categoria (completas, incompletas, não lidas, as que só a web completaria e os campos que mais faltam) e os produtos de cada categoria com os campos lidos, de onde veio cada um, o texto guardado da página e "Ler ficha".
- Tabela de desempenho: RX 9050 e RX 7650 GRE (índice pelas vizinhas na TechPowerUp, consumo e PCIe x8 da 7650 GRE).
- Rotina de preços só pelas páginas de categoria das lojas, nas três lojas e em qualquer modo: lê a lista de cada categoria até acabar o que está em estoque (as lojas listam os em estoque primeiro) e recomeça a cada `ROUTINE_REFRESH_H`. Anúncio novo só entra em estoque; no fim de cada volta, o que estava em estoque e não apareceu passa a "sem estoque" (com ponto no histórico), e volta ao estoque sozinho na volta seguinte em que aparecer. Uma categoria pode ter mais de um caminho na loja (separados por espaço, em Lojas). A S3 ganhou leitor de página de categoria (os cards dela não trazem a marca: lida do título) e do "ver mais".
- Admin, Coleta: "Varrer agora" lê uma categoria inteira numa loja na hora (serve para conferir um caminho novo). Cobertura: anúncios em estoque, volta em andamento e última volta completa por loja e categoria.

- Mesmo produto em lojas diferentes: chave de produto por anúncio (mesmo part number, também achado no título ou no endereço de outra loja, sem o "NAC" que uma loja põe no fim) e de grupo (mais EAN, chave do título e assinatura de placa de vídeo: marca + chip + memória + linha). Nas placas de vídeo, os anúncios casados com outra loja foram de 24% para 35% (exato) e de 37% para 44% (grupo). A ficha técnica passa a valer para todos os anúncios do mesmo produto: 190 anúncios ganharam ficha de outra loja na hora, e a rotina não abre a página de produto já coberto. Admin, Produtos: status "de outra loja", de onde veio a ficha e os outros anúncios do mesmo produto. A busca agrupa com as mesmas regras (e deixa de juntar variantes como "Infinity 2" e "Infinity 3", "Ventus 2X" e "3X", DDR4 e DDR5).
- Identificar Gargalo: cada dica de upgrade mostra as 5 melhores ofertas de agora. Processador e placa de vídeo ordenados por desempenho ganho por real (só os compatíveis: placa que cabe na fonte, processador aceito pela placa-mãe, com aviso quando pede BIOS nova), com o ganho estimado; memória, fonte e SSD, as mais baratas que servem. Tudo do banco, sem consultar loja.
- Admin, cobertura: modelos de processador e placa de vídeo à venda que a tabela de desempenho não conhece.
- Tabela de desempenho: placas antigas ainda à venda (GT 210 a GTX 750) e RX 5600.
- Fichas técnicas nas três lojas (antes só na S1): uma rotina própria, separada da coleta, percorre aos poucos o catálogo de placa de vídeo, gabinete e cooler e lê a ficha de cada produto uma vez (uma por loja a cada `SHEET_ROUTINE_SECONDS`, padrão 180 s; desligada até ligar no admin). A checagem física da montagem passa a sair na hora para quase tudo. Ficha com dados vale para sempre; página sem ficha é lida de novo depois de 30 dias. Admin, cobertura: fichas lidas por loja e categoria.
- Admin, aba Produtos: catálogo inteiro paginado (loja, categoria, ficha técnica, estoque, busca por título ou código), com as specs do título, o índice de desempenho e a ficha de cada produto; "Ler ficha" força a leitura na hora (na fila da loja, na frente da rotina). Rotina de fichas, totalmente separada da coleta: chave, lojas e intervalo entre fichas próprios (10 s a 24 h), com o andamento por loja (lidas, sem ficha, faltam, próxima ficha, quanto falta).
- Ficha técnica: altura do cooler escrita como "104 (C) x 126 (L) x 159 (A) mm" e radiadores em lista com barra ("120/240/360 mm").
- Admin, coleta: "Busca ao vivo" por loja. Marcada, a loja é consultada na hora quando alguém pesquisa no site (na frente da rotina); desmarcada, a busca mostra só o que o banco tem dela.
- Admin, coleta: segundos de cada modo da rotina (normal, reduzido, lento) editáveis no admin, valendo na hora, sem reiniciar. O `.env` (`ROUTINE_*_GAP_S`) fica só como padrão.

### Corrigido
- Fichas novas, gabinete e water cooler (conferido nas 490 páginas da primeira noite): a frente agora é lida também pela frase sobre a frente ("painel frontal em mesh"), e não mais pelo material (o vidro de "Materiais" é o da lateral: um gabinete Airflow, de frente em malha, saía "Vidro"); as ventoinhas inclusas somam as posições escritas nas linhas de baixo ("Frente: 2 x 120 mm" / "Traseira: 1 x 140 mm") e não contam duas vezes o texto repetido (conferido com o título do anúncio: de 59 para 96 batendo, de 52 para 13 diferentes); dimensões sem a da caixa, com "(C)" antes do número, com "*" e na ficha numa linha só; "Tamanho máximo do cooler" sem "CPU"; radiador pelas medidas em qualquer ordem, com "mm" no meio e sem as medidas "incluindo ventilador". Gabinetes completos de 35 para cerca de 70 das 256 páginas.
- Fichas técnicas: medidas que o leitor não reconhecia, conferidas nas páginas vazias guardadas (420 de uma noite): comprimento da placa em "Product Size", "Tamanho do produto", "Formato" e "Length"; altura do cooler de ar sem a marcação (C x L x A) e de low profile (27 mm); folgas do gabinete em "VGA suportada", sob "Compatibilidade / Máxima" e com o valor na linha seguinte. +57 fichas lidas nessas páginas. Water cooler sai da fila de fichas (a ficha não tem medida que a montagem use) e aparece como "sem ficha física".
- Rotina de preços: a volta que já estava em andamento antes da atualização marcava como sem estoque tudo o que não estava na última página dela (320 processadores numa loja); agora o fim dela não marca nada.
- S1 muito lenta: cada página esperava os 45 s do limite, porque a página da loja nunca termina de carregar para o Chrome (anúncios e rastreadores). A extensão agora lê assim que o HTML está pronto: busca de 46 s para ~2 s, e de ~90 s para ~6 s quando abre a página de um cupom. Vale para as três lojas.
- Fichas da S1 vazias na maioria: o leitor só olhava as "informações técnicas", e em muitos anúncios (marcas menores, vendedores parceiros, alguns gabinetes) as medidas estão só na descrição. Agora junta as duas. Também lê "Tamanho do cartão: C=215 L=122 A=40 mm" (Gigabyte) e radiadores do gabinete em lista abaixo do título ("- 240 mm", "- 2 x 140 mm"). Em 8 páginas reais, as que rendem dado foram de 2 para 6 (as outras 2 não têm medida na página).
- Ficha técnica: medida em cm colada no número ("15,5x11,5cm") era lida como mm, e o peso na mesma frase ("pesando apenas 430g") virava o comprimento da placa (430 mm numa RX 550). Números em g, kg, GB, W, MHz, bits etc. não contam mais como medida.
- Ficha técnica: lê "Board size: 331.9 x 127.1 x 60 mm" (em inglês; o "Box size" da caixa fica de fora), medida sem unidade que só faz sentido em cm ("Dimensão do cartão 35 x 14 x 6,7" = 350 mm) e "tamanho de cartão ... 200 mm" em texto corrido que também fala dos ventiladores. Achados com as páginas guardadas pelo `DEBUG_DUMPS`.
- Ficha técnica: lê "centímetros" por extenso, "Tamanho: 233x120x44mm" (a palavra sozinha) e "L = 152 W = 114 H = 36 mm" (o "W" seguido de "=" era tomado por watts e o comprimento sumia).
- Parar o serviço com uma aba do admin aberta levava os 90 s do systemd até o SIGKILL: o servidor esperava as conexões ao vivo (SSE) fecharem, e elas não fecham sozinhas. Agora dá 1 s para o que está em andamento e derruba as que sobraram; se algo travar ao fechar, sai em 10 s.
- Admin, fichas: com `DEBUG_DUMPS` ligado, ficha que vem sem nenhuma medida guarda a página inteira em `data/debug` (`…-<loja>-ficha-<categoria>-<código>.html`), para conferir se a medida faltou no anúncio ou no leitor.
- Admin: todas as telas atualizam sozinhas, sem precisar trocar de aba (status, coleta, consultas, cobertura, produtos e rotina de fichas, termos, atividade, backups). Um canal ao vivo só para a página avisa quando uma consulta termina, uma loja começa ou termina uma página, entra ou sai de pausa, algo muda pelo admin ou alguém busca no site; a tela recarrega o que mostra. Também recarrega ao voltar para a aba do navegador e, por garantia, de tempos em tempos.

### Alterado
- A busca do formulário responde só pelo banco (os anúncios que batem com os termos pelas specs); só o "Não achou? Buscar nas lojas" consulta as lojas (nas com busca ao vivo ligada), sem repetir o mesmo texto na mesma loja por `REVALIDATE_MIN`.
- Admin: Consultas e Termos paginados no servidor, 50 por página, no mesmo padrão dos Produtos (total com os filtros, página anterior e próxima). O filtro "nunca coletado" dos Termos agora é feito no servidor, valendo para todas as páginas. A aba "Ao vivo" saiu; o canal ao vivo continua, atualizando as outras telas.
- Varredura de categoria também na s2 (a página da categoria inteira, 36 itens por página): todo produto à venda nela passa a ter histórico, não só os que aparecem nos termos. Caminhos no admin (aba Lojas).
- s2: até 3 páginas por termo na rotina (`MAX_PAGES_S2`, antes 1). A busca do site lê só a 1ª página de cada termo (`SEARCH_MAX_PAGES`): o intervalo antes da 2ª página deixava a S2 em ~16 s, quase sempre por poucos itens a mais; o resto vem do banco (rotina e varredura).
- Varredura alterna com os termos (no máximo metade das vezes da rotina), até 20 páginas por hora por loja (`ROUTINE_SWEEP_PAGES_PER_HOUR`, antes 6) e 40 por categoria (`ROUTINE_SWEEP_MAX_PAGES`, antes 25).
- O modo da loja passa a valer só para a rotina. Antes, no reduzido e no lento, a busca do site também esperava o intervalo do modo; agora isso é a "Busca ao vivo", independente do modo. A chave `slowlast:` do banco deixou de ser usada e é apagada ao subir.

### Removido
- Ficha técnica antiga (só medidas físicas de placa de vídeo, gabinete e cooler) e tudo o que era dela: a tabela no banco, o `GET /api/sheets` da montagem, o limite `SHEETS_PER_HOUR`, a releitura de página vazia depois de `SHEET_MAX_AGE_DAYS` e o `pnpm sheet-dumps`. O site fica em manutenção (só o admin) enquanto o banco de fichas novo é montado.
- Termos automáticos: a rotina não busca mais termos nas lojas (traziam kits, PCs montados e acessórios e só o topo de cada busca). Saem as tabelas de termos (migração 12), a aba Termos e o "coletar termo" do admin, e `ROUTINE_TEXT_DAYS`, `ROUTINE_SWEEP_REFRESH_H` e `ROUTINE_SWEEP_PAGES_PER_HOUR`.

## [0.3.0] - 2026-11-21

### Adicionado
- Admin, coleta: fila de cada loja no painel (consultando agora e quantas buscas do site e da rotina esperam), atualizada a cada 5 s.
- `pnpm routine-test`: a rotina de verdade nas lojas (um termo por categoria), com relatório por loja e categoria em `data/debug/`.
- `BACKOFF_ENABLED=false` desliga a pausa automática depois de bloqueio; `BROWSER_STEP_MS` espera a cada passo no Chrome, para acompanhar.
- Admin, coleta: rotina com um switch por loja (roda nas lojas ligadas) e o modo de cada uma (normal: 1 termo ou página de varredura a cada 15 s; reduzido: a cada 20 s; lento: a cada 1 min), contagem regressiva até a próxima consulta de cada loja, painel de cada loja (pausa, páginas da hora, última coleta boa, último bloqueio, consultas do dia), tirar pausa, pausar por um tempo e "coletar agora", tudo valendo na hora.
- Admin, dados: registro de cada consulta às lojas (90 dias) com linha do tempo de bloqueios por hora, cobertura por loja e categoria, e termos (última coleta por loja, filtro de nunca coletados, dar prioridade, apagar pesquisados).
- Admin, operação: consultas ao vivo, atividade do site (buscas recentes sem IP, conexões abertas, quem está no limite), backups (criar, baixar, apagar) e merge de outro banco com prévia e backup antes.
- Lojas configuradas no banco e editadas no admin (aba Lojas): nome, site, busca, caminhos por categoria e de varredura, cores e ligada/desligada, valendo na hora, sem reiniciar. Na primeira vez, o servidor copia as variáveis `STORE_*` do `.env`; depois, elas não valem mais.
- Admin em `/admin`, com login fixo do `.env` (`ADMIN_USER`/`ADMIN_PASSWORD`): sessão em cookie protegido, limite de tentativas por IP e status do servidor (versão, commit, há quanto tempo está no ar, banco, memória, Chrome).
- Varredura de categoria na rotina: a loja com caminhos de categoria (admin, aba Lojas; hoje a s1) é lida inteira, algumas páginas por hora, e todo produto à venda passa a ter histórico de preço, não só os que aparecem nas buscas do formulário. `pnpm scan --sweep` confere os caminhos.
- Compatibilidade: TDP de referência de cada processador, para o aviso de cooler fraco valer também para o que está à venda (antes só para o PC importado); observações de water cooler de 120 mm com processador forte e de placa-mãe de entrada com processador de 105 W ou mais.
- Licença proprietária (`LICENSE`): todos os direitos reservados.
- Tela de resultado atualiza sozinha: depois da busca, quando chega coleta nova de uma loja (rotina, loja que saiu da pausa, busca de outra pessoa), a lista dela troca sem buscar de novo, com um aviso discreto no canto. Os cards já mostrados não mudam de lugar.
- Checagem física na montagem, pela ficha técnica da página do produto (lida só das peças escolhidas, guardada 30 dias): placa de vídeo que não cabe ou fica justa no gabinete, cooler alto demais, radiador que o gabinete não aceita e conector 12V-2x6 da placa.
- Condições do cupom (S1): "cupons limitados", valor mínimo, validade e PIX. O cupom só entra no preço quando vale para ele, e o card diz as condições ou por que não vale.
- Identidade da peça entre lojas: part number do fabricante lido do título também na S3 (68% dos anúncios dela, que antes só casavam pela chave de modelo).
- "Buscar nas lojas" a partir do filtro de texto do resultado: o texto (ex. "Zotac RTX 3050 Twin Edge OC") vai às lojas como termo próprio, junto com os da busca. Na S2, que rende uma página por consulta, a página já traz o produto procurado. Limitado por pessoa por hora; a rotina só mantém o texto enquanto alguém pesquisa (7 dias).
- Bolinha da loja em degradê: a cor da loja (admin, aba Lojas) aceita duas ou três cores separadas por vírgula (`"#ffc300,#e30613"`); com uma só, continua lisa.

### Corrigido
- Chrome das lojas: às vezes a aba de início carregava antes de a extensão ficar pronta e parava lá ("A extensão não conectou"), e a loja só voltava depois de reiniciar o serviço. A extensão agora troca a aba quando ela termina de carregar, e o app abre outra aba de início se a extensão não conectar em 8 s (espera até 30 s).
- Resultado: loja que ainda esperava a vez (ou em pausa) não aparecia quando a rotina a coletava enquanto outra loja ainda estava ao vivo: a tela só escutava novidades depois do fim da busca. Agora escuta desde o começo (ignorando as lojas ainda ao vivo, que recebem a própria lista).
- S2: termo igual ao nome de uma categoria ("Water Cooler", "Gabinete") contava como bloqueio e pausava a loja. A busca da loja redireciona esses termos, por script, para a página da categoria, sem lista de produtos. Agora o redirecionamento é reconhecido (pela instrução que vem na própria resposta da busca): a loja não pausa, o destino fica guardado no termo (migração 9) e as próximas coletas desse termo abrem a página da categoria direto, que traz a lista normalmente. Na primeira vez, a busca do site segue com os anúncios que o banco já tem.
- Testes usam banco em memória (`DB_PATH=:memory:`); antes, os que usavam o banco do servidor abriam o `data/upgradezin.db` de quem rodava.
- Busca sem a loja que tinha o produto (ex. i5-12400F sem a S2): a S2 nunca tinha coletado um termo de processador Intel (a rotina ia termo a termo e gastava o pouco que a loja aceita sempre nas mesmas categorias). A rotina agora espalha a coleta pelas categorias, o pesquisado primeiro.
- Toda busca atualiza por trás o que foi coletado há mais de 10 min (antes, só o que tinha mais de 24 h), e sair da página não interrompe mais a consulta: ela termina e grava no banco.
- S2 e S3 bloqueavam da 2ª consulta em diante. A causa era o navegador controlado (Playwright e porta de depuração: o próprio Chrome se declara automatizado), não o ritmo. Resolvido com o Chrome comum e a extensão (ver Alterado); o último intervalo entre consultas fica guardado entre reinícios.
- Consulta na fila atrás de uma que bloqueou ia à loja mesmo assim, e o 2º bloqueio subia a pausa de 15 min para 1 h.
- A busca escondia anúncios que o banco já tinha: buscar processadores AM4 mostrava só a loja que tinha coletado o termo "AM4", e o mesmo processador nas outras lojas (vindo da coleta de "Ryzen 7", ou de uma loja bloqueada) não aparecia. Agora cada loja junta ao resultado do termo os anúncios dela que batem com ele pelas specs (encaixe, linha, potência, chipset, memória…), vistos nas últimas 72 h (`SEARCH_DB_MAX_AGE_H`).
- Fonte do "Meu PC": a marca sugeria só 20 marcas fixas; agora sugere as mesmas que a busca de fontes mostra (78 nos anúncios do servidor em nov/2026, ex. Duex, ASRock, BRX, Be Quiet!) e grava a marca na mesma grafia da busca.
- Placas A620A ("A620AM-K") não tinham o chipset reconhecido: a montagem não confirmava processador nenhum nelas.
- H610 e H810 travam a frequência da memória: a montagem sugeria ativar o XMP.
- Kit de 4 pentes numa placa ATX sem os slots no título ficava "não deu para confirmar": ATX conta 4.

### Alterado
- Todas as lojas lidas do mesmo jeito: um Google Chrome comum por loja, sem porta de depuração e sem Playwright, com a extensão do projeto (`apps/server/extension`) abrindo cada página numa aba, lendo o HTML e fechando a aba. Acabaram os bloqueios da 2ª consulta em diante nas lojas com anti-robô. A S1 deixou de usar HTTP direto. Instalação da extensão uma vez por loja: `pnpm chrome-setup` (no Chromium ela carrega sozinha).
- Modos da rotina em segundos: normal 15 s (a busca do site vai na hora), reduzido 20 s e lento 1 min (a busca do site também respeita o intervalo). Cada vez da rotina é uma coisa só: uma página da varredura ou um termo.
- Na fila de cada loja, a busca do site passa na frente da rotina.
- Rotina de preços volta às três lojas, por igual; se uma loja bloquear, pausa e volta a tentar sozinha, em vez de ficar fora da rotina.
- "Parar" a busca fica junto da ordenação, acima dos resultados.
- Rota da API que não existe responde 404 em JSON, em vez da página do app.

### Removido
- `pnpm share` (link público temporário a partir do PC, usado antes de haver servidor). O link do servidor (`deploy/upgradezin-tunnel.service`) continua.
- Playwright e os modos de abrir o Chrome por ele ou pela porta de depuração.
- Catálogo de peças importado (BuildCores OpenDB) e `pnpm catalog:import`: o app usa só o que as lojas mostram. Ao subir, o banco apaga as tabelas do catálogo (anúncios, histórico e montagens ficam) e é compactado uma vez.

## [0.2.0] - 2026-11-20

### Adicionado
- Categorias SSD, Cooler e Gabinete: busca, filtros (capacidade por faixa, geração PCIe, tipo de cooler e radiador, placa-mãe que cabe, vidro, fans), ordenação por preço por TB e por leitura, e specs no card.
- Montagem com 8 peças: SSD, cooler e gabinete entram com compatibilidade (encaixe e TDP do cooler, placa-mãe que cabe no gabinete, SSD mais novo que o M.2 da placa, radiador grande no gabinete). Cooler na montagem tira o aviso de processador sem cooler.
- Identificar Gargalo: a dica de Windows num HD abre a busca de SSD.

## [0.1.0] - 2026-11-20

Primeira versão numerada, já rodando no servidor.

### Busca e preços
- Categorias Fonte, Placa-Mãe, Processador, Placa de Vídeo e Memória RAM, em três lojas configuráveis pelo `.env`.
- Preços guardados num banco SQLite local: uma rotina coleta sozinha, e o site responde do banco (consulta a loja na hora só quando falta ou está velho).
- Preço à vista em destaque, com cupom, ofertas com prazo e estoque.
- Histórico de preço por produto (gráfico por loja) e selo de menor preço em 30 dias.
- Filtros calculados do resultado, ordenação (inclusive "Maior Desconto") e categoria e filtros lembrados no navegador.

### Montagem
- Montar o PC peça por peça, com compatibilidade conferida a cada escolha (encaixe, chipset × geração, DDR4/DDR5, slots, fonte).
- Quantidade na memória, "Adicionar à Montagem" em qualquer resultado e compartilhamento por link curto.
- "Já Tenho": a peça sai do total e conta como parte do PC atual.

### Meu PC
- Importar o PC pelo relatório do CPU-Z (lido só no navegador), com a fonte informada à mão.
- Identificar Gargalo: equilíbrio processador × placa de vídeo pelo monitor, placas de vídeo na faixa certa (que cabem na fonte e na placa-mãe), memória, disco, limites da placa-mãe e ajustes grátis como o XMP.

### Servidor
- Proteções da API (limite por pessoa, buscas simultâneas, links de montagem), cabeçalhos de segurança e coleta respeitosa (bloqueio de loja pausa a consulta).
- Tema escuro.
