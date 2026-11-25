# Changelog

Mudanças de cada versão. Versões no formato `MAIOR.MENOR.CORREÇÃO`: enquanto for 0.x, a versão menor sobe a cada conjunto de recursos e a de correção a cada ajuste. Para lançar uma versão nova, veja a seção "Versões" do [README](README.md).

## [Não lançado]

- A lista Fichas por Produto pode ser filtrada por estoque e vendedor. Os campos de texto e selects do admin seguem a mesma altura mínima.

- O admin aproveita toda a largura disponível em desktop, tablet e celular, com as abas abaixo do cabeçalho em telas estreitas.

- A lista de respostas da busca na web mostra a situação da ficha antes e depois da consulta. Respostas antigas exibem a situação atual quando disponível.

- A fila da busca na web prioriza produtos novos vendidos pela própria loja, primeiro os que têm estoque e depois os esgotados. O admin mostra a quantidade de produtos em cada prioridade.

- A busca na web envia só os campos em aberto e usa a identificação disponível para confirmar a variante em manuais e datasheets. Refazer uma consulta preserva os valores encontrados.

- O comando `pnpm budget-test` gera o relatório de referência com 120 cenários. A opção `--expanded` cobre 4.104 combinações, simulações de mercado, upgrades e pontos de transição. A auditoria roda em uma cópia da base.

### Corrigido

- O campo de orçamento exibe valores com separador de milhar e dois centavos em português do Brasil.

