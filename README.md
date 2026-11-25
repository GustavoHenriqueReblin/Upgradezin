# Upgradezin

Buscador de preços de hardware no varejo brasileiro. Uma rotina no servidor acompanha os preços de três lojas configuráveis e guarda o histórico num banco local; o site responde na hora a partir dele, agrupa o mesmo produto entre lojas e filtra como as grandes lojas (potência, certificação, socket, chipset, linha do processador, modelo da placa de vídeo, capacidade e frequência da memória, marca…).

> **Status:** em desenvolvimento. Categorias disponíveis: **Fonte**, **Placa-Mãe**, **Processador**, **Placa de Vídeo**, **Memória RAM**, **SSD**, **Cooler** e **Gabinete**. Tema escuro.

## Recursos

- Os filtros de categoria consultam o catálogo local. A tela mostra a idade das ofertas e recebe atualizações conforme a rotina grava novos dados.
- Rotina de coleta: de tempos em tempos o servidor atualiza sozinho os preços de tudo o que o formulário de busca oferece e, na loja configurada para isso, lê cada categoria inteira, para todo produto à venda ter histórico. Mesmo cuidado de volume da busca; um ponto de histórico a cada mudança de preço, cupom ou estoque.
- O resultado de cada loja traz também o que o banco já tem dela e bate com a busca (ex. buscar AM4 acha o processador AM4 que veio da coleta de "Ryzen 7"), inclusive de loja bloqueada naquela hora, com a idade de cada preço.
- Preço à vista (PIX) em destaque, já com o cupom anunciado pela loja quando houver, e a idade da coleta.
- Mesmo modelo em várias lojas vira um card, com o menor preço em destaque.
- Histórico de preço de cada produto: gráfico por loja (30 dias, 90 dias ou tudo) e o selo "Menor Preço em 30 Dias" quando o preço de agora é o menor do período.
- Filtros calculados dos próprios resultados, com contagem, sem refazer a busca; ordenação por preço, maior desconto e as de cada categoria (eficiência, R$ por watt, núcleos…).
- Só produto novo vendido pela loja, por padrão.
- Trocar de categoria e voltar não refaz a busca, e a categoria e os filtros ficam salvos no navegador: reabrir o app volta onde estava.
- Montar pelo orçamento: diga quanto quer gastar e o app recomenda um PC completo ou um upgrade para as peças informadas no seu PC. Escolha Jogos, Jogos e Trabalho ou Produtividade e compare ofertas recentes em estoque ou referências de preços históricos no modo PC Ideal. O resultado vai para a montagem.
- Montar o PC peça por peça: a busca usa os filtros das peças já escolhidas e a compatibilidade é conferida a cada troca. A memória aceita quantidade, e a montagem aceita múltiplos discos NVMe e SATA, com total por loja e na melhor combinação.
- Informar o PC atual: escolha peças na montagem e marque **Já Tenho** ou importe um relatório do CPU-Z. A importação preenche automaticamente a montagem, incluindo os discos, e o relatório é lido no navegador. As peças atuais ficam fora do total de compra.
- Identificar gargalo: usa as peças atuais para indicar o que limita o desempenho e sugerir trocas. O diagnóstico aproveita os dados medidos quando há relatório. Sem dados do monitor, considera Full HD a 60 Hz.
- Comparar hardware: selecione peças pela busca, pela página do produto ou pelas sugestões de upgrade. As abas mostram preços e fichas por categoria. Para CPUs e GPUs, o comparador mostra desempenho estimado e desempenho por real. Com uma CPU atual informada, a aba de processadores também mostra essa referência e a compatibilidade com a plataforma.
- O filtro de texto pesquisa nos resultados já carregados. A consulta direta por texto nas lojas está desativada na interface.
- Admin em `/admin` (login fixo do `.env`) para quem opera o servidor: configuração das lojas, rotina por loja (liga e desliga), intervalos de cada loja (um para páginas de lista e outro para páginas de produto, "uma página a cada X a Y s"), busca ao vivo por loja (consultar ou não quando alguém pesquisa no site), fila de cada loja com as buscas do site e da rotina esperando, contagem até a próxima consulta), pausar e tirar pausa, coletar agora, registro de cada consulta e dos bloqueios, cobertura por loja e categoria, modelos sem índice de desempenho, produtos catalogados (lista paginada com filtros, specs, ficha técnica, "Ler ficha") e a rotina de fichas, separada da coleta (ligar, parar, lojas, intervalo de fichas de cada loja, andamento por loja), termos, consultas ao vivo, atividade do site (sem IP), backups e merge de outro banco.
- Como visitante, a montagem fica no navegador. Com login, as alterações são guardadas na conta no SQLite. Compartilhar gera um link curto para abrir ou copiar a montagem com os preços mais recentes.

