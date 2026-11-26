# Arquitetura: Upgradezin

> Documento vivo. Descreve a arquitetura, as decisões tomadas e as que ainda estão em aberto. Atualizado a cada etapa implementada.
>
> **Status:** categorias **Fonte**, **Placa-mãe**, **Processador**, **Placa de vídeo**, **Memória RAM**, **SSD**, **Cooler** e **Gabinete** disponíveis, com preços guardados num SQLite local (rotina de coleta nas três lojas, S2 e S3 em modo lento; a busca do site consulta na hora quando falta ou quando pedem para atualizar), histórico de preço, filtros, cupons e montagem do PC com compartilhamento por link. S1 funciona de ponta a ponta; S3 funciona com o Chrome instalado; S2 responde a primeira página e depois limita a frequência (ver [§4.4](#44-proteção-anti-bot)).

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Escopo](#2-escopo)
3. [Arquitetura](#3-arquitetura)
4. [Coleta](#4-coleta)
5. [Fontes de dados](#5-fontes-de-dados)
6. [Normalização e agrupamento](#6-normalização-e-agrupamento)
7. [Filtros (facetas)](#7-filtros-facetas)
8. [Persistência](#8-persistência)
9. [API e frontend](#9-api-e-frontend)
10. [Segurança e privacidade](#10-segurança-e-privacidade)
11. [Stack e estrutura](#11-stack-e-estrutura)
12. [Testes](#12-testes)
13. [Execução e deploy](#13-execução-e-deploy)
14. [Roadmap](#14-roadmap)
15. [Registro de decisões](#15-registro-de-decisões)
16. [Questões em aberto](#16-questões-em-aberto)
17. [Ideias futuras](#17-ideias-futuras)

---

## 1. Visão geral

Buscador de preços de hardware no varejo brasileiro. Uma **rotina no servidor** consulta as lojas e grava os preços num SQLite local; o site lê desse banco (e consulta a loja na hora só quando falta ou está velho). Normaliza os anúncios e permite filtrar com a granularidade dos filtros das grandes lojas (potência, certificação, cabeamento, marca, socket, chipset…), comparando o mesmo produto entre lojas.

Princípios:

- **Preço real e recente:** coletado pela rotina (ou na hora, se faltar ou o usuário pedir); preço à vista (PIX) separado do parcelado; sempre mostra quando o preço foi coletado.
- **Comparação por produto, não por anúncio:** o mesmo modelo em N lojas vira um item com N ofertas.
- **Volume de pessoa:** em cada loja, uma requisição por vez (busca do site e rotina na mesma fila), intervalo entre páginas, limite por hora; fonte de dados mais leve disponível em cada loja.
- **Simples:** um processo e um arquivo SQLite local (preços e montagens compartilhadas), sem serviço de banco.

## 2. Escopo

### Dentro

- Lojas: três lojas de hardware que vendem e entregam o próprio estoque. No código e na documentação são só **S1**, **S2** e **S3**; nome, domínio e endereços ficam no banco do servidor, editados no admin ([§4.7](#47-lojas-por-id)).
- Categorias: **fonte**, **placa-mãe**, **processador**, **placa de vídeo**, **memória RAM**, **SSD**, **cooler** e **gabinete**.
- Somente produto novo vendido pela loja (marketplace e open box escondidos por padrão, mas visíveis se o usuário quiser).
- Uso self-hosted, poucos usuários.

### Fora

- **Marketplaces abertos** (Mercado Livre, Amazon marketplace, AliExpress): risco alto de produto usado ou com defeito vendido como novo e pouco controle sobre o vendedor. Ver [ADR-003](#adr-003-sem-marketplaces-abertos).
- Usado, recondicionado, vitrine.
- Checkout, afiliados, uso comercial.

## 3. Arquitetura

```
 ┌──────────────┐  EventSource (SSE)   ┌───────────────────────────────────────────┐
 │  apps/web    │◄────────────────────►│ apps/server (Fastify)                     │
 │  React SPA   │  status + ofertas    │                                           │
 │              │  por loja            │  /api/search/stream                       │
 │  filtros e   │                      │        │                                  │
 │  agrupamento │                      │        ▼                                  │
 │  no cliente  │                      │  search.ts ◄── SQLite ◄── routine.ts      │
 └──────────────┘                      │        │ (sempre, prioritária) (15 s–1 min)│
                                       │        ▼                                  │
                                       │  collect.ts: fila por loja → grava no DB  │
                                       │        │  lojas em paralelo               │
                                       │   ┌────┴──────────┬───────────────┐       │
                                       │   ▼               ▼               ▼       │
                                       │  s1              s2              s3       │
                                       │   └───────────────┼───────────────┘       │
                                       │        browser.ts: loadPage(loja, url)    │
                                       │        Chrome comum por loja + extensão   │
                                       │        (aba nova por página, fecha a aba) │
                                       │                   ▼                       │
                                       │ normalize (packages/shared)               │
                                       └───────────────────────────────────────────┘
```

Fluxo de uma busca:

1. O usuário escolhe a categoria e **monta a busca** antes de qualquer requisição (ex. potências 750 W e 850 W; plataforma AM4 e chipset B550). Cada escolha vira um termo (`750W`, `850W`, `B550`). Nunca se busca a categoria inteira: a API recusa busca sem termo.
2. A UI abre `GET /api/search/stream?category=psu&terms=750W,850W` (SSE). Os termos do formulário **não vão às lojas**: para cada loja, `search.ts` responde na hora com os anúncios do banco (lidos pela rotina nas páginas de categoria, [§8.2](#82-preços-e-rotina-de-coleta)) que batem com algum termo pelas specs, com a data da última volta da rotina pela categoria. Só o texto livre ("Não achou? Buscar nas lojas", `text=1`) vai à loja: o banco (títulos com todas as palavras) na hora e a busca da própria loja, **na frente da rotina** na fila dela, nas lojas com **busca ao vivo** ligada no admin; o resultado troca quando chega e o que ela trouxer vai para o banco. O mesmo texto na mesma loja não vai de novo antes de `REVALIDATE_MIN` (10 min). **Sair da página não interrompe:** a consulta que já saiu termina e grava no banco.
3. Cada adapter devolve `Offer[]` já normalizadas (specs extraídas, chave de modelo). O servidor emite `status` a cada página.
4. Cada página lida já é enviada (`offers` com `partial: true`), e a UI mostra resultados enquanto as lojas ainda paginam. Ao fim de cada loja, a lista final substitui os parciais.
5. A UI agrupa e filtra **no cliente**: mudar filtro não refaz a busca. Refazer só quando muda o termo.
6. Em paralelo, a **rotina** ([§8.2](#82-preços-e-rotina-de-coleta)) mantém o banco atualizado sozinha, lendo a página de cada categoria em cada loja (só o que está em estoque). Duas buscas do mesmo texto na mesma loja compartilham a mesma execução.
7. O Chrome de cada loja fica aberto entre as consultas (cada consulta abre e fecha só a própria aba); fecha quando o servidor para.

## 4. Coleta

### 4.1 Por que self-hosted

As lojas bloqueiam ou desafiam faixas de IP de datacenter. A coleta roda num host próprio, em conexão residencial, com navegador real. É uma restrição de arquitetura, não detalhe de deploy.

### 4.2 Um caminho até a loja, leitura por camadas

Todas as lojas chegam à página do mesmo jeito: `loadPage(loja, url)` (`browser.ts`) abre a página numa aba nova do Chrome da loja, espera o HTML estar lido (`document.readyState` interativo; não espera o carregamento completo da aba, que na S1 nunca termina por causa de anúncios e rastreadores e fazia cada página levar os 45 s do limite) e, se pedido, um seletor aparecer, devolve o HTML, o endereço final e o título, e fecha a aba. Até nov/2026 a S1 era lida por HTTP direto e S2/S3 pelo Playwright; ver [ADR-004](#adr-004-navegador-padrão-e-pausa-no-bloqueio).

No HTML lido, cada adapter usa a fonte mais estruturada que houver:

1. **Dados embutidos** (`__NEXT_DATA__` na S1, payload RSC do Next.js na S2, atributos `data-*` na S3).
2. **Seletores CSS** sobre o DOM (linkedom, no servidor).
3. **Regex** em texto visível, só para campos isolados (ex. o texto do cupom na página do produto da S1).

### 4.3 Política de coleta

Volume parecido com o de uma pessoa consultando à mão. Inegociável:

- **Em cada loja, uma requisição por vez, com dois intervalos:** rotina, varredura completa, fichas, busca do site e testes entram na **mesma fila por loja** (`withStore` em `pace.ts`). Cada loja tem dois intervalos no admin (de 2 a 600 s cada, "uma página a cada X a Y s"): o de **listagens** (páginas de categoria, da busca e dos testes: "/fonte", "/fonte?page=2"…; aba Coleta, Rotina de preços; padrão 15–30 s; `meta` `interval:<loja>`) e o de **fichas** (páginas de produto; aba Fichas; padrão 10–20 s; `meta` `sheet-interval:<loja>`). Cada consulta espera um tempo aleatório dentro do intervalo do seu tipo desde a anterior do mesmo tipo, e nunca menos que o de fichas desde a anterior de qualquer tipo.
- **Lojas em paralelo:** cada loja tem a própria fila e o próprio Chrome; uma loja lenta ou bloqueada não atrasa as outras. Na fila de cada loja, a busca do site passa na frente da rotina (a consulta em andamento termina antes).
- **Limite de páginas por loja por hora** (`MAX_PAGES_PER_HOUR`, padrão 30, janela deslizante). Estourou: a loja é pulada até liberar, a UI mostra quando libera e as outras lojas seguem. A rotina só usa até `ROUTINE_PAGES_PER_HOUR` (padrão 12) desse total, contando as páginas da busca do site; o resto fica para quem busca.
- **Limite de páginas por busca** (`MAX_PAGES_*`) e parada antecipada quando a relevância acaba.
- **Banco em vez de repetir consulta:** o site lê do SQLite; a loja só é consultada pela rotina (páginas de categoria) ou pela busca por texto que o usuário pede. Buscas idênticas simultâneas são deduplicadas.
- **Navegador:** todas as lojas pelo mesmo caminho (`browser.ts`, `loadPage`): um Google Chrome comum por loja, sem porta de depuração e sem Playwright, com perfil fixo em `data/chrome/<loja>`. A extensão em `apps/server/extension` abre cada página numa aba, lê o HTML e fecha a aba; o app conversa com ela por uma porta local (`EXT_PORT`, só 127.0.0.1, com token por execução). Ver [ADR-004](#adr-004-navegador-padrão-e-pausa-no-bloqueio).
- **Bloqueio = parar:** página de desafio ("Confirme que é humano"), de "manutenção" ou sem os dados de produto esperados colocam a loja em **backoff exponencial** (15 min → 1 h → 6 h → 24 h; `BACKOFF_ENABLED=false` desliga, e o bloqueio só fica no registro). O código HTTP não é visto (a extensão lê a página como o navegador mostra), então o bloqueio é reconhecido pelo título e pelo conteúdo. A pausa fica no banco (`meta`, chave `backoff:<loja>`): reiniciar o servidor não a zera. Consulta que estava na fila atrás da que bloqueou não vai à loja (não conta como bloqueio novo nem sobe a escada). A UI mostra o status, oferece "Ver na <loja>", e a busca segue com as outras lojas.
- **Busca ao vivo por loja:** chave do admin. Ligada (padrão), a busca do site consulta a loja na hora, na frente da rotina; desligada, mostra só o banco. A busca respeita o intervalo de listagens da loja.

### 4.4 Proteção anti-bot

| Situação | Comportamento |
|---|---|
| **Google Chrome comum, sem porta de depuração, lido pela extensão do projeto** (o que o app usa hoje, nas três lojas) | Para a loja é um Chrome comum com uma extensão: `navigator.webdriver` falso, sem `--enable-automation`, sem emulação de tela, idioma ou fuso. Medido em nov/2026 com a rotina de verdade (`pnpm routine-test`): 13 de 14 consultas boas nas lojas com anti-robô (a outra foi um redirecionamento para a categoria, não bloqueio), contra bloqueio na 2ª consulta pelo Playwright. |
| Chrome conectado pela porta de depuração (`--remote-debugging-port`, com ou sem Playwright) | O próprio Chrome passa a se declarar automatizado (`navigator.webdriver = true`); as lojas bloqueiam da 2ª página em diante. Não usar. |
| Chromium headless | Barrado pela proteção anti-bot de S2 e S3. Não usar. |
| (histórico) Google Chrome instalado, aberto pelo Playwright em **sessão anônima** (`channel: chrome`, contexto novo, nada salvo em disco), com janela | Sem nenhuma modificação: o navegador continua se identificando como automatizado. Testado: a S3 responde normalmente; a S2 responde a primeira página e limita a frequência logo depois (página de "manutenção"). Medido em nov/2026: não é limite por IP nem por frequência. Na mesma rede, a 2ª página da mesma sessão levou 403 "Site em Manutenção" 45 s depois da 1ª, e uma sessão nova respondeu normal logo em seguida (e o Chrome comum da pessoa navegava na loja ao mesmo tempo). A detecção da página marca a sessão automatizada (`navigator.webdriver`) e daí em diante tudo dela é recusado. Hoje a S2 rende 1 página por consulta, por isso as buscas específicas ("Buscar nas lojas" do filtro de texto) valem mais nela. |
| Desafio interativo ("Confirme que é humano") ou página de bloqueio disfarçada (S2 responde 403 com "Site em Manutenção" só para o navegador automatizado) | A loja entra em backoff e a UI mostra "não deu para consultar agora" com um botão **"Ver na <loja>"**, que abre a mesma busca no site da loja, no navegador do próprio usuário. Opcional para quem opera o servidor: `MANUAL_CHALLENGE_WAIT_S` > 0 faz a busca esperar alguém resolver na janela do Chrome **da máquina do servidor** (padrão 0; o usuário final nunca vê essa janela). |
| Headless (`HeadlessChrome` no user-agent) | Barrado. Trocar o user-agent seria falsificar: não usar. |
| Janela fora da área visível (`--window-position=-32000,-32000` no Windows, padrão via `BROWSER_HIDE_WINDOW`) | Para o site é o mesmo Chrome com janela; o usuário não vê. No Linux a janela fica em `0,0`: a tela virtual já é invisível, e uma posição negativa enorme não existe num monitor real (o site lê `window.screenX`). Duas flags de desempenho (`CalculateNativeWinOcclusion` desligado, `--disable-backgrounding-occluded-windows`) evitam que o Chrome desacelere a janela escondida. Testado na S3: normal. |
| Interceptar rede ou minimizar a janela | Quebra o desafio. Não usar. |

Num servidor Linux sem tela, o Chrome roda sob `xvfb-run`. O app abre o Chrome em português (`--accept-lang=pt-BR` e `LANG=pt_BR.UTF-8`, porque no Linux o `--lang` é ignorado) e com o WebGL desenhado por software: sem GPU, o servidor passa `--enable-unsafe-swiftshader` (no script do `CHROME_PATH`; `--disable-gpu` tirava o WebGL), e um navegador sem WebGL é um sinal forte de robô para as lojas. Lá não dá para clicar na instalação da extensão: com o Chromium (`CHROME_PATH`), ela carrega sozinha pelo `--load-extension` que o app sempre passa (o Chrome comum ignora essa flag desde a versão 137). Para o modo assistido nesse cenário, é preciso acesso à tela virtual (VNC). Ver [§16](#16-questões-em-aberto).

### 4.5 Contrato do adapter

```ts
interface StoreAdapter {
  id: StoreId;
  search(ctx: SearchContext): Promise<Offer[]>;
  // Uma página da categoria (rotina de preços): as ofertas, páginas da lista e itens em estoque na página.
  sweepPage?(ctx: { category; url; page; signal }): Promise<{ offers: Offer[]; totalPages: number; inStock: number }>;
  // Opcional: HTML do bloco da ficha técnica da página do produto (as três lojas leem).
  productSheet?(sku: string, signal: AbortSignal): Promise<string | null>;
}

interface SearchContext {
  category: CategoryId;
  q: string;                     // o texto livre da busca ("Rise Mode Zeus")
  signal: AbortSignal;           // cancelado se o servidor desliga
  onPage?(info: { page; total?; found; offers }): void;  // progresso + ofertas da página
  onNeedsHuman?(): void;         // loja pediu verificação (só com MANUAL_CHALLENGE_WAIT_S > 0)
}

// browser.ts: o único caminho até as lojas.
loadPage(store, url, { signal?, onNeedsHuman?, waitFor?, recheck?, recheckMs? }): Promise<{ html; url; title }>
```

Adapters não conhecem cache, fila nem navegador: montam a URL, chamam `takePage` antes de cada página (limite por hora) e `loadPage` para ler (abre a aba, detecta desafio e "manutenção", devolve o HTML e o endereço final, fecha a aba). O redirecionamento para a página da categoria é reconhecido pelo endereço final (S1 reabre o destino com a paginação; S2 lança `SearchRedirectError`). Cada adapter expõe funções puras de parsing (`parseS1Html`, `couponFromS1ProductHtml`, `parseS2Rsc`, `parseS3Cards`, `mapS3Card`…), testadas com páginas reais recortadas, e nos testes `usePageLoader` troca o Chrome por fixtures ([§12](#12-testes)).

### 4.6 Falhas e depuração

- Com `DEBUG_DUMPS=1`, página sem itens esperados ou bloqueada gera HTML + screenshot em `data/debug/` (fora do git). Página de produto sem o bloco da ficha técnica também guarda a página inteira (`<data>-<loja>-ficha-<categoria>-<código>.html`), para conferir se a ficha faltou no anúncio ou no leitor da loja.
- `pnpm scan <termo>[,<termo>…] [--category=<categoria>] [--stores=s1,s2] [--json] [--top=N]` roda a busca pelo terminal, como a do site (termos do formulário pelo banco; texto livre também nas lojas).
- `pnpm scan --sweep [--category=<categoria>] [--stores=s1]` lê a primeira página de cada caminho de categoria (configuração da loja no admin, aba Lojas), sem gravar, para conferir.
- `pnpm routine-test [--stores=s2,s3] [--categories=gpu,ssd] [--keep-open]` lê de verdade a 1ª página de cada categoria em cada loja (pelo mesmo `collectSweepPage` da rotina), grava como a rotina e salva um relatório em `data/debug/`.
- A ficha lida fica com o texto no banco (`sheet_pages`): melhorar o leitor e subir o número `READER_VERSION` relê tudo ao subir o servidor, sem abrir as páginas de novo ([§8.3](#83-fichas-técnicas)).
- `pnpm chrome-setup [--stores=…]` abre o Chrome de cada loja na página de extensões para instalar a extensão uma vez e confere se ela conectou.
- `BROWSER_HIDE_WINDOW=false` mostra as janelas; `BROWSER_STEP_MS=1000` espera 1 s a cada passo (abrir aba, abrir página, ler, fechar) e escreve o passo no terminal.
- `pnpm dev`, `pnpm scan`, `pnpm routine-test` e `pnpm chrome-setup` usam a mesma porta local da extensão (`EXT_PORT`): um de cada vez.

### 4.7 Lojas por ID

O código, os testes e esta documentação identificam as lojas só por ID (`s1`, `s2`, `s3`). O que identifica cada loja fica no banco do servidor (tabela `store_configs`, fora do git), editado no admin, aba **Lojas** ([§9.3](#93-admin-admin)): salvar vale na hora, sem reiniciar. Na primeira vez que o servidor sobe com a migração 7, ele copia para o banco o que estiver nas variáveis abaixo do `.env`; depois disso, elas não valem mais (testes e `pnpm scan` sem banco ainda as usam). O `.env.example` traz só valores de exemplo:

| Variável | Exemplo | Uso |
|---|---|---|
| `STORE_S1_NAME` | `Loja 1` | nome exibido na tela |
| `STORE_S1_URL` | `https://www.loja1.example` | origem do site (links de produto, página de cupom) |
| `STORE_S1_SEARCH` | `/busca/{slug}` | caminho da busca; marcador `{q}`, `{q+}` ou `{slug}` |
| `STORE_S1_CATEGORIES` | `psu:caminho/fontes,motherboard:caminho/placas` | caminho da categoria na loja, quando o adapter filtra por ele |
| `STORE_S1_SWEEP` | `psu:/caminho/fontes,cooler:/caminho/air /caminho/water` | página de cada categoria no site (começa com `/`; mais de uma separadas por espaço), lida pela rotina de preços ([§8.2](#82-preços-e-rotina-de-coleta)) |
| `STORE_S1_COLOR` | `"#22c55e"` | cor da loja na tela (bolinha nos cards, status e totais); entre aspas, porque no `.env` o `#` sem aspas começa um comentário (sem `#` também vale); opcional, sem ela vale uma cor padrão por ID; duas ou três cores separadas por vírgula (`"#ffc300,#e30613"`) viram degradê na bolinha |

- `apps/server/src/stores.ts` guarda a configuração (`useStoreStorage` copia do `.env` na primeira vez e lê do banco; `saveStoreConfig` salva o que vem do admin). Loja sem nome, URL ou busca, ou desligada no admin, não é consultada.
- O admin valida o que salva (o `.env` é tolerante e ignora o que não vale): site só origem `https`, busca começando com `/` e com marcador, varredura só caminho do próprio site, cores `#rrggbb`. Os valores vão para URLs que o servidor abre e para o estilo da página.
- A interface recebe nomes e links de busca de `GET /api/stores` e não tem nenhum nome fixo.
- Cada adapter continua específico do tipo de site (dados embutidos, seletores), mas sem nome nem domínio no código.

## 5. Fontes de dados

Registro da investigação de cada loja. Só abordagem técnica.

| | S1 | S2 | S3 |
|---|---|---|---|
| Acesso | Chrome + extensão (como todas) | Chrome + extensão (Cloudflare) | Chrome + extensão (Cloudflare) |
| Onde estão os dados | `__NEXT_DATA__` → `props.pageProps.data.catalogServer` | payload RSC (`self.__next_f`) → `{"products":{"items":[…]}}` | atributos `data-tss-*` + DOM do card |
| Itens por página | até 120 (`page_size`; pedir mais devolve 120), 1 página por termo | 36 | até 300, página única |
| Preço à vista | `offer.priceWithDiscount` (oferta temporária, só enquanto `offer.endsAt` não passou e `offer.quantityAvailable` > 0; o card mostra prazo e estoque da oferta) ou `priceWithDiscount` | `<prefixo>_prices.avista` | `data-tss-price` |
| Parcelado | `maxInstallment` ("10x de R$ …") | `final_price` / `max_installments` | spans de `.product-item__juros` |
| Estoque | `available` (`quantity` só vale dentro de oferta: fora dela vem 0 com o produto à venda) | `stock_status` | `data-tss-estoque` |
| Identificadores | código interno; part number no fim do título | `sku` (part number), `codigo_barra` (EAN) | id interno |
| Vendedor | `sellerName`, `flags.isMarketplace` | próprio | próprio |
| Facetas nativas | `meta.filters` (marca, 80 Plus, cabeamento, preço) | `aggregations` | sidebar de filtros (marca, estoque) |
| Particularidades | Termo que coincide com categoria redireciona e perde os parâmetros: o adapter vê pelo endereço final da aba e reabre o destino com a paginação. | Busca ampla (traz PCs montados); filtra pela categoria da loja (`url_path`, configurado em `STORE_S2_CATEGORIES`) e para quando a página tem menos de 20% de itens da categoria. Os dados são lidos do HTML da aba (o DOM serializado), porque depois da hidratação o Next.js esvazia `self.__next_f`. Com o navegador automatizado, limitava na 2ª consulta (página de "manutenção"); com a extensão, não. Na rotina, até **3 páginas por termo** (`MAX_PAGES_S2`; antes 1, por causa do limite da loja); na busca do site, só a 1ª (`SEARCH_MAX_PAGES`, vale para todas as lojas), porque o intervalo antes da 2ª página dobrava o tempo da consulta (medido em nov/2026: "Ryzen 7" 29 itens na 1ª página e 0 na 2ª; "AM4" 33, 32, 34). Varredura de categoria (`sweepPage`): a página da categoria aberta direto, com `?page=N`. Às vezes responde só a casca da busca, sem o bloco de produtos: tratado como bloqueio (não como "0 resultados"). | Busca devolve até 300 itens numa página só; a categoria é filtrada pelo título e o filtro de potência na UI deixa só as escolhidas. |
| Tempo medido (Chrome aberto, nov/2026) | ~1,5 s por página (+ ~3 s por cupom novo, que abre a página de um produto) | ~3 s por página, mais o intervalo entre páginas | ~1,5–2 s |

## 6. Normalização e agrupamento

Código em `packages/shared`, usado pelo servidor e pela UI. `categorize.ts` é o ponto único por categoria: o anúncio pertence à categoria? quais specs? qual chave de modelo? Os adapters chamam `matchesCategory` / `normalizeListing` e não conhecem regras de categoria.

### 6.1 Pipeline

```
anúncio bruto da loja
  → categoria na loja (S1: caminho da categoria; S2: url_path; ambos em STORE_*_CATEGORIES;
    S3: só título)
  → regra da categoria sobre o título (descarta kit, combo, notebook, acessório…)
  → specs do título + campos estruturados da loja quando confiáveis
  → marca normalizada (aliases)
  → chave de modelo da categoria
  → Offer
```

| Categoria | Specs extraídas | Chave de modelo |
|---|---|---|
| Fonte | potência (S2: campo `potencia`), eficiência 80 Plus/Cybenetics, cabeamento, ATX 3.0/3.1, PCIe 5 / 12V-2x6 | marca + palavras até a potência (`xpg kyber 750`) |
| Processador | linha (Ryzen 5, Core i5, Core Ultra 7…), modelo com sufixo, geração (do número do modelo: "12400F" → 12ª), socket (do título ou deduzido do modelo), núcleos e threads, vídeo integrado (do título ou do sufixo: F sem, G com; Ryzen AM5 sem F tem), cooler (só quando o anúncio diz; part number AMD "WOF" = sem fan), desbloqueado (Intel K, todo Ryzen) | fabricante + linha + modelo (`amd ryzen 7 5700x`), tray/OEM separado |
| Placa de vídeo | fabricante do chip, série e modelo do chip ("RTX 50" / "RTX 5060 Ti", "RX 9000" / "RX 9060 XT"), VRAM, tipo de memória (GDDR6/6X/7), low profile, cor e RGB | marca + chip + VRAM + palavras da linha em ordem alfabética (`gigabyte rtx 5060 8gb eagle max oc`), porque cada loja escreve numa ordem |
| Memória RAM | tipo (DDR4/DDR5), capacidade total e pentes ("32GB (2x16GB)" → 32 GB, 2 pentes), frequência (MHz ou MT/s), latência (CL), cor e RGB | marca + palavras da linha (sem números, em ordem alfabética) + capacidade, pentes, tipo, frequência, RGB e cor |
| SSD | interface (NVMe/SATA; M.2 sem interface no título: pela leitura, já que SATA não passa de ~560 MB/s), formato (M.2/2,5"), capacidade ("1TB", "480GB", "512G", "1T"; filtro por faixa: 480–512 GB juntos), geração PCIe, leitura (MB/s). Descarta acessório (dissipador, case, adaptador), externo e de servidor; "HD SSD", "Disco Sólido…" e "SSD … com Dissipador" são SSD |
| Cooler | tipo (air/water), radiador (120–420 mm), fabricantes ("Intel e AMD", "Intel-amd", universal) e encaixes listados (AM4, AM5, LGA1851, LGA1700, LGA1200, LGA115x), TDP quando o título diz. Descarta ventoinha avulsa, kit com processador, tela de monitoramento, cooler de notebook ou de placa de vídeo |
| Gabinete | maior placa que cabe (o maior formato citado; sem formato, pela torre: full = E-ATX, mid = ATX, mini = Micro-ATX), torre, vidro, fans inclusos ("Sem fans" = 0). Descarta tela de monitoramento e kits |
| Placa-mãe | chipset (lista conhecida por socket), socket (do título ou deduzido do chipset), formato (do título ou do sufixo M/I do modelo), DDR4/DDR5 (do título ou deduzido do socket), Wi-Fi | marca + palavras do modelo até a 1ª vírgula, sem termos de spec (`msi b550m a pro`); variantes Wi-Fi (AX/AC) ficam separadas |

Os campos estruturados de placa-mãe da S2 (`socket`, `formato_placa`) são códigos internos (ex. `"539"`) e não são usados. Validação com páginas reais (busca "placa mae B550"): chipset identificado em 392 de 395 ofertas, 42 produtos casados entre lojas.

### 6.2 Agrupamento entre lojas

Mesmo produto em lojas diferentes (`packages/shared/src/identity.ts`, `identifyProducts`), em dois níveis, por união de conjuntos (union-find):

**Exato** (o mesmo item do fabricante: a ficha técnica de um vale para o outro):

1. **Part number** igual, comparado só com letras e dígitos e sem o "NAC" que a S2 acrescenta no fim (`productMpn`). S2 informa em campo próprio; S1 e S3 no fim do título (`mpnFromTitle`: "… - 90-GA41ZZ-00UANF" na S1, "…, Preta, SYDSCD4-3200MHZ-8GB" na S3; pedaço que é spec, como "3200MHz" ou "8GB", não conta).
2. **Part number de outra loja no título ou no endereço** (código de 8+ caracteres, em palavras inteiras, sem marca de outra versão logo depois, `textHasCode`): a S1 às vezes usa o código interno do fabricante ("90YV0MD0-M0NA00") e põe o nome comercial ("TUF-RTX5070TI-O16G-GAMING") no título ou no endereço. "B860M-AORUS-ELITE" não casa com "B860M Aorus Elite WIFI6E" (outra versão).

**Grupo** (para mostrar junto na busca): o exato mais

3. **EAN** igual (≈10% dos anúncios têm; em nov/2026 nenhum casou entre lojas).
4. **Chave de modelo** igual (tabela em [§6.1](#61-pipeline)), só entre anúncios com a mesma assinatura de placa de vídeo (ou os dois sem): a chave descarta números soltos ("Infinity 2" = "Infinity 3", "Ventus 2X" = "3X").
5. **Assinatura de placa de vídeo** (`gpuSignature`, marcas conhecidas): marca + chip + VRAM + linha ("Dual", "TUF", "Windforce", "Challenger", com o número logo depois: "infinity2") + OC + branca. Junta "ASRock Arc B570 Challenger OC" com e sem o código no título.

Proteções: branco e não branco nunca se juntam; specs contraditórias (chip, VRAM, modelo do processador, capacidade, potência, DDR4 × DDR5, socket, chipset, Wi-Fi) separam; o mesmo código (ou assinatura) em dois anúncios da mesma loja com títulos e specs diferentes é ambíguo e fica de fora (título cortado: "BX8071514" para i5-14600KF e i7-14700KF). Chave do produto: o menor part number do conjunto (único: dois conjuntos com o mesmo código ganham o menor id no fim). Na busca (`groupOffers`), a chave do grupo continua a menor chave de modelo dele.

No banco, `listings.product_key` (exato) e `listings.group_key` (grupo), por categoria (`gpu:DUALRTX5070O12G`), são recalculadas sobre todos os anúncios da categoria (`prices/identity.ts`): ao subir (5 s depois) e 30 s depois de uma coleta da categoria, juntando as seguidas (~2 s para todas as categorias com ~12,7 mil anúncios). Em nov/2026, nas placas de vídeo vistas em 14 dias, 35% dos anúncios casam com outra loja no nível exato e 44% no grupo (antes: 24% e 37%).

**Fichas juntadas:** a ficha de um produto junta as páginas lidas de todos os anúncios dele (nível exato), campo a campo ([§8.3](#83-fichas-técnicas)). A rotina de fichas pula o produto que já tem a ficha completa por outra loja, e deixa de fora por 6 h o produto cuja página deu erro (sem ser bloqueio da loja), para não travar a fila nele. Com 2 falhas seguidas (horas entre elas, então uma queda de rede não conta), a oferta daquela loja sai do app (busca, ofertas da categoria e página do produto): a página quebrada levaria quem clica em "Ver na loja" a uma página de erro. A página abrindo de novo (rotina ou "Ler ficha") a traz de volta (`prices/page-errors.ts`).

A melhor oferta do grupo é a em estoque com menor preço à vista com cupom. Cada loja aparece uma vez no grupo, com a melhor oferta dela.

Limitação conhecida: variantes do mesmo modelo (revisões, ATX 3.0 vs 3.1, cabo incluso ou não) ainda podem cair no mesmo grupo quando nenhuma loja informa part number; no card, cada loja aparece uma vez, com a melhor oferta.

### 6.3 Cupons

O preço exibido, ordenado e filtrado é o **à vista com cupom** (`effectiveCash`), quando a loja anuncia cupom para o item. O card mostra o cupom e o preço sem ele.

| Loja | Onde o cupom aparece | Como o app obtém a % |
|---|---|---|
| S1 | Selo da vitrine (`stamps.title` = "CUPOM CODIGO"), sem a % | Abre **uma** página de produto por código de cupom (pausa curta, 2–4 s, logo após a busca) e lê o texto do selo ("ganhe 10% OFF neste item"). Aplica em todos os itens com o mesmo selo. Cache de 1 h por código. Conta no limite de páginas por hora. |
| S2 | Item numa "categoria" com o nome do cupom (ex. `CODIGO10OFF`); o card mostra "CUPOM: CODIGO10OFF" | Do próprio nome (`10OFF` → 10%) |
| S3 | Etiqueta `.cupomL` no card ("Cupom 10% OFF"), sem código | Do texto da etiqueta; o código fica na página de cupons da loja |

Validado ao vivo em S1: R$ 672,99 → R$ 605,69 com um cupom de 10%, igual à página da loja. Condições do cupom (`parseCouponConditions`), quando o texto da loja diz: "cupons limitados", valor mínimo ("acima de R$ 500"), validade ("válido até 24/11") e "no PIX". O cupom só entra no preço (`effectiveCash`/`couponApplies`) quando o preço atinge o mínimo e ele não venceu; o card mostra as condições ("limitado · até 24/11") ou por que não vale ("só a partir de R$ 500"). Hoje só a S1 traz o texto (o selo da página do produto: "…corre que os cupons são limitados"); S2 e S3 dão só a % no anúncio, e o cupom delas vale sem condição conhecida. Promoções da S2 (`mysales_promotion`) já vêm aplicadas no preço e não são cupom.

**S1, conferido na página do produto (nov/2026, clicando em "Inserir cupom"):** o cupom **soma com a oferta temporária** (aplicado sobre o preço de oferta: 10× R$ 238,88 → 10× R$ 222,16 com um cupom de 7%), e a % lida da página bate com a aplicada (7% e 8% nos exemplos). Em produto de **vendedor parceiro** (marketplace) o cupom não entra: o app não aplica cupom nesses itens. Busca de fonte "450W" na S1: a loja redireciona para a subcategoria "Fonte 450W", que tem só 2 ou 3 produtos; termos sem redirecionamento acham as mesmas 3, então não é erro do app.

## 7. Filtros (facetas)

Categorias vêm de um registro único (`CATEGORY_DEFS` em `packages/shared`): nome, termo base de busca nas lojas e se está habilitada. UI, validação da API e adapters leem dele. Habilitar uma categoria = regras em `categorize.ts` (pertence? specs? chave de modelo?) + caminho da categoria de S1 e S2 no `.env` (e, opcional, o caminho de varredura) + plano de busca (`searchPlan.ts`) + regra do termo em `termMatches` (`terms.ts`) + formulário e facetas na UI, e marcar `enabled: true`.

**Facetas derivadas dos resultados.** Valores de marca, potência, eficiência etc. são calculados das ofertas retornadas, com contagem que exclui o próprio filtro (como nas lojas). Não há lista fixa para manter: um modelo ou marca nova aparece sozinho na próxima busca.

Facetas da fonte:

| Faceta | Tipo |
|---|---|
| Potência | multi (potências encontradas no resultado) |
| Eficiência | "a partir de" (White < Bronze < Silver < Gold < Platinum < Titanium) |
| Cabeamento | multi (inclui "Não informado"); mesmas opções no formulário e no painel |
| ATX 3.x, PCIe 5 | booleano |
| Formato | ATX / SFX (compacta); só aparece quando o resultado tem SFX |

Facetas da placa-mãe: chipset (multi, valores do resultado), formato (Mini-ITX, Micro-ATX, ATX, E-ATX), memória (DDR4/DDR5), Wi-Fi, Bluetooth. A plataforma (socket) é escolhida ao montar a busca. Bluetooth vale quando o título cita Bluetooth ou Wi-Fi: módulos Wi-Fi de placa-mãe são combo Wi-Fi + Bluetooth, e o título raramente cita os dois.

Facetas do processador: linha, plataforma (socket), geração, núcleos, com vídeo integrado, com cooler (só quem o anúncio confirma), desbloqueado para overclock.

Facetas da placa de vídeo: fabricante do chip (NVIDIA/AMD/Intel), série (RTX 50, RX 9000… derivada do chip), modelo do chip (valores do resultado), memória de vídeo (GB), tipo de memória, low profile. O formulário pede fabricante (obrigatório) e, opcionais, série, memória e marca (lista curta das marcas mais vendidas; o painel mostra todas).

Facetas da memória RAM: tipo (DDR4/DDR5), capacidade total, pentes (1 / kit), frequência, latência (CL). Só memória de PC desktop: notebook/SODIMM, servidor/ECC e DDR3 são descartadas.

Facetas de todas as categorias: preço à vista (de/até), visual (Preta / Branca, Com RGB), marca, loja, só em estoque, só com cupom, só vendido pela loja.

Comparado com as facetas nativas das lojas (S1 `meta.filters`, S2 `aggregations`, S3 só marca), ficam de fora as que o título quase nunca traz (nº de M.2, rede 2.5G, debug display, capacidade máxima de memória) e as de interesse comercial (frete grátis, pré-venda). Em placa de vídeo, "conexões de saída" (HDMI/DisplayPort) fica de fora: só 12% dos títulos da S1 e nenhum da S3 citam; o dado só está na página de cada produto, o que exigiria abrir dezenas de páginas por busca. Em processador, só entra quem tem a plataforma identificada (pelo título ou pelo modelo) entre as de DDR4/DDR5; sem isso, não há como garantir a memória. Saem plataformas antigas (LGA1155/1150, Intel até a 5ª geração, Pentium/Celeron G1–G3), Ryzen de notebook (série 6000), Celeron J/N e servidor/HEDT (Xeon, Threadripper). Pentium/Celeron pela família: G4/G5 = LGA1151, G59xx e G6 = LGA1200, G7 = LGA1700. "80 Plus White" é nível de eficiência, não cor. A versão branca é outro produto no agrupamento (sufixo `white` na chave de modelo, nas duas categorias).

**Montar a busca por categoria** (`apps/web/src/searchPlan.ts`): fonte → potências viram termos (`750W`); placa-mãe → uma ou mais plataformas (AMD e Intel juntas) e os chipsets de cada uma viram termos (`B550`); plataforma sem chipset escolhido busca inteira (`AM4`, mais demorado); sem plataforma, o tipo de memória vira o termo (`DDR5`); processador → linhas viram termos (`Ryzen 5`) e a plataforma filtra o resultado, ou só a plataforma (`AM4`); placa de vídeo → fabricantes do chip viram termos (`NVIDIA GeForce`, `AMD Radeon`, `Intel Arc`), e série, memória de vídeo e marca filtram o resultado (a busca das lojas não entende série: "RTX 50" foi redirecionado para placas-mãe no teste); memória → tipo obrigatório e capacidades viram termos (`DDR4 16GB`); frequência (opções do tipo escolhido, em `RAM_SPEEDS`) e pentes filtram o resultado. No máximo 8 termos por busca (limite da API); o botão avisa quando passa. O que define a busca vira também filtro do resultado (a busca "Ryzen 5" da loja traz outras linhas, que o filtro esconde). Plataformas: AM5, AM4, LGA1851, LGA1700, LGA1200 e LGA1151, só DDR4 e DDR5 (placas DDR3 são descartadas). Chipsets por socket ficam em `CHIPSETS` e a memória aceita por plataforma em `SOCKET_MEMORY` (`packages/shared`), atualizados quando sai plataforma nova. O formulário só oferece os tipos de memória das plataformas escolhidas.

Ordenação: ver [§9.2](#92-frontend).

Para categorias com specs que o título não traz (ex. nº de M.2 numa placa-mãe), ver a questão sobre fonte de specs em [§16](#16-questões-em-aberto).

## 8. Persistência

**Preços em SQLite.** O banco guarda os anúncios e preços coletados das lojas, com histórico ([ADR-006](#adr-006-preços-no-banco-coletados-por-rotina)), as montagens compartilhadas por link e os dados privados das contas autenticadas. A busca pública continua disponível sem login. (Um catálogo de peças importado do OpenDB chegou a ficar no banco; saiu, ver [ADR-005](#adr-005-catálogo-de-peças-em-sqlite-importado-uma-vez-do-opendb).)

| Onde | O quê | Por quê |
|---|---|---|
| `data/upgradezin.db` | Anúncios, histórico de preço e montagens compartilhadas (SQLite, `node:sqlite` embutido no Node) | Responder a busca sem consultar as lojas a cada vez; histórico de preço; links de montagem. Gitignored; criado na primeira execução. |
| Navegador (`localStorage`) | Dados do visitante e alterações de conta que ainda precisam sincronizar | Os dados de visitante ficam separados. A fila de alterações do usuário autenticado é isolada por conta. |
| Contas (`accounts`, `account_sessions`, `account_data`, `price_alerts`, `notifications`) | Identidade, sessões, dados sincronizados, alertas de preço e as notificações que a rotina grava | O navegador carrega os dados da conta após validar a sessão. Compartilhar cria uma cópia separada em `shared_builds`. |
| `data/debug/` | HTML + screenshot de falhas | Só com `DEBUG_DUMPS=1`, para consertar adapters. |

### 8.1 Banco (`apps/server/src/db/`)

O carregador do SQLite filtra o aviso experimental de inicialização em versões do Node que ainda o emitem. Os demais avisos seguem o tratamento do Node.

Migrações versionadas por `PRAGMA user_version` em `db.ts` (só acrescentar no fim, nunca editar uma que já rodou). `openDb` cria o arquivo e migra; `getDb()` abre na primeira vez que o servidor precisa.

| Tabela | Conteúdo |
|---|---|
| `meta` | chave/valor: pausa por bloqueio ou manual de cada loja (`backoff:<loja>`), para sobreviver a reinício, a rotina do admin (`routine`: ligada, lojas e busca ao vivo), os intervalos de cada loja (`interval:<loja>` de listagens, `sheet-interval:<loja>` de fichas), as categorias da varredura completa (`full-sweep:<loja>`), a rotina de fichas (`sheet-routine`: ligada e lojas), e o estado da leitura de cada categoria pela rotina (`sweep:<loja>:<categoria>`: caminho e página da volta em andamento, início dela, fim da última volta, última falha) |
| `listings` | anúncio de uma loja (loja + código na loja): título, URL, chave de modelo, EAN, part number, a última oferta (`offer`, JSON no formato `Offer`) e as chaves de produto e de grupo (`product_key`, `group_key`: mesmo produto em outras lojas, [§6.2](#62-agrupamento-entre-lojas)) |
| `price_points` | histórico: um ponto quando preço à vista, cartão, cupom, oferta temporária ou estoque mudam (não a cada coleta) |
| `store_attempts` | cada consulta a uma loja (busca por texto, página de categoria, ficha técnica): quando, de onde veio, resultado, ofertas, motivo do bloqueio, duração; 90 dias ([§9.3](#93-admin-admin)) |
| `store_configs` | configuração de cada loja (antes `STORE_*` no `.env`): ligada, nome, site, caminho da busca, caminhos por categoria e páginas de categoria (JSON), cores (JSON) e data da alteração |
| `sheet_completion` | decisão do admin, por categoria e produto. Marca a ficha como completa para a cobertura e as filas de revisão, mantendo os campos ausentes vazios. |
| `sheet_pages` | cada página de produto lida pela rotina de fichas (loja + código): categoria, texto da ficha (`sheetText`; null: a página não tinha ficha) e a data. Lida uma vez; o texto é relido quando o leitor muda ([§8.3](#83-fichas-técnicas)) |
| `page_errors` | página de produto que deu erro sem ser bloqueio da loja (loja + código): falhas seguidas, a última e a mensagem. Fora da fila de fichas por 6 h; com 2 falhas seguidas, a oferta sai do app até a página abrir de novo. Três páginas seguidas com erro na mesma loja contam como rede (ou loja) fora: a rotina desfaz os registros dessa sequência e pausa a loja por 10 min (`NETWORK_STREAK`, `NETWORK_PAUSE_MS`). Não entra no merge de backups (estado do servidor) |
| `sheet_<categoria>` | os campos lidos de cada página (loja + código), uma coluna por campo da categoria (`packages/shared/src/sheet/fields.ts`). As colunas seguem a lista: ao subir, o servidor cria as que faltam e apaga as que saíram (`syncSheetTables`) |
| `shared_builds` | montagem compartilhada por link: código curto (`/m/<id>`), JSON da montagem (peças, ofertas, quantidade) e data. Sem dono nem expiração: quem tem o link vê |

A migração 12 apaga os termos (`search_terms`, `term_runs`, `listing_terms`): a rotina passou a ler as páginas de categoria e a busca não guarda nada por termo. A migração 5 tira o catálogo importado (tabelas `parts` e `part_codes`, coluna `listings.part_id`, marcas `opendb_*` em `meta`). Recria `listings` com as chaves estrangeiras desligadas (senão apagar a tabela antiga apagaria em cascata `listing_terms` e `price_points`), confere a integridade no fim e, só nessa vez, compacta o arquivo (`VACUUM`).

### 8.2 Preços e rotina de coleta

**Ficha nas ofertas:** toda oferta que o site recebe (busca no banco, texto livre, busca ao vivo, upgrades, página do produto) leva a ficha juntada do produto (`sheet`), e as specs dos campos que a ficha cobre vêm só dela (`withSheetSpecs` em `packages/shared/src/sheet/specs.ts`; índice anúncio → ficha por categoria em `apps/server/src/prices/offer-sheets.ts`, refeito a cada minuto). Filtros, montagem e os termos abaixo leem a ficha; o título só dá o que a ficha não cobre (linha e geração do processador, série da placa de vídeo, cor, RGB). Os campos da ficha sem filtro próprio ganham filtro genérico no painel (`SheetFilters`).

**O que a busca do site mostra de cada loja** = os anúncios dela no banco que batem com algum termo do formulário pelas specs (`termMatches` em `packages/shared/src/terms.ts`: "AM4" = encaixe AM4, "Ryzen 7" = linha, "750W" = potência, chipset, tipo e capacidade de memória, interface do SSD, tipo de cooler, formato do gabinete, fabricante do chip de vídeo), vistos nas últimas `SEARCH_DB_MAX_AGE_H` (72 h). Com texto livre, também os de título com todas as palavras (`titleMatches`, sem acento nem maiúsculas) e o que a busca da loja trouxer. Cada anúncio leva a data da própria coleta ("preço visto há X").

**Termos do formulário:** `allSearchTerms()` (`packages/shared/src/terms.ts`) lista tudo o que o formulário de busca pode gerar (potências de fonte, plataformas e chipsets, linhas de processador, fabricantes de chip de vídeo, tipo × capacidade de memória); um teste garante que o `searchPlan` do site só gera termos dessa lista. Não vão às lojas nem ficam guardados: só escolhem anúncios do banco.

**Rotina de preços** (`prices/routine.ts` e `prices/sweep.ts`, sobe com o servidor; [ADR-008](#adr-008-varredura-de-categoria-para-o-histórico)): nas lojas ligadas nela, um switch por loja no admin (aba Coleta), valendo na hora e guardado no banco (`meta`, chave `routine`); com nenhuma loja ligada, não roda. Até alguém mexer no admin, valem `ROUTINE_ENABLED` e `ROUTINE_STORES` do `.env`. A rotina lê a **página de cada categoria** de cada loja (configuração da loja no admin, aba Lojas, "Página da categoria"; um ou mais caminhos por categoria, separados por espaço, lidos um depois do outro), e grava cada página (anúncio e ponto de histórico quando muda). Cada vez de uma loja lê **uma categoria inteira**: todas as páginas com estoque, uma atrás da outra, só com o intervalo de sempre entre páginas da loja (`PAGE_DELAY_*`); o intervalo do modo vale entre uma categoria e a próxima.
- **Só o que está em estoque:** as lojas listam os em estoque primeiro, então a lista de um caminho acaba na primeira página sem nenhum item em estoque (contado pelo adapter, antes do filtro da categoria), na última página ou em `ROUTINE_SWEEP_MAX_PAGES` (40). Anúncio novo só entra em estoque; o esgotado só atualiza o anúncio que já existe.
- **Fim da volta:** depois do último caminho, o que estava em estoque e não apareceu desde o começo da volta passa a "sem estoque" (`markOutOfStock`: oferta guardada e um ponto de histórico). Se voltar ao estoque, a volta seguinte o encontra entre os em estoque e grava de novo. Volta que parou no teto de páginas ainda com itens em estoque não marca nada (o resto não foi lido).
- **Ordem e ritmo:** retoma de onde parou (estado em `meta`, `sweep:<loja>:<categoria>`), na ordem: volta em andamento, categoria nunca lida, volta mais antiga. Uma categoria recomeça quando a última volta completa passou de `ROUTINE_REFRESH_H` (12 h). Erro numa página faz a categoria esperar `ROUTINE_RETRY_MIN` (60 min) e retomar da mesma página; bloqueio pausa a loja como sempre. Para quando a loja chega a `ROUTINE_PAGES_PER_HOUR` páginas na última hora (contando busca por texto e fichas). Na fila de cada loja, a busca por texto e o admin passam na frente.
- **Lojas:** S1 (até 120 itens por página, `page_number`), S2 (36, `?page=N`; numa aba que fica aberta entre as páginas; da segunda em diante, a extensão clica no link da página seguinte, como uma pessoa, e devolve os dados que o site buscou em segundo plano (pedido `?page=N&_rsc=…` do Next.js, o mesmo formato do HTML), em vez de abrir cada `?page=N` numa aba nova como endereço digitado: `keepTab` do `loadPage` e o comando `clickPage` da extensão; sem o link ou sem resposta a tempo, abre o endereço; a aba fecha depois de 90 s parada ou quando uma página dá erro) e S3 (a 1ª página é a própria página da categoria, ~150 cards sem os atributos `data-tss-*` da busca, marca lida do título; as seguintes pelo mesmo pedido do botão "ver mais" da loja, por GET, que responde JSON). Em nov/2026, com os em estoque primeiro, as categorias têm de 1 a 10 páginas em estoque por loja.
- **Admin:** "Varredura completa" (aba Coleta, por loja) pausa a rotina de preços e a de fichas (para não disputar a loja nem pesar no servidor) e lê as categorias marcadas da loja (caixas no painel da loja; padrão, todas as que têm página), uma depois da outra, cada uma até o fim da lista, no intervalo de listagens da loja, esgotados também: anúncio novo esgotado entra no banco (a rotina só lê o que está em estoque e não cria anúncio esgotado). Serve para popular o catálogo com tudo o que a loja tem e para conferir um caminho novo. O modo fica no estado da volta (`full`), então uma página que a rotina leia no meio dela segue a mesma regra; cada caminho vai até `FULL_SWEEP_MAX_PAGES` (200). "Parar varredura" (no painel, enquanto roda) interrompe a da loja. Varredura parada no meio, por bloqueio, pelo botão ou por reinício: a categoria interrompida volta ao modo normal (`clearFullSweeps` ao subir), para a rotina não continuar a volta completa lendo os esgotados. Quando a última varredura completa acaba, cada rotina volta a como estava (o estado anterior fica em `meta` `sweep-paused`, e o servidor o restaura ao subir se reiniciar no meio). **De madrugada**, a varredura completa roda sozinha em todas as lojas, todo dia na hora `NIGHTLY_SWEEP_HOUR` (padrão 1, horário do servidor; -1 desliga), antes do backup do cron (04:30), com as mesmas pausas (`admin/nightly.ts`; a última vez fica em `meta` `nightly-sweep`, e o admin mostra a próxima e a última); a aba Cobertura mostra, por loja e categoria, a volta em andamento e a última completa. `pnpm scan --sweep` lê a primeira página de cada caminho, sem gravar.

**Rotina de fichas técnicas** (`prices/sheet-routine.ts`, sobe com o servidor): separada da coleta, com chave e lojas próprias (admin, aba Fichas; `meta` `sheet-routine`; até alguém mexer, `SHEET_ROUTINE_ENABLED`, padrão desligada, todas as lojas). Em cada loja marcada, abre a página de um produto (todas as categorias) cuja ficha ainda não está completa e cuja página nesta loja ainda não foi lida (`nextSheets`: em estoque e achado há menos tempo primeiro) e marca a próxima para o **intervalo de fichas** da loja (campos no card de cada loja, na aba Fichas) depois que termina; sem nada a ler, confere de novo em 1 min. Divide com a coleta só o que é da loja: a fila (o "Ler ficha" do admin passa na frente), a pausa por bloqueio e `ROUTINE_PAGES_PER_HOUR`. Ligar, desligar ou trocar as lojas reinicia; o intervalo vale a partir da próxima ficha.

### 8.3 Fichas técnicas

Cada categoria tem uma lista fixa de campos, só o indispensável para quem monta ou faz upgrade (`SHEET_FIELDS`, `packages/shared/src/sheet/fields.ts`): placa-mãe (chipset, soquete, formato, memória, PCIe, M.2, SATA, rede), processador (soquete, arquitetura, núcleos, threads, clocks, caches, TDP, vídeo integrado), placa de vídeo (chip, VRAM, memória, barramento, clocks, consumo, comprimento), memória (capacidade, módulos, tipo, frequência, latência), SSD (capacidade, formato, interface, leitura, escrita), fonte (potência, eficiência, modularidade, padrão, conectores), gabinete (formato, placas aceitas, folgas, dimensões, frente, ventoinhas, radiadores) e cooler (tipo, altura ou radiador, TDP, ruído, soquetes). Todas têm marca e modelo. Campo "principal": sem ele a ficha está incompleta (o do cooler depende do tipo: altura no de ar, radiador no water cooler).

- **Leitura:** o adapter da loja tira o bloco da ficha da página; `sheetText` transforma em linhas de texto; `readSheet` (`sheet/read.ts`) procura os rótulos de cada campo ("Soquete", "Socket", "CPU Socket"…) e, para alguns, o padrão no texto todo. O que não acha fica de fora, nunca chuta.
- **Banco:** a página fica em `sheet_pages` com o texto; os campos em `sheet_<categoria>`. Mudou o leitor ou a lista de campos: o servidor relê as páginas guardadas ao subir (`rereadSheets`, pela marca em `meta` `sheet-reader`).
- **Produto:** a ficha junta as páginas de todos os anúncios do mesmo produto (`product_key`), campo a campo: a página da própria loja primeiro, depois a lida há menos tempo; cada campo guarda de qual página veio. Nenhuma loja tem preferência. O preenchido à mão no admin (`sheet_manual`) vale mais que tudo. O que nenhuma página trouxe vem, nesta ordem: do título dos anúncios (`readTitle`, `sheet/title.ts`), da busca na web (abaixo), da estimativa (`estimateSheet`: o tamanho do gabinete pelas placas-mãe e medidas, só depois de a web não responder) e do valor padrão da categoria (`SHEET_DEFAULTS`: fonte não modular e sem certificação, gabinete sem ventoinhas; só com página lida). Título, estimativa e padrão entram na hora de juntar, sem gravar. O admin mostra de onde veio cada campo. Completa: todos os principais; incompleta: lida, mas faltam principais; não lida: nenhuma página lida.
- **Fila:** a rotina só abre páginas de produto sem ficha completa; incompleta, as páginas das outras lojas continuam na fila. Página lida não é lida de novo (o vendedor quase nunca completa o anúncio); o que nenhuma loja traz fica para a busca na web. No admin, o andamento por loja arredonda para baixo e só mostra 100% com a fila vazia; os itens da fila parados por erro na página aparecem à parte, com a hora em que o primeiro volta.
- **Busca na web** (`prices/web-fill.ts`, admin, aba Busca na web; desligada por padrão): para os produtos "só a web completa" (incompletos com a página de todas as lojas lida), manda à IA do Google, no Modo IA (`udm=50`), o JSON de resposta da categoria (`webKeys` e `webPrompt`, `sheet/web.ts`): só os campos em aberto, com chaves autoexplicativas em português e com a unidade ("altura_mm", "soquetes", "tamanho"), em null, mais "produto" e "confianca", e a lista de opções das chaves fechadas. A IA devolve o JSON preenchido; o código lê cada chave validando tipo, opções e faixa (`parseWebReply`). A resposta é o último JSON que começa em `{"produto"` no texto visível da página (o pedido, que também aparece, tem tudo null); o texto da tela que o buscador mistura sai, aspas de polegada sem escape são consertadas e, se ainda não abrir, a leitura é chave a chave. Chaves com espaços em volta (`"ventoinhas   "`) valem como a chave sem eles. Confiança baixa: nenhum valor entra. Processador sem turbo ou placa de vídeo sem boost: a pergunta pede para repetir o clock base, e 0 ou "Não" no turbo vale o base (null continua "não sei"). Listas começam em null no modelo, então `[]` na resposta é "não tem" nos campos com esse valor (radiadores do gabinete); em pedidos antigos, que traziam `[]` no modelo, não dá para saber. O nome do produto na pergunta junta o pedaço seguinte do título quando o primeiro não tem número ("Processador Intel Core - i3-6100 - …"), e a vírgula entre números ("3,7ghz") não corta. Página sem resposta nenhuma (sem o JSON) não conta como perguntado: o produto espera 6 h e é perguntado de novo, até 3 vezes. Mudou o leitor da resposta (`WEB_PARSER_VERSION`): ao subir, o servidor relê as respostas guardadas (recupera valores sem perguntar de novo) e devolve à fila as sem resposta e as listas vazias de pedidos antigos. O pedido inclui o título completo e a identificação conhecida para conferir a variante e consultar manuais e datasheets. A lista de respostas mostra o estado da ficha antes e depois de cada resposta registrada. Em consultas antigas, mostra o estado atual quando encontra o produto. A fila automática pergunta cada campo em aberto uma vez. A prioridade é definida pela melhor oferta do produto: com estoque e vendida pela própria loja, sem estoque e vendida pela própria loja, ou demais. O critério da busca exclui marketplace e open box das duas primeiras prioridades. Dentro de cada grupo, a fila prefere campos principais, depois estoque e produtos descobertos mais recentemente. O admin mostra a quantidade de produtos elegíveis em cada prioridade. O botão Refazer pede os campos ainda vazios ou estimados e preserva o que foi confirmado. `sheet_web` guarda os campos perguntados, a confiança e o JSON da resposta. Usa o Chrome de uma loja ativa, na fila dela (com o intervalo de fichas da loja), sem contar no limite de páginas da loja; o intervalo entre perguntas é o do admin (padrão 90 a 150 s). O Google pedindo verificação ("tráfego incomum", endereço `/sorry/`) ou o Modo IA pedindo confirmação para o pedido vindo pelo endereço ("Continuar com esta pesquisa?", uma proteção que pede uma pessoa: não é clicada) pausa a busca na web por 6 h, sem pausar a loja.
- **"Não tem" × "não sei":** campo que o produto pode não ter tem um valor de "não tem" (`none` do campo: "Não", 0 ou false); vazio é "não sei". O leitor só diz "não tem" quando a ficha deixa claro (placa-mãe com a parte de rede e sem Wi-Fi/Bluetooth em lugar nenhum; fonte com a lista de conectores e sem o de 16 pinos; memória DDR4 sem EXPO; SSD SATA sem geração PCIe; placa de vídeo "alimentada pelo slot"); a web responde "Não"/0/false quando o produto não tem e null quando não sabe; à mão, o mesmo. Na junção, o "não tem" automático cede para um valor de verdade de outra fonte (o título "… Wifi7", a outra loja, a web); o à mão vale contra tudo. Campo com `only` (altura e heatpipes do cooler: só air cooler) não falta onde não se aplica.
- **Opcionais vazios também vão à web:** o produto com as páginas todas lidas entra na fila da web se algum campo vazio, principal ou opcional (`missingOptional`), ainda não foi perguntado; os que falta campo principal primeiro. O produto completo já aparece na busca do site enquanto a web completa a ficha.
- **Precisa de você:** o produto com as páginas lidas e algum campo vazio (principal ou opcional) que a web já foi perguntada de todos os que ela pergunta não volta para a busca sozinho. Opcional que a web não pergunta (o código do chip da placa de vídeo) não segura o produto: antes, ele não ia para a web nem para cá. Fica no filtro "precisa de você" da lista de fichas (e numa coluna da Cobertura, ao lado de "Completas com opcional vazio"), e o preenchimento à mão mostra também os opcionais vazios.

**Ritmo por loja** (admin, aba Coleta). Cada loja tem a sua agenda, conferida a cada 2 s; cada vez da rotina é uma categoria inteira (as páginas com estoque; para antes se a loja entrar em pausa ou chegar a `ROUTINE_PAGES_PER_HOUR`, e continua de onde parou na vez seguinte), e a categoria seguinte vem depois. Entre duas páginas de lista, da mesma categoria ou não, vale o **intervalo de listagens** da loja (campos na linha de cada loja, no card Rotina de preços; o mesmo da varredura completa, da busca e dos testes). Mudar o intervalo ou a busca ao vivo não reinicia a rotina (o intervalo novo vale a partir da próxima consulta); ligar, desligar ou trocar as lojas reinicia. A busca por texto depende da **busca ao vivo** da loja (`live`).

**Histórico:** `GET /api/prices/history?items=s1:123,s2:abc` devolve os pontos de `price_points` dos anúncios de um produto (até 12) e quando cada um apareceu por último. Toda lista completa que a busca envia leva em cada oferta o resumo `history` (`withHistoryStats`): menor preço à vista com cupom, com estoque, nos últimos 30 dias (contando o preço que já valia quando a janela começou e o atual) e desde quando o anúncio é acompanhado.

## 9. API e frontend

### 9.1 API

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/version` | Versão do app (`{ version }`, do `package.json` da raiz; também no log ao subir e no rodapé da tela inicial). |
| `POST` | `/api/activity` | Eventos do navegador com cabeçalho `X-Usage: 1`, corpo de até 1 KB e limite separado de 120 pedidos por minuto por IP. A identidade vem da sessão ou do ID temporário calculado pelo servidor. |
| `GET` | `/api/stores` | Lojas configuradas: `id`, `name`, `search` (URL de busca com marcador), `color` e, com degradê, `colors`. |
| `GET` | `/api/search/stream?category=psu&terms=750w,850w&stores=s1,s2` | SSE: eventos `status` (estado e motivo em código, nunca texto técnico; `cached` = resultado do banco, com a data da última volta da rotina), `offers` (`partial` = lote de uma página), `end`. Termos do formulário: só o banco, pelas specs ([§8.2](#82-preços-e-rotina-de-coleta)). `text=1` aceita um texto livre entre eles, que também vai às lojas com busca ao vivo ([§10](#10-segurança-e-privacidade)); `force=1` busca o texto de novo depois de `FORCE_MIN_AGE_MIN`. `terms` obrigatório (até 8): nunca a categoria inteira. Só aceita categorias habilitadas. Fechar a conexão para o envio para a tela; a consulta que já saiu termina e grava. |
| `GET` | `/api/watch?category=cpu&terms=Core%20i5&stores=s1,s2,s3` | SSE de novidades para a tela de resultado aberta, desde o começo da busca. Toda coleta que grava no banco (rotina, varredura, loja que saiu da pausa, busca de outra pessoa) avisa por um evento interno (`prices/events.ts`); se for da categoria e de uma loja da busca, a rota manda a lista nova daquela loja (`offers`, a mesma conta da busca: termos + anúncios que batem pelas specs) e `fresh` (loja e quantas ofertas). Várias páginas seguidas viram uma lista só (1,5 s depois da última). Não consulta loja nenhuma. Ping a cada 25 s (o túnel fecha conexão parada); até `WATCHES_PER_IP` (4) por pessoa. |
| `GET` | `/api/prices/history?items=s1:123,s2:abc` | Histórico de preço dos anúncios de um produto (`ListingHistory[]`: pontos e última vez visto), até 12 ([§8.2](#82-preços-e-rotina-de-coleta)). |
| `GET` | `/api/products/:key` | Página do produto (`ProductPage`, `prices/product-page.ts`): os anúncios das lojas ligadas com a chave de produto (ou `id:<n>`, anúncio sem chave), a ficha juntada (só os valores; de qual loja veio fica no admin) e as ofertas, em estoque e mais baratas primeiro, com o resumo do histórico. Só do banco. 404 se não existe. A tela (`/produto/<chave>`) mostra todos os campos da categoria; o que a ficha não tem aparece como "não informado". Também fica disponível no modo de manutenção. |
| `GET` | `/api/brands?category=psu` | Marcas dos anúncios da categoria vistos nos últimos 30 dias (as mesmas do filtro "Marca" da busca), em ordem alfabética, sem "Outros"/"Genérica". Sugestões da marca da fonte no "Meu PC". Guardado em memória por 10 min. |
| `POST` | `/api/builds` | Compartilha a montagem (`{ build }`, até 256 KB, validada com zod: só links `https://`, quantidade 1–4) e devolve `{ id }` para o link `/m/<id>`. |
| `POST` | `/api/budget/plan` | Recomenda PC completo ou upgrade com as ofertas e fichas do catálogo. Aceita orçamento, perfil, resolução, frequência, modalidade, tipo de trabalho e fabricantes preferidos ou exigidos. |
| `GET` | `/api/builds/:id` | Montagem compartilhada, com cada oferta trocada pela versão mais recente do mesmo anúncio no banco (preço de hoje, não o do dia em que salvou). 404 se não existe. |

Parâmetros validados com zod. Em produção, o Fastify serve o build do front na mesma porta; caminho desconhecido devolve o `index.html` (rotas do front, como `/m/<id>`), exceto em `/api/`, que responde 404 em JSON.

### 9.2 Frontend

O cabeçalho e o conteúdo do admin ocupam toda a largura disponível, com espaçamento lateral interno. As abas passam para uma segunda linha em telas estreitas, e as tabelas mantêm a rolagem dentro dos painéis. No app público, cada tela tem seu próprio limite de largura e fica centralizada. Cada tela do app tem URL (`uiState.ts`, `screenUrl`/`screenFromUrl`): busca em `/?categoria=...`, montagem em `/montagem`, orçamento em `/orcamento` (`?modo=upgrade`) e gargalo em `/gargalo`. Trocar de tela cria uma entrada no histórico, trocar a aba do orçamento substitui a entrada e o Voltar do navegador reabre a tela anterior. Em `/` sem categoria, o app reabre a última categoria guardada. O servidor entrega o `index.html` em qualquer caminho fora de `/api/`. O cabeçalho do app público também usa a largura toda: logo à esquerda com as categorias logo em seguida (sempre no mesmo ponto, rolam para o lado quando não cabem) e, à direita, os atalhos Meu PC, Comparar e Montagem (`BuildAction`, link para `/montagem` fora do app) como ícones com a contagem no canto, os mesmos em todo cabeçalho (busca, tela inicial, produto e comparação), mais o atalho Acompanhando dos alertas de preço (o nome aparece só em telas bem largas), um traço e a conta com a inicial e o primeiro nome. O atalho Meu PC abre um modal com as peças do PC guardado (`PcSpecs`, o mesmo do orçamento) e a data da importação do CPU-Z (`importedAt`, gravado no perfil ao importar). Na busca e na tela inicial ele também oferece Identificar gargalo, Trocar relatório e Esquecer meu PC (pede confirmação; usa a mesma rotina do Gargalo); nas páginas de produto e de comparação só mostra o PC.

Os botões de ação do site e do admin compartilham a altura mínima de 40 px no CSS global. Cartões interativos e controles compactos incorporados a campos e filtros usam a altura adequada ao conteúdo.

- **Tela inicial:** grade de categorias com ícones (lucide), sem atalhos rápidos, na ordem da montagem do PC (placa-mãe, processador, memória, placa de vídeo, fonte, SSD, cooler, gabinete), a mesma da barra no cabeçalho. Categoria desligada no registro aparece como "Em breve".
- **Montar a busca (obrigatório):** escolher a categoria não busca nada. Abre um formulário com um botão principal claro, que só habilita com o mínimo escolhido. Fonte: potências (ao menos uma; não há "todas"), eficiência mínima, cabeamento. Placa-mãe: plataformas (uma ou mais; ou nenhuma, buscando pela memória), chipsets por plataforma, formato, memória, Wi-Fi. SSD: interface (NVMe e/ou SATA, vira o termo "SSD NVMe"/"SSD SATA") e capacidade por faixa. Cooler: tipo ("Air Cooler"/"Water Cooler") e, no water, o radiador. Gabinete: formatos de placa-mãe (um termo por formato, ou "Gabinete" sem formato; o resultado mostra onde a placa cabe), vidro, com fans. Todas: faixa de preço à vista. Busca textual nas lojas só a partir do resultado ("Buscar nas lojas" da busca local, abaixo).
- **Resultado:** cabeçalho com barra de categorias; "Parar" ao lado da ordenação enquanto a busca roda. O progresso da busca aparece nos próprios resultados, que chegam loja a loja. "Alterar busca" fica no topo do painel lateral e volta ao formulário com os valores atuais. Sempre consulta todas as lojas; o filtro "Loja" só muda a exibição.
- **Visual:** tema escuro fixo (`<html class="dark">`, variante `dark:` sempre ativa). Cinzas quentes (fundo quase preto, cards elevados; a escala `zinc` é redefinida em `index.css`) e um brilho laranja discreto no alto da página. Destaque em laranja (`accent-*`): botões (laranja vivo com texto escuro), seleção, links e o ponto do logo. **Verde só para o que é bom:** preço à vista, desconto, cupom, "Menor preço em 30 dias", "Compatível" e loja consultada com sucesso. Fonte Quicksand. Nome "Upgradezin." em texto no cabeçalho e na tela inicial; ícone da aba "Up." em SVG com traços arredondados (`public/favicon.svg`), nítido em qualquer tamanho e sem depender da fonte. As cores das lojas (bolinhas) vêm do `.env`; o gráfico de histórico tem a própria paleta.
- **Preço à vista sempre em destaque**, já com cupom quando houver ("À vista com cupom", com o código e o preço sem cupom embaixo); preço no cartão aparece pequeno. Selo de desconto (contra o preço "de" da loja) no topo do card. Faixas (de/até) em vez de só máximo.
- **Histórico de preço:** cada card tem "Histórico", que abre o gráfico do produto: uma linha em degrau por loja (o preço vale até a próxima mudança), à vista com cupom, tracejada sem estoque; 30 dias, 90 dias ou tudo; resumo com o preço de agora e o menor e o maior do período; dica ao passar o mouse com o preço de cada loja no dia; "Ver tabela" lista as mudanças. Cores do gráfico fixas por loja, de uma paleta validada para daltonismo e contraste nos dois temas (`.viz` em `index.css`): as cores das lojas no `.env` podem ser claras demais para linha. O card mostra "Menor preço em 30 dias" (ou "Menor preço desde dd/mm") quando o preço de agora é o menor que o banco viu no período, só depois de 7 dias de acompanhamento.
- **Cache na página (memória, sem backend):** cada categoria guarda resultados, filtros, ordenação e a tela em que estava. Trocar de categoria ou ir ao início e voltar restaura tudo sem nova busca. Categoria aberta e filtros (com a ordenação) de cada categoria ficam também no `localStorage` (`uiState.ts`): reabrir o app volta na mesma categoria, com os mesmos filtros, e refaz a busca se havia resultado na tela (vem do banco, na hora). Os resultados em si não são guardados no navegador.
- **Ordenação:** menor/maior preço à vista e maior desconto (contra o preço "de" da loja, já com cupom; sem desconto vai para o fim) em todas as categorias. Fonte: melhor eficiência, preço por watt, maior potência. Processador: mais núcleos. Placa de vídeo: mais memória de vídeo. Memória: menor preço por GB, maior frequência. Uma ordenação só aparece quando muda algo (ex. por potência, só com mais de uma potência no resultado).
- **Textos:** rótulos (botões, títulos de seção, abas, opções de filtro e ordenação, categorias) com só a primeira letra maiúscula ("Só em estoque", "Menor preço à vista", "Placa de vídeo"); maiúscula no meio só em nomes próprios, marcas, siglas e termos em inglês ("Meu PC", "Full HD", "Mid Tower", "RTX 4060 Ti"). Frases e status em caixa normal. Todo elemento clicável com cursor de mão.
- **Busca local nos resultados:** caixa de texto acima dos cards que filtra o que já foi carregado (todas as palavras no título, sem diferenciar acento), sem consultar as lojas. Sugestões clicáveis com os nomes de linha mais comuns no resultado ("Windforce", "Fury Beast"): só a parte do título antes da primeira vírgula, sem números, specs com filtro próprio, marcas e palavras presentes em quase todos (80%+). Com um texto que vale como termo (3 a 60 caracteres, letras, números e `- + . /`), aparece "Não achou? Buscar “texto” nas lojas": repete a busca com os termos do formulário mais o texto, que vai às lojas como termo próprio (`text=1`), e o filtro de texto continua aplicado. Os termos vão às lojas do mais antigo (ou nunca coletado) para o mais novo; na S2, que rende 1 página por consulta, a página já traz o produto procurado.
- **Novidade sozinha:** desde o começo da busca, a tela fica escutando `GET /api/watch` (loja ainda na fila ou ao vivo nesta busca é ignorada: a lista dela vem da própria busca). Começar junto, e não no fim, importa para a loja que ainda espera a vez (ou que está em pausa): a rotina pode coletar nela enquanto outra loja ainda está ao vivo, e essa coleta se perdia. Quando chega coleta nova de uma loja (ex. a loja que estava em pausa voltou e coletou), a lista dela troca sozinha e aparece um aviso discreto no canto ("Loja S2: preços atualizados agora", some em 6 s). Os cards já mostrados ficam no lugar (só preço e lojas mudam; produto novo entra no fim); mudar ordenação, filtros ou buscar de novo volta à ordem normal. Nova busca, "Parar", trocar de categoria ou sair da tela param de escutar.
- **Nunca texto técnico na tela:** o servidor envia códigos (`state`, `reason`), a UI escolhe a frase.
- Resultados parciais com cards de carregamento enquanto as lojas respondem. Aviso quando os filtros escondem todas as ofertas, com atalho para limpar.
- Painel de filtros (lateral; gaveta no celular).
- Cards agrupados por produto: imagem, marca, specs como selos (eficiência colorida por nível), menor preço à vista com desconto sobre o "de", parcelamento, uma oferta por loja, a melhor dela (anúncios repetidos e variantes do mesmo modelo não aparecem duplicados; melhor oferta em destaque, marketplace/open box/esgotado sinalizados), idade da coleta.
- **Montar pelo orçamento** ([§17.4](#174-montar-pelo-orçamento)): entrada na tela inicial (abre no upgrade se já há um PC importado) e no Identificar gargalo ("Tem um valor em mente?"). Abas "PC completo" e "Upgrade do meu PC" e o valor (vem um sugerido e é formatado em português do Brasil com duas casas decimais ao sair do campo ou enviar). No PC completo, a tela (resolução e 144 Hz). No upgrade, antes do valor, o PC importado num cartão recolhido com o resumo numa linha (processador, placa de vídeo, memória e fonte; `pcSummary`), que expande para todos os dados (`PcSpecs.tsx`, a mesma lista da prévia da importação, com a fonte), e o diagnóstico do Identificar gargalo (veredito, resumo e as sugestões de upgrade e de atenção), para a pessoa saber o que o sistema sugere antes de dizer quanto quer gastar; o resultado lista as peças com preço e loja (cada uma abre a página do produto), as que ficam, o que sobra, o equilíbrio ou o ganho e as observações, e "Levar para a montagem".
- **Montar o PC** ([§17.1](#171-montar-o-pc-montagem-dinâmica)): entrada na tela inicial ("Montar peça por peça" com o orçamento visível; "Montar o PC" sem ele) e botão "Montagem" no cabeçalho (com quantas peças já tem).
  - A tela lista as 8 peças em ordem (placa-mãe, processador, memória, placa de vídeo, fonte, SSD, cooler, gabinete), com "Escolher" / "Trocar" / remover. Cada peça escolhida mostra o selo de compatibilidade, os motivos, a melhor oferta (loja e idade do preço). A fonte mostra o consumo estimado e a potência recomendada, mesmo antes de escolher uma.
  - Memória tem **quantidade** (1 a 4, para pentes avulsos iguais, ex. 2× 8 GB): o preço da peça e os totais multiplicam, e a compatibilidade conta o total de pentes contra os slots da placa. Trocar a memória mantém a quantidade.
  - Barra fixa no rodapé com o total à vista, o total comprando tudo em cada loja (ou quantas peças faltam nela) e o resumo da compatibilidade.
  - "Escolher" abre a busca normal da categoria, com o formulário já preenchido pela montagem (`slotFilters`): plataforma da placa-mãe ou do processador, tipo de memória, potências de fonte a partir da recomendada. Uma faixa avisa que a peça é para a montagem, com "Voltar à montagem".
  - No resultado, cada card mostra o selo da peça contra o resto da montagem (`checkCandidate`) e o botão "Adicionar à montagem". "Só compatíveis com a montagem" (ligado por padrão) esconde os vermelhos e diz quantos; desligado, o botão de um incompatível vira "Escolher mesmo assim".
  - Na busca comum (sem vir da montagem), os cards de todas as categorias também têm "Adicionar à montagem" ("Trocar na montagem" se já houver uma peça daquela categoria), e o selo de compatibilidade aparece quando a montagem já tem outra peça. Adicionar por ali não sai do resultado.
  - A montagem fica no `localStorage` do navegador (peça = produto com as ofertas de cada loja na hora da escolha). Sem armazenamento disponível, vale enquanto a página estiver aberta.
  - **Importar meu PC** ([§17.2](#172-importar-setup-atual-cpu-z)): passo a passo para gerar o relatório no CPU-Z, arquivo arrastado ou escolhido, prévia do que foi lido (peças, discos, monitor) e "Usar na montagem". As peças entram com o selo "Atual" e "Você já tem" no lugar do preço e ficam fora do total ("Nenhuma peça nova ainda" enquanto não houver o que comprar).
  - **Já tenho:** chave em toda peça escolhida numa loja (ex. a fonte, que o CPU-Z não mostra). Ligada, a peça vira "Atual": sai do total e conta como parte do PC. A fonte "Já tenho" entra na análise de gargalo.
- **Identificar gargalo** ([§17.3](#173-identificar-gargalo-e-sugerir-upgrades)): entrada na tela inicial. Sem PC importado, explica e abre a importação; com PC, mostra no topo "Esquecer meu PC" (apaga o perfil do navegador), "Trocar relatório" e "Levar para a montagem"; depois o veredito com o medidor de equilíbrio, as peças lidas (a fonte com "Informar"/"Alterar", que abre a prévia da importação) e "O que fazer" (cada sugestão com o selo Upgrade, Grátis, Atenção ou Observação e, quando é peça, o botão que abre a busca filtrada).
  - **Compartilhar** grava uma cópia da montagem no servidor e copia o link curto (`/m/<id>`); o botão vira "Link copiado". Clicar de novo sem mudar a montagem copia o mesmo link. Quem abre vê a montagem só para leitura (preços atualizados pelo banco, compatibilidade e totais) e pode "Usar esta montagem" (troca a própria, com confirmação se já houver peças) ou ir para a própria. O link usa o endereço da página: aberto pelo link do servidor (túnel), funciona fora de casa; aberto em `localhost`, só na mesma máquina.

### 9.3 Admin (`/admin`)

Tela de quem opera o servidor, em pacote separado do app (carregado só em `/admin`). Desligado sem `ADMIN_USER` e `ADMIN_PASSWORD` no `.env` (senha de 10+ caracteres): aí `/api/admin/*` responde 404 e a tela diz como ligar.

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/admin/login` | `{ user, password }`. Certo: cookie de sessão e `{ user, expiresAt }`. Errado: 401; 5 erros por IP em 15 min: 429 com `retryAt` (recusa sem conferir, nem a senha certa). Tentativas no log. |
| `POST` | `/api/admin/logout` | Encerra a sessão e apaga o cookie. |
| `GET` | `/api/admin/me` | `{ user }` com sessão; 401 sem. |
| `GET` | `/api/admin/stores` | As três lojas, com a configuração de cada uma (`AdminStoreConfig`: `configured`, `enabled`, nome, site, busca, caminhos, cores, data da alteração). |
| `PUT` | `/api/admin/stores/:id` | Salva a loja (`AdminStoreInput`, cores como texto `"#a,#b"`) e devolve como ficou; vale na hora. Erro de validação: 400 com `errors` (uma frase por campo). |
| `GET` | `/api/admin/stores/state` | Painel das lojas (`AdminStoreState`): pausa (motivo, até quando, degrau), páginas na última hora e limites, se está na rotina, intervalo de listagens, busca ao vivo, **fila** (consulta em andamento e quantas esperam: buscas do site e "coletar agora", que passam na frente, e as da rotina; `queuedAt` em `pace.ts`), próxima consulta da rotina (nunca antes do fim da pausa), última coleta boa, último bloqueio e consultas das últimas 24 h por resultado. |
| `POST` | `/api/admin/stores/:id/unpause` | Tira a pausa da loja na hora (sem reiniciar). |
| `POST` | `/api/admin/stores/:id/pause` | `{ minutes }` (5 min a 7 dias): pausa manual (motivo `paused`). Não sobe a escada de pausas. |
| `POST` | `/api/admin/stores/:id/sweep/stop` | "Parar varredura": interrompe a varredura completa da loja; a categoria do meio volta ao normal e as rotinas voltam a como estavam (se era a última rodando). Nada rodando: 409. |
| `PUT` | `/api/admin/stores/:id/full-sweep` | `{ minS, maxS, categories }`: configuração da varredura completa da loja (intervalo entre páginas de 2 a 600 s, o primeiro não maior que o segundo, e categorias), guardada em `meta` `full-sweep:<loja>`; vale para o botão e para a madrugada. Inválida: 400. |
| `POST` | `/api/admin/stores/:id/sweep` | Com `{ minS, maxS, categories }` opcional (guardado antes, como no `PUT`). "Varredura completa": pausa as rotinas de preços e de fichas e lê as categorias marcadas da loja até o fim da lista (esgotados também), na fila da loja, com as regras de sempre; no fim, cada rotina volta a como estava. Loja em pausa, sem página de categoria ou já em varredura completa: 409. Responde na hora (`startsAt`); as páginas vão para o registro de consultas. |
| `PUT` | `/api/admin/stores/:id/interval` | Intervalo da loja (`{ kind, minS, maxS }`: `kind` `list` para listagens ou `sheet` para fichas, de 2 a 600 s, o primeiro não maior que o segundo): vale na hora e fica guardado (`meta` `interval:<loja>` ou `sheet-interval:<loja>`). |
| `GET`/`PUT` | `/api/admin/routine` | Rotina de coleta: ligada, em quais lojas e busca ao vivo de cada loja (`RoutineInfo`, com última e próxima rodada). Mudar vale na hora (desligar interrompe a rodada em andamento; o que não é enviado fica como está) e fica guardado (`meta`, chave `routine`); sem nada guardado, valem `ROUTINE_ENABLED`/`ROUTINE_STORES` do `.env`. |
| `GET` | `/api/admin/attempts` | Registro de consultas, mais recentes primeiro, paginado (`page`, `pageSize` até 200, padrão 50; devolve `items`, `total`, `page`, `pageSize`); filtros `store`, `status`, `origin`. |
| `GET` | `/api/admin/attempts/timeline?hours=48` | Consultas por hora de cada loja (ok, bloqueio, outro), até 720 h. |
| `GET` | `/api/admin/coverage` | Cobertura por loja e categoria: anúncios, em estoque, vistos em 24 h e 7 dias, caminhos de categoria configurados, volta em andamento (caminho e página) e última volta completa, fichas lidas (placa de vídeo, gabinete, cooler), último visto. |
| `GET` | `/api/admin/perf-gaps` | Processadores e placas de vídeo à venda (últimos 14 dias) que a tabela de desempenho não conhece. |
| `GET` | `/api/admin/products` | Catálogo paginado (`AdminProductPage`, 50 por página, até 200), do visto há menos tempo: loja, categoria, título, preço à vista com cupom, estoque, specs do título, índice de desempenho e os outros anúncios do mesmo produto. Filtros `store`, `category`, `inStock` (`1`/`0`), `q` (título ou código, `%` e `_` literais), `page`, `pageSize`. |
| `GET`/`PUT` | `/api/admin/sheets` | Rotina de fichas (separada da coleta): ligada e lojas (guardadas em `meta` `sheet-routine`). O intervalo de fichas é configurado por loja e, por loja, páginas lidas, fila, lidas na última hora e a próxima (`SheetRoutineStatus`). |
| `GET` | `/api/admin/sheets/coverage` | Cobertura das fichas por categoria (produtos vistos nos últimos 14 dias): completas, incompletas, não lidas, as que só a web completaria (todas as lojas lidas) e quantos produtos não têm cada campo principal. |
| `GET` | `/api/admin/sheets/products` | Fichas paginadas por produto. Categoria e situação filtram a ficha; estoque (`inStock`), venda própria (`ownRetail`) e busca por título ou código devem corresponder ao mesmo anúncio. Os dois filtros de oferta aceitam `1`, `0` ou podem ser omitidos. Venda própria segue a busca pública e inclui apenas anúncios novos fora de marketplace. Na tela, mudar um filtro preserva os demais e volta à primeira página. |
| `GET` | `/api/admin/sheets/products?category=cpu` | Produtos de uma categoria com a ficha juntada (`SheetProductPage`): situação, campos, de onde veio cada um, campos principais que faltam e os anúncios (página lida ou não). Filtros `state` (`complete`, `incomplete`, `unread`, `exhausted`, `manual`), `q`, `page`, `pageSize`. |
| `PUT` | `/api/admin/sheets/completion` | Marca ou reabre a conclusão manual por categoria e produto. Os campos da ficha são preservados. |
| `GET` | `/api/admin/sheets/page?store=s1&sku=123` | Texto guardado da ficha de uma página, para conferir o que o leitor leu. |
| `POST` | `/api/admin/products/:loja/:código/sheet` | "Ler ficha": abre a página do produto e lê a ficha de novo, mesmo já guardada, na fila da loja (na frente da rotina, com o intervalo e o limite por hora de sempre). Loja em pausa ou produto fora do catálogo: 409. Responde na hora. |
| `GET` | `/api/admin/activity` | Buscas e telas abertas e quantas pessoas estão em cada limite. Inclui os dados anteriores de buscas em memória para compatibilidade, com os termos reconhecidos do formulário e a identidade da sessão ou o ID temporário. |
| `GET` | `/api/admin/activity/usage` | Rankings de telas e ações, contagem de contas e IDs de visitantes, e histórico de 50 eventos por página. Filtros por 1, 7, 30 ou 90 dias, tela, ação e e-mail ou ID exato. Exige sessão de admin e responde sem cache. |
| `GET` | `/api/admin/live` | SSE: as últimas 50 consultas e cada nova conforme acontece (evento `attempt`) e avisos de mudança (evento `change`, `{ kind }`: `store` quando uma loja começa ou termina uma página ou entra/sai de pausa, `admin` depois de cada mudança pelo admin que deu certo, `activity` a cada busca no site; `changes.ts`). As telas do admin usam uma conexão só (`web/src/admin/live.ts`, `useLiveReload`) e recarregam o que mostram ao receber o aviso que as interessa; também ao voltar para a aba e, por garantia, de tempos em tempos. |
| `GET`/`POST` | `/api/admin/backups` | Lista `data/backups` / cria backup (`VACUUM INTO` comprimido, `manual-AAAA-MM-DD-HHMMSS.db.gz`). |
| `GET`/`DELETE` | `/api/admin/backups/:name` | Baixa / apaga um backup (nome sem caminho; outro: 404). |
| `POST` | `/api/admin/merge` | Corpo binário (`application/octet-stream`, até 300 MB): um banco `.db` ou `.db.gz` na mesma migração. Guarda por 30 min e devolve `{ id, report }` (`MergeReport`: o que entraria), sem gravar. |
| `POST` | `/api/admin/merge/:id/apply` | Faz um backup (`pre-merge-…`) e aplica numa transação: anúncios novos, oferta vista por último, histórico nos instantes que faltam, termos, ligação anúncio×termo, coleta mais recente por termo, fichas. Não mexe em `meta`, lojas, consultas nem montagens. `DELETE /api/admin/merge/:id` desiste. |
| `GET` | `/api/admin/status` | Versão, commit, há quanto tempo está no ar, Node, memória do app e da máquina, banco (nome do arquivo, tamanho, WAL, migração), Chrome aberto e coletas usando o navegador. |

- **Sessão:** token aleatório (32 bytes) em memória, `ADMIN_SESSION_H` (12 h); reiniciar o servidor desloga. Cookie `uz_admin`: `HttpOnly`, `Secure`, `SameSite=Strict`, só em `/api/admin`. Senha comparada em tempo constante.
- **Requisição forjada de outro site:** além do `SameSite=Strict`, toda chamada que muda algo exige o cabeçalho `X-Admin: 1` (403 sem ele): um site de fora só consegue mandá-lo com a pré-checagem de CORS, que o servidor não libera.
- **Abas:** Servidor (status e "Máquina agora": CPU, memória, rede, disco e processos lidos do /proc a cada 2 s enquanto o admin estiver aberto, em qualquer aba do painel, admin/system.ts), Coleta (rotina com um switch e o intervalo de listagens por loja, painel de cada loja com a fila (consultando agora e quantas consultas prioritárias e da rotina esperam), a contagem até a próxima consulta, pausas e "varredura completa" (com a categoria em leitura); atualiza a cada 5 s), Consultas (linha do tempo de 48 h e registro com filtros, paginado), Cobertura, Produtos (catálogo paginado), Fichas (rotina de fichas com o intervalo de fichas de cada loja, cobertura por categoria e os produtos com os campos lidos, de onde veio cada um, o texto guardado e "Ler ficha". Fichas "Precisa de Você" podem ser concluídas manualmente e reabertas), Atividade, Lojas (configuração) e Backups (com o merge).
- **Registro de consultas** (`store_attempts`, `prices/attempts.ts`): cada consulta que vai à loja (busca por texto, página de categoria, ficha técnica) grava loja, fim, tipo, origem (`search`, `routine`, `admin`), categoria, termo ou página, resultado (`ok`, `partial`, `blocked`, `limit`, `error`), ofertas, motivo e mensagem do bloqueio e duração; a que nem saiu (loja em pausa, cancelada) não entra. Guardado por 90 dias. Falha ao gravar o registro nunca derruba a coleta.
- Respostas com `Cache-Control: no-store`. Código em `apps/server/src/admin/` (rotas montadas como plugin, testadas com `inject`) e `apps/web/src/admin/`.

O histórico persistente da Atividade usa a tabela `usage_events` (migração 20). A navegação e ações locais são registradas pelo navegador. Login, saída, mudanças nos alertas e resultados de orçamento são registrados quando o servidor confirma a operação. A busca restaurada e o acompanhamento automático de preços não contam como novas buscas iniciadas. Mudanças em filtros da busca são agrupadas em intervalos de dois segundos.

A migração 21 acrescenta a coluna de produto às bases que receberam a primeira versão da tabela de eventos, preservando o histórico.

O histórico usa o componente de paginação das outras tabelas do admin, abaixo da listagem. Alterar o período ou outro filtro volta à primeira página.

O evento armazena o ID interno da conta. A resposta ao admin consulta o e-mail atual na tabela de contas. Sem sessão válida, o servidor usa o mesmo hash curto do IP com sal por execução. IDs de visitantes podem se repetir entre pessoas da mesma rede e mudam no reinício. O servidor exclui eventos fora dos 90 dias na inicialização e em uma limpeza diária. O histórico começa com a implantação da coleta.

### 9.4 Páginas públicas e indexação

O Fastify usa o HTML compilado do Vite como base e inclui título, descrição, URL canônica e conteúdo antes de enviar a resposta. A página inicial e `/produto/<chave>` mantêm a interação em React. `/catalogo`, `/catalogo/<categoria>` e `/guias` funcionam com links HTML, inclusive a paginação do catálogo. Os guias usam comparativos editoriais com índices do motor de desempenho, ficha, opções do catálogo e preços à vista recentes quando há ofertas. O comparador interativo continua aceitando seleções compartilhadas.

O catálogo público usa produtos com chave e anúncios de lojas ativas vistos nos últimos 90 dias. O sitemap publica uma URL por chave e separa produtos em arquivos de até 5.000 URLs. O endereço canônico vem de `PUBLIC_ORIGIN` (padrão `https://upgradezin.com.br`). O `robots.txt` aponta para o índice de sitemaps e deixa o conteúdo público acessível aos buscadores.

As respostas da API indicam `noindex`. A API pública fica acessível ao rastreador que renderiza o React e precisa carregar as fichas ou o catálogo.

A página de produto mostra a ficha e publica `Product` com `AggregateOffer` quando há oferta à vista de produto novo, em estoque, vendido pela própria loja e conferido nas últimas 24 horas. Conta uma oferta por loja. Buscas com filtros, seleções do comparador, montagens compartilhadas e admin recebem `noindex`. Produtos e guias inexistentes respondem com HTTP 404.

## 10. Segurança e privacidade

- Nada sensível no repositório: `.env` e `data/` (banco SQLite e dumps de debug) estão no `.gitignore`. O navegador não guarda perfil em disco.
- Montagem compartilhada: quem tem o link vê (código aleatório de 8 caracteres); o servidor só aceita links `https://` e limita o tamanho. Nenhum dado de usuário é guardado.
- Relatório automático: lido só no navegador (não vai para o servidor), até 5 MB e com o cabeçalho do CPU-Z. O arquivo é só lido, nunca executado; cada valor sai sem caracteres de controle e invisíveis (inclusive os que invertem o texto) e com tamanho máximo (200 caracteres por valor, 160 no nome da peça), as listas têm teto (16 discos, 8 monitores, 16 pentes) e a tela mostra tudo como texto (o React escapa). O perfil guardado no navegador só volta com o formato esperado (`validPc`).
- **Proteções da API** (`security.ts`, contadores em memória por pessoa; atrás do `cloudflared` o IP real vem de `CF-Connecting-IP`, aceito só quando a conexão é local):
  - A busca só aceita os termos que o formulário gera (`isFormTerm`), respondidos pelo banco: termo inventado chamado direto na API é recusado (400). Exceção: com `text=1`, um texto livre por busca (`isTextTerm`), que vai às lojas, limitado a `TEXT_SEARCHES_PER_HOUR` (20) por pessoa por hora; passou disso, a busca segue só com os termos do formulário. Nada fica guardado por texto.
  - `force=1` (consultar de novo): até `FORCE_PER_HOUR` (10) por pessoa; além disso, e quando o resultado do banco tem menos de `FORCE_MIN_AGE_MIN` (10 min), a busca responde com o banco. Protege o limite de páginas por hora das lojas, que é de todos.
  - Buscas abertas ao mesmo tempo: `SEARCHES_PER_IP` (3). Requisições à API: `RATE_LIMIT_PER_MIN` (120) por pessoa (429 com `Retry-After`).
  - Link de montagem: a mesma montagem reaproveita o link (hash do conteúdo); links novos, `SHARE_PER_HOUR` (20) por pessoa. Corpo até 256 KB.
  - Cabeçalhos: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` e, na página, CSP só com recursos do próprio servidor (imagens de qualquer `https:`, as fotos vêm das lojas).
- Fixtures de teste são recortes mínimos de páginas públicas de busca: poucos itens, só os campos lidos, sem scripts, cookies, tokens ou metadados de sessão.
- Servidor escuta em `127.0.0.1` por padrão, sem abrir portas. Acesso de fora pelo link temporário do `cloudflared` (serviço do túnel no servidor) ou por VPN mesh.
- Admin: login fixo do `.env`, sessão em cookie protegido, limite de tentativas e cabeçalho obrigatório contra requisição forjada ([§9.3](#93-admin-admin)).
- Contas de usuário: login opcional com Google e sessão separada do admin. A configuração OAuth e a validação com um cliente real ainda são necessárias.
- Os eventos de uso ficam no próprio SQLite. As categorias, modos e lojas saem das opções previstas no código. Chaves de produto são aceitas quando existem no catálogo. O histórico persistente não registra IP bruto, texto digitado, CEP ou conteúdo de arquivos do CPU-Z. O e-mail exibido no admin fica na conta e o filtro de pessoa é omitido do log HTTP.

## 11. Stack e estrutura

| Camada | Escolha |
|---|---|
| Linguagem | TypeScript ponta a ponta, executado direto com `tsx` (sem build no servidor) |
| Runtime | Node 22.13+ (`node:sqlite` embutido) |
| Servidor | Fastify 5, zod 4 |
| Navegador | Google Chrome comum, um por loja, lido pela extensão do projeto (sem porta de depuração) |
| Front | React 19, Vite, Tailwind 4 |
| Testes | Vitest |
| Monorepo | pnpm workspaces |

```
apps/
  server/src/
    adapters/        s1.ts, s2.ts, s3.ts, types.ts (+ *.test.ts com fixtures; load.test.ts: as três pelo loadPage)
    stores.ts        configuração das lojas: no banco (admin), copiada do .env na primeira vez; validação do que o admin salva
    admin/           admin: login e sessão (auth.ts), rotas (routes.ts), status, painel e ações das lojas (actions.ts),
                     cobertura e linha do tempo (data.ts), atividade sem IP (activity.ts), backups e merge (backup.ts)
    cli/             scan.ts (busca pelo terminal), routine-test.ts (rotina de verdade nas lojas, com relatório),
                     chrome-setup.ts (instala a extensão no Chrome de cada loja)
    db/              SQLite (node:sqlite): migrações, meta, instância do servidor
    prices/          prices.ts (anúncios, histórico, resumo de 30 dias, "sem estoque" no fim da volta, anúncios que batem com o termo ou o texto),
                     collect.ts (busca um texto ou lê uma página de categoria e grava), routine.ts (rotina de preços),
                     sweep.ts (voltas pelas páginas de categoria), attempts.ts (registro de cada consulta às lojas)
    builds/          montagens compartilhadas por link (validação, código curto, preço atualizado ao abrir)
    browser.ts       loadPage: o único caminho até as lojas (aba nova no Chrome da loja, lê, fecha), detecção de bloqueio
    browser-ext.ts   Chrome por loja (perfil em data/chrome/<loja>) e a ponte local com a extensão (EXT_PORT, token)
    pace.ts          fila por loja (withStore), intervalos, limite por hora, backoff guardado no banco
    search.ts        busca do site: termos do formulário pelo banco (specs); texto livre também na loja, com busca ao vivo
    config.ts        variáveis de ambiente (zod)
    index.ts         Fastify + SSE, rotas da API, sobe a rotina
  server/extension/  extensão do Chrome (MV3): aba de controle, abre as páginas e lê o HTML
  server/fixtures/   páginas reais recortadas das 3 lojas (ver README da pasta)
  web/src/
    components/      CategoryPicker, SearchSetup, FilterPanel, LocalSearch, ProductCard, PriceHistory,
                     BuildView, ImportPc, PcAnalysis, Compat, ui
    build.ts         montagem: pré-filtro por peça, checagem de candidatas, quantidade, peças atuais, totais, localStorage
    pc.ts            "Meu PC": lê o arquivo do CPU-Z (UTF-8/UTF-16), põe as peças na montagem, guarda o perfil
    share.ts         link da montagem (salvar e abrir /m/<id>)
    uiState.ts       categoria e filtros lembrados entre visitas (localStorage)
    searchPlan.ts    escolhas do formulário → termos da busca
    filters.ts       predicados e contagem de facetas
    useSearch.ts     cliente SSE
    format.ts        rótulos, formatação, desconto
    admin/           tela /admin (pacote separado): Admin.tsx (login e abas), um painel por aba, api.ts, format.ts, Switch.tsx
packages/
  shared/src/
    types.ts         lojas, categorias, Offer, cupom (effectiveCash), eventos
    categorize.ts    ponto único por categoria
    normalize.ts     preço, marca, specs de fonte
    motherboard.ts   specs de placa-mãe
    cpu.ts, gpu.ts, ram.ts   specs de processador, placa de vídeo e memória
    ssd.ts, cooler.ts, pccase.ts   specs de SSD (faixas de capacidade), cooler e gabinete
    hardware.ts      fatos de plataforma (chipset × geração, memória oficial, consumo, TDP de referência)
    compat.ts        checkBuild: compatibilidade da montagem
    cpuz.ts          leitura do relatório do CPU-Z (peças atuais, discos, monitor, WHEA)
    perf.ts          desempenho relativo em jogos (placa de vídeo, processador) e equilíbrio
    upgrade.ts       analyzePc: gargalo e sugestões de upgrade
    terms.ts         todos os termos que o formulário gera, isTextTerm (texto livre aceito) e termMatches (anúncio × termo pelas specs)
    group.ts         chave de modelo e agrupamento
    *.test.ts        testes
  shared/fixtures/cpuz/  relatórios do CPU-Z para os testes (um real anonimizado e um de exemplo)
data/                banco SQLite (upgradezin.db) e debug (gitignored)
```

## 12. Testes

`pnpm test` (Vitest, ~1 s). Nenhum teste acessa as lojas.

| Camada | Onde | Cobre |
|---|---|---|
| Normalização | `packages/shared/src/*.test.ts` | specs e filtro de categoria de fonte, placa-mãe, processador, placa de vídeo e memória (com títulos reais), preço BRL, marca, chaves de modelo, agrupamento (EAN, part number, ambíguo), cupons |
| Banco | `apps/server/src/db/db.test.ts` | migração idempotente; a saída do catálogo (migração 5) mantém anúncios, histórico e pausas; a saída dos termos (12) mantém anúncios e histórico |
| Compatibilidade | `packages/shared/src/compat.test.ts` | montagens válidas e inválidas a partir de títulos reais (encaixe, chipset × geração, DDR4/DDR5, slots com ATX = 4, fonte, vídeo, cooler), selos por peça, troca de placa-mãe revalidando tudo, tabelas de plataforma; TDP de referência por modelo, cooler fraco para o processador da loja (o do CPU-Z vale mais), radiador de 120 mm, placa de entrada com processador forte, H610 travando a memória |
| Lojas pelo mesmo caminho | `apps/server/src/adapters/load.test.ts` | as três lojas pelo `loadPage` (Chrome trocado por fixtures com `usePageLoader`): a URL pedida, o que foi lido, redirecionamento para a categoria (S1 reabre com paginação; S2 vira `SearchRedirectError`, também quando o destino parece bloqueio), página sem dados como bloqueio, releitura da S2, página da varredura da S2 (`?page=N`), espera pelos cards na S3, ficha técnica da S1 |
| Parsers das lojas | `apps/server/src/adapters/{s1,s2,s3}.test.ts` | leitura de cada página real recortada: preços, parcelamento, estoque, EAN/part number, cupom, marketplace/open box, itens fora da categoria; na S1, oferta temporária (prazo e estoque), estoque fora de oferta e cupom (soma com a oferta, não vale para vendedor parceiro); na S3, "OPEN BOX" no título |
| Lojas | `apps/server/src/stores.test.ts`, `stores-db.test.ts` | do `.env`: cor com ou sem `#`, valor inválido ignorado, degradê; no banco: cópia do `.env` só na primeira vez, validação de cada campo do admin, salvar valendo na hora, loja desligada fora das buscas |
| Admin | `apps/server/src/admin/{admin,ops,data,backup}.test.ts`, `apps/web/src/admin/format.test.ts` | login, força bruta, cookie, cabeçalho `X-Admin`, sessão e cada rota (montadas com `inject`); pausa manual e tirar pausa sem subir a escada; resultado de cada consulta; registro, filtros e linha do tempo; rotina guardada e reiniciada; modo por loja (só o enviado muda, inválido volta ao padrão), loja em pausa na sua vez sem consultar; painel com o modo e a fila da loja; fila em texto ("2 buscas do site e 1 da rotina esperando"); coletar agora recusando loja em pausa e termo inválido; cobertura; termos (filtro, `%` literal, apagar só pesquisados, prioridade); atividade sem IP; backup que abre como banco; nome com caminho recusado; merge com dois bancos reais (oferta mais recente, histórico das duas, sem duplicar, outra migração recusada); textos da tela |
| Preços no banco | `apps/server/src/prices/prices.test.ts`, `apps/server/src/search.test.ts` | histórico só quando muda, "sem estoque" no fim da volta e de volta ao estoque, fila por loja, pausa guardada, menor preço em 30 dias, anúncio que bate com o termo pelas specs, texto no título; busca do site sem consultar loja nos termos do formulário e só nas lojas com busca ao vivo no texto livre |
| Ficha técnica | `packages/shared/src/sheet/sheet.test.ts`, `apps/server/src/prices/sheets.test.ts`, `identity.test.ts`, `s2.test.ts`, `s3.test.ts`, `sweep.test.ts` | texto da página em linhas (ficha numa linha só, marcadores, valor na linha seguinte, seções); campos de cada categoria em fichas no formato das três lojas (núcleos P+E, kit de memória, leitura/escrita juntas, conectores da fonte em cabos, radiador pelas medidas, cooler baixo); colunas que seguem a lista de campos, releitura quando o leitor muda, ficha juntada entre lojas com a origem, fila (completa sai, incompleta deixa as outras lojas na fila), cobertura; fichas reais da S2 e da S3 |
| Cupom, part number, fila e modos | `packages/shared/src/coupon.test.ts`, `mpn.test.ts`, `apps/server/src/pace.test.ts` | condições do cupom (limitado, mínimo, validade com e sem ano, PIX) e o cupom só valendo quando atinge o mínimo e não venceu; part number no fim do título das três lojas (e o que não é código), mesmo código juntando lojas e variante separada; consulta na fila atrás de bloqueio sem ir à loja; busca do site passando na frente da rotina na fila; fila visível (em andamento, prioritárias e da rotina); cancelar quem espera sem travar a fila |
| Marcas | `apps/server/src/prices/prices.test.ts`, `apps/web/src/brands.test.ts` | marcas da categoria vistas no período (sem repetir, sem "Outros"/"Genérica"); sugestões da fonte do "Meu PC" juntando as do banco com as comuns, na grafia da busca |
| Termo × anúncio | `packages/shared/src/terms.test.ts` | `termMatches` em cada tipo de termo (encaixe, linha, potência, chipset, memória, SSD, cooler, gabinete, fabricante do chip). Conferido também contra os ≈8 mil anúncios do banco (nov/2026): todo tipo de termo acha anúncios; os que não acham nada (chipsets antigos, Core 3/5/7, 48/96 GB) também não têm nada à venda |
| Rotina de preços | `apps/server/src/prices/sweep.test.ts`, `routine-jobs.test.ts` | volta página por página, fim na primeira página sem estoque, só anúncio novo em estoque, fim da volta marcando sem estoque, vários caminhos por categoria, teto de páginas, ordem entre categorias, falha retomando da mesma página, página da categoria nas três lojas (S3: cards sem `data-tss-*` e o "ver mais" em JSON), rotina só com páginas de categoria |
| Montagem por link | `apps/server/src/builds/builds.test.ts` | código curto, validação (vazia, link que não é https, quantidade), salvar/abrir com o preço mais recente do banco |
| Segurança | `apps/server/src/security.test.ts` | limite por janela, abertos ao mesmo tempo, IP real só com conexão local, termos aceitos, mesma montagem reaproveitando o link |
| Três lojas juntas | `apps/server/src/adapters/cross-store.test.ts` | invariantes de toda oferta (preço, link, chave) e o mesmo modelo de lojas diferentes virando um produto |
| Categorias novas | `apps/server/src/adapters/categories.test.ts` | processador, placa de vídeo, memória, SSD, cooler e gabinete nas lojas com amostra: specs, descartes (acessório, kit, ventoinha, tela de monitoramento, SSD de servidor), o mesmo processador nas três lojas e a mesma placa de vídeo em duas virando um produto |
| SSD, cooler e gabinete | `packages/shared/src/{ssd,cooler,pccase}.test.ts` | reconhecimento e specs com títulos reais (formas curtas "512G"/"1T", interface pela leitura, M.2 SATA), faixas de capacidade, encaixe do cooler (fixação AM4/AM5 e LGA1700/1851), placa que cabe no gabinete, chaves de modelo |
| Montagem | `apps/web/src/build.test.ts` | busca de cada peça pré-filtrada pela montagem, selo de cada candidata (inclusive na troca), totais por loja e na melhor combinação (com quantidade e peças atuais fora), guardar/carregar no navegador (e sem armazenamento) |
| Orçamento | `packages/shared/src/budget.test.ts`, `apps/web/src/budget.test.ts`, `apps/server/src/cli/budget-test.test.ts` | Dimensionamento, ranking, valores em pt-BR, consulta ao mínimo e simulação de preços. A matriz com o catálogo está na seção 17.4. |
| Gargalo e upgrades | `packages/shared/src/upgrade.test.ts` | tabela de desempenho (referências, X3D, Intel K, pares equilibrados, toda placa com consumo tem desempenho); placa de vídeo como gargalo com a faixa sugerida e a fonte (sem fonte, cabe, não cabe), processador como gargalo no mesmo encaixe, topo do encaixe → plataforma nova, só vídeo integrado, PC equilibrado, memória pouca/um pente/lenta, Windows num HD, modelo fora da tabela |
| Relatório automático | `packages/shared/src/cpuz.test.ts`, `apps/web/src/pc.test.ts` | AMD AM4/DDR4/Radeon (relatório real anonimizado) e Intel LGA1700/DDR5/GeForce (exemplo): specs de cada peça, pentes sem a repetição dos registradores, XMP gravado × frequência em uso, fabricante abreviado, "Default string" ignorado, só vídeo integrado, sem SPD (pelo DMI), discos sem pendrive, monitor, WHEA, nada de número de série; arquivo UTF-16, texto que não é do CPU-Z, peças como "Atual" na montagem, problemas só entre peças atuais ignorados |
| Front | `apps/web/src/searchPlan.test.ts` | plano de busca de cada categoria (termos, botão, limite de 8; placa-mãe com várias plataformas ou só memória), filtros novos, "Limpar" mantendo o que define a busca, todo termo do formulário coberto pela rotina |

Fixtures em `apps/server/fixtures/` (como atualizar quando uma loja muda o layout: README da pasta) e em `packages/shared/fixtures/cpuz/` (relatórios do CPU-Z, ver README da pasta). A leitura dos cards de S3 usa `linkedom` como DOM nos testes. As fixtures são anonimizadas (domínios `s1.example`…, nomes e códigos de campanha trocados) e os testes usam lojas fictícias definidas em `apps/server/src/test-setup.ts`, sem ler o `.env`.

## 13. Execução e deploy

Desenvolvimento:

```bash
pnpm install
pnpm dev          # servidor :8787 + web :5173 (proxy /api)
pnpm chrome-setup # uma vez: instala a extensão no Chrome de cada loja
pnpm scan 750w    # busca pelo terminal
pnpm scan --sweep # confere as páginas de categoria (1ª página, sem gravar)
pnpm routine-test # rotina de verdade nas lojas, com relatório em data/debug/
pnpm test
```

Requisitos: Node 22.13+, pnpm e Google Chrome instalado (com a extensão do projeto em cada perfil de loja; com Chromium, ela carrega sozinha).

Versões: `version` nos `package.json` (a da raiz vale para o app), histórico no `CHANGELOG.md`, tag `vX.Y.Z` no git. `pnpm release X.Y.Z` (`scripts/release.mjs`) atualiza todos os pacotes e abre a seção da versão no CHANGELOG.

Servidor sem tela (em uso: notebook com Ubuntu; scripts e passo a passo em `deploy/`, fora do git):

- Node 22 e pnpm só do usuário (`~/.local/opt/node`), código clonado em `~/Upgradezin`, `.env` e `data/` na pasta.
- Google Chrome (ou Chromium, que carrega a extensão sozinho) rodando sob `xvfb-run`; com o Chrome comum, instalar a extensão uma vez por loja no perfil `data/chrome/<loja>`.
- `pnpm build` e `pnpm start` (Fastify serve o front) num serviço do systemd (`upgradezin.service`, `Nice=10`, até 2 GB); logs no journald.
- Link público temporário por um segundo serviço com `cloudflared` (`trycloudflare.com`); `deploy/update.sh` atualiza pelo GitHub e reinicia.
- Backup diário do banco (`VACUUM INTO`, 7 dias no servidor, cópia puxada para o PC). Backups do admin (manuais e os de antes do merge) ficam na mesma pasta e não são apagados sozinhos.
- Admin: `ADMIN_USER` e `ADMIN_PASSWORD` no `.env`. Na primeira subida com a migração 7, as lojas do `STORE_*` vão para o banco; conferidas na aba Lojas, as linhas `STORE_*` podem sair do `.env`.

Variáveis em `.env.example`.

## 14. Roadmap

| # | Etapa | Estado |
|---|---|---|
| 0 | Investigação das lojas | feito ([§5](#5-fontes-de-dados)) |
| 1 | Busca ao vivo de fontes, 3 lojas, UI com filtros | feito |
| 1.1 | Cupons (preço à vista com cupom) | feito ([§6.3](#63-cupons)) |
| 1.2 | Cache na página por categoria | feito |
| 1.3 | Categoria e filtros lembrados entre visitas; ordenação "Maior desconto" | feito |
| 2 | Polimento: separar variantes do mesmo modelo por part number | — |
| 3 | Fixtures e testes dos parsers | feito ([§12](#12-testes)) |
| 4 | Placa-mãe, processador, placa de vídeo, memória RAM | feito |
| 5 | SSD, cooler, gabinete | feito |
| 6 | Usuários e login | — |
| 7 | Monitores e alertas de preço | — |
| 7.3 | Histórico de preço na tela (gráfico por loja, selo de menor preço em 30 dias) | feito ([§9.2](#92-frontend)) |
| 7.2 | Preços no banco, coletados por rotina; busca do site lendo do banco | feito ([§8.2](#82-preços-e-rotina-de-coleta)) |
| 8 | Admin: lojas no banco, rotina por loja, pausas, coletar agora, registro de consultas, cobertura, termos, ao vivo, atividade, backups e merge | feito ([§9.3](#93-admin-admin)) |
| 8.1 | Admin: montagens compartilhadas (listar, apagar) e restaurar backup pela tela | — |
| 7.1 | Catálogo de peças em SQLite (importação única do OpenDB) | removido ([ADR-005](#adr-005-catálogo-de-peças-em-sqlite-importado-uma-vez-do-opendb)) |
| 8 | Deploy no servidor Linux | feito ([§13](#13-execução-e-deploy)) |
| — | Montar o PC, peça por peça (ver [§17.1](#171-montar-o-pc-montagem-dinâmica)) | feito, com compartilhamento por link |
| — | Importar setup atual pelo CPU-Z ([§17.2](#172-importar-setup-atual-cpu-z)) | feito |
| — | Identificar gargalo e sugerir upgrades a partir do PC atual ([§17.3](#173-identificar-gargalo-e-sugerir-upgrades)) | feito |
| — | Montar pelo orçamento: PC completo ou upgrade do PC atual ([§17.4](#174-montar-pelo-orçamento)) | feito |
| 7.4 | Varredura de categoria: histórico de todo produto à venda (S1) | feito ([§8.2](#82-preços-e-rotina-de-coleta)) |

### A fazer

#### Entregas da 1ª versão

1. **Montar pelo orçamento.** Feito em nov/2026 ([§17.4](#174-montar-pelo-orçamento)): um ponto de entrada ("quanto quer gastar?") para o PC completo e o upgrade do PC atual, só com peças compatíveis pela ficha, e o resultado vai para a montagem. Falta: as "melhores ofertas" de cada dica do gargalo (`picks.ts`, §17.3) ainda têm ranking próprio; passar a usar o mesmo motor.
2. **Comparador de hardware.** Disponível pelo ícone no cabeçalho, com a contagem total das peças. A seleção vem da busca, da página do produto ou das sugestões de upgrade. A URL `/comparar` carrega as chaves do catálogo e a tela reutiliza a API dos produtos para mostrar ficha e preço em tabelas separadas por categoria, com rolagem horizontal quando as colunas ocupam mais espaço. Para CPU e GPU, mostra desempenho relativo em jogos, diferença sobre a primeira peça e pontos por R$ 1.000. Com o PC atual informado, também estima ganho sobre a peça atual e equilíbrio com a outra peça. A seleção fica numa lista só (`upgradezin.compare.v1`, com a categoria de cada peça), limitada a 5 peças por categoria; a lista antiga, com uma chave por categoria, é convertida na primeira leitura. Na página dá para remover uma peça ou limpar a categoria da aba aberta (as outras ficam). Um link `/comparar?peca=...` diferente da seleção abre como comparação compartilhada: só para ver, com Adicionar à minha comparação e Ver minha comparação.
3. **Mais de um disco na montagem.** Implementado. A montagem aceita NVMe e SATA e importa os discos do CPU-Z como "Atual". Total, compartilhamento e validação incluem todos os discos. O orçamento inclui os discos existentes ao validar upgrades e continua selecionando um SSD nos PCs completos.
4. **Login com Google.** Implementado, com configuração e validação real pendentes. A conta abre com os dados do SQLite e registra as alterações feitas após o login. O que já estiver salvo como visitante fica separado. A sincronização cobre Meu PC, montagem atual, filtros e categoria das buscas, preferências de orçamento e seleção do comparador. O último resultado de cada aba do orçamento também vai para a conta (`upgradezin.budget.result.v1`), com a data. Guardar montagens separadas e o resultado completo das buscas continua no escopo da v1.
5. **Alertas de preço.** Ficam na conta, no servidor (`apps/server/src/alerts.ts`; regras e textos em `packages/shared/src/alerts.ts`, usados pelos dois lados). Um alerta por produto (`price_alerts`), de três tipos: preço-alvo (o preço à vista, o mesmo da busca: a oferta em estoque mais barata das próprias lojas, com cupom), qualquer queda (abaixo da referência; o preço avisado vira a nova referência) e voltou ao estoque. Ao criar, título, categoria e preço vêm do banco, não do pedido, e uma condição que já vale não avisa (espera deixar de valer e voltar). A rotina `startAlertChecks` confere ao subir e depois de cada coleta da categoria (com a folga do recálculo das chaves de produto); produto que sumiu do banco fica como estava. Quando a condição vale, grava em `notifications` (as 50 últimas por conta). Preço-alvo e estoque desarmam ao avisar e rearmam quando a condição deixa de valer. Rotas: `GET/PUT /api/account/alerts`, `DELETE /api/account/alerts/:key`, `POST /api/account/notifications/read` (gravações com `x-account` e `x-account-id`, como os dados da conta). O site (`apps/web/src/alerts.ts`, `PriceAlerts.tsx`) só lê: busca ao abrir, a cada 5 min e ao voltar para a aba; o sino fica ao lado da conta e, com permissão, as notificações novas desde a última vista no navegador viram notificação do navegador (tag por notificação, para não repetir entre abas). Precisa de login; com o login desligado, o sino não aparece. Até 30 produtos por conta. O e-mail fica para depois.

Antes de lançar a 1ª versão, falta o motor único de recomendação e conferir os fluxos com o catálogo de produção. A calibração do orçamento fica pausada enquanto as fichas são complementadas. Depois, a matriz ampliada deve ser executada com um dump atualizado e comparada ao JSON de referência.

**Sessão da conta.** O servidor troca o código de autorização com o Google, valida a identidade pelo ID token e usa o identificador estável do Google para localizar a conta. A migração 17 cria as tabelas de contas, sessões, tentativas de login e dados da conta. A sessão usa cookie HttpOnly e Secure e o servidor guarda o hash do identificador. O admin tem sua própria sessão. O navegador mantém uma fila isolada por conta para alterações que ainda não chegaram à base. O arquivo do CPU-Z continua sendo lido no navegador. A conta guarda o `given_name` do Google (ou o nome completo, quando ele não vem) e é atualizada a cada login. O cabeçalho mostra só a primeira palavra do nome e usa "Minha conta" quando o Google não informa nome.

**CEP de entrega.** A migração 18 adiciona um CEP opcional à conta. Minha conta consulta o CEP pela sessão e salva ou remove o valor via `PUT /api/account/cep`. O servidor guarda oito dígitos, preservando zeros à esquerda. A cotação de frete por loja continua planejada.

Comparações de GPU exibem separadamente o modelo comercial, a arquitetura e o código do chip quando a ficha os informa. O leitor reconhece NVIDIA Kepler a partir de GK208/GK208B ou de uma declaração explícita de arquitetura e guarda a contagem CUDA quando consta no texto.

Na comparação, a nota de CPU e GPU soma 75% do índice de jogos e 25% dos pontos por R$ 1.000, cada um dividido pelo maior valor do grupo. Peças sem índice ou preço em estoque ficam sem nota. As demais categorias são ordenadas pelo preço em estoque. As tabelas partem da largura padrão de 64 rem e crescem com as colunas até a largura da tela.

Na tela, CPUs e GPUs podem ser ordenadas por nota, preço, desempenho bruto ou custo-benefício. Os modelos identificados aparecem com nomes curtos e a ficha técnica abre em um card recolhido por padrão. O ganho estimado usa como referência a peça atual do PC importado. Voltar à busca abre a categoria do produto ou da aba ativa e retoma os filtros e resultados salvos daquela categoria quando disponíveis.

As páginas de produto e comparação compartilham o cabeçalho fixo no topo ao rolar, com a marca Upgradezin, Voltar à busca e o contador da comparação. No comparador, o cabeçalho fica sem título (as abas já situam a pessoa) e as categorias ficam em abas com contagem, sem trocar de rota. Processadores e placas de vídeo aparecem sempre (vazias, com um aviso), as demais só com peças. As abas ficam sobre uma linha de base, com a ativa sublinhada em laranja e a contagem num selo. O link do cabeçalho leva a própria seleção na URL e não conta como comparação compartilhada. A folha global aplica a paleta do app ao menu aberto dos selects em navegadores com suporte a `base-select`.

Em Identificar gargalo, Comparar alternativas abre o comparador com os produtos daquela dica. O nome curto da GPU inclui VRAM quando disponível. O ganho no PC compara o índice de jogos combinado antes e depois de trocar uma peça, com resolução e frequência do monitor importado, usando a mesma função do orçamento para combinar os índices.

Nas abas de processadores e de placas de vídeo, a última coluna destaca a peça atual (processador ou placa de vídeo dedicada), com o índice em jogos e as especificações disponíveis. Ela permanece fora da ordenação, das notas e dos destaques das alternativas.

Na mesma aba, compatibilidade direta e Componentes adicionais necessários usam o socket, o chipset e o tipo de memória do PC importado. O comparador indica mudança de plataforma, troca de placa-mãe ou memória e possível atualização de BIOS. Cooler e fonte ficam na análise de compatibilidade da montagem.

Os botões Adicionar e Limpar ficam à direita, na linha das abas, e valem para a aba aberta: Adicionar abre a busca da categoria em outra guia. Alterações na seleção feitas em outra guia (pelo evento `storage` ou pelo canal da conta) atualizam o comparador aberto, que só busca as peças novas. A ordenação fica na mesma faixa das abas.

Na tela inicial, o atalho de comparação exibe o texto Comparar. No cabeçalho da busca, comparação e montagem usam ícones com contagem.

Links para a busca usam `?categoria=…` para escolher a categoria inicial. O app remove esse parâmetro da URL depois de abrir.

Abas ativas e botões em destaque do app e do admin usam a classe compartilhada `accent-control`, com borda laranja e fundo suave.

#### Melhorias

- **Cupons da S2 e S3:** hoje só a % do anúncio. A página de cupons da S3 lista código e condições; ler uma vez por dia, como na S1 ([§6.3](#63-cupons)).
- **Frete por CEP:** cotar por loja com o CEP já disponível na conta ([§16](#16-questões-em-aberto)).
- **Variantes do mesmo modelo** separadas por part number, quando importa (cor, versão OC).

#### Decidido

- **Threadripper, Xeon, EPYC e Opteron ficam fora** (`isCpu`): plataformas de workstation e servidor, com soquetes e placas que o app não conhece, e que em jogos rendem menos que os de desktop.
- **Altura do cooler:** fica com a ficha e a busca na web. Cooler sem altura em nenhuma das duas é produto de procedência duvidosa, e a montagem só pede para conferir.
- **"Gabinete ATX"** na busca são os gabinetes onde uma placa ATX cabe, incluindo os que aceitam E-ATX ([§8.2](#82-preços-e-rotina-de-coleta)).

## 15. Registro de decisões

### ADR-001: Busca ao vivo, em volume de pessoa

- **Contexto:** o objetivo é automatizar a consulta de preço feita à mão, para uso pessoal, com preço atualizado no momento da busca. Uma busca levar alguns minutos é aceitável.
- **Decisão:** cada busca consulta as lojas na hora, em paralelo entre lojas e uma requisição por vez dentro de cada uma, com intervalo entre páginas, limite de páginas por hora e cache. Para não desperdiçar requisições, o usuário monta a busca antes (ex. potências), e cada escolha vira um termo pequeno em vez de varrer a categoria inteira. Filtros e agrupamento rodam no cliente.
- **Revisão:** a primeira versão consultava uma loja de cada vez. Passou a consultar as lojas em paralelo: o que protege cada loja é o volume dentro dela (uma requisição por vez, intervalo, limite por hora, pausa no bloqueio), que não mudou; a espera de uma loja pela outra só deixava a busca lenta.
- **Consequência:** sem índice local nem varredura agendada. Busca com várias lojas e termos leva de segundos a alguns minutos.
- **Substituído em parte (nov/2026) pelo [ADR-006](#adr-006-preços-no-banco-coletados-por-rotina):** a busca passou a ler do banco, alimentado por uma rotina. As regras de volume continuam as mesmas.

### ADR-002: Sem persistência, por enquanto

- **Contexto:** a busca é anônima e só quer o preço atual. Um histórico gravado a partir das buscas fica cheio de buracos (só registra o que alguém procurou) e não sustenta selos confiáveis.
- **Decisão:** nenhum dado de negócio em disco. Cache só em memória. O navegador roda em sessão anônima, sem perfil salvo. A primeira versão gravava histórico em `data/history.json`; foi removida.
- **Consequência:** se surgir necessidade real (monitores, selo "menor preço em N dias", detecção de "de" inflado), a persistência volta com propósito definido. Preferência por JSON em disco; se o volume pedir, o `node:sqlite` embutido no Node (sem dependência nem serviço).
- **Atualização (nov/2026):** o catálogo de peças passou a ficar em SQLite ([ADR-005](#adr-005-catálogo-de-peças-em-sqlite-importado-uma-vez-do-opendb)), e depois os preços ([ADR-006](#adr-006-preços-no-banco-coletados-por-rotina)). O histórico agora sai de uma rotina que cobre todos os termos do formulário, não só o que alguém procurou: o motivo original para não gravar deixou de valer. O navegador também deixou de ser uma sessão anônima: cada loja tem um perfil de Chrome fixo em `data/chrome/<loja>` (onde fica a extensão; [ADR-004](#adr-004-navegador-padrão-e-pausa-no-bloqueio)), sem dado de usuário do site.

### ADR-003: Sem marketplaces abertos

- **Contexto:** em marketplaces abertos é comum receber produto usado ou com defeito anunciado como novo, e é difícil controlar a reputação de cada vendedor.
- **Decisão:** só lojas que vendem e entregam o próprio estoque. Ofertas de terceiros dentro dessas lojas (marketplace da S1) ficam escondidas por padrão.

### ADR-004: Navegador padrão e pausa no bloqueio

- **Contexto:** S2 e S3 usam proteção anti-bot (Cloudflare). Nos testes, um navegador real passou no começo, mas as lojas escalaram: a S3 passou a pedir confirmação interativa e a S2 a devolver 403 com página de "manutenção".
- **Decisão:** o Google Chrome instalado, aberto pelo Playwright. Bloqueio pausa a loja (backoff), a UI mostra o status com o link da mesma busca no site da loja, e a busca segue nas outras.
- **Revisão:** começou com o Chromium do Playwright; passou a usar o **Google Chrome instalado** (`channel: chrome`), aberto em sessão anônima, com a janela fora da área visível e fechado ao fim de cada busca. Continua sem nenhuma modificação: o Chrome segue se identificando como automatizado. Interceptar rede e minimizar a janela foram descartados porque quebravam a página de verificação.
- **Consequência:** a cobertura de S2 e S3 depende de as lojas aceitarem esse volume baixo. S1 responde a HTTP simples e funciona de ponta a ponta; S3 funciona com o Chrome instalado; S2 limita depois da primeira página.
- **Revisão (nov/2026):** o que as lojas detectavam era o navegador controlado: com o Playwright e com qualquer conexão pela porta de depuração, o próprio Chrome se declara automatizado (`navigator.webdriver`), e as duas lojas bloqueavam da 2ª página em diante. Um Chrome comum, sem porta de depuração, não bloqueou nem abrindo uma página por segundo. Agora **todas as lojas** (S1 inclusive, antes por HTTP) são lidas pela extensão do projeto num Chrome comum por loja: um só caminho (`loadPage`), sem Playwright. Nos testes, `usePageLoader` troca o Chrome por fixtures.

### ADR-005: Catálogo de peças em SQLite, importado uma vez do OpenDB

- **Contexto:** a montagem do PC precisa escolher modelos (processador, chipset, chip de vídeo, memória, fonte) antes de buscar preços. Não há catálogo oficial completo: Intel e AMD não exportam o catálogo, o PCPartPicker não tem API e os termos dele proíbem uso fora do pessoal. O BuildCores OpenDB é aberto (CC BY-NC-SA 4.0), estruturado e atualizado pela comunidade.
- **Decisão:** importar o OpenDB **uma vez** (`pnpm catalog:import`) para um SQLite local, só com o escopo do app, convertido para as specs do app. Não consultar o OpenDB em rotina nem usá-lo como API. SQLite pelo `node:sqlite` embutido no Node (sem dependência nativa nem serviço), já pensando em receber anúncios e histórico de preço quando a busca em rotina existir.
- **Consequências:** o banco não é versionado (cada instalação roda a importação; sem ela, a montagem fica sem catálogo). Uso comercial do app exigiria permissão do BuildCores ou outra fonte. Tabelas de plataforma escritas à mão (chipset × geração, memória oficial, margem da fonte) continuam no código: a base não tem esses dados.
- **Substituído (nov/2026): catálogo removido.** A montagem passou a partir do que está à venda ([§17.1](#171-montar-o-pc-montagem-dinâmica)), e a tela nunca chegou a usar o catálogo; sobrava só casar anúncio com peça por EAN/part number, que nada lia. Sem ele, some a licença não comercial (CC BY-NC-SA) presa ao banco, a importação de 16 MB e um passo da instalação. A migração 5 apaga as tabelas ([§8.1](#81-banco-appsserversrcdb)). O TDP do processador, que vinha dele, sai do CPU-Z no PC importado e, para o que está à venda, de uma regra por família e sufixo (`cpuTdp`, [§17.1.1](#1711-regras-de-compatibilidade)).

### ADR-006: Preços no banco, coletados por rotina

- **Contexto:** com a busca ao vivo, cada pesquisa esperava as lojas (segundos a minutos), o mesmo termo era consultado de novo a cada pesquisa e não havia histórico de preço. O conjunto de termos possíveis é pequeno e fixo (o formulário gera ≈110), então dá para mantê-los todos atualizados com volume baixo.
- **Decisão:** uma rotina no servidor coleta os termos e grava anúncios e preços no SQLite (`listings`, `price_points`); o site lê do banco. A loja só é consultada na hora quando o termo não tem coleta, quando ela está velha (`LIVE_REFRESH_H`) ou quando a requisição pede `force=1`. (Depois, nov/2026: toda busca atualiza por trás o que tem mais de `REVALIDATE_MIN`; ver [§3](#3-arquitetura).) Rotina e busca do site dividem a mesma fila por loja e o mesmo limite por hora, com teto próprio para a rotina (`ROUTINE_PAGES_PER_HOUR`).
- **Consequências:** busca instantânea na maior parte do tempo, com "atualizado há X" em vez de "agora"; histórico de preço por anúncio, base para selos de menor preço e alertas. O volume nas lojas passa a existir mesmo sem ninguém usando (até 12 páginas por hora por loja, por padrão), sempre dentro das regras de [§4.3](#43-política-de-coleta); bloqueio pausa a rotina naquela loja.
- **Revisão (nov/2026):** com as três lojas na rotina, s2 e s3 (navegador) bloquearam na primeira hora. A rotina passou a cobrir só as lojas de `ROUTINE_STORES` (padrão s1); s2 e s3 ficam com a busca do site, e o banco guarda o que ela trouxer. A pausa por bloqueio passou a ser gravada no banco, para sobreviver a reinício.
- **Revisão (nov/2026, servidor):** nova tentativa com s2 e s3 na rotina, agora pelo Chrome do servidor: s3 pediu verificação depois de um termo, duas vezes seguidas (logo após a pausa), e s2 bloqueou já na primeira consulta. A rotina continua só em s1.
- **Revisão (nov/2026, modo lento):** tirar a loja da rotina deixava o histórico dela parado de vez. s2 e s3 voltaram em modo lento (um termo a cada 30–45 min), e o bloqueio só pausa, com retomada automática. No servidor, `ROUTINE_STORES` voltou às três lojas.
- **Revisão (nov/2026, resultado por specs):** o resultado de uma loja era só o do termo pesquisado; com s2 e s3 bloqueadas, um termo que elas nunca coletaram ("AM4") escondia anúncios que o banco já tinha delas (vindos de "Ryzen 7"). A busca passou a juntar os anúncios da loja que batem com o termo pelas specs, de qualquer coleta ([§8.2](#82-preços-e-rotina-de-coleta)).
- **Revisão (nov/2026, extensão):** com as lojas lidas pelo Chrome comum com a extensão ([ADR-004](#adr-004-navegador-padrão-e-pausa-no-bloqueio)), as três voltaram à rotina por igual. Cada loja coleta uma coisa por vez (um termo, ou uma página da varredura no modo normal), a cada 15 s (normal), 20 s (reduzido) ou 60 s (lento); na fila da loja, a busca do site passa na frente.

### ADR-008: Varredura de categoria para o histórico

- **Contexto:** o histórico só cobria o que aparecia na primeira página de algum termo do formulário (120 itens por termo na S1, ordenados pelos mais procurados). Produto fora desse topo não tinha histórico nenhum, e o que tinha era recoletado só quando o termo vencia. Para quem usa, o mais útil é ver o histórico de qualquer peça à venda. Os ≈110 termos custam mais páginas por volta (≥110) do que a categoria inteira (75 na S1).
- **Decisão:** a rotina varre a página de cada categoria da loja, algumas páginas por hora, com orçamento próprio e retomando de onde parou ([§8.2](#82-preços-e-rotina-de-coleta)). Os termos continuam: dão a relevância da loja e a consulta na hora. A busca do site junta a eles os anúncios da varredura que batem com o termo pelas specs ([§8.2](#82-preços-e-rotina-de-coleta)). "Nunca a categoria inteira" segue valendo para a busca ao vivo ([ADR-001](#adr-001-busca-ao-vivo-em-volume-de-pessoa)); a varredura é da rotina, no mesmo volume de pessoa (uma consulta por vez, intervalo, limite por hora, pausa no bloqueio).
- **Consequências:** todo produto da categoria na S1 ganha um ponto de histórico por dia, no mínimo. Caminhos de categoria no `.env` (`STORE_Sx_SWEEP`), como o resto do que identifica a loja; hoje ficam no banco, editados no admin ([§4.7](#47-lojas-por-id)).
- **Revisão (nov/2026, só páginas de categoria):** os termos automáticos traziam kits, PCs montados e acessórios junto e cobriam só o topo de cada busca (na S2, ~140 placas-mãe de mais de mil). A rotina passou a ler só as páginas de categoria, nas três lojas e em todos os modos, e só o que está em estoque (a lista acaba na primeira página sem estoque; no fim da volta, o que sumiu vira "sem estoque"). A busca do formulário responde pelo banco; só o "Não achou? Buscar nas lojas" vai às lojas. As tabelas de termos saíram (migração 12).

### ADR-007: CPU-Z para leitura automática do setup atual

- **Contexto:** para sugerir upgrades, o app precisa saber o PC atual. O navegador só entrega uma parte: o nome da placa de vídeo em alguns navegadores (Firefox, Safari e Brave escondem), núcleos, memória arredondada e o monitor; nunca o modelo do processador nem a placa-mãe, que definem o que dá para trocar. Outras entradas possíveis: relatório do dxdiag (sem placa-mãe nem detalhe de memória), um comando do PowerShell para colar no terminal ou um programa próprio.
- **Decisão:** usar o relatório do CPU-Z para leitura automática no navegador. O formato fornece dados de placa-mãe, pentes e perfis de memória, PCIe, discos e monitor. A alternativa manual é marcar Já tenho na montagem.
- **Consequências:** a leitura automática precisa de um relatório gerado no Windows. O fluxo manual funciona sem instalar o CPU-Z e usa as especificações conhecidas das peças.

## 16. Questões em aberto

- [x] **Fonte de specs para categorias complexas.** Resolvido em nov/2026 com a ficha técnica por categoria ([§8.3](#83-fichas-técnicas)): página do produto nas três lojas, título, busca na web e preenchimento à mão, juntados campo a campo. Busca, filtros, montagem e gargalo leem a ficha.
- [x] **Cobertura confiável de S2 e S3.** Resolvido em nov/2026: o bloqueio vinha do navegador controlado (Playwright, porta de depuração). Com o Chrome comum e a extensão, as duas respondem como a S1 ([ADR-004](#adr-004-navegador-padrão-e-pausa-no-bloqueio)). Falta acompanhar por mais tempo, no servidor também.
- [x] **Profundidade por termo e amostras que faltavam.** Superado: a busca lê do banco, alimentado pela rotina e pela varredura completa das categorias nas três lojas (a da madrugada também), com os caminhos de categoria configurados no admin.
- [x] **Condições de cupom:** lidas do texto da S1 (limitado, mínimo, validade, PIX) e aplicadas no preço ([§6.3](#63-cupons)). S2 e S3 seguem só com a %.
- [x] **Frete:** por CEP, depois do login (o CEP fica na conta). Até lá, o preço é sem frete.
- [ ] **Ritmo por loja.** Com a extensão (nov/2026), S2 e S3 não bloquearam com um termo a cada 6–8 s. Os modos são por loja e em segundos (normal 15 s, reduzido 20 s, lento 60 s; [§8.2](#82-preços-e-rotina-de-coleta)). Acompanhar no registro de consultas (admin, aba Consultas), também no servidor; se alguma loja voltar a bloquear, baixar o modo dela. Ideia: o modo descer sozinho a cada bloqueio e subir depois de uma sequência de consultas boas.
- [x] **Licença** do repositório: proprietária, todos os direitos reservados (`LICENSE`, `"license": "UNLICENSED"`). Sem licença o padrão já seria esse, mas o aviso explícito deixa claro; impedir de fato a cópia só com o repositório privado.

## 17. Ideias futuras

> Status: implementados a montagem (17.1), com a checagem de compatibilidade ([§17.1.1](#1711-regras-de-compatibilidade)), a tela ([§9.2](#92-frontend)) e o compartilhamento por link, a importação do setup atual pelo CPU-Z (17.2) e a identificação de gargalo com sugestões de upgrade (17.3). Público: quem curte PC e quer ver preço, montar e comparar. As três primeiras se encaixam: a montagem é o centro, a importação do setup atual vira o Meu PC (sem preencher a montagem), e as sugestões apontam o que vale trocar.

```
 CPU-Z .txt ──► Importar setup atual (17.2) ──► Montar o PC (17.1) ◄── busca por peça (banco)
                         │                         ▲
                         └──► Sugerir upgrades (17.3) ─┘  (cada sugestão abre a peça na montagem)
```

### 17.1 Montar o PC (montagem dinâmica)

Peças marcadas como Já tenho alimentam o PC atual usado no diagnóstico, no comparador e no orçamento. A peça marcada prevalece na sua categoria. O relatório do CPU-Z complementa com as demais peças e com dados medidos, como monitor, frequência em uso e erros WHEA. Importar o relatório (pelo Meu PC, pelo diagnóstico ou pelo orçamento) não monta nada: as peças lidas ficam só no Meu PC e as marcações Já tenho saem da montagem (`withoutOwned`). Peças com chave `pc:` que versões antigas copiavam para a montagem são limpas ao abrir (`withoutPcItems`). Numa busca aberta por uma sugestão do Gargalo, a compatibilidade confere contra o PC sem gravá-lo na montagem.

Diagnóstico e orçamento compartilham os botões Importar meu PC e Informar peças manualmente.

Na tela inicial, o card Identificar gargalo mostra o modelo curto do processador quando há espaço ao lado da descrição.

A tela Montar peça por peça agrupa os componentes em uma lista única, com as ações de cada peça junto dela e o total fixo no rodapé. O título abre a página do produto quando alguma oferta tem a chave do catálogo, seguindo a mesma regra da busca.

O primeiro disco fica em `ssd`, e os demais em `extraDrives`. A compatibilidade compara a quantidade de discos M.2 e SATA com os slots e portas informados na ficha da placa-mãe. Quando a ficha declara compartilhamento de portas SATA ou de linhas com vídeo, a montagem avisa para conferir a posição no manual. A ficha ainda não descreve as combinações de portas e slots por modelo. Esses avisos vêm do texto guardado da ficha e não entram na fila de perguntas da busca web.

Uma tela de montagem peça por peça, na ordem em que uma escolha restringe a próxima:

> **Decidido (nov/2026):** a montagem parte do que está à venda (as buscas, agora lidas do banco), não de modelos escolhidos no catálogo. A ideia de montar escolhendo modelos (processador, chipset, chip de vídeo) e só no fim buscar o preço do setup inteiro foi descartada: com os preços no banco, faz mais sentido escolher entre o que dá para comprar. Depois disso o catálogo de peças saiu de vez ([ADR-005](#adr-005-catálogo-de-peças-em-sqlite-importado-uma-vez-do-opendb)).

| Ordem | Peça | O que ela define para as seguintes |
|---|---|---|
| 1 | Placa-mãe | socket (→ processador), tipo de memória (→ RAM), formato (→ gabinete), PCIe (→ GPU) |
| 2 | Processador | consumo (→ fonte), vídeo integrado (GPU opcional) |
| 3 | Memória RAM | tipo e frequência máxima pela placa-mãe e pelo processador |
| 4 | Placa de vídeo | consumo e conectores (→ fonte), tamanho (→ gabinete) |
| 5 | Fonte | potência mínima calculada (CPU + GPU + folga), ATX 3.x se a GPU usa 12V-2x6 |
| 6 | SSD | geração PCIe contra o M.2 da placa-mãe (observação) |
| 7 | Cooler | encaixe e TDP do processador; com cooler na montagem, some o aviso de processador sem cooler |
| 8 | Gabinete | formato da placa-mãe; radiador grande do water cooler (observação) |

- **Cada peça é uma busca já filtrada pelas anteriores:** escolher uma placa-mãe AM4 DDR4 abre a busca de processador com a plataforma AM4 marcada e a de memória com DDR4. Reaproveita o formulário e o plano de busca de cada categoria (`searchPlan`) e o resultado com filtros; "Escolher" num card coloca a peça na montagem.
- **Compatibilidade checada sempre (regra central):** toda vez que uma peça entra, sai ou é trocada (inclusive as "Atual" vindas do CPU-Z), a montagem inteira é revalidada, todas as peças contra todas, não só contra a anterior. Trocar a placa-mãe de AM4 para AM5, por exemplo, marca na hora o processador e a memória DDR4 como incompatíveis.
  - **Selo em cada peça:** verde (compatível), amarelo (funciona com ressalva: "memória acima do suportado pela placa, roda mais lenta", "BIOS pode precisar de atualização", "fonte no limite") e vermelho (não funciona: socket diferente, DDR4 em placa DDR5, fonte abaixo do mínimo).
  - **Na busca de cada peça:** os resultados já vêm filtrados pelo que é compatível com o resto da montagem; os demais ficam ocultos ou marcados como incompatíveis, nunca escolhidos sem aviso.
  - **Peça sem informação suficiente** (spec não extraída do título): selo cinza "não deu para confirmar", nunca verde por padrão.
  - **Total e compartilhamento:** a barra de total mostra se a montagem tem alguma incompatibilidade; um link compartilhado é revalidado ao abrir.
  - **Implementado:** `checkBuild(build)` em `packages/shared/src/compat.ts`, função pura que devolve os problemas (`issues`, com nível, código, peças envolvidas e texto), o selo de cada peça (`status`) e a fonte recomendada (`power`). Ver [§17.1.1](#1711-regras-de-compatibilidade).

#### 17.1.1 Regras de compatibilidade

Duas fontes de informação: as **specs do anúncio** (extraídas do título, por produto) e os **fatos de plataforma** (`packages/shared/src/hardware.ts`, tabelas fixas a partir das especificações dos fabricantes, para o que nenhum título traz).

| Checagem | Peças | Vermelho | Amarelo | Cinza |
|---|---|---|---|---|
| Encaixe | placa-mãe × processador | socket diferente | — | socket não identificado |
| Chipset × geração | placa-mãe × processador | mesmo socket, chipset não aceita (ex. B550 + Ryzen 2000, B460 + 11ª, série 300 + 7ª) | aceita com BIOS nova (ex. B450 + Ryzen 5000, B650 + Ryzen 9000, H610 + 14ª) | chipset fora da tabela |
| Tipo de memória | memória × placa-mãe, memória × processador | DDR4 × DDR5 | — | placa LGA1700 sem DDR4/DDR5 no título |
| Slots | memória × placa-mãe | mais pentes que slots (pentes do kit × quantidade; sem slots no título, ATX conta 4 e Mini-ITX 2) | — | kit de 4 pentes numa Micro-ATX sem slots no título (2 ou 4) |
| Pentes avulsos | memória | — | — | quantidade > 1: aviso leve (`info`) de que só um kit com todos os pentes garante a frequência anunciada |
| Frequência de memória | memória × placa-mãe | — | placa Intel que trava a memória (não-Z antes da série 500, H510, H610, H810) | — |
| Vídeo | processador | — | — | vídeo integrado não identificado |
| Cooler | processador | — | não acompanha cooler | — |
| Potência | fonte × processador + placa de vídeo | abaixo do consumo máximo estimado | abaixo do recomendado (consumo × 1,3, múltiplo de 50 W) | consumo de alguma peça desconhecido |
| Cooler × encaixe | cooler × processador | o título lista encaixes do mesmo fabricante e nenhum é o do processador (AM5 aceita fixação AM4; LGA1851 a do LGA1700; LGA1200 a do 115x), ou só o outro fabricante | TDP do cooler abaixo do TDP do processador (o do CPU-Z ou o de referência do modelo, `cpuTdp`) | o título não diz encaixe nem fabricante |
| Gabinete | gabinete × placa-mãe | a placa é maior que o maior formato do gabinete | — | gabinete sem formato no título |
| Gabinete × placa de vídeo | gabinete × placa de vídeo (ficha técnica) | placa mais comprida que o máximo do gabinete | cabe com menos de 10 mm de folga | — (sem as duas medidas: observação para conferir) |
| Gabinete × cooler | gabinete × air cooler / water cooler (ficha técnica) | cooler mais alto que o máximo do gabinete; radiador fora dos tamanhos que o gabinete aceita | — | — (sem as medidas: observação para conferir) |

Observações que não mudam o selo: processador sem vídeo integrado e sem placa de vídeo (o espaço da placa de vídeo passa a dizer "Obrigatória"); memória acima da frequência oficial do processador (ativar XMP/EXPO); placa de vídeo de 285 W ou mais com fonte sem 12V-2x6 (usa o adaptador da placa). Também: SSD NVMe mais novo que o M.2 da placa-mãe (funciona na velocidade da placa); water cooler de 280 mm ou mais com gabinete (conferir o espaço do radiador); water cooler de 120 mm com processador de 125 W ou mais; placa-mãe de entrada (`ENTRY_CHIPSETS`) com processador de 105 W ou mais (regulagem de energia limita em carga longa).

**Fatos de plataforma (`hardware.ts`):**

- `cpuFamily`: geração no nível que decide compatibilidade (zen1, zen+, zen2, zen3, r7000/8000/9000; i6…i14, core1, ultra2), inclusive Pentium/Celeron pela família G.
- `chipsetSupport(chipset, família)`: `ok`, `bios` ou `no`, por grupo de chipset.
- `cpuMemorySpeed`: frequência oficial de memória por geração e tipo.
- `MEMORY_LOCKED_CHIPSETS`: chipsets Intel que travam a frequência da memória.
- `cpuTdp`: TDP de referência (AMD) ou PBP (Intel) por família e sufixo, com as exceções da AMD numa tabela (5600X a 65 W, X3D a 120 W…). O título raramente traz o TDP; o do CPU-Z, quando há, vale mais.
- `cpuPower`: consumo máximo aproximado por linha e geração (PPT/PL2 de referência).
- `GPU_POWER`: consumo de referência por chip.
- Consumo do resto do PC: 75 W.

**Cobertura medida nas amostras reais** (os mesmos títulos usados nas fixtures, mais as páginas completas salvas na investigação):

- Specs do título: socket, chipset e tipo de memória em 100% das 392 placas-mãe, formato em 98%; socket, modelo e vídeo integrado em 100% dos 295 processadores; chip e VRAM em 100% das 380 placas de vídeo; tipo, frequência e pentes em 100% das 66 memórias.
- Fatos de plataforma: geração, consumo e memória oficial em 295/295 processadores; chipset na tabela em 392/392 placas-mãe; consumo do chip em 374/380 placas de vídeo (faltam modelos profissionais e um chip não identificado, que ficam cinza).

Lacunas conhecidas: slots de memória só aparecem no título de 1% das placas (Mini-ITX = 2 e ATX = 4 são deduções seguras; Micro-ATX varia); cooler incluso só quando o anúncio diz. Medidas físicas (comprimento da placa de vídeo, altura do cooler, máximos e radiadores do gabinete, conector 12V-2x6) não aparecem nos títulos: vêm da ficha técnica da página do produto, nas três lojas ([§8.3](#83-fichas-técnicas)): a S1 tem o campo de texto da ficha no `__NEXT_DATA__`, juntado com a descrição do produto (`s1SheetFromHtml`); a S2, a tabela de especificações (`s2SheetFromHtml`); a S3, o bloco "Especificações Técnicas" (`#esptec`, `s3SheetFromHtml`). A montagem usa as medidas disponíveis nas fichas. Quando uma medida está ausente, a interface pede conferência. Conferido contra os ≈4 mil anúncios do banco (nov/2026): encaixe, geração, TDP e consumo do processador, chipset e memória da placa-mãe e tipo da memória reconhecidos em 99–100%; RX 9050 fora da tabela de consumo (sem valor oficial conferido).
- **Total sempre à mostra:** barra fixa com o total à vista com cupom, a soma por loja ("tudo na S1: R$ X") e a melhor combinação entre lojas.
- **Ordem flexível:** começar pela placa de vídeo, por exemplo, é permitido; a montagem só avisa as dependências que ficaram para trás.
- **Sem conta:** a montagem fica no navegador (`localStorage`). Compartilhar grava uma cópia no servidor e gera um link curto (`/m/<id>`), aberto só para leitura e com preços atualizados pelo banco.
- **Usabilidade a desenhar:** lista vertical de peças com ícone (como a tela inicial), cada uma com "Escolher" / "Trocar"; no celular, uma peça por vez com avanço; preço e compatibilidade sempre visíveis; nunca mais de um clique para voltar a uma peça.

### 17.2 Importar setup atual (CPU-Z)

> **Implementado** (`packages/shared/src/cpuz.ts`, `apps/web/src/pc.ts`, `ImportPc`). Ver [ADR-007](#adr-007-cpu-z-para-leitura-automática-do-setup-atual).

A pessoa pode marcar Já tenho nas peças da montagem ou gerar o relatório no CPU-Z (aba **About** → **Save Report (.TXT)**) e importá-lo pelo Meu PC, pelo diagnóstico ou pelo orçamento. O relatório vira só o Meu PC e não mexe na montagem: ao importar, as peças marcadas como Já tenho saem da montagem (o espaço fica vazio). As peças marcadas à mão contam na verificação de compatibilidade e ficam fora do custo de compra.

- **Lido no navegador, nunca enviado ao servidor** (proteções contra arquivo forjado em [§10](#10-segurança-e-privacidade)). O leitor guarda só campos de peça: números de série, UUID, caminhos de dispositivo, datas e nome da máquina ficam de fora. O perfil completo (com discos, monitor e erros WHEA, para as sugestões) fica em `localStorage` (`upgradezin.pc.v1`).
- **Formato:** seções com o título sublinhado por traços; em cada linha, `Chave<TABs>Valor`, com subitens indentados por TAB. Arquivo em UTF-8/ANSI ou UTF-16.
- **Peças no mesmo formato das ofertas:** o nome de cada peça passa pelos mesmos extratores dos títulos das lojas (`extractCpuSpecs`, `extractGpuSpecs`, `extractMotherboardSpecs`), e o relatório completa o que o nome não diz (encaixe, chipset, tipo de memória, slots, núcleos, TDP, VRAM). Assim a compatibilidade e as buscas da montagem funcionam sem regra nova.
- **Peças atuais funcionam juntas:** um problema que envolve só peças "Atual" (ex. "pode precisar de BIOS") não aparece. Uma peça nova continua sendo conferida contra as atuais.
- **Fonte e cooler** não aparecem no relatório. Na prévia da importação, a pessoa pode informar a fonte (potência, marca, PFC ativo, eficiência mínima; tudo opcional, e sem potência a fonte não entra). A marca usa um menu compacto com opção de entrada manual. A fonte vai para a montagem como "Atual" e para a análise, e fica guardada para a próxima importação. Na montagem, "Já tenho" faz o mesmo com uma fonte escolhida numa loja.

| Peça | Seção e campos do CPU-Z | Observações |
|---|---|---|
| Processador | `Processors Information` → `Name` (ou `Specification`), `Package`, `Number of cores/threads`, `TDP Limit` | (R)/(TM) removidos antes de extrair |
| Placa-mãe | `DMI` → `DMI Baseboard` (`vendor`, `model`), `DMI Physical Memory Array` (`max# of devices`); `Chipset` → `Southbridge`, `Memory Type` | "Default string" e afins ignorados; fabricante abreviado (ASUSTeK → ASUS); código interno do modelo removido ("(MS-7D99)"); chipset genérico no relatório → chipset do modelo |
| Memória | `Memory SPD` → `DIMM #` (`Size`, `Max bandwidth`, `Part number`, perfis `XMP profile`/`EXPO profile`); `Chipset` → `Memory Frequency` | O CPU-Z repete cada pente no fim, só com os registradores: blocos sem dados são ignorados. Frequência de fábrica = maior perfil; em uso = relógio × 2, encaixado na frequência vendida mais próxima. Sem SPD: pentes pelo `DMI Memory Device` |
| Placa de vídeo | `Display Adapters` → `Display adapter N` (`Name`, `Board Manufacturer`, `Memory size/type`, `Current Link Width`) | Só dedicada; vídeo integrado fica no processador |
| Discos | `Storage` → `Drive` (`Name`, `Capacity`, `Type`, `Bus Type`, `Rotation speed`, `Volume`) | Removíveis e USB fora; volume C: = sistema, com % livre |
| Monitor | `Display Adapters` → `Monitor N` (`Max Resolution`, `Vertical Freq. Range`, `Size`) | Hz máximo pela faixa vertical |
| Estabilidade | `Software` → `WHEA errors` | Contagem de erros corrigidos |

### 17.3 Identificar gargalo e sugerir upgrades

A entrada do Identificar gargalo oferece importação do relatório e preenchimento manual. Com as peças atuais informadas, o diagnóstico e a lista de peças ficam lado a lado em telas largas e empilhados em telas estreitas. Sem dados do monitor, a estimativa usa Full HD a 60 Hz. O atalho de orçamento ocupa a largura toda. O card o que fazer começa recolhido e carrega as sugestões de ofertas quando é aberto.

> **Implementado** (`packages/shared/src/perf.ts`, `packages/shared/src/upgrade.ts`, `PcAnalysis`). Entrada "Identificar gargalo" na tela inicial.

**Pela ficha técnica:**
- **Processador:** a nota sai da ficha (`cpuScore.ts`): IPC da arquitetura em jogos × clock máximo ÷ 4,4 GHz × cache L3 (X3D ×1,28; APU AMD com 16 MB ou menos ×0,9) × núcleos. Ryzen 5 5600 = 100, a escala de `perf.ts`. A tabela por linha fica de reserva, para quando a ficha não tem arquitetura ou boost.
- **Processador da pessoa:** vem da ficha do mesmo modelo no catálogo (GET /api/sheets/cpu), porque o CPU-Z não traz o boost.
- **Placa de vídeo da pessoa:** o CPU-Z traz só modelo, VRAM, tipo de memória e link PCIe. GET `/api/sheets/gpu?model=&vram=` (`gpuSheetFor`) completa com os campos do chip (`GPU_CHIP_FIELDS`: chip, código do chip, arquitetura, memória, barramento, VRAM, unidades de processamento, banda, consumo, PCIe), pegando para cada campo o valor mais comum entre as placas do mesmo modelo e VRAM no catálogo. Clock, comprimento, ventoinhas, conectores e fonte recomendada mudam de um fabricante para outro e ficam de fora. O que o CPU-Z mediu vale sobre o catálogo. Usado na linha da placa no Meu PC, no orçamento e na coluna da placa atual do comparador. Só leitura: nada do CPU-Z é gravado no catálogo.
- **Placa de vídeo:** pela tabela do chip, que é a média de análises de jogos; consumo e linhas PCIe vêm da ficha.
- **Sugestões (`picks.ts`):** uma por modelo, só as compatíveis pela ficha. Primeiro as que resolvem o gargalo, com nota de pelo menos 90% da meta de equilíbrio (`cpuNeeded` ou `gpuMatching` na tela da pessoa), da mais barata; depois mais desempenho por real.

Com o PC atual informado (17.2), o app indica o que limita o desempenho e sugere o que trocar. Cada sugestão abre a busca com os filtros do upgrade. Ao escolher um produto, ele ocupa o espaço da peça correspondente na montagem.

**Equilíbrio processador × placa de vídeo (`perf.ts`):**

- Tabela de desempenho relativo em jogos, aproximada e arredondada (médias de análises públicas em 1080p): placa de vídeo por chip (RTX 3060 = 100) e processador por geração e linha (Ryzen 5 5600 = 100), com os modelos fora da curva à parte (X3D, APUs sem cache) e Intel K a partir da 12ª. Vídeo integrado = 12.
- `cpuNeeded(gpu, resolução, Hz)`: processador que a placa pede para não esperar. Linear, calibrado em pares equilibrados (RTX 3060 + Ryzen 5 5600; RTX 4090 + Ryzen 7 9800X3D). Em 1440p e 4K a placa trabalha mais (fator 0,8 e 0,62); monitor de 120 Hz ou mais pede 5% a mais do processador.
- Razão = processador ÷ o que a placa pede. Acima de 1,2: a placa de vídeo é o gargalo; abaixo de 0,8: o processador. Modelo fora da tabela: "não deu para avaliar", sem chute.
- A tela mostra o veredito, uma frase com resolução e Hz do monitor e um medidor (escala logarítmica, equilíbrio no meio). A faixa do diagnóstico e o marcador usam o laranja do tema.

**Sugestões (`analyzePc`):**

| Tipo | Regra | Ação |
|---|---|---|
| Upgrade | Placa de vídeo é o gargalo: placas na faixa do que o processador aguenta (85% a 115% do ideal, e ao menos 30% acima da atual), só de séries vendidas novas. O texto cita até 4 da geração atual. Placas de 8 linhas concorrem normalmente em PCIe 3.0. O texto indica a possibilidade de ganho futuro ao trocar de plataforma. Com a fonte informada, só as que cabem nela, ou o aviso de que a fonte entra na troca (ou "troque-a junto", se ela for simples); sem ela, a potência a partir da placa mais econômica | Busca de placa de vídeo com os modelos da faixa |
| Upgrade | Processador é o gargalo e o encaixe tem processador ao menos 15% melhor (que o chipset aceita) | Busca de processador no mesmo encaixe, com as linhas que servem |
| Upgrade | Processador é o gargalo e já está perto do topo do encaixe | Processadores da plataforma nova (AM5; LGA1851/LGA1700) |
| Upgrade | Memória com menos de 16 GB, um pente só ou DDR4 de até 2666 MHz com Ryzen | Kit de 2 pentes do mesmo tipo (16/32 GB, 3200/3600 MHz no Ryzen) |
| Upgrade / grátis | Windows num HD: SSD; se já houver um SSD maior, passar o sistema para ele | — |
| Grátis | Memória rodando abaixo do perfil XMP/EXPO gravado | — |
| Grátis | Windows num SSD SATA com um NVMe maior sobrando | — |
| Grátis | Monitor de 100 Hz ou mais: conferir a taxa no Windows e o cabo | — |
| Atenção | Disco do sistema com menos de 15% livre | — |
| Atenção | Erros de hardware corrigidos (WHEA) | — |
| Atenção | Fonte informada abaixo do consumo estimado | Busca de fonte com a potência recomendada |
| Atenção | Fonte sem PFC ativo e sem certificação (ou só White): costuma entregar menos que o rótulo | Busca de fonte |
| Observação | Placa-mãe de entrada (`ENTRY_CHIPSETS`) ou PCIe 3.0 (`chipsetPcie`): o que ela limita (PCIe 3.0; VRM simples com processador de 105 W ou mais; slots de memória todos ocupados) e se vale trocar só ela (com o processador no topo do encaixe, não: sai junto no upgrade de plataforma) | — |

Ordem: upgrades, ajustes grátis, atenção, observações. A tabela de desempenho é a parte que pede manutenção: incluir cada geração nova de placa de vídeo e processador (o teste confere que toda placa com consumo conhecido tem desempenho).

**Melhores ofertas de agora** (`picks.ts`, `POST /api/upgrade/picks`, `UpgradePicks.tsx`): cada dica com ação leva, além do filtro da busca, o contexto do PC (`PickContext`: desempenho atual da peça, chipset, consumo de placa de vídeo que a fonte aguenta, potência mínima de fonte). O servidor lê do banco as ofertas da categoria vistas nas últimas `SEARCH_DB_MAX_AGE_H` horas (sem consultar loja; cache de 1 min) e devolve até 3 (1ª, 2ª e 3ª opção, o mesmo número do Montar pelo orçamento), só compráveis (em estoque, sem marketplace nem open box):
- **Processador e placa de vídeo:** uma oferta por modelo (a mais barata entre lojas e marcas), só as que sobem pelo menos 15% e cabem no PC (placa de vídeo com pelo menos a memória de vídeo da atual, `minVram`, também no filtro da busca que a dica abre) (placa dentro da fonte atual; processador aceito pelo chipset, com o aviso "atualize a BIOS" quando o chipset só aceita depois de atualizar), ordenadas por pontos de desempenho ganhos por real.
- **Memória, fonte e SSD:** as mais baratas que batem com o filtro, uma por produto; fonte com a potência mínima e certificada (bronze ou melhor). Sem comparar desempenho, que a tabela não tem. A fonte mais barata certificada nem sempre é boa (qualidade varia muito por modelo); falta uma lista de qualidade.

**Modelos sem índice** (admin, aba Cobertura; `perfGaps` em `admin/data.ts`): processadores e placas de vídeo vistos nas lojas nos últimos 14 dias que a tabela não conhece, do mais anunciado ao menos, com um título de exemplo. Conta na hora, do banco: modelo novo aparece assim que a rotina ou a varredura o grava. Em nov/2026: RX 9050 e RX 7650 GRE (sem dado confiável ainda) e anúncios cujo modelo o leitor não reconheceu.

### 17.4 Montar pelo orçamento

O orçamento e a montagem usam a mesma reserva de potência, diferenciada pelo padrão ATX 3 e respeitando o piso da GPU. Conectores com ausência declarada excluem a fonte quando a montagem precisa deles. Em produtividade, a estimativa de trabalho aplica uma redução conservadora sob carga alta sem ensaio aplicável. Para trabalho acelerado, o índice combina CPU e referência gráfica de 1080p. A referência é uma aproximação geral para cargas aceleradas.

A API distingue preferência de fabricante, que pesa no ranking, de exigência, que filtra candidatos. A interface identifica a opção de maior índice entre as exibidas dentro do valor quando ela difere da recomendada. Em uso misto e produtividade a busca inclui 64 GB e SSD de 4 TB quando há oferta compatível. No upgrade, a ausência de índice atual ou de candidato que cumpra uma exigência pode retornar ausência de dados em vez de ausência de ganho.

Os índices do vídeo integrado usam pontes entre ensaios em 1080p. O Ryzen 7 5700G fica em cerca de 55% do desempenho gráfico do 8700G. A UHD 730 do i5-11400 fica em cerca de 43% do desempenho gráfico do 5700G. Identificação genérica de um chip e transposição entre bancadas são aproximações. [Hierarquia de iGPUs](https://www.tomshardware.com/reviews/cpu-hierarchy,4312.html) · [Ensaio do Ryzen 5 5600G](https://www.tomshardware.com/reviews/amd-ryzen-5-5600g-review/3)

Em PCs completos, o motor compara SSDs até 2 TB em Jogos e até 4 TB nos perfis com trabalho e a folga comprovada em gabinete. Na ficha da placa-mãe, M.2_1 e M2_1 identificam o mesmo slot. Divergências entre páginas nos totais de DIMM e M.2 usam a menor contagem até haver correção manual. O crédito por capacidade aumenta conforme o desempenho e a sobra. Certificação de eficiência da fonte não concede bônus de qualidade. Em carga alta, padrão ATX 3 e conectores declarados são critérios de dimensionamento, sem comprovar qualidade elétrica por modelo.

`pnpm budget-test --expanded --reread-sheets --output=.vitest/budget-local.json` requer Node 22.16 ou superior e cruza 57 orçamentos de R$ 2.000 a R$ 30.000 com três resoluções, quatro frequências de 60 a 240 Hz (60, 144, 165 e 240 Hz), três perfis e as duas modalidades. Em cada modalidade, o teste de sensibilidade usa um pedido de referência em QHD a 144 Hz e R$ 12 mil para simular preços, promoções, remoções, lacunas e contradições de ficha. A matriz verifica os dois lados do orçamento mínimo e de uma transição de CPU ou GPU por grupo quando detectadas no intervalo. Em degraus com queda de índice ou aumento de preço sem ganho de índice, registra o melhor candidato de desempenho descartado e contagens da triagem. Também testa preferências de fabricante, tipos de vídeo e upgrades de PCs montados com peças do catálogo. O relatório registra o maior índice viável e o da primeira opção para avaliar separadamente a progressão e o ranking. Use `--output` nas reexecuções para preservar o JSON original de 120 casos. Passe `--reread-sheets` para aplicar o leitor atual aos textos da cópia temporária durante o teste.

O perfil Jogos usa o índice combinado. Produtividade usa uma estimativa relativa de CPU por núcleos e threads, limitada pela referência de desempenho de CPU. Jogos e trabalho usa a média geométrica dos dois índices. A estimativa de produtividade não representa benchmarks por aplicativo. Os bônus por RAM, SSD e recursos de plataforma são graduais e dependem do perfil e da folga no orçamento. Em Produtividade, configurações com índice de trabalho a partir de 150 podem ampliar a base do crédito por capacidade, em até 40% da sobra e 60% do custo-base. Isso contempla estações com CPU forte e vídeo integrado, que têm custo-base menor. O gabinete mais barato e uma opção com melhor ventilação ou folga comprovada podem concorrer. A escolha de placa-mãe e refrigeração dá mais peso à alimentação sustentada e à margem térmica quando a demanda é maior.

**Matriz de testes.** Da raiz, `pnpm budget-test` gera `.vitest/budget-full-pc.json` com 120 cenários de PC completo. Cruza o mínimo calculado e os quatro valores fixos (R$ 5 mil, R$ 8 mil, R$ 12 mil e R$ 15 mil) com dois tipos de recomendação, dois perfis, três resoluções e 60/144 Hz. Para cada cenário mínimo, consulta o motor com um valor baixo, registra o `minTotal` calculado e roda novamente com esse valor. A identificação do cenário mínimo permanece estável entre execuções. `--db` e `--output` aceitam caminhos relativos à raiz. O script fixa o relógio na coleta mais recente da cópia e reaproveita as ofertas por modalidade. Cada pedido registra a primeira recomendação, as alternativas, os índices, as peças por categoria e a origem dos preços. As verificações sinalizam opções incompatíveis, recomendações comuns acima do orçamento e peças indisponíveis no modo comprável.

**Calibração de CPU em jogos.** O orçamento usa `budgetCpuScore` para as CPUs à venda e para a CPU atual no upgrade. A referência por fabricante e modelo tem prioridade. Para os demais modelos, vale a estimativa já recebida no upgrade ou a nota por ficha, com a tabela existente como fallback. O índice mede desempenho relativo de CPU em jogos sob as condições dos ensaios.

| Modelo | Índice | Referência |
|---|---:|---|
| Ryzen 5 5600 | 100 | Base da escala |
| Core i5-12400F | 105 | [9 jogos em 1080p, GPU de topo, média de quadros](https://www.techspot.com/review/2448-amd-ryzen-5600-vs-intel-core-i5-12400f/) |
| Ryzen 5 7600 | 135 | [12 jogos em 1080p com RTX 4090](https://www.techspot.com/review/2615-ryzen-7600-vs-ryzen-5600/) |
| Ryzen 7 5800X3D | 128 | [4 jogos em 1080p, qualidade média, RTX 5090](https://www.techspot.com/review/3021-ryzen-7-5800x3d-cpu-gpu-scaling/) |
| Ryzen 7 5700X3D | 122 | [14 jogos em 1080p, qualidade média, 5% abaixo do 5800X3D](https://www.techspot.com/review/3077-amd-ryzen-am4-5800x3d-5700x3d/) |
| Ryzen 7 7800X3D e 9800X3D | 159 e 175 | [14 jogos em 1080p com RTX 5090, extremos superiores de 24% e 37% acima do 5800X3D](https://www.techspot.com/review/3111-every-ryzen-x3d-cpu/) |
| Ryzen 5 9600X, Core i5-14600K/KF e Core Ultra 9 285K | 129, 125 e 131 | [14 jogos em 1080p, comparação contra o 5800X3D](https://www.techspot.com/review/3077-amd-ryzen-am4-5800x3d-5700x3d/). O KF usa a mesma nota do K com GPU dedicada |

As referências ligadas pelo 5800X3D são aproximações entre suítes diferentes. Como verificação fora do ajuste, o ensaio de quatro jogos coloca o 9800X3D perto de 183 na mesma escala, cerca de 4% acima dos 175 adotados. Nesse recorte, a nota antiga de tabela (185) ficava mais próxima. A dispersão entre suítes e o conjunto pequeno de referências limitam as conclusões para CPUs fora da tabela.

Na auditoria da mesma janela, entre os anúncios de CPU em estoque, com preço à vista positivo, fora de marketplace e open box e com modelo identificado, apareceram 72 combinações de fabricante e modelo. Selecionado o anúncio de menor preço à vista de cada combinação, seis tinham referência nova e 66 tinham nota calculável pela ficha.

**Comparação local de 24/11/2026.** A mesma cópia do catálogo, janela de 72 horas e relógio fixo na última observação serviram para comparar 21 pedidos de PC completo a 144 Hz (sete orçamentos entre R$ 3 mil e R$ 18 mil, em 1080p, 1440p e 4K). A primeira opção ficou igual em 20 casos. No pedido de R$ 18 mil em 1080p, mudou de 7800X3D para 9800X3D com a mesma RX 9070 XT. O total subiu de R$ 14.315,32 para R$ 14.774,32 e o índice combinado exibido ficou em 240. A nota anterior permitia ao 7800X3D atingir esse índice no cálculo de 144 Hz. A nova nota reduz o teto estimado desse par e o ranking passa a escolher a opção mais cara. A bancada mede o efeito no motor, sem medir desempenho físico das montagens.

O card da tela inicial e o atalho no Identificar gargalo abrem `BudgetView.tsx` para PC completo ou upgrade. A rota `POST /api/budget/plan` roda a função pura `planBudget` sobre o catálogo local com a ficha. No upgrade, as especificações das peças atuais e os índices calculados na tela vão ao servidor.

No PC completo, o formulário agrupa as preferências e separa o valor e a ação de montar em um painel. Os tipos de recomendação usam botões de opção com uma explicação abaixo de cada título. Em telas estreitas, os campos ficam empilhados. No upgrade, o painel do valor vem depois do resumo do PC.

**Modalidades de preço.** PC comprável agora é o padrão e exige loja ativa, preço positivo e estoque observado nas últimas 24 horas (`listings.last_seen_at`). PC ideal inclui também anúncios com o último preço positivo registrado em estoque em até 90 dias (`price_points`). A oferta recente tem prioridade para a mesma peça. O resultado distingue data e valor históricos, marca o total estimado e omite ação de compra e transferência para a montagem quando há peça apenas com referência. O servidor usa as tabelas e as fichas existentes.

**Capacidade e ganho marginal.** O critério de desempenho segue o perfil selecionado. Dentro da faixa de desempenho próximo, o ranking usa um crédito de preferência pela capacidade no PC completo. O crédito é limitado pela sobra real do orçamento. O peso sobe até a referência de 100 pontos, com um adicional gradual de até 30% entre 150 e 225 pontos para conjuntos mais fortes. Na primeira duplicação, os pesos de base sobre o custo da opção são 6,5% e 4,5% em Jogos, 9,5% e 5,5% em jogos e trabalho, e 11% e 6,5% em Produtividade. O benefício usa `2 × (1 − capacidade-base / capacidade)`, com bases de 16 GB e 500 GB, de modo que cada duplicação seguinte acrescente metade do benefício anterior. Os pesos são escolhas de recomendação. O preço exibido e a restrição do orçamento usam o total real. Quando só uma entre CPU e GPU muda, a escolha pode aceitar até 5% de perda estimada se a economia percentual for pelo menos o dobro da perda.

**Carga sustentada e folgas.** Em jogos e trabalho e Produtividade, a escolha da placa-mãe favorece evidência aplicável de teste por modelo sob carga alta. A partir de 200 W, uma placa nova precisa de ensaio aplicável ou de dissipador declarado e pelo menos oito fases principais informadas. Essa segunda condição é uma triagem de construção. Quando a ficha só confirma o dissipador e falta ensaio do conjunto, o índice de trabalho aplica um fator conservador proporcional à carga estimada. A referência inicial é a B650M-HDV/M.2 até 200 W, sob as condições do ensaio. Para CPUs a partir de 145 W em jogos e trabalho e Produtividade, o motor acrescenta 10% de reserva de triagem ao cooler, com base na estimativa de consumo do processador. Na seleção do gabinete, folgas abaixo de 10 mm para a GPU, 5 mm para o cooler a ar recebem ressalva. A combinação de GPU e radiador com menos de 55 mm de folga conhecida é excluída quando a posição de montagem não está comprovada. Um gabinete melhor ventilado ou com folga comprovada pode concorrer com o de menor preço. A preferência depende do desempenho da configuração e do custo total. Os 55 mm são uma estimativa de radiador com ventoinhas. A ficha disponível não confirma a posição do radiador. [Ensaio de VRM](https://www.techspot.com/review/2828-amd-b650-motherboard-budget/) · [Exemplo de montagem e posições](https://assets.corsair.com/image/upload/corsairmedia/sys_master/productcontent/iCUE_220T_RGB_QSG.pdf)

**Como escolhe.** O teto de CPU usa a referência 5600/3060 em Full HD a 60 Hz, uma curva de potência com expoente 1,8 e ajustes de resolução e frequência. O índice combinado se aproxima do menor entre o teto e a nota da GPU, com transição suavizada na vizinhança do equilíbrio. A curva é uma estimativa de equilíbrio. A busca combina as capacidades de RAM e SSD disponíveis para o perfil. Valida as peças finais, elimina configurações dominadas em custo, desempenho e capacidade, e compara preço e benefícios na faixa de pelo menos 97% do melhor desempenho válido, com a exceção de ganho marginal quando só a CPU ou a GPU muda. [Referência de escalonamento CPU e GPU](https://www.techspot.com/review/3021-ryzen-7-5800x3d-cpu-gpu-scaling/)

**Calibração de GPU por resolução.** No orçamento, a RTX 4070 é a âncora local de 165 pontos para a comparação de sete jogos em qualidade alta/ultra. A RTX 3070 fica com 124/127/130 e a RTX 5070 com 191/198/203 em 1080p, 1440p e 4K. A RTX 3060 de 8 GB recebe 85 em cada resolução contra 100 da de 12 GB, após arredondar as diferenças medidas em 1080p e 1440p. Para 4K mantém-se provisoriamente o fator de 1440p. Variantes sem medida comparável mantêm o índice de referência do chip e a capacidade real em separado. São índices relativos, de cobertura parcial; a geração do plano usa apenas referências locais. [Série RTX 70](https://www.techspot.com/review/3057-nvidia-geforce-rtx-70-series/) · [RTX 3060 de 8 e 12 GB](https://www.techspot.com/review/2581-nvidia-rtx-3060-8gb/)

Para RTX 5060 Ti e RX 9060 XT, a nota de 8 GB usa a razão medida entre as duas variantes na mesma resolução, aplicada à referência existente de 16 GB do respectivo chip. Isso captura a diferença de memória sem atribuir o mesmo desconto a todas as placas de 8 GB. [Médias de rasterização em qualidade Ultra](https://www.tomshardware.com/reviews/gpu-hierarchy,4388.html)

Para os modelos em `GPU_RES_SCALING`, a nota base de 1080p é ajustada pelo escalonamento medido da própria GPU dividido pelo escalonamento da RTX 4070. A âncora preserva a escala usada pela busca. Modelos sem medição aplicável seguem com a referência já existente. [Hierarquia de rasterização](https://www.tomshardware.com/reviews/gpu-hierarchy,4388.html)

**Vídeo integrado.** Usa um índice aproximado em 1080p baixo separado do teto de CPU para placas dedicadas. Ryzen 5600G e 5700G ficam perto da referência da RX 550. Radeon 780M fica perto de 40 pontos, usando a RX 6600 como referência: nos exemplos de Baldur's Gate 3, Cyberpunk 2077, F1 2023 e Ratchet & Clank, a placa dedicada entrega em média cerca de 2,38 vezes os quadros do 8700G. Os demais integrados têm o índice genérico existente. A interface omite percentuais quando o índice de comparação é zero. [Ryzen 5600G](https://www.techspot.com/review/2302-amd-ryzen-5600g/) · [Ryzen 5700G](https://www.techspot.com/review/2293-amd-ryzen-5700g/) · [Ryzen 8700G](https://www.techspot.com/review/2796-amd-ryzen-8700g/)

O Ryzen 8600G (Radeon 760M) fica em 36 pontos, usando a diferença de aproximadamente 10% a favor do 8700G na média de cinco jogos em 1080p. [Teste do Ryzen 8600G](https://www.tomshardware.com/pc-components/cpus/amd-ryzen-5-8600g-cpu-review/3)

**Comparação após a regulagem.** Nos mesmos 21 pedidos em catálogo local, comparando com o motor já calibrado para CPU, 15 recomendações subiram no índice interno e seis mantiveram o índice. Treze ficaram mais baratas. Em 1080p a 144 Hz, com R$ 4.500, a primeira opção passou do i3-12100 com vídeo integrado para o i3-12100F com RTX 3050, de R$ 4.454,43 para R$ 4.421,41. Com R$ 18 mil, manteve 9800X3D e RX 9070 XT e caiu de R$ 14.774,32 para R$ 12.474,41. A economia pode vir de capacidades e peças de apoio diferentes, e os índices das duas versões usam referências gráficas diferentes.

**Comparação com o cálculo combinado e o ranking novos.** Com as mesmas ofertas e relógio nos 21 pedidos, sete primeiras opções ficaram mais baratas, nove ficaram com o mesmo total e cinco ficaram mais caras. Em 1080p a 144 Hz e R$ 4.500, a primeira opção passou de i3-12100F + RTX 3050 (R$ 4.421,41) para Ryzen 5 5500 + RTX 2060 (R$ 4.248,92). Em R$ 14 mil, a opção com RX 9070 XT passou de 9800X3D (R$ 12.474,41) para 7800X3D (R$ 11.885,41). A comparação de preço é direta; os índices mudaram de fórmula.

**Até 3 opções** (`OPTIONS`): as alternativas priorizam variar a GPU, depois a CPU e, quando há diferença útil, a capacidade. A tela mostra o total e o ganho estimado quando calculável. A primeira é "Recomendada no valor", a de maior índice por real entre as apresentadas dentro do orçamento é "Melhor custo-benefício" e a que passa do orçamento é "Acima do valor". O piso de desempenho para placas dedicadas fica na faixa da GTX 1050 Ti. A tela guarda o último resultado de cada aba com a data ("Resultado calculado em 25/11 às 14:30") e oferece Refazer cálculo; mudar qualquer campo descarta o resultado guardado daquela aba. O Tipo de trabalho é lembrado e só vai no pedido fora de Jogos. Opção que só compra outras peças leva o nome delas ("Fonte + SSD"). Com peças só de preço histórico (PC ideal), Refazer com PC comprável agora roda de novo só com ofertas de agora. Cada peça comprada tem o botão Comparar. Pedido recusado pelo servidor (400) mostra uma mensagem própria.

**Opção acima do valor** (`STRETCH`): a última opção pode passar até 25% do orçamento, se render pelo menos 10% a mais que o melhor índice que cabe no orçamento e se o ganho percentual sobre a primeira opção cobrir o acréscimo percentual de preço. A tela informa quanto passa do orçamento e o ganho estimado sobre a primeira opção. Cada opção leva o índice de jogos no campo `fps`.

| Peça | PC completo | Upgrade |
|---|---|---|
| Processador | Qualquer um com nota (ficha ou tabela) | Mantém; ou um do mesmo encaixe, se a placa-mãe aceita (com o aviso de BIOS); ou plataforma nova |
| Placa-mãe | Compatível sem atualização de BIOS. A partir de 105 W de TDP ou 145 W de potência máxima, a triagem exclui chipset de entrada e VRM declaradamente sem dissipador. A falta de evidência aparece como ressalva | Pode manter a atual quando passa pela triagem ou trocar respeitando o formato disponível |
| Memória | 16 ou 32 GB em dois pentes, e 64 GB nos perfis com trabalho, DDR4 a partir de 3200 ou DDR5 a partir de 5200. O kit tem preferência de 5% sobre dois pentes avulsos iguais | Reaproveita a atual quando serve na placa-mãe escolhida |
| Placa de vídeo | Modelos da tabela e suas variantes. Placa x8 em PCIe 3.0 permanece elegível, com observação sobre banda e sem desconto fixo no índice. Pode montar só com vídeo integrado | Mantém ou troca respeitando a capacidade da memória de vídeo atual |
| Fonte | Certificada (bronze ou melhor). Usa o piso declarado pela GPU e exclui cabos comprovadamente insuficientes. Em ATX 3 declarado usa 120% da carga. Nos demais casos usa o maior valor entre 130% da carga e a carga mais metade do consumo da GPU. São margens de triagem, apoiadas na distinção de transientes do padrão | Troca quando a atual é insuficiente ou simples e a placa muda. Sinaliza se faltam dados da fonte |
| Cooler | Considera o cooler incluso quando confirmado no anúncio, exceto WOF ou CPU de demanda alta. A triagem usa soquete, potência estimada e dimensões. Em carga elevada favorece características físicas (heatpipes, ventoinhas, tamanho do radiador). Acima de 200 W exige radiador de pelo menos 280 mm ou air cooler com seis heatpipes e duas ventoinhas de 120 mm ou mais | Reaproveita o atual quando a ficha confirma encaixe e capacidade para o novo processador |
| SSD | NVMe de 500 GB, 1 TB ou 2 TB, com 4 TB nos perfis com trabalho | Fica o atual |
| Gabinete | Onde a placa-mãe cabe, com 1 ventoinha ou mais (3 com consumo estimado de pelo menos 200 W na CPU ou na GPU) | Fica o atual |

**Marcas com prioridade** (`BUDGET_BRANDS`): placa-mãe (ASUS, MSI, Gigabyte, ASRock, Biostar), memória (Kingston, Corsair, G.Skill, Crucial, ADATA, XPG, TeamGroup, Patriot), placa de vídeo (ASUS, MSI, Gigabyte, ASRock, PowerColor, XFX, Zotac, PNY, Galax) e fonte (Corsair, XPG, Cooler Master, Thermaltake, MSI, EVGA, DeepCool, Cougar, Gamemax). Prioridade, não exclusividade: na escolha, o produto de outra marca conta como se custasse mais (15% na placa-mãe, 20% na placa de vídeo, 30% na memória, 70% na fonte; memória e fonte de marca desconhecida são as que mais arriscam o PC); o preço mostrado e o total são os reais. A fonte pesa mais porque é onde a marca desconhecida mais arrisca o PC: em nov/2026, a fonte certificada de marca da lista custava de 40% a 60% a mais que a mais barata (uns R$ 100). Processador, SSD, cooler e gabinete sem lista. A marca vem do anúncio; sem ela, do começo do título.

A triagem térmica e elétrica usa TDP e uma estimativa de consumo por família. Capacidade térmica, dissipador de VRM e padrão declarado da fonte são indícios. As dimensões conhecidas da GPU e do cooler entram no cálculo do custo. `checkBuild` exclui erros conhecidos antes de devolver opções. No upgrade, a busca compara o ganho com o PC atual e o custo-benefício usa o ganho estimado por real quando disponível. [Transientes no padrão ATX 3](https://edc.intel.com/content/www/us/en/design/ipla/software-development-platforms/client/platforms/alder-lake-desktop/atx-version-3-0-multi-rail-desktop-platform-power-supply-design-guide/2.0/psu-power-excursion/)

**Respostas.**
- `ok`: as peças a comprar, o total, o desempenho e o equilíbrio, o ganho (no upgrade) e as observações (vídeo integrado, 16 GB, SSD de 500 GB, fonte não informada, memória que fica, memória de 32 GB, BIOS).
- `too-low`: o mínimo que monta (no upgrade, o primeiro que rende 10%), com um botão para usar esse valor.
- `no-gain`: nenhuma combinação elegível atingiu o ganho mínimo estimado para o pedido.
- `no-data`: faltam dados do PC atual, ofertas ou candidatos que atendam às exigências.

**Lembra entre visitas** (`upgradezin.budget.v1` no navegador, `loadBudgetUi`): a aba, o valor de cada aba, a tela do PC completo e o tipo de recomendação. Ao voltar, a tela abre preenchida na última aba usada. Para calcular um upgrade, é preciso informar uma CPU ou GPU atual. Para buscar, a pessoa escolhe Montar ou pressiona Enter no campo de valor.

**Limites.** A placa de vídeo e o gabinete mais baratos de cada modelo nem sempre são os melhores (falta uma lista de qualidade, como na fonte). A estimativa de produtividade considera CPU. Aceleração específica pela GPU, benchmarks por aplicativo e requisitos de estações de trabalho estão fora do cálculo. Preços sem frete.

### 17.5 Outras ideias

| Ideia | Comentário |
|---|---|
| **Upgrade × PC novo** | Compara o custo de trocar as peças sugeridas com o de uma montagem nova equivalente. |
| **Montagens prontas por faixa** | Pontos de partida ("entrada", "intermediário", "topo") que abrem na montagem para ajustar. Mantidas no repositório, revisadas quando sai geração nova. |
| **Checagem física** | Feito (nov/2026): placa de vídeo × gabinete, cooler × gabinete, radiador aceito e conector 12V-2x6 pela ficha técnica; BIOS que precisa de atualização já existia. Fichas das três lojas lidas pela rotina para todo o catálogo de placa de vídeo, gabinete e cooler. |
| **Consumo e conta de luz** | Estimativa de consumo da montagem e custo mensal por horas de uso, além da fonte recomendada. |
| **Preço por desempenho** | R$ por ponto de desempenho relativo (mesma tabela de 17.3), como ordenação em processador e placa de vídeo. |
| **Uma loja só × melhor combinação** | Na montagem, mostrar se comprar tudo numa loja compensa (frete, cupom de carrinho) frente a dividir entre as três. |
| **Alerta de preço por e-mail** | Os alertas já avisam no sino e pelo navegador (§14, item 5); falta mandar por e-mail com o site fechado. |