- O servidor e os testes filtram o aviso de inicialização do SQLite embutido no Node.
- Placa de vídeo com o chip incompleto na ficha da loja ("Chipset: GT 218", o nome interno; "Arquitetura Radeon RX 6900", sem o XT; "RX 7800"; "RX 9000", a série) ficava com esse modelo, sem nota de desempenho, fora dos filtros por modelo e das sugestões: o chip que a tabela de desempenho não conhece perde para o modelo do título (GT 210, RX 6900 XT, RX 7800 XT, RX 9060 XT). Os 4 modelos sem índice do admin eram esses.
- Gabinete: ventoinhas inclusas que as lojas chamam de "cooler" no título ("Com 3 Coolers RGB", "3 Cooler", "3 Coolers Rgb Inclusos") eram ignoradas, e o gabinete ficava com o padrão da categoria (0, "não tem"); o que o gabinete suporta ("Suporta 6 Coolers", "até 9 Fans") continua de fora. "Com Fans" sem o número deixa o campo como "não sei" em vez de "não tem".
- Clock máximo do processador: com vários turbos na ficha (Intel: Thermal Velocity Boost, Turbo Boost Max 3.0, P-core Max Turbo), vale o maior, o que conta em jogos. O i9-13900K era lido com 5,4 GHz em vez de 5,8. No título "3.7ghz Turbo 4.4ghz", o 3,7 era lido como turbo. A base "Frequência de base P-core" também passa a ser lida. Nas páginas guardadas, 14 processadores sobem o clock e nenhum desce; o servidor relê as fichas ao subir.
- Admin: as lacunas de desempenho e a nota da aba Produtos usam a ficha do processador, como o site. Processador fora da tabela, mas com nota pela ficha, não aparece mais como lacuna.
- Air cooler lido como water cooler por um "bomba" no texto da ficha ("ARGB: design para bomba e ventilador", copiado de water cooler): a bomba agora só conta no rótulo ("Bomba: 2800 RPM"). Nas páginas guardadas, muda só o Aigo Darkflash Ellsworth S31 (preto e branco), que passa a air cooler com altura de 153 mm, e nenhum water cooler deixa de ser water.
- Water cooler com radiador de 480 mm: o tamanho não era aceito no título ("480mm"), na ficha (4 ventoinhas de 120, "518 x 120 x 27 mm") nem nas opções do JSON da busca na web, e a IA devolvia o radiador em branco mesmo achando. A resposta da web com a unidade ("480 mm") também passa, e o radiador vindo da web entra como número.
- Admin, Backups: a lista quebrava ("Não foi possível agora") quando o backup para o qual o link "latest.db.gz" da madrugada aponta era apagado; arquivo que não dá para ler agora fica de fora.
- Cooler: "Bloco de alumínio com 2 heatpipes" (air cooler) era lido como water cooler.
- Soquetes do cooler: no título grudados no "LGA" ("Socket LGA1151") e na ficha abreviados ("Sockets 1151/56/50": 1151, 1156 e 1150).
- Leitor das fichas: campo inteiro com decimal na ficha ("Altura: 158,5 mm") é arredondado (antes ficava 158,5 num campo inteiro).
- Ficha da S2 em páginas sem a tabela de especificações: lida do bloco "Especificações" (ou "ESPECIFICAÇÃO") da descrição, um parágrafo por campo com o rótulo em negrito ("Dimensões" / "84 x 129 x 158,5 mm"). Antes a página ficava "sem ficha"; das 212 páginas assim guardadas para conferência, 202 passam a ter ficha (134 coolers e 61 placas-mãe).
- Produtos diferentes juntos porque a loja reaproveitou a página: o part number de outro anúncio no endereço só junta quando o anúncio não tem part number ou tem um parecido (a mesma raiz, como "…M0EAY0" × "…M1EAY0"). O Hyper 212 Spectrum com endereço do antigo Hyper T20 juntava os dois coolers; nos dados de hoje, 11 anúncios deixam de juntar com outro produto.
- Leitor das fichas, com as páginas lidas depois do reset (gabinete, cooler e fonte): placas-mãe do gabinete em lista uma por linha ("Mini ITX" / "Micro ATX" / "ATX": o "Micro ATX" virava título e a lista parava no primeiro), no rótulo no plural ("Placas-mãe: …"), no próprio rótulo ("Placas-mãe Micro-ATX / ITX: …") e uma por linha com sim/não (77 gabinetes, muitos antes lidos só como "ATX" ou "E-ATX"); placa de vídeo no plural ("suporta placas de vídeo de até 325 mm", +30), sem pegar o cooler da mesma frase; radiador em texto corrido sem o comprimento da GPU (15 gabinetes com um radiador de 420 ou 280 que não existia); ruído de cooler com "dB" no rótulo ou sem dois-pontos (+29); radiador do water cooler pelas medidas com "*" ("397*120*27mm", +19); conectores da fonte com número no rótulo ("Conector PCIe 6+2 Pinos: 4x", "Conector 4+4 Pinos: 2x", +11 EPS e +9 PCIe) e "4 SATA: 3 cabos" (3 cabos de 4). Nenhum campo perdeu valor.
- Lista aberta na aba que ficou aberta da categoria anterior (varredura completa de uma categoria logo depois de outra): a leitura podia sair da página anterior, que ainda respondia enquanto a nova carregava, e dava "a busca da loja redireciona este termo para outra página" com o endereço da categoria anterior. A extensão agora espera o documento novo.
- Mesmo processador em lojas diferentes sem part number (ou com códigos de embalagem diferentes, "…651POF" e "…651WOF" do mesmo 5800X3D) ficava em páginas de produto separadas: agora junta pelo modelo quando a descrição do título não se contradiz (clocks, cache, soquete, núcleos, vídeo integrado, cooler "sem/S/"/"com/C/", nome do cooler da caixa). Tray/OEM (no título ou no código: "Oem", "Cm8070…", "…MFH", "…MPK") continua outro produto da box. Nos dados de hoje, 421 chaves de processador viraram 318.
- Leitor das fichas, com as ~4.400 páginas já lidas pela rotina: mais formatos de placa-mãe (formato em "Configuração"/"PCB" ou numa linha só, SATA em "SATA 6Gb/s: 4" e "interfaces de disco SATA", PCIe x16 com a versão depois, slots de memória por extenso e em "DIMMs", memória máxima com "(GB)" no rótulo, M.2 "Ultra"/"Tomada" e "até Gen3", rede pelo chip ou "10/100/1000"), de processador ("Soquete: 1700", "Frequência de Operação", "P-core Max Turbo", "Cache Inteligente (L3)", "Voltagem / TDP", "Nome da GPU"), de placa de vídeo ("3 Fan", "Power Supply Requirement") e de fonte (conectores em "x 2:", "- 2", "x2 peças", "2 cabos 4 conectores", sem contar adaptador; "Modular: Semi"; "Cybernetics"). Corrigidos: fonte com "80 Plus" repetido antes do nível lida como "80 Plus White" (29 fontes), com 80 Plus e Cybenetics vale o 80 Plus, placa-mãe com o 5 do "DDR5" lido como 5 slots de memória (13 placas) e "6 x SATA (3 cabos com 3 conectores cada)" lido como 18. Nenhum campo perdeu valor; o servidor relê as fichas guardadas ao subir.
- Lista de categoria que não anda (a loja devolve de novo uma página já lida): a página que só traz produtos que a volta já viu encerra a lista ali, na rotina e na varredura completa, sem marcar nada como esgotado (o resto pode não ter sido lido). Na S3, o "ver mais" devolvia a mesma página da 2ª à 200ª, e a varredura de cada categoria ia até o teto de 200 páginas.