## Rodando

Requisitos: Node 22.13+ (SQLite embutido), pnpm e Google Chrome instalado.

```bash
pnpm install
pnpm chrome-setup     # uma vez: instala a extensão leitora no Chrome de cada loja
pnpm dev              # http://localhost:5173
```

O banco (`data/upgradezin.db`, fora do git) é criado na primeira execução e enchido pela rotina de coleta e pelas buscas.

Pelo terminal:

```bash
pnpm scan 750W,850W
pnpm scan B550 --category=motherboard
pnpm scan 850W --stores=s1 --json
pnpm scan --sweep          # confere os caminhos de varredura (admin, Lojas; antes STORE_Sx_SWEEP), sem gravar
```

Todas as lojas são lidas do mesmo jeito: um Chrome comum por loja (perfil em `data/chrome/<loja>`, janela fora da tela), sem porta de depuração nem Playwright. A extensão em `apps/server/extension` abre cada página numa aba nova, lê o HTML, devolve ao app por uma porta local (`EXT_PORT`, só `127.0.0.1`) e fecha a aba; a aba de controle da extensão fica sempre aberta. No Chrome comum a extensão é instalada uma vez por loja (`pnpm chrome-setup`); no Chromium ela carrega sozinha. Quando uma loja barra a consulta, a tela mostra "não deu para consultar agora" e um botão para abrir a mesma busca no site da loja. `pnpm dev`, `pnpm scan` e `pnpm routine-test` usam a mesma porta local: um de cada vez.

A rotina de preços percorre as páginas das categorias e retoma de onde parou. O admin configura dois intervalos por loja, de 2 a 600 segundos, um para listagens e outro para fichas de produto. Uma loja bloqueada fica em pausa enquanto as outras seguem. Consulte a seção de coleta para os valores padrão e as regras de execução.

As lojas são identificadas no código só por ID (`s1`, `s2`, `s3`). Nome, endereço, busca e cor de cada uma ficam no banco e são editados no admin (`/admin`, aba Lojas). Para começar, copie o [.env.example](.env.example) para `.env` e preencha: na primeira vez, o servidor copia as lojas dele para o banco. O mesmo arquivo tem as demais configurações, inclusive o usuário e a senha do admin (`ADMIN_USER`, `ADMIN_PASSWORD`).

## Login com Google

Configure um cliente OAuth do tipo **Aplicativo da Web** no Google Cloud e defina `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REDIRECT_URI` no `.env`. Cadastre no cliente a URI de redirecionamento exata, como `http://localhost:5173/api/account/google/callback` em desenvolvimento. Em produção, use o domínio público em HTTPS com o mesmo caminho.

Ao entrar, a conta carrega os dados do SQLite. As alterações seguintes são salvas na conta. O que foi preenchido como visitante permanece separado.

Em **Minha Conta**, o usuário pode salvar, alterar ou remover o CEP de entrega. A cotação de frete pelas lojas ainda está planejada.

## Teste do orçamento

Com uma base local preenchida, execute a matriz ampliada no Node 22.16 ou superior. O teste trabalha sobre uma cópia temporária da base.

```bash
pnpm budget-test --expanded --reread-sheets --output=.vitest/budget-local.json
```

## Versões

A versão fica no `package.json` (a da raiz vale para o app todo) e aparece no rodapé da tela inicial e em `GET /api/version`. O que mudou em cada uma está no [CHANGELOG.md](CHANGELOG.md).

Para lançar uma versão nova: anote as mudanças em "Não lançado" no CHANGELOG ao longo do caminho e, na hora de lançar, rode `pnpm release 0.2.0`. Ele atualiza a versão de todos os pacotes, transforma "Não lançado" na versão nova com a data e mostra os comandos de commit, tag (`v0.2.0`) e push.

## Documentação

- [docs/PROJECT.md](docs/PROJECT.md): visão consolidada (objetivos, estado atual, implementado × planejado, regras, algoritmos, decisões, problemas conhecidos, roadmap). Agentes de código: [AGENTS.md](AGENTS.md).
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): arquitetura, investigação das lojas, decisões e questões em aberto.

## Uso responsável

Projeto pessoal, não comercial, self-hosted. Volume de uma pessoa consultando: as lojas em paralelo, mas em cada uma só uma requisição por vez (busca e rotina na mesma fila), com intervalo entre páginas e limite por hora; a rotina usa só parte desse limite. Bloqueio pausa a loja e a busca segue nas outras.

## Licença

Código proprietário: todos os direitos reservados. Nenhuma licença de uso, cópia ou distribuição é concedida; ver [LICENSE](LICENSE).