### Mudado

- O orçamento e a montagem compartilham o dimensionamento da fonte e respeitam ausência declarada de conectores. A recomendação distingue trabalho acelerado, fabricante exigido ou preferido e maior desempenho dentro do valor. Perfis avançados podem avaliar 64 GB de RAM e SSD de 4 TB.

- O orçamento distingue Vega 8, Vega 7 e UHD 730, modera o índice combinado e dá menos peso a picos de CPU sem evidência de alimentação sustentada. A triagem de cooler, fonte e gabinete usa características físicas e elétricas declaradas. A busca inclui SSDs de 2 TB, folga de montagem e alternativas com benefício distinto. A auditoria registra os degraus de orçamento e candidatos preteridos.

- Fichas de CPU preservam o TDP e deixam de usar o campo Potência Máxima. O leitor deduz o tipo de memória quando o socket o determina.
- No admin, fichas que precisam de revisão podem ser concluídas manualmente com campos em branco e reabertas depois. O monitoramento do servidor continua nas outras abas do admin.

- GPUs x8 concorrem normalmente em placas-mãe PCIe 3.0 no diagnóstico e no orçamento. A diferença de banda aparece como observação de compatibilidade.

- Montar pelo Orçamento inclui o perfil Produtividade e ajusta o ganho marginal de CPU e GPU, a preferência por RAM e SSD e a escolha de placa-mãe, gabinete e refrigeração. A auditoria ampliada registra progressão de orçamento e sensibilidade às ofertas.

- Na montagem peça por peça, o título abre a página do produto quando há uma oferta identificada no catálogo.

- Identificar Gargalo destaca o atalho de orçamento em largura total, recolhe as sugestões por padrão e alinha a linha da fonte às demais peças. O medidor usa a paleta do site, com destaque na faixa do diagnóstico.

- Botões de ação do site e do admin usam a mesma altura. A montagem peça por peça usa o laranja do tema nas ações de escolher e nos ícones de categoria.

- Montar Peça por Peça e Identificar Gargalo seguem o estilo do orçamento, com painéis, ações e espaçamentos consistentes.

- Montar pelo Orçamento ganhou um formulário responsivo que agrupa as preferências e destaca o valor e o botão de montagem. Tipo de recomendação e perfil de uso são botões de opção com as cores do site.

- Montar pelo Orçamento ganhou os perfis Jogos e Jogos e Trabalho. RAM e SSD maiores ganham preferência gradual quando há margem no orçamento. A escolha também considera o custo de ganhos pequenos de CPU, a evidência de alimentação sustentada da placa-mãe e as folgas entre gabinete, placa de vídeo e radiador.

- Montar pelo Orçamento ganhou PC Comprável Agora, com ofertas em estoque vistas nas últimas 24 horas, e PC Ideal, com preços históricos de até 90 dias identificados por peça. O motor ampliou as referências de CPU e GPU, suavizou a combinação do desempenho, passou a dimensionar a fonte por carga e conectores e valida as peças finais antes de ordenar por preço real, desempenho e capacidade.

- Montar pelo Orçamento compara diferentes capacidades de memória e SSD na mesma busca. Diferencia variantes gráficas, aplica as primeiras referências por resolução e permite montar com vídeo integrado mesmo sem ofertas de placas de vídeo. A escolha de placa-mãe e cooler considera a potência estimada e as medidas do gabinete. A tela informa quando o cooler acompanha o processador e só mostra ganho percentual quando existe uma referência positiva.

- Montar pelo Orçamento voltou à tela inicial e ao Identificar Gargalo, com o mesmo estilo dos demais atalhos.

- Montar pelo orçamento: sete processadores passam a usar referências locais de testes de jogos, na escala em que o Ryzen 5 5600 vale 100. A mesma referência vale para a peça à venda e para o processador atual no upgrade.
- Montar pelo Orçamento lembra os campos preenchidos no navegador. A busca só roda quando a pessoa escolhe Montar ou pressiona Enter no campo de valor.
- Montar pelo Orçamento compara kits com pares de pentes avulsos iguais. A tela identifica a recomendação, a melhor relação entre índice e preço e, quando distinta, a opção de maior desempenho entre as exibidas no orçamento.
- Identificar Gargalo: cada dica de upgrade mostra as 3 melhores ofertas (1ª, 2ª e 3ª opção) em vez de 5, o mesmo número do Montar pelo Orçamento.
- Troca de placa de vídeo nunca sugere uma com menos memória de vídeo que a atual, mesmo com chip melhor (seria downgrade): vale no Montar pelo Orçamento, nas melhores ofertas e na busca que a dica do Identificar Gargalo abre, e a dica avisa ("Só versões com 8 GB de memória de vídeo ou mais, como a sua"). Placa sem a memória informada também fica de fora.
- "Importar Meu PC" na montagem, com um PC já importado (no Identificar Gargalo ou antes), abre direto na prévia com as peças lidas, sem pedir o arquivo de novo; "Escolher Outro Arquivo" continua lá.
- "Gabinete ATX" (e Micro ATX, Mini ITX) na busca passa a mostrar os gabinetes onde a placa cabe, incluindo os que aceitam formatos maiores. Antes eram só os de maior placa exatamente ATX, e mid towers que aceitam E-ATX ficavam de fora. A contagem do formulário segue a mesma regra.
- "Não achou? Buscar nas lojas", abaixo do filtro de texto do resultado, desligado por enquanto: a varredura completa das lojas já traz praticamente todas as peças. O filtro de texto nos resultados continua.
- Cooler: altura e ruído ficam opcionais (só tipo, soquetes e, no water cooler, o radiador são principais).
- Fonte: só potência, eficiência e modular são principais; padrão e conectores ficam opcionais.
- Cooler: o TDP suportado fica opcional (a loja quase nunca informa).
- Gabinete: só o tamanho (mid, mini tower) e as placas-mãe são principais; placa de vídeo, cooler, dimensões, frente, ventoinhas e radiadores ficam opcionais.
- Título do processador: "S/ Cooler" e "S/ Vídeo" (abreviados) contam como sem cooler e sem vídeo.
- Dois intervalos por loja, no admin, valendo na hora: o de **listagens** (aba Coleta, na linha de cada loja em Rotina de preços: "uma página de lista a cada X a Y s"), entre duas páginas de lista ("/fonte", "/fonte" página 2…) na rotina, na varredura completa, na busca e nos testes; e o de **fichas** (aba Fichas, no card de cada loja: "uma ficha a cada X a Y s"), entre duas páginas de produto, que também é o ritmo da rotina de fichas. De 2 a 600 s cada. Uma ficha nunca sai antes do intervalo de fichas depois de qualquer consulta, e uma página de lista espera o de listagens desde a última página de lista. Saem os modos da rotina (normal, reduzido, lento e os segundos de cada um), o intervalo próprio da varredura completa (ela fica só com as categorias), o "1 ficha a cada N" da rotina de fichas e os intervalos do `.env` (`PAGE_DELAY_MIN_MS`, `PAGE_DELAY_MAX_MS`, `ROUTINE_*_GAP_S`, `ROUTINE_SLOW_STORES`, `SHEET_ROUTINE_SECONDS`). Antes, entre as páginas de uma mesma categoria a rotina usava os 5 a 12 s do `.env`, que não apareciam no admin. O que estava salvo vira os intervalos novos: o da varredura completa, o de listagens; os segundos da rotina de fichas, o de fichas (até +20%). Sem nada salvo: 15 a 30 s nas listagens e 10 a 20 s nas fichas.

### Adicionado
- Fichas técnicas: campos novos, todos opcionais e lidos das páginas já guardadas (o servidor relê ao subir, sem abrir as lojas de novo). Placa-mãe: fases do VRM, dissipador no VRM, BIOS Flashback. Placa de vídeo: arquitetura (pelo chip), unidades de processamento (CUDA/stream), largura de banda (lida ou pelo barramento × a velocidade da memória), conectores de alimentação (sem o adaptador). Memória: XMP, EXPO. SSD: geração PCIe, tipo de NAND (sem confundir com o "SLC cache"), cache DRAM, durabilidade (TBW). Cooler: heatpipes, tamanho da ventoinha. Nas páginas guardadas: arquitetura em 87% das placas de vídeo, banda em 80%, unidades em 74%; ventoinha em 75% dos coolers; geração PCIe em 83% dos SSDs; BIOS Flashback em 47% das placas-mãe.
- Fichas: "não tem" diferente de "não sei". Campo que o produto pode não ter guarda o "não tem" ("Não", 0 ou false) quando a ficha deixa claro: 394 placas-mãe sem Wi-Fi, 400 fontes sem conector de 16 pinos, 597 SSDs SATA, 1.006 memórias DDR4 sem EXPO. O título com "Wifi" (mesmo sem a versão) ou outra fonte com o valor de verdade ganham do "não tem" automático. A web e o preenchimento à mão também respondem "Não".
- Busca na web também para os produtos de ficha completa com campo opcional vazio (depois dos que falta campo principal); o que nem a web completa vai para a revisão manual ("precisa de você"), que agora mostra os opcionais. Nova coluna "Completas com opcional vazio" na Cobertura.
- Montar pelo Orçamento recomenda PC completo ou upgrade do PC importado. Mostra até três opções com benefícios distintos, informa o valor mínimo quando necessário e leva o resultado para a montagem peça por peça.
- Prévia da importação do CPU-Z com mais detalhes: memória com os pentes e a frequência de fábrica, TDP e vídeo integrado do processador, linhas PCIe da placa de vídeo e polegadas do monitor.
- Memória: 32 GB é o recomendado. Com 16 GB, a análise do PC mostra uma observação (não um upgrade pendente) com as memórias de 32 GB, e a montagem uma observação que não muda o selo. Jogos atuais em Full HD já passam de 16 GB com navegador e Discord abertos. O upgrade de memória (pouca, um pente só, lenta) também passa a mirar 32 GB (2x 16 GB).
- Gargalo e upgrade pela ficha técnica:
  - **Processador:** avaliado pela ficha, multiplicando o IPC da arquitetura em jogos pelo clock máximo, pelo cache L3 (os X3D rendem mais, as APUs da AMD menos) e pelos núcleos. Antes era uma tabela por linha e geração, que dava a mesma nota a modelos diferentes e não conhecia os X3D novos. Nos 179 modelos do catálogo com ficha, 162 ficam a até 12% da tabela antiga; os que diferem são casos em que a ficha acerta mais (versões T de baixo consumo, X3D).
  - **Processador da pessoa:** vem da ficha do mesmo modelo no catálogo (GET /api/sheets/cpu), porque o CPU-Z não traz o clock máximo. Sem ficha, vale a tabela, e a tela diz qual foi usada.
  - **Placa de vídeo:** continua pela média de análises do chip, com chip, consumo e linhas PCIe vindos da ficha.
  - **As 5 sugestões de processador e placa de vídeo:** primeiro as que resolvem o gargalo (chegam ao equilíbrio com a outra peça na tela da pessoa), da mais barata; depois as que mais sobem por real. Ficam de fora as incompatíveis pela ficha: encaixe e chipset, consumo além da fonte. A sugestão de processador no mesmo encaixe não filtra mais por linha: quem decide é a nota de cada modelo. Cada sugestão abre a página do produto, com os preços de todas as lojas.
- Formulário da busca com o que existe: cada opção (plataforma, chipset, linha, potência, selo, memória, capacidade, frequência, VRAM, marca, interface, radiador, formato) mostra quantos produtos em estoque há, contados pelas fichas, e some quando não há nenhum. Potência, capacidade, frequência, VRAM e radiador que o banco tiver em ao menos 3 produtos aparecem mesmo fora da lista fixa (1600 W, DDR5 24 GB, radiador de 480 mm). As contagens vêm de GET /api/search/options (guardadas por 1 min); sem resposta, o formulário fica com as listas fixas.
- Montagem confere mais coisas com a ficha técnica:
  - memória além do máximo da placa-mãe (erro);
  - memória acima dos MHz da placa (roda no máximo dela);
  - SSD M.2 em placa sem M.2 e SATA sem porta SATA;
  - placa de vídeo x8 em placa-mãe PCIe 3.0;
  - consumo da placa de vídeo pela ficha quando o chip não está na tabela;
  - fonte recomendada pelo fabricante da placa de vídeo como piso da recomendação.

  A geração do M.2 vem da ficha da placa, não mais do chipset (algumas B450 têm M.2 4.0).
- Card do resultado leva à página do produto: clicar na imagem ou no título abre /produto/<chave>, com a ficha e as ofertas de todas as lojas. Cada oferta que o site recebe passa a trazer a chave do produto.
- Site de volta para quem usa: sai a tela "Em manutenção", agora que busca, filtros e montagem leem as fichas técnicas.
- Busca, filtros e montagem pela ficha técnica. Cada oferta que o site recebe leva a ficha juntada do produto (lojas > título > web > à mão), e as specs que a ficha cobre passam a vir só dela, não do título: soquete, chipset, formato, memória, núcleos, VRAM, potência, selo, modular, radiador, soquetes do cooler, medidas. A escolha dos anúncios pelos termos do formulário também é pela ficha. A montagem volta a conferir as medidas (placa de vídeo no gabinete, altura do cooler, radiador), que estavam sem dados desde o refeito das fichas.
- Filtros da ficha no painel do resultado: um por campo da ficha da categoria que não tinha filtro próprio, com valores e contagens tirados do resultado. Exemplos: slots M.2, portas SATA e rede da placa-mãe; arquitetura, threads, cache e TDP do processador; comprimento, consumo, conector de 16 pinos e PCIe da placa de vídeo; leitura e escrita do SSD; conectores da fonte; tamanho, placa de vídeo e cooler até, frente e radiadores do gabinete; altura, ruído e soquetes do cooler. Número com muitos valores vira faixa (de / até).
- Admin, Fichas: "Editar" nos campos de qualquer produto. Abre todos os campos já com os valores de agora; o que mudar é salvo à mão e vale mais que lojas, título e web. Esvaziar um campo que estava à mão volta para o valor das outras origens.
- Admin, aba Servidor: "Máquina agora", um monitor tipo btop. Mostra CPU (total com o histórico de 2 min, cada núcleo, carga e temperatura), memória (em uso, cache e disponível, swap), rede, disco e os processos que mais usam, agrupados pelo nome, com a memória própria de cada um (sem contar várias vezes a que os processos do Chrome dividem). Lê o /proc a cada 2 s durante a sessão do admin. O servidor reaproveita a leitura entre consultas próximas. Sai o card "Memória da máquina", que contava o cache como memória em uso.
- Admin, Fichas por produto: "todas as categorias" no filtro de categoria, com as colunas categoria e o que falta (por exemplo, para ver de uma vez tudo o que "precisa de você").
- Fichas "precisa de você": produto só a web completa que a busca na web já perguntou e ainda está sem campo principal não é mais perguntado sozinho. Ele aparece no filtro "precisa de você" da lista de fichas e numa coluna da Cobertura, e no detalhe do produto há um campo para cada informação que falta (lista para as opções fechadas), validado como na busca na web. O preenchido à mão vale mais que tudo, inclusive a página, e o admin mostra a origem como "manual".
- Busca na web das fichas (admin, aba Busca na web; desligada por padrão): para os produtos "só a web completa", manda à IA do Google (Modo IA) o JSON de resposta da categoria, com todos os campos da ficha em branco e chaves autoexplicativas ("altura_mm", "soquetes", "tamanho"), para ela devolver preenchido; o código lê cada chave validando tipo, opções e faixa. Resposta de confiança baixa não entra. Cada produto é perguntado uma vez; usa o Chrome de uma loja, na fila dela; o Google pedindo verificação, ou a confirmação do Modo IA para pedido vindo pelo endereço, pausa a busca por 6 h, sem clicar nem tentar resolver, e sem pausar a loja. Aba própria no admin (Busca na web): "Perguntar agora", "Refazer" em cada produto, e a lista paginada dos já perguntados (filtro por categoria, resultado e título ou código) com o produto (código e link para a página dele), os valores aceitos, a confiança, o JSON como veio e a pergunta feita (com o link da mesma busca).
- Tamanho do gabinete estimado pelas placas-mãe que cabem (ATX: mid tower; E-ATX grande: full tower) e, sem ATX, pela maior medida, só depois de a busca na web não responder. Nos gabinetes com o tamanho informado, a regra acerta cerca de 4 em 5. O admin mostra o campo como "estimado".
- Admin, Fichas por produto: filtro "só a web completa" (incompletas com a página de todas as lojas lida), e a situação filtrada continua ao trocar de categoria (antes voltava a "qualquer situação").
- Selects com a seta afastada da borda direita (a nativa ficava colada).
- Ficha técnica completada pelo título dos anúncios: o que a página não trouxe e o título diz (potência e modular da fonte; chipset, soquete e formato da placa-mãe; tipo da memória; formato e interface do SSD; VRAM e barramento da placa de vídeo; soquete, núcleos e vídeo integrado do processador; tamanho e placas-mãe do gabinete). Também a arquitetura do processador pela geração e o consumo de referência do chip de vídeo. Vale na hora, com o que já está no banco: nenhuma página é aberta de novo.
- Valor padrão depois de ler a página: fonte não modular e sem certificação, gabinete sem ventoinhas, quando nem a página nem o título dizem. O admin mostra quando o campo veio do título ou é o padrão.
- Cache L3 do processador Intel pelo título ("Cache 30MB"; o da AMD é L2 + L3 somados e fica de fora) e na ficha escrito "Intel Smart Cache LLC: 30MB"; comprimento da placa de vídeo em "Board size: 331.9 x 150 x 70.4 mm"; fonte recomendada em "Minimum System Power Requirement (W): 550"; clocks com o MHz no rótulo ("Boost Clock (MHz): 2595", +29 boost e +25 base); PCIe da placa de vídeo sem pegar o "PCIe 8-pin" do conector de energia (14 placas lidas como "8.0").
- Desempenho e consumo das RX 480, RX 470, RX 460, RX 5500, RX 560 XT e GTX 950; RX 460, RX 560 e RX 5500 contam como PCIe x8.
- Admin, Coleta, painel da S2 (botões fora da tela por enquanto; a rota `POST /api/admin/stores/:id/probe` e a lógica continuam), dois testes que mostram o que a loja devolveu em cada página (produtos e páginas da lista, se abriu pelo clique ou pelo endereço, ou o bloqueio e a mensagem), gravam as ofertas como a rotina sem mexer na volta da categoria e aparecem em Consultas; bloqueio não pausa a loja, e loja em pausa ou sem páginas na hora recusa. "Testar página 2 de fonte" abre só essa página, direto pelo endereço (aba nova, sem passar pela 1). "Testar páginas 1 a 5" abre um endereço editável (padrão: a página de fontes filtrada por parâmetro) e vai às seguintes clicando no link da próxima, como a rotina, com o intervalo da varredura completa da loja entre as páginas, parando na primeira que não abrir.
- Lista paginada lida pelo clique: o link da próxima página é achado com os parâmetros em qualquer ordem, e a aba da lista fica aberta até 11 min parada (antes 90 s, menos que o intervalo que a varredura completa pode ter entre páginas).
- Rotina de preços por categoria: cada vez de uma loja lê a categoria inteira (todas as páginas com estoque) e passa à próxima, no intervalo de listagens da loja.
- Página do produto (`/produto/<chave>`): melhor preço com "Ver na Loja" no topo (como no card da busca), as outras ofertas abaixo, sem repetir a do topo (preço de cada loja, cupom, estoque; como na busca, só o novo vendido pela própria loja, com produto aberto e outros vendedores atrás de um botão; o melhor preço e o histórico também ficam sem eles), ficha técnica com todos os campos da categoria (o que falta aparece como "não informado"; quem usa vê só o valor, não de qual loja veio) e histórico de preço. Junta os anúncios do mesmo produto nas lojas. No ar mesmo com o resto do site em manutenção; por enquanto aberta pelo admin (aba Fichas, "Ver página do produto").
- Fichas técnicas refeitas do zero, para todas as categorias: cada uma com seus campos fixos, só o indispensável para quem monta ou faz upgrade (placa-mãe: chipset, soquete, formato, memória, PCIe, M.2, SATA, rede; processador: soquete, arquitetura, núcleos, threads, clocks, cache, TDP, vídeo integrado; placa de vídeo: chip, VRAM, memória, barramento, clocks, consumo, comprimento; memória, SSD, fonte, gabinete e cooler com os seus). Uma tabela por categoria no banco, uma coluna por campo: mudar a lista de campos cria ou apaga a coluna sozinho. A ficha de um produto junta as páginas de todas as lojas que o vendem (mesmo part number), campo a campo, guardando de onde veio cada um. O texto da ficha fica guardado: melhorar o leitor relê tudo sem abrir as páginas de novo. A rotina de fichas lê todas as categorias, o que a coleta achou há menos tempo primeiro, e só abre página de produto sem ficha completa.
- Admin, aba Fichas: a rotina de fichas (saiu da aba Produtos), a cobertura por categoria (completas, incompletas, não lidas, as que só a web completaria e os campos que mais faltam) e os produtos de cada categoria com os campos lidos, de onde veio cada um, o texto guardado da página e "Ler ficha".
- Tabela de desempenho: RX 9050 e RX 7650 GRE (índice pelas vizinhas na TechPowerUp, consumo e PCIe x8 da 7650 GRE).
- Rotina de preços só pelas páginas de categoria das lojas, nas três lojas e em qualquer modo: lê a lista de cada categoria até acabar o que está em estoque (as lojas listam os em estoque primeiro) e recomeça a cada `ROUTINE_REFRESH_H`. Anúncio novo só entra em estoque; no fim de cada volta, o que estava em estoque e não apareceu passa a "sem estoque" (com ponto no histórico), e volta ao estoque sozinho na volta seguinte em que aparecer. Uma categoria pode ter mais de um caminho na loja (separados por espaço, em Lojas). A S3 ganhou leitor de página de categoria (os cards dela não trazem a marca: lida do título) e do "ver mais".
- Admin, Coleta: "Varredura completa" por loja: pausa as rotinas de preços e de fichas e lê todas as categorias da loja até o fim da lista, esgotados também (anúncio esgotado que nunca esteve em estoque passa a entrar no banco: a página do produto mostra a loja como esgotada em vez de não mostrar). No fim, cada rotina volta a como estava, mesmo se o servidor reiniciar no meio. A rotina de preços continua lendo só o que está em estoque. Substitui o "Varrer agora" de uma categoria.
- Admin, Coleta: "Parar varredura" enquanto a varredura completa da loja roda. Varredura parada no meio (botão, bloqueio ou reinício) não deixa mais a categoria em modo completo: antes, a rotina continuaria aquela volta lendo os esgotados.
- Varredura completa configurável por loja no admin: intervalo entre páginas só dela ("uma página a cada 9 a 18 s"; as rotinas seguem com o da loja) e quais categorias ler. Fica guardado e vale também para a da madrugada.
- Varredura completa automática de madrugada, em todas as lojas, todo dia às `NIGHTLY_SWEEP_HOUR` (padrão 01:00), antes do backup das 04:30, com as mesmas pausas. O admin mostra a próxima e a última. Cobertura: anúncios em estoque, volta em andamento e última volta completa por loja e categoria.

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

- Rotina de fichas: produto cuja página dá erro (sem ser bloqueio da loja, ex.: a loja redireciona o endereço para ele mesmo) sai da fila por 6 h e a rotina segue para o próximo. Antes, tentava o mesmo produto a cada vez e travava a fila de fichas da loja. Com 2 falhas seguidas, a oferta daquela loja sai do app (busca, ofertas e página do produto), porque o "Ver na Loja" cairia numa página de erro; volta sozinha quando a página abrir de novo. Fica guardado no banco (tabela `page_errors`, migração 14).
- Chrome das lojas no servidor Linux com cara de navegador comum: em português (no Linux o Chrome ignorava `--lang` e os sites recebiam inglês com fuso de São Paulo; agora vai `--accept-lang=pt-BR` e o idioma do sistema em português) e janela no canto da tela virtual (a posição fora da tela, `-32000`, fica só no Windows: no Linux ninguém vê a tela e o site enxergava uma posição que não existe num monitor). No servidor, o Chrome troca `--disable-gpu` (que tirava o WebGL) por `--enable-unsafe-swiftshader` (WebGL desenhado na CPU).
- S2: páginas de categoria da segunda em diante passaram a cair na página de "manutenção" da loja (só no navegador do servidor). Agora a leitura da lista usa uma aba só e, da segunda página em diante, clica no link da página seguinte como uma pessoa (o site troca a lista sem recarregar, e os dados vêm do pedido que ele faz), em vez de abrir cada `?page=N` numa aba nova como endereço digitado.
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
