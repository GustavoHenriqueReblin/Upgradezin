# Arquitetura: Upgradezin

> Documento vivo. Descreve a arquitetura, as decisões tomadas e as que ainda estão em aberto. Atualizado a cada etapa implementada.
>
> **Status:** categorias **Fonte**, **Placa-Mãe**, **Processador**, **Placa de Vídeo**, **Memória RAM**, **SSD**, **Cooler** e **Gabinete** disponíveis, com preços guardados num SQLite local (rotina de coleta nas três lojas, S2 e S3 em modo lento; a busca do site consulta na hora quando falta ou quando pedem para atualizar), histórico de preço, filtros, cupons e montagem do PC com compartilhamento por link. S1 funciona de ponta a ponta; S3 funciona com o Chrome instalado; S2 responde a primeira página e depois limita a frequência (ver [§4.4](#44-proteção-anti-bot)).

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
 └──────────────┘                      │        │ (falta/força)    (a cada 5 min)  │
                                       │        ▼                                  │
                                       │  collect.ts: fila por loja → grava no DB  │
                                       │        │  lojas em paralelo               │
                                       │   ┌────┼──────────────┬───────────────┐   │
                                       │   ▼    ▼              ▼               │   │
                                       │  s1      s2          s3               │   │
                                       │ (fetch)(aba)        (aba)             │   │
                                       │   │        └──── browser.ts ──────────┘   │
                                       │   ▼        Chrome anônimo, fecha ao fim   │
                                       │ normalize (packages/shared)               │
                                       └───────────────────────────────────────────┘
```

Fluxo de uma busca:

1. O usuário escolhe a categoria e **monta a busca** antes de qualquer requisição (ex. potências 750 W e 850 W; plataforma AM4 e chipset B550). Cada escolha vira um termo (`750W`, `850W`, `B550`). Nunca se busca a categoria inteira: a API recusa busca sem termo.
2. A UI abre `GET /api/search/stream?category=psu&terms=750W,850W` (SSE). Para cada loja, `search.ts` lê do banco o resultado de cada termo (a última coleta completa) e responde na hora, com "atualizado há X". **Toda busca atualiza por trás** (*stale-while-revalidate*): mostra o banco na hora e consulta a loja para todo termo coletado há mais de `REVALIDATE_MIN` (10 min) naquela loja; o resultado troca quando a consulta chega. Nas lojas lentas, 1 termo por busca (o há mais tempo sem coleta) e só se o intervalo mínimo passou ([§4.3](#43-política-de-coleta)). `force=1` (a tela não tem esse botão; fica para a API e o `pnpm scan`) usa o mesmo piso. **Sair da página não interrompe:** a tela para de receber, mas a consulta que já saiu termina e grava no banco (só o desligamento do servidor a interrompe); em loja lenta, uma busca não enfileira outra consulta enquanto a anterior não terminou. A consulta segue as regras de sempre (lojas em paralelo; em cada loja, um termo por vez, com intervalo e limite por hora) e grava no banco. Ao resultado de cada termo a busca junta os anúncios da loja que o banco já tem de outras coletas e batem com o termo pelas specs ([§8.2](#82-preços-e-rotina-de-coleta)).
3. Cada adapter devolve `Offer[]` já normalizadas (specs extraídas, chave de modelo). O servidor emite `status` a cada página.
4. Cada página lida já é enviada (`offers` com `partial: true`), e a UI mostra resultados enquanto as lojas ainda paginam. Ao fim de cada loja, a lista final substitui os parciais.
5. A UI agrupa e filtra **no cliente**: mudar filtro não refaz a busca. Refazer só quando muda o termo.
6. Em paralelo, a **rotina** ([§8.2](#82-preços-e-rotina-de-coleta)) mantém o banco atualizado sozinha: os termos do formulário e, nas lojas configuradas, a varredura de cada categoria inteira. Coletas do mesmo termo na mesma loja (duas buscas, ou busca e rotina) compartilham a mesma execução.
7. Quando a última busca ou rodada da rotina termina, ou é cancelada, o Chrome fecha (abas, cookies e cache da sessão anônima são descartados).

## 4. Coleta

### 4.1 Por que self-hosted

As lojas bloqueiam ou desafiam faixas de IP de datacenter. A coleta roda num host próprio, em conexão residencial, com navegador real. É uma restrição de arquitetura, não detalhe de deploy.

### 4.2 Estratégia por camadas

Para cada loja, a fonte mais leve e estruturada que funcionar:

1. **HTTP simples + dados embutidos** (`__NEXT_DATA__`, JSON-LD): sem navegador, ~1–2 s por página.
2. **Navegador real + dados embutidos** (payload RSC do Next.js, atributos `data-*`): quando há proteção anti-bot.
3. **Seletores CSS** sobre o DOM renderizado.
4. **Regex** em texto visível, só para campos isolados.

### 4.3 Política de coleta

Volume parecido com o de uma pessoa consultando à mão. Inegociável:

- **Em cada loja, uma requisição por vez:** um termo por vez, uma página por vez, com intervalo aleatório entre páginas (`PAGE_DELAY_MIN_MS`–`PAGE_DELAY_MAX_MS`, padrão 5–12 s). Busca do site e rotina entram na **mesma fila por loja** (`withStore` em `pace.ts`), com o mesmo intervalo entre uma consulta e a próxima.
- **Lojas em paralelo:** cada loja tem a própria fila; uma loja lenta ou bloqueada não atrasa as outras. No navegador, uma janela anônima por loja (contexto próprio, cookies isolados), cada uma em primeiro plano na própria janela escondida.
- **Limite de páginas por loja por hora** (`MAX_PAGES_PER_HOUR`, padrão 30, janela deslizante). Estourou: a loja é pulada até liberar, a UI mostra quando libera e as outras lojas seguem. A rotina só usa até `ROUTINE_PAGES_PER_HOUR` (padrão 12) desse total, contando as páginas da busca do site; o resto fica para quem busca.
- **Limite de páginas por busca** (`MAX_PAGES_*`) e parada antecipada quando a relevância acaba.
- **Banco em vez de repetir consulta:** o site lê do SQLite; a loja só é consultada pela rotina (termo desatualizado, varredura de categoria) ou quando falta resultado / o usuário pede. Coletas idênticas simultâneas são deduplicadas.
- **Navegador:** o Google Chrome instalado, aberto pelo Playwright (ou o Chromium do Playwright); o HTTP direto se identifica como `Upgradezin/0.1`.
- **Bloqueio = parar:** 403/429, CAPTCHA, página de desafio ou de "manutenção" colocam a loja em **backoff exponencial** (15 min → 1 h → 6 h → 24 h). A pausa fica no banco (`meta`, chave `backoff:<loja>`): reiniciar o servidor não a zera. Consulta que estava na fila atrás da que bloqueou não vai à loja (não conta como bloqueio novo nem sobe a escada). A UI mostra o status, oferece "Ver na <loja>", e a busca segue com as outras lojas.
- **Lojas lentas (S2, S3), intervalo mínimo:** nos logs (nov/2026), as duas aceitam a 1ª página e bloqueiam a seguinte quando ela vem segundos depois (7–26 s depois de uma coleta boa); com 5 min de intervalo, não. Entre duas consultas a uma loja lenta passa no mínimo `SLOW_MIN_GAP_S` (3 min), venham da rotina ou da busca do site; a última consulta fica no banco (`meta`, `slowlast:<loja>`), então reiniciar o servidor não libera uma rajada. A busca do site não dispara uma página por termo nelas: vai à loja com 1 termo (o há mais tempo sem coleta, ou nunca coletado), só se o intervalo já passou e se não há outra consulta da busca em andamento; os outros termos vão para a frente da fila da rotina. Na rotina, a ordem das lojas lentas espalha a coleta pelas categorias (`dueTermsSpread`): o pesquisado e ainda não coletado, depois a categoria há mais tempo sem coleta naquela loja, e dentro dela o termo nunca coletado. Medido no servidor (nov/2026): a ordem antiga, termo a termo, deixou a S2 com 26 dos 117 termos (nenhum de processador Intel, gabinete ou cooler) e a S3 com 39.

### 4.4 Proteção anti-bot

| Situação | Comportamento |
|---|---|
| Chromium headless | Barrado pela proteção anti-bot de S2 e S3. Não usar. |
| Google Chrome instalado, aberto pelo Playwright em **sessão anônima** (`channel: chrome`, contexto novo, nada salvo em disco), com janela | Sem nenhuma modificação: o navegador continua se identificando como automatizado. Testado: a S3 responde normalmente; a S2 responde a primeira página e limita a frequência logo depois (página de "manutenção"). Medido em nov/2026: não é limite por IP nem por frequência. Na mesma rede, a 2ª página da mesma sessão levou 403 "Site em Manutenção" 45 s depois da 1ª, e uma sessão nova respondeu normal logo em seguida (e o Chrome comum da pessoa navegava na loja ao mesmo tempo). A detecção da página marca a sessão automatizada (`navigator.webdriver`) e daí em diante tudo dela é recusado. Hoje a S2 rende 1 página por consulta, por isso as buscas específicas ("Buscar nas lojas" do filtro de texto) valem mais nela. |
| Desafio interativo ("Confirme que é humano") ou página de bloqueio disfarçada (S2 responde 403 com "Site em Manutenção" só para o navegador automatizado) | A loja entra em backoff e a UI mostra "não deu para consultar agora" com um botão **"Ver na <loja>"**, que abre a mesma busca no site da loja, no navegador do próprio usuário. Opcional para quem opera o servidor: `MANUAL_CHALLENGE_WAIT_S` > 0 faz a busca esperar alguém resolver na janela do Chrome **da máquina do servidor** (padrão 0; o usuário final nunca vê essa janela). |
| Headless (`HeadlessChrome` no user-agent) | Barrado. Trocar o user-agent seria falsificar: não usar. |
| Janela fora da área visível (`--window-position=-32000,-32000`, padrão via `BROWSER_HIDE_WINDOW`) | Para o site é o mesmo Chrome com janela; o usuário não vê. Duas flags de desempenho (`CalculateNativeWinOcclusion` desligado, `--disable-backgrounding-occluded-windows`) evitam que o Chrome desacelere a janela escondida. Testado na S3: normal. |
| Interceptar rede (`page.route`) ou minimizar a janela | Quebra o desafio. Não usar. |

Num servidor Linux sem tela, o Chrome roda sob `xvfb-run`. Para o modo assistido nesse cenário, é preciso acesso à tela virtual (VNC). Ver [§16](#16-questões-em-aberto).

### 4.5 Contrato do adapter

```ts
interface StoreAdapter {
  id: StoreId;
  search(ctx: SearchContext): Promise<Offer[]>;
  // Opcional (hoje só a S1): uma página da categoria inteira, para a varredura da rotina.
  sweepPage?(ctx: { category; url; page; signal }): Promise<{ offers: Offer[]; totalPages: number }>;
}

interface SearchContext {
  category: CategoryId;
  q: string;                     // um termo da busca ("750W", "B550")
  signal: AbortSignal;           // cancelado se o cliente fecha a conexão
  onPage?(info: { page; total?; found; offers }): void;  // progresso + ofertas da página
  onNeedsHuman?(): void;         // loja pediu verificação (só com MANUAL_CHALLENGE_WAIT_S > 0)
}
```

Adapters não conhecem cache nem HTTP do servidor; chamam `takePage` antes de cada página (limite por hora) e `gotoChecked` para navegar (detecção de bloqueio). Cada adapter expõe também funções puras de parsing (`parseS1Html`, `couponFromS1ProductHtml`, `parseS2Rsc`, `readS3Cards`, `mapS3Card`…), testadas com páginas reais recortadas ([§12](#12-testes)). `readS3Cards` roda dentro da página (via `$$eval`) e, nos testes, sobre um DOM em Node.

### 4.6 Falhas e depuração

- Com `DEBUG_DUMPS=1`, página sem itens esperados ou bloqueada gera HTML + screenshot em `data/debug/` (fora do git).
- `pnpm scan <termo>[,<termo>…] [--category=<categoria>] [--stores=s1,s2] [--json] [--top=N]` roda a busca pelo terminal (sempre consulta as lojas e grava no banco, como `force=1`).
- `pnpm scan --sweep [--category=<categoria>] [--stores=s1]` lê a primeira página de cada caminho de varredura (configuração da loja no admin, aba Lojas), sem gravar, para conferir.

### 4.7 Lojas por ID

O código, os testes e esta documentação identificam as lojas só por ID (`s1`, `s2`, `s3`). O que identifica cada loja fica no banco do servidor (tabela `store_configs`, fora do git), editado no admin, aba **Lojas** ([§9.3](#93-admin-admin)): salvar vale na hora, sem reiniciar. Na primeira vez que o servidor sobe com a migração 7, ele copia para o banco o que estiver nas variáveis abaixo do `.env`; depois disso, elas não valem mais (testes e `pnpm scan` sem banco ainda as usam). O `.env.example` traz só valores de exemplo:

| Variável | Exemplo | Uso |
|---|---|---|
| `STORE_S1_NAME` | `Loja 1` | nome exibido na tela |
| `STORE_S1_URL` | `https://www.loja1.example` | origem do site (links de produto, página de cupom) |
| `STORE_S1_SEARCH` | `/busca/{slug}` | caminho da busca; marcador `{q}`, `{q+}` ou `{slug}` |
| `STORE_S1_CATEGORIES` | `psu:caminho/fontes,motherboard:caminho/placas` | caminho da categoria na loja, quando o adapter filtra por ele |
| `STORE_S1_SWEEP` | `psu:/caminho/fontes,ssd:/caminho/ssd` | página de cada categoria no site (começa com `/`), para a varredura da rotina ([§8.2](#82-preços-e-rotina-de-coleta)); opcional, hoje só a S1 sabe ler |
| `STORE_S1_COLOR` | `"#22c55e"` | cor da loja na tela (bolinha nos cards, status e totais); entre aspas, porque no `.env` o `#` sem aspas começa um comentário (sem `#` também vale); opcional, sem ela vale uma cor padrão por ID; duas ou três cores separadas por vírgula (`"#ffc300,#e30613"`) viram degradê na bolinha |

- `apps/server/src/stores.ts` guarda a configuração (`useStoreStorage` copia do `.env` na primeira vez e lê do banco; `saveStoreConfig` salva o que vem do admin). Loja sem nome, URL ou busca, ou desligada no admin, não é consultada.
- O admin valida o que salva (o `.env` é tolerante e ignora o que não vale): site só origem `https`, busca começando com `/` e com marcador, varredura só caminho do próprio site, cores `#rrggbb`. Os valores vão para URLs que o servidor abre e para o estilo da página.
- A interface recebe nomes e links de busca de `GET /api/stores` e não tem nenhum nome fixo.
- Cada adapter continua específico do tipo de site (dados embutidos, seletores), mas sem nome nem domínio no código.

## 5. Fontes de dados

Registro da investigação de cada loja. Só abordagem técnica.

| | S1 | S2 | S3 |
|---|---|---|---|
| Acesso | HTTP simples (user-agent `Upgradezin/0.1`) | Navegador (Cloudflare) | Navegador (Cloudflare) |
| Onde estão os dados | `__NEXT_DATA__` → `props.pageProps.data.catalogServer` | payload RSC (`self.__next_f`) → `{"products":{"items":[…]}}` | atributos `data-tss-*` + DOM do card |
| Itens por página | até 120 (`page_size`; pedir mais devolve 120), 1 página por termo | 36 | até 300, página única |
| Preço à vista | `offer.priceWithDiscount` (oferta temporária, só enquanto `offer.endsAt` não passou e `offer.quantityAvailable` > 0; o card mostra prazo e estoque da oferta) ou `priceWithDiscount` | `<prefixo>_prices.avista` | `data-tss-price` |
| Parcelado | `maxInstallment` ("10x de R$ …") | `final_price` / `max_installments` | spans de `.product-item__juros` |
| Estoque | `available` (`quantity` só vale dentro de oferta: fora dela vem 0 com o produto à venda) | `stock_status` | `data-tss-estoque` |
| Identificadores | código interno; part number no fim do título | `sku` (part number), `codigo_barra` (EAN) | id interno |
| Vendedor | `sellerName`, `flags.isMarketplace` | próprio | próprio |
| Facetas nativas | `meta.filters` (marca, 80 Plus, cabeamento, preço) | `aggregations` | sidebar de filtros (marca, estoque) |
| Particularidades | Termo que coincide com categoria redireciona (308) e perde os parâmetros: o adapter segue o redirect à mão e reaplica a paginação. | Busca ampla (traz PCs montados); filtra pela categoria da loja (`url_path`, configurado em `STORE_S2_CATEGORIES`) e para quando a página tem menos de 20% de itens da categoria. Os dados são lidos do HTML (`page.content()`), porque depois da hidratação o Next.js esvazia `self.__next_f`. Limita frequência rápido (página de "manutenção"): **1 página por termo** por padrão. Às vezes responde só a casca da busca, sem o bloco de produtos: tratado como bloqueio (não como "0 resultados"). | Busca devolve até 300 itens numa página só; a categoria é filtrada pelo título e o filtro de potência na UI deixa só as escolhidas. |
| Tempo medido | ~1,5 s por página | ~4 s por página | ~4 s |

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
| Gabinete | maior placa que cabe (o maior formato citado; sem formato, pela torre: full = E-ATX, mid = ATX, mini = Micro-ATX), torre, vidro, fans inclusos ("Sem Fans" = 0). Descarta tela de monitoramento e kits |
| Placa-mãe | chipset (lista conhecida por socket), socket (do título ou deduzido do chipset), formato (do título ou do sufixo M/I do modelo), DDR4/DDR5 (do título ou deduzido do socket), Wi-Fi | marca + palavras do modelo até a 1ª vírgula, sem termos de spec (`msi b550m a pro`); variantes Wi-Fi (AX/AC) ficam separadas |

Os campos estruturados de placa-mãe da S2 (`socket`, `formato_placa`) são códigos internos (ex. `"539"`) e não são usados. Validação com páginas reais (busca "placa mae B550"): chipset identificado em 392 de 395 ofertas, 42 produtos casados entre lojas.

### 6.2 Agrupamento entre lojas

União de conjuntos (union-find) sobre três critérios:

1. **EAN** igual → mesmo produto.
2. **Part number** do fabricante igual, comparado só com letras e dígitos. S2 informa em campo próprio; S1 e S3 no fim do título (`mpnFromTitle`: "… - 90-GA41ZZ-00UANF" na S1, "…, Preta, SYDSCD4-3200MHZ-8GB" na S3; pedaço que é spec, como "3200MHz" ou "8GB", não conta). A S3 não tem EAN nem campo de código: até nov/2026 ela só casava pela chave de modelo; com a leitura do título, 68% dos anúncios dela ganharam part number. Código "quase igual" não junta: a diferença costuma ser variante (W = branca, R = vermelha, K × KF). Exceção: se a mesma loja usa o código para produtos diferentes (título cortado, ex. "BX8071514" para i5-14600KF e i7-14700KF), o código é ambíguo e é ignorado.
3. **Chave de modelo** igual, definida por categoria (tabela em [§6.1](#61-pipeline)). Fonte: marca + palavras do título até a potência, sem ruído ("Fonte XPG Kyber, 750W…" → `xpg kyber 750`), com sufixo para variante branca.

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
| Cabeamento | multi (inclui "Não Informado"); mesmas opções no formulário e no painel |
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

**Preços em SQLite.** O banco guarda os anúncios e preços coletados das lojas, com histórico ([ADR-006](#adr-006-preços-no-banco-coletados-por-rotina)), e as montagens compartilhadas por link. Nenhum dado de usuário vai para disco: a busca continua anônima. (Um catálogo de peças importado do OpenDB chegou a ficar no banco; saiu, ver [ADR-005](#adr-005-catálogo-de-peças-em-sqlite-importado-uma-vez-do-opendb).)

| Onde | O quê | Por quê |
|---|---|---|
| `data/upgradezin.db` | Anúncios, histórico de preço e montagens compartilhadas (SQLite, `node:sqlite` embutido no Node) | Responder a busca sem consultar as lojas a cada vez; histórico de preço; links de montagem. Gitignored; criado na primeira execução. |
| Navegador (`localStorage`) | A montagem do usuário | Fica com quem montou. O servidor só guarda uma cópia quando a pessoa clica em "Compartilhar" (`shared_builds`). |
| `data/debug/` | HTML + screenshot de falhas | Só com `DEBUG_DUMPS=1`, para consertar adapters. |

### 8.1 Banco (`apps/server/src/db/`)

Migrações versionadas por `PRAGMA user_version` em `db.ts` (só acrescentar no fim, nunca editar uma que já rodou). `openDb` cria o arquivo e migra; `getDb()` abre na primeira vez que o servidor precisa.

| Tabela | Conteúdo |
|---|---|
| `meta` | chave/valor: pausa por bloqueio ou manual de cada loja (`backoff:<loja>`), para sobreviver a reinício, a rotina do admin (`routine`: ligada e lojas), e o estado da varredura de cada categoria (`sweep:<loja>:<categoria>`) |
| `search_terms` | termos coletados (categoria + termo, como vai para a loja): os do formulário (`seed`) e os que alguém pesquisou (`user`, com a data do último pedido) |
| `term_runs` | última tentativa e última coleta completa de cada termo em cada loja, com o status (`ok`, `partial`, `blocked`, `error`) |
| `listings` | anúncio de uma loja (loja + código na loja): título, URL, chave de modelo, EAN, part number e a última oferta (`offer`, JSON no formato `Offer`) |
| `listing_terms` | em quais termos o anúncio apareceu e quando por último |
| `price_points` | histórico: um ponto quando preço à vista, cartão, cupom, oferta temporária ou estoque mudam (não a cada coleta) |
| `store_attempts` | cada consulta a uma loja (termo, página de varredura, ficha técnica): quando, de onde veio, resultado, ofertas, motivo do bloqueio, duração; 90 dias ([§9.3](#93-admin-admin)) |
| `store_configs` | configuração de cada loja (antes `STORE_*` no `.env`): ligada, nome, site, caminho da busca, caminhos por categoria e de varredura (JSON), cores (JSON) e data da alteração |
| `product_sheets` | ficha técnica da página de um produto (loja + código): medidas físicas e part number (`SpecSheet`, JSON) e a data; lida sob demanda, só das peças que entram na montagem, vale `SHEET_MAX_AGE_DAYS` (30) |
| `shared_builds` | montagem compartilhada por link: código curto (`/m/<id>`), JSON da montagem (peças, ofertas, quantidade) e data. Sem dono nem expiração: quem tem o link vê |

A migração 5 tira o catálogo importado (tabelas `parts` e `part_codes`, coluna `listings.part_id`, marcas `opendb_*` em `meta`). Recria `listings` com as chaves estrangeiras desligadas (senão apagar a tabela antiga apagaria em cascata `listing_terms` e `price_points`), confere a integridade no fim e, só nessa vez, compacta o arquivo (`VACUUM`).

### 8.2 Preços e rotina de coleta

**Resultado de um termo numa loja** = os anúncios vistos desde a última coleta completa dele (`listing_terms.last_seen_at ≥ term_runs.last_ok_at`). O que saiu da busca da loja some do resultado sem apagar o histórico. Coleta interrompida (bloqueio ou limite no meio) grava o que leu, mas não conta como completa: o termo continua na fila. Sem nenhuma coleta completa, o termo não tem resultado naquela loja e a busca do site consulta na hora.

**O que a busca do site mostra de cada loja** = o resultado dos termos **mais** os anúncios dela no banco que batem com algum termo pelas specs (`termMatches` em `packages/shared/src/terms.ts`: "AM4" = encaixe AM4, "Ryzen 7" = linha, "750W" = potência, chipset, tipo e capacidade de memória, interface do SSD, tipo de cooler, formato do gabinete, fabricante do chip de vídeo), vistos nas últimas `SEARCH_DB_MAX_AGE_H` (72 h), venham da coleta que vierem (outro termo, varredura). Sem isso, buscar "AM4" mostrava só a loja que tinha coletado "AM4", e o mesmo processador vindo da coleta de "Ryzen 7", ou de uma loja bloqueada que nunca coletou "AM4", ficava escondido. Cada anúncio leva a data da própria coleta ("preço visto há X").

**Termos:** `allSearchTerms()` (`packages/shared/src/terms.ts`) lista tudo o que o formulário de busca pode gerar (potências de fonte, plataformas e chipsets, linhas de processador, fabricantes de chip de vídeo, tipo × capacidade de memória: ≈110 termos); um teste garante que o `searchPlan` do site só gera termos dessa lista. Termos novos pesquisados no site também entram.

**Rotina** (`prices/routine.ts`, sobe com o servidor): nas lojas ligadas nela, um switch por loja no admin (aba Coleta), valendo na hora e guardado no banco (`meta`, chave `routine`); com nenhuma loja ligada, não roda. Até alguém mexer no admin, valem `ROUTINE_ENABLED` e `ROUTINE_STORES` do `.env` (padrão: ligada, as três). Acorda a cada `ROUTINE_TICK_MIN` (5 min) e, em cada loja em paralelo, coleta até `ROUTINE_BATCH` (4) termos devidos, na ordem: nunca coletados; os que alguém pesquisou; os mais antigos. Um termo é devido quando a última coleta completa passou de `ROUTINE_REFRESH_H` (12 h); se falhou, só é tentado de novo depois de `ROUTINE_RETRY_MIN` (60 min). Para quando a loja chega a `ROUTINE_PAGES_PER_HOUR` páginas na última hora (contando as da busca do site), entra em pausa por bloqueio ou atinge o limite por hora. Com os padrões, uma volta completa pelos termos leva algumas horas em cada loja.

**Varredura de categoria** (`prices/sweep.ts`; lojas com caminhos de varredura na configuração (admin, aba Lojas; antes `STORE_Sx_SWEEP`) e adapter com `sweepPage`, hoje só a S1; [ADR-008](#adr-008-varredura-de-categoria-para-o-histórico)): os termos só trazem a primeira página de cada busca, então produto fora do topo de algum termo ficava sem histórico. A varredura lê a **página de cada categoria** da loja (a mesma que a busca abre quando o termo bate com a categoria), página por página, e grava cada uma como uma coleta comum, ligada a um termo especial da categoria (`origin = 'sweep'`, termo `*`), fora da fila de termos e que a busca não aceita. Os anúncios que ela traz entram na busca do site pelas specs, como os de qualquer coleta (parágrafo acima). Vem antes dos termos em cada rodada, com orçamento próprio: até `ROUTINE_SWEEP_PAGES_PER_HOUR` (6) páginas por hora, dentro de `ROUTINE_PAGES_PER_HOUR`; o resto fica para os termos. Retoma de onde parou (estado em `meta`, `sweep:<loja>:<categoria>`: próxima página, fim da última volta, última falha), na ordem: volta em andamento, categoria nunca varrida, volta mais antiga. Uma categoria recomeça quando a última volta passou de `ROUTINE_SWEEP_REFRESH_H` (24 h); vai até a última página da loja ou `ROUTINE_SWEEP_MAX_PAGES` (25). Erro numa página faz a categoria esperar `ROUTINE_RETRY_MIN` e retomar da mesma página; bloqueio pausa a loja como sempre. Na S1 (nov/2026), uma volta completa nas 8 categorias tem 75 páginas de 120 itens: ≈13 h no orçamento padrão. `pnpm scan --sweep` lê a primeira página de cada caminho, sem gravar, para conferir a configuração. Lojas em modo lento não varrem.

**Modos por loja** (admin, aba Coleta; guardados com a rotina). Cada loja tem a sua agenda, conferida a cada 30 s. **Normal:** uma rodada a cada `ROUTINE_TICK_MIN` (5 min), com a varredura (se configurada) e até `ROUTINE_BATCH` termos, recoletando depois de `ROUTINE_REFRESH_H`. **Reduzido** e **lento:** um termo por vez, espalhado pelas categorias, a cada `ROUTINE_REDUCED_GAP_MIN` (5 min) ou `ROUTINE_SLOW_GAP_MIN` (10 min) mais até 20% aleatório, recoletando depois de `ROUTINE_SLOW_REFRESH_H` (24 h). Até alguém escolher no admin, as lojas de `ROUTINE_SLOW_STORES` (s2 e s3, as com navegador) ficam no lento e as outras no normal. Esses modos existem porque as lojas com navegador, coletando vários termos seguidos, bloquearam em minutos (ver revisões do [ADR-006](#adr-006-preços-no-banco-coletados-por-rotina)); a primeira versão usava 15 min, lento demais para manter a cobertura. Vale também o intervalo mínimo de 3 min entre quaisquer duas consultas às lojas lentas ([§4.3](#43-política-de-coleta)). **Termo redirecionado:** na S2, um termo igual ao nome de uma categoria ("Water Cooler", "Gabinete", "placa de video") é levado para a página da categoria. A resposta da própria busca já traz a instrução do Next.js (`NEXT_REDIRECT;replace;/hardware/…;307;`), que o navegador às vezes segue e às vezes não; chegando pelo redirecionamento, vem a página de "manutenção", mas a mesma página aberta direto traz a lista normalmente. O adapter lê a instrução (e, por garantia, confere o endereço final) antes de chamar de bloqueio: redirecionamento não pausa a loja, e o destino fica guardado no termo (`term_runs.redirect_path`, migração 9). A rotina pega o termo de novo sem esperar o intervalo de falha, e dali em diante a coleta desse termo nessa loja abre o destino direto, no lugar da busca. O painel de cada loja mostra a contagem até a próxima consulta (vez da rotina, nunca antes do fim da pausa nem do intervalo mínimo). **Bloqueio nunca tira a loja da rotina para sempre:** a pausa sobe a cada bloqueio seguido (15 min, 1 h, 6 h, 24 h, e fica em 24 h) e, terminada, a rotina tenta de novo; uma coleta boa zera a escada. Sem isso, um bloqueio de um dia viraria um buraco permanente no histórico.

**Histórico:** `GET /api/prices/history?items=s1:123,s2:abc` devolve os pontos de `price_points` dos anúncios de um produto (até 12) e quando cada um apareceu por último. Toda lista completa que a busca envia leva em cada oferta o resumo `history` (`withHistoryStats`): menor preço à vista com cupom, com estoque, nos últimos 30 dias (contando o preço que já valia quando a janela começou e o atual) e desde quando o anúncio é acompanhado.

## 9. API e frontend

### 9.1 API

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/version` | Versão do app (`{ version }`, do `package.json` da raiz; também no log ao subir e no rodapé da tela inicial). |
| `GET` | `/api/stores` | Lojas configuradas: `id`, `name`, `search` (URL de busca com marcador), `color` e, com degradê, `colors`. |
| `GET` | `/api/search/stream?category=psu&terms=750w,850w&stores=s1,s2&force=1` | SSE: eventos `status` (estado e motivo em código, nunca texto técnico; `cached` = resultado do banco, com a data da coleta), `offers` (`partial` = lote de uma página), `end`. Responde na hora com o banco e atualiza por trás os termos coletados há mais de `REVALIDATE_MIN` ([§3](#3-arquitetura)). Cada loja manda o resultado dos termos mais os anúncios dela no banco que batem com eles pelas specs, vistos nas últimas `SEARCH_DB_MAX_AGE_H` ([§8.2](#82-preços-e-rotina-de-coleta)). `terms` obrigatório (até 8): nunca a categoria inteira; `text=1` aceita um texto livre entre eles ([§10](#10-segurança-e-privacidade)). Só aceita categorias habilitadas. Fechar a conexão para o envio para a tela; a consulta que já saiu termina e grava. |
| `GET` | `/api/watch?category=cpu&terms=Core%20i5&stores=s1,s2,s3` | SSE de novidades para a tela de resultado aberta, desde o começo da busca. Toda coleta que grava no banco (rotina, varredura, loja que saiu da pausa, busca de outra pessoa) avisa por um evento interno (`prices/events.ts`); se for da categoria e de uma loja da busca, a rota manda a lista nova daquela loja (`offers`, a mesma conta da busca: termos + anúncios que batem pelas specs) e `fresh` (loja e quantas ofertas). Várias páginas seguidas viram uma lista só (1,5 s depois da última). Não consulta loja nenhuma. Ping a cada 25 s (o túnel fecha conexão parada); até `WATCHES_PER_IP` (4) por pessoa. |
| `GET` | `/api/prices/history?items=s1:123,s2:abc` | Histórico de preço dos anúncios de um produto (`ListingHistory[]`: pontos e última vez visto), até 12 ([§8.2](#82-preços-e-rotina-de-coleta)). |
| `GET` | `/api/sheets?items=gpu:s1:123,case:s1:456` | Ficha técnica das peças da montagem (placa de vídeo, cooler, gabinete; até 4): medidas físicas e part number. Do banco quando já lida; senão abre a página do produto (só nas lojas que sabem ler, hoje a S1), até `SHEETS_PER_HOUR` (30) por pessoa. Devolve só resposta definitiva (a ficha, ou `null` quando a loja não tem como dar); falha passageira fica de fora e o site pede de novo depois. |
| `GET` | `/api/brands?category=psu` | Marcas dos anúncios da categoria vistos nos últimos 30 dias (as mesmas do filtro "Marca" da busca), em ordem alfabética, sem "Outros"/"Genérica". Sugestões da marca da fonte no "Meu PC". Guardado em memória por 10 min. |
| `POST` | `/api/builds` | Compartilha a montagem (`{ build }`, até 256 KB, validada com zod: só links `https://`, quantidade 1–4) e devolve `{ id }` para o link `/m/<id>`. |
| `GET` | `/api/builds/:id` | Montagem compartilhada, com cada oferta trocada pela versão mais recente do mesmo anúncio no banco (preço de hoje, não o do dia em que salvou). 404 se não existe. |

Parâmetros validados com zod. Em produção, o Fastify serve o build do front na mesma porta; caminho desconhecido devolve o `index.html` (rotas do front, como `/m/<id>`), exceto em `/api/`, que responde 404 em JSON.

### 9.2 Frontend

- **Tela inicial:** grade de categorias com ícones (lucide), sem atalhos rápidos, na ordem da montagem do PC (placa-mãe, processador, memória, placa de vídeo, fonte, SSD, cooler, gabinete), a mesma da barra no cabeçalho. Categoria desligada no registro aparece como "Em Breve".
- **Montar a busca (obrigatório):** escolher a categoria não busca nada. Abre um formulário com um botão principal claro, que só habilita com o mínimo escolhido. Fonte: potências (ao menos uma; não há "todas"), eficiência mínima, cabeamento. Placa-mãe: plataformas (uma ou mais; ou nenhuma, buscando pela memória), chipsets por plataforma, formato, memória, Wi-Fi. SSD: interface (NVMe e/ou SATA, vira o termo "SSD NVMe"/"SSD SATA") e capacidade por faixa. Cooler: tipo ("Air Cooler"/"Water Cooler") e, no water, o radiador. Gabinete: formatos de placa-mãe (um termo por formato, ou "Gabinete" sem formato; o resultado mostra onde a placa cabe), vidro, com fans. Todas: faixa de preço à vista. Busca textual nas lojas só a partir do resultado ("Buscar nas lojas" da busca local, abaixo).
- **Resultado:** cabeçalho com barra de categorias; "Parar" ao lado da ordenação enquanto a busca roda. O progresso da busca aparece nos próprios resultados, que chegam loja a loja. "Alterar Busca" fica no topo do painel lateral e volta ao formulário com os valores atuais. Sempre consulta todas as lojas; o filtro "Loja" só muda a exibição.
- **Visual:** tema escuro fixo (`<html class="dark">`, variante `dark:` sempre ativa). Cinzas quentes (fundo quase preto, cards elevados; a escala `zinc` é redefinida em `index.css`) e um brilho laranja discreto no alto da página. Destaque em laranja (`accent-*`): botões (laranja vivo com texto escuro), seleção, links e o ponto do logo. **Verde só para o que é bom:** preço à vista, desconto, cupom, "Menor Preço em 30 Dias", "Compatível" e loja consultada com sucesso. Fonte Quicksand. Nome "Upgradezin." em texto no cabeçalho e na tela inicial; ícone da aba "Up." em SVG com traços arredondados (`public/favicon.svg`), nítido em qualquer tamanho e sem depender da fonte. As cores das lojas (bolinhas) vêm do `.env`; o gráfico de histórico tem a própria paleta.
- **Preço à vista sempre em destaque**, já com cupom quando houver ("À Vista com Cupom", com o código e o preço sem cupom embaixo); preço no cartão aparece pequeno. Selo de desconto (contra o preço "de" da loja) no topo do card. Faixas (de/até) em vez de só máximo.
- **Histórico de preço:** cada card tem "Histórico", que abre o gráfico do produto: uma linha em degrau por loja (o preço vale até a próxima mudança), à vista com cupom, tracejada sem estoque; 30 dias, 90 dias ou tudo; resumo com o preço de agora e o menor e o maior do período; dica ao passar o mouse com o preço de cada loja no dia; "Ver Tabela" lista as mudanças. Cores do gráfico fixas por loja, de uma paleta validada para daltonismo e contraste nos dois temas (`.viz` em `index.css`): as cores das lojas no `.env` podem ser claras demais para linha. O card mostra "Menor Preço em 30 Dias" (ou "Menor Preço Desde dd/mm") quando o preço de agora é o menor que o banco viu no período, só depois de 7 dias de acompanhamento.
- **Cache na página (memória, sem backend):** cada categoria guarda resultados, filtros, ordenação e a tela em que estava. Trocar de categoria ou ir ao início e voltar restaura tudo sem nova busca. Categoria aberta e filtros (com a ordenação) de cada categoria ficam também no `localStorage` (`uiState.ts`): reabrir o app volta na mesma categoria, com os mesmos filtros, e refaz a busca se havia resultado na tela (vem do banco, na hora). Os resultados em si não são guardados no navegador.
- **Ordenação:** menor/maior preço à vista e maior desconto (contra o preço "de" da loja, já com cupom; sem desconto vai para o fim) em todas as categorias. Fonte: melhor eficiência, preço por watt, maior potência. Processador: mais núcleos. Placa de vídeo: mais memória de vídeo. Memória: menor preço por GB, maior frequência. Uma ordenação só aparece quando muda algo (ex. por potência, só com mais de uma potência no resultado).
- **Textos:** rótulos (botões, títulos de seção, opções de filtro e ordenação, categorias) em Title Case com conectores curtos em minúsculo ("Só em Estoque", "Menor Preço à Vista"); frases e status em caixa normal. Todo elemento clicável com cursor de mão.
- **Busca local nos resultados:** caixa de texto acima dos cards que filtra o que já foi carregado (todas as palavras no título, sem diferenciar acento), sem consultar as lojas. Sugestões clicáveis com os nomes de linha mais comuns no resultado ("Windforce", "Fury Beast"): só a parte do título antes da primeira vírgula, sem números, specs com filtro próprio, marcas e palavras presentes em quase todos (80%+). Com um texto que vale como termo (3 a 60 caracteres, letras, números e `- + . /`), aparece "Não achou? Buscar “texto” nas lojas": repete a busca com os termos do formulário mais o texto, que vai às lojas como termo próprio (`text=1`), e o filtro de texto continua aplicado. Nas lojas lentas, que aceitam 1 página por consulta, o termo nunca coletado vai primeiro, e a página já traz o produto procurado.
- **Novidade sozinha:** desde o começo da busca, a tela fica escutando `GET /api/watch` (loja ainda na fila ou ao vivo nesta busca é ignorada: a lista dela vem da própria busca). Começar junto, e não no fim, importa para a loja lenta que a busca deixa para a rotina: a rotina pode coletar enquanto outra loja ainda está ao vivo, e essa coleta se perdia. Quando chega coleta nova de uma loja (ex. a loja que estava em pausa voltou e coletou), a lista dela troca sozinha e aparece um aviso discreto no canto ("Loja S2: preços atualizados agora", some em 6 s). Os cards já mostrados ficam no lugar (só preço e lojas mudam; produto novo entra no fim); mudar ordenação, filtros ou buscar de novo volta à ordem normal. Nova busca, "Parar", trocar de categoria ou sair da tela param de escutar.
- **Nunca texto técnico na tela:** o servidor envia códigos (`state`, `reason`), a UI escolhe a frase.
- Resultados parciais com cards de carregamento enquanto as lojas respondem. Aviso quando os filtros escondem todas as ofertas, com atalho para limpar.
- Painel de filtros (lateral; gaveta no celular).
- Cards agrupados por produto: imagem, marca, specs como selos (eficiência colorida por nível), menor preço à vista com desconto sobre o "de", parcelamento, uma oferta por loja, a melhor dela (anúncios repetidos e variantes do mesmo modelo não aparecem duplicados; melhor oferta em destaque, marketplace/open box/esgotado sinalizados), idade da coleta.
- **Montar o PC** ([§17.1](#171-montar-o-pc-montagem-dinâmica)): entrada na tela inicial e botão "Montagem" no cabeçalho (com quantas peças já tem).
  - A tela lista as 8 peças em ordem (placa-mãe, processador, memória, placa de vídeo, fonte, SSD, cooler, gabinete), com "Escolher" / "Trocar" / remover. Cada peça escolhida mostra o selo de compatibilidade, os motivos, a melhor oferta (loja e idade do preço). A fonte mostra o consumo estimado e a potência recomendada, mesmo antes de escolher uma.
  - Memória tem **quantidade** (1 a 4, para pentes avulsos iguais, ex. 2× 8 GB): o preço da peça e os totais multiplicam, e a compatibilidade conta o total de pentes contra os slots da placa. Trocar a memória mantém a quantidade.
  - Barra fixa no rodapé com o total à vista, o total comprando tudo em cada loja (ou quantas peças faltam nela) e o resumo da compatibilidade.
  - "Escolher" abre a busca normal da categoria, com o formulário já preenchido pela montagem (`slotFilters`): plataforma da placa-mãe ou do processador, tipo de memória, potências de fonte a partir da recomendada. Uma faixa avisa que a peça é para a montagem, com "Voltar à Montagem".
  - No resultado, cada card mostra o selo da peça contra o resto da montagem (`checkCandidate`) e o botão "Adicionar à Montagem". "Só Compatíveis com a Montagem" (ligado por padrão) esconde os vermelhos e diz quantos; desligado, o botão de um incompatível vira "Escolher Mesmo Assim".
  - Na busca comum (sem vir da montagem), os cards de todas as categorias também têm "Adicionar à Montagem" ("Trocar na Montagem" se já houver uma peça daquela categoria), e o selo de compatibilidade aparece quando a montagem já tem outra peça. Adicionar por ali não sai do resultado.
  - A montagem fica no `localStorage` do navegador (peça = produto com as ofertas de cada loja na hora da escolha). Sem armazenamento disponível, vale enquanto a página estiver aberta.
  - **Importar Meu PC** ([§17.2](#172-importar-setup-atual-cpu-z)): passo a passo para gerar o relatório no CPU-Z, arquivo arrastado ou escolhido, prévia do que foi lido (peças, discos, monitor) e "Usar na Montagem". As peças entram com o selo "Atual" e "Você já tem" no lugar do preço e ficam fora do total ("Nenhuma Peça Nova Ainda" enquanto não houver o que comprar).
  - **Já Tenho:** chave em toda peça escolhida numa loja (ex. a fonte, que o CPU-Z não mostra). Ligada, a peça vira "Atual": sai do total e conta como parte do PC. A fonte "Já Tenho" entra na análise de gargalo.
- **Identificar Gargalo** ([§17.3](#173-identificar-gargalo-e-sugerir-upgrades)): entrada na tela inicial. Sem PC importado, explica e abre a importação; com PC, mostra no topo "Esquecer Meu PC" (apaga o perfil do navegador), "Trocar Relatório" e "Levar para a Montagem"; depois o veredito com o medidor de equilíbrio, as peças lidas (a fonte com "Informar"/"Alterar", que abre a prévia da importação) e "O Que Fazer" (cada sugestão com o selo Upgrade, Grátis, Atenção ou Observação e, quando é peça, o botão que abre a busca filtrada).
  - **Compartilhar** grava uma cópia da montagem no servidor e copia o link curto (`/m/<id>`); o botão vira "Link Copiado". Clicar de novo sem mudar a montagem copia o mesmo link. Quem abre vê a montagem só para leitura (preços atualizados pelo banco, compatibilidade e totais) e pode "Usar Esta Montagem" (troca a própria, com confirmação se já houver peças) ou ir para a própria. O link usa o endereço da página: compartilhado pelo `pnpm share`, funciona fora de casa; aberto em `localhost`, só na mesma máquina.

### 9.3 Admin (`/admin`)

Tela de quem opera o servidor, em pacote separado do app (carregado só em `/admin`). Desligado sem `ADMIN_USER` e `ADMIN_PASSWORD` no `.env` (senha de 10+ caracteres): aí `/api/admin/*` responde 404 e a tela diz como ligar.

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/admin/login` | `{ user, password }`. Certo: cookie de sessão e `{ user, expiresAt }`. Errado: 401; 5 erros por IP em 15 min: 429 com `retryAt` (recusa sem conferir, nem a senha certa). Tentativas no log. |
| `POST` | `/api/admin/logout` | Encerra a sessão e apaga o cookie. |
| `GET` | `/api/admin/me` | `{ user }` com sessão; 401 sem. |
| `GET` | `/api/admin/stores` | As três lojas, com a configuração de cada uma (`AdminStoreConfig`: `configured`, `enabled`, nome, site, busca, caminhos, cores, data da alteração). |
| `PUT` | `/api/admin/stores/:id` | Salva a loja (`AdminStoreInput`, cores como texto `"#a,#b"`) e devolve como ficou; vale na hora. Erro de validação: 400 com `errors` (uma frase por campo). |
| `GET` | `/api/admin/stores/state` | Painel das lojas (`AdminStoreState`): pausa (motivo, até quando, degrau), páginas na última hora e limites, se está na rotina, próxima consulta possível (lojas lentas), última coleta boa, último bloqueio e consultas das últimas 24 h por resultado. |
| `POST` | `/api/admin/stores/:id/unpause` | Tira a pausa da loja na hora (sem reiniciar). |
| `POST` | `/api/admin/stores/:id/pause` | `{ minutes }` (5 min a 7 dias): pausa manual (motivo `paused`). Não sobe a escada de pausas. |
| `POST` | `/api/admin/stores/:id/collect` | `{ category, term }`: "coletar agora", na fila da loja e com as regras de sempre (intervalo, intervalo mínimo das lentas, limite por hora); termo do formulário ou texto livre (`isTextTerm`). Loja em pausa: 409. Responde na hora (`startsAt`); o resultado vai para o registro de consultas. |
| `GET`/`PUT` | `/api/admin/routine` | Rotina: ligada e em quais lojas (`RoutineInfo`, com última e próxima rodada). Mudar vale na hora (desligar interrompe a rodada em andamento) e fica guardado (`meta`, chave `routine`); sem nada guardado, valem `ROUTINE_ENABLED`/`ROUTINE_STORES` do `.env`. |
| `GET` | `/api/admin/attempts` | Registro de consultas, mais recentes primeiro; filtros `store`, `status`, `origin`, `before` (id, para paginar), `limit` (até 500). |
| `GET` | `/api/admin/attempts/timeline?hours=48` | Consultas por hora de cada loja (ok, bloqueio, outro), até 720 h. |
| `GET` | `/api/admin/coverage` | Cobertura por loja e categoria: anúncios, vistos em 24 h e 7 dias, termos com coleta boa de quantos, última coleta boa. |
| `GET` | `/api/admin/terms` | Termos (sem a varredura) com a última coleta em cada loja; filtros `category`, `origin` (`seed`, `user`, `text`), `q` (texto, `%` e `_` literais). |
| `POST` | `/api/admin/terms/:id/prioritize` | Conta o termo como pedido agora: as lojas lentas pegam primeiro. |
| `DELETE` | `/api/admin/terms/:id` | Apaga termo pesquisado (`user`, `text`) com suas coletas; termo do formulário (`seed`): 409, a rotina o recriaria. |
| `GET` | `/api/admin/activity` | Buscas recentes do site (em memória, até 500; sem IP: `person` é um hash do IP com um valor aleatório que muda a cada subida), pessoas desde o reinício, buscas e telas abertas agora e quantas pessoas estão em cada limite. |
| `GET` | `/api/admin/live` | SSE: as últimas 50 consultas e cada nova conforme acontece (evento `attempt`). |
| `GET`/`POST` | `/api/admin/backups` | Lista `data/backups` / cria backup (`VACUUM INTO` comprimido, `manual-AAAA-MM-DD-HHMMSS.db.gz`). |
| `GET`/`DELETE` | `/api/admin/backups/:name` | Baixa / apaga um backup (nome sem caminho; outro: 404). |
| `POST` | `/api/admin/merge` | Corpo binário (`application/octet-stream`, até 300 MB): um banco `.db` ou `.db.gz` na mesma migração. Guarda por 30 min e devolve `{ id, report }` (`MergeReport`: o que entraria), sem gravar. |
| `POST` | `/api/admin/merge/:id/apply` | Faz um backup (`pre-merge-…`) e aplica numa transação: anúncios novos, oferta vista por último, histórico nos instantes que faltam, termos, ligação anúncio×termo, coleta mais recente por termo, fichas. Não mexe em `meta`, lojas, consultas nem montagens. `DELETE /api/admin/merge/:id` desiste. |
| `GET` | `/api/admin/status` | Versão, commit, há quanto tempo está no ar, Node, memória do app e da máquina, banco (nome do arquivo, tamanho, WAL, migração), Chrome aberto e coletas usando o navegador. |

- **Sessão:** token aleatório (32 bytes) em memória, `ADMIN_SESSION_H` (12 h); reiniciar o servidor desloga. Cookie `uz_admin`: `HttpOnly`, `Secure`, `SameSite=Strict`, só em `/api/admin`. Senha comparada em tempo constante.
- **Requisição forjada de outro site:** além do `SameSite=Strict`, toda chamada que muda algo exige o cabeçalho `X-Admin: 1` (403 sem ele): um site de fora só consegue mandá-lo com a pré-checagem de CORS, que o servidor não libera.
- **Abas:** Servidor, Coleta (rotina com um switch e um modo por loja, painel de cada loja com a contagem até a próxima consulta, e ações), Consultas (linha do tempo de 48 h e registro com filtros), Cobertura, Termos (com filtro de nunca coletados em nenhuma loja ou em alguma), Ao vivo, Atividade, Lojas (configuração) e Backups (com o merge).
- **Registro de consultas** (`store_attempts`, `prices/attempts.ts`): cada consulta que vai à loja (termo, página de varredura, ficha técnica) grava loja, fim, tipo, origem (`search`, `routine`, `admin`), categoria, termo ou página, resultado (`ok`, `partial`, `blocked`, `limit`, `error`), ofertas, motivo e mensagem do bloqueio e duração; a que nem saiu (loja em pausa, cancelada) não entra. Guardado por 90 dias. Falha ao gravar o registro nunca derruba a coleta.
- Respostas com `Cache-Control: no-store`. Código em `apps/server/src/admin/` (rotas montadas como plugin, testadas com `inject`) e `apps/web/src/admin/`.

## 10. Segurança e privacidade

- Nada sensível no repositório: `.env` e `data/` (banco SQLite e dumps de debug) estão no `.gitignore`. O navegador não guarda perfil em disco.
- Montagem compartilhada: quem tem o link vê (código aleatório de 8 caracteres); o servidor só aceita links `https://` e limita o tamanho. Nenhum dado de usuário é guardado.
- Relatório do CPU-Z: lido só no navegador (não vai para o servidor), até 5 MB e com o cabeçalho do CPU-Z. O arquivo é só lido, nunca executado; cada valor sai sem caracteres de controle e invisíveis (inclusive os que invertem o texto) e com tamanho máximo (200 caracteres por valor, 160 no nome da peça), as listas têm teto (16 discos, 8 monitores, 16 pentes) e a tela mostra tudo como texto (o React escapa). O perfil guardado no navegador só volta com o formato esperado (`validPc`).
- **Proteções da API** (`security.ts`, contadores em memória por pessoa; atrás do `cloudflared` o IP real vem de `CF-Connecting-IP`, aceito só quando a conexão é local):
  - A busca só aceita os termos que o formulário gera (`isFormTerm`): termo inventado chamado direto na API é recusado (400), não consulta as lojas nem entra na fila da rotina. Exceção: com `text=1`, um texto livre por busca (`isTextTerm`), limitado a `TEXT_SEARCHES_PER_HOUR` (20) por pessoa por hora; passou disso, a busca segue só com os termos do formulário. O texto entra no banco com origem `text`: conta como pedido, mas a rotina só o mantém enquanto alguém pesquisou nos últimos `ROUTINE_TEXT_DAYS` (7) dias, para a lista dela não crescer sem fim.
  - `force=1` (consultar de novo): até `FORCE_PER_HOUR` (10) por pessoa; além disso, e quando o resultado do banco tem menos de `FORCE_MIN_AGE_MIN` (10 min), a busca responde com o banco. Protege o limite de páginas por hora das lojas, que é de todos.
  - Buscas abertas ao mesmo tempo: `SEARCHES_PER_IP` (3). Requisições à API: `RATE_LIMIT_PER_MIN` (120) por pessoa (429 com `Retry-After`).
  - Link de montagem: a mesma montagem reaproveita o link (hash do conteúdo); links novos, `SHARE_PER_HOUR` (20) por pessoa. Corpo até 256 KB.
  - Cabeçalhos: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` e, na página, CSP só com recursos do próprio servidor (imagens de qualquer `https:`, as fotos vêm das lojas).
- Fixtures de teste são recortes mínimos de páginas públicas de busca: poucos itens, só os campos lidos, sem scripts, cookies, tokens ou metadados de sessão.
- Servidor escuta em `127.0.0.1` por padrão, sem abrir portas. Acesso de fora pelo link temporário do `cloudflared` (`pnpm share` ou o serviço do túnel no servidor) ou por VPN mesh.
- Admin: login fixo do `.env`, sessão em cookie protegido, limite de tentativas e cabeçalho obrigatório contra requisição forjada ([§9.3](#93-admin-admin)).
- Contas de usuário: pendente (necessária antes de expor para outros usuários).

## 11. Stack e estrutura

| Camada | Escolha |
|---|---|
| Linguagem | TypeScript ponta a ponta, executado direto com `tsx` (sem build no servidor) |
| Runtime | Node 22.13+ (`node:sqlite` embutido) |
| Servidor | Fastify 5, zod 4 |
| Navegador | Playwright abrindo o Google Chrome instalado em sessão anônima |
| Front | React 19, Vite, Tailwind 4 |
| Testes | Vitest |
| Monorepo | pnpm workspaces |

```
apps/
  server/src/
    adapters/        s1.ts, s2.ts, s3.ts, types.ts (+ *.test.ts com fixtures)
    stores.ts        configuração das lojas: no banco (admin), copiada do .env na primeira vez; validação do que o admin salva
    admin/           admin: login e sessão (auth.ts), rotas (routes.ts), status, painel e ações das lojas (actions.ts),
                     cobertura, termos e linha do tempo (data.ts), atividade sem IP (activity.ts), backups e merge (backup.ts)
    cli/scan.ts      busca pelo terminal
    db/              SQLite (node:sqlite): migrações, meta, instância do servidor
    prices/          prices.ts (termos, coletas, anúncios, histórico, resumo de 30 dias, anúncios que batem com o termo),
                     collect.ts (consulta um termo ou uma página de categoria e grava), routine.ts (rotina de coleta),
                     sweep.ts (estado e ordem da varredura de categoria), attempts.ts (registro de cada consulta às lojas)
    builds/          montagens compartilhadas por link (validação, código curto, preço atualizado ao abrir)
    browser.ts       Chrome com janela escondida, uma janela anônima por loja, detecção de bloqueio
    pace.ts          fila por loja (withStore), intervalos, limite por hora, backoff guardado no banco
    search.ts        busca do site: lê o banco (termos + anúncios que batem pelas specs), consulta a loja só quando falta, está velho ou pedem
    config.ts        variáveis de ambiente (zod)
    index.ts         Fastify + SSE, rotas da API, sobe a rotina
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
    terms.ts         todos os termos que o formulário gera (a rotina coleta esses), isTextTerm (texto livre aceito) e termMatches (anúncio × termo pelas specs)
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
| Banco | `apps/server/src/db/db.test.ts` | migração idempotente; a saída do catálogo (migração 5) mantém anúncios, histórico, termos e pausas |
| Compatibilidade | `packages/shared/src/compat.test.ts` | montagens válidas e inválidas a partir de títulos reais (encaixe, chipset × geração, DDR4/DDR5, slots com ATX = 4, fonte, vídeo, cooler), selos por peça, troca de placa-mãe revalidando tudo, tabelas de plataforma; TDP de referência por modelo, cooler fraco para o processador da loja (o do CPU-Z vale mais), radiador de 120 mm, placa de entrada com processador forte, H610 travando a memória |
| Parsers das lojas | `apps/server/src/adapters/{s1,s2,s3}.test.ts` | leitura de cada página real recortada: preços, parcelamento, estoque, EAN/part number, cupom, marketplace/open box, itens fora da categoria; na S1, oferta temporária (prazo e estoque), estoque fora de oferta e cupom (soma com a oferta, não vale para vendedor parceiro); na S3, "OPEN BOX" no título |
| Lojas | `apps/server/src/stores.test.ts`, `stores-db.test.ts` | do `.env`: cor com ou sem `#`, valor inválido ignorado, degradê; no banco: cópia do `.env` só na primeira vez, validação de cada campo do admin, salvar valendo na hora, loja desligada fora das buscas |
| Admin | `apps/server/src/admin/{admin,ops,data,backup}.test.ts`, `apps/web/src/admin/format.test.ts` | login, força bruta, cookie, cabeçalho `X-Admin`, sessão e cada rota (montadas com `inject`); pausa manual e tirar pausa sem subir a escada; resultado de cada consulta; registro, filtros e linha do tempo; rotina guardada e reiniciada; modo por loja (só o enviado muda, inválido volta ao padrão), loja em pausa na sua vez sem consultar; coletar agora recusando loja em pausa e termo inválido; cobertura; termos (filtro, `%` literal, apagar só pesquisados, prioridade); atividade sem IP; backup que abre como banco; nome com caminho recusado; merge com dois bancos reais (oferta mais recente, histórico das duas, sem duplicar, outra migração recusada); textos da tela |
| Preços no banco | `apps/server/src/prices/prices.test.ts` | termos sem duplicar, resultado da última coleta completa, coleta incompleta, histórico só quando muda, ordem da rotina, fila por loja, pausa guardada, menor preço em 30 dias, anúncio de outra coleta que bate com o termo ("AM4" achando o que veio de "Ryzen 7"; velho demais fica de fora) |
| Ficha técnica e checagem física | `packages/shared/src/specsheet.test.ts`, `compat.test.ts`, `apps/web/src/build.test.ts`, `apps/server/src/prices/sweep.test.ts` | leitura de fichas reais (comprimento da placa com a medida na linha seguinte, gabinete com GPU/cooler máximos e radiadores sem confundir com ventoinhas, cooler sem altura, conector 6/8 × 16 pinos, part number); placa que não cabe, justa, cabe; cooler alto; radiador não aceito; quando a montagem pede a ficha, peça trocada no meio, falha passageira sem marcar; ficha guardada e velha demais |
| Cupom, part number, lojas lentas | `packages/shared/src/coupon.test.ts`, `mpn.test.ts`, `apps/server/src/pace.test.ts` | condições do cupom (limitado, mínimo, validade com e sem ano, PIX) e o cupom só valendo quando atinge o mínimo e não venceu; part number no fim do título das três lojas (e o que não é código), mesmo código juntando lojas e variante separada; consulta na fila atrás de bloqueio sem ir à loja, intervalo mínimo da loja lenta guardado |
| Marcas | `apps/server/src/prices/prices.test.ts`, `apps/web/src/brands.test.ts` | marcas da categoria vistas no período (sem repetir, sem "Outros"/"Genérica"); sugestões da fonte do "Meu PC" juntando as do banco com as comuns, na grafia da busca |
| Termo × anúncio | `packages/shared/src/terms.test.ts` | `termMatches` em cada tipo de termo (encaixe, linha, potência, chipset, memória, SSD, cooler, gabinete, fabricante do chip). Conferido também contra os ≈8 mil anúncios do banco (nov/2026): todo tipo de termo acha anúncios; os que não acham nada (chipsets antigos, Core 3/5/7, 48/96 GB) também não têm nada à venda |
| Varredura de categoria | `apps/server/src/prices/sweep.test.ts` | volta página por página, teto de páginas, ordem entre categorias, falha retomando da mesma página, histórico gravado, termo da varredura fora da fila, `STORE_S1_SWEEP` só com caminho do próprio site, página da categoria na S1 com paginação |
| Montagem por link | `apps/server/src/builds/builds.test.ts` | código curto, validação (vazia, link que não é https, quantidade), salvar/abrir com o preço mais recente do banco |
| Segurança | `apps/server/src/security.test.ts` | limite por janela, abertos ao mesmo tempo, IP real só com conexão local, termos aceitos, mesma montagem reaproveitando o link |
| Três lojas juntas | `apps/server/src/adapters/cross-store.test.ts` | invariantes de toda oferta (preço, link, chave) e o mesmo modelo de lojas diferentes virando um produto |
| Categorias novas | `apps/server/src/adapters/categories.test.ts` | processador, placa de vídeo, memória, SSD, cooler e gabinete nas lojas com amostra: specs, descartes (acessório, kit, ventoinha, tela de monitoramento, SSD de servidor), o mesmo processador nas três lojas e a mesma placa de vídeo em duas virando um produto |
| SSD, cooler e gabinete | `packages/shared/src/{ssd,cooler,pccase}.test.ts` | reconhecimento e specs com títulos reais (formas curtas "512G"/"1T", interface pela leitura, M.2 SATA), faixas de capacidade, encaixe do cooler (fixação AM4/AM5 e LGA1700/1851), placa que cabe no gabinete, chaves de modelo |
| Montagem | `apps/web/src/build.test.ts` | busca de cada peça pré-filtrada pela montagem, selo de cada candidata (inclusive na troca), totais por loja e na melhor combinação (com quantidade e peças atuais fora), guardar/carregar no navegador (e sem armazenamento) |
| Gargalo e upgrades | `packages/shared/src/upgrade.test.ts` | tabela de desempenho (referências, X3D, Intel K, pares equilibrados, toda placa com consumo tem desempenho); placa de vídeo como gargalo com a faixa sugerida e a fonte (sem fonte, cabe, não cabe), processador como gargalo no mesmo encaixe, topo do encaixe → plataforma nova, só vídeo integrado, PC equilibrado, memória pouca/um pente/lenta, Windows num HD, modelo fora da tabela |
| Relatório do CPU-Z | `packages/shared/src/cpuz.test.ts`, `apps/web/src/pc.test.ts` | AMD AM4/DDR4/Radeon (relatório real anonimizado) e Intel LGA1700/DDR5/GeForce (exemplo): specs de cada peça, pentes sem a repetição dos registradores, XMP gravado × frequência em uso, fabricante abreviado, "Default string" ignorado, só vídeo integrado, sem SPD (pelo DMI), discos sem pendrive, monitor, WHEA, nada de número de série; arquivo UTF-16, texto que não é do CPU-Z, peças como "Atual" na montagem, problemas só entre peças atuais ignorados |
| Front | `apps/web/src/searchPlan.test.ts` | plano de busca de cada categoria (termos, botão, limite de 8; placa-mãe com várias plataformas ou só memória), filtros novos, "Limpar" mantendo o que define a busca, todo termo do formulário coberto pela rotina |

Fixtures em `apps/server/fixtures/` (como atualizar quando uma loja muda o layout: README da pasta) e em `packages/shared/fixtures/cpuz/` (relatórios do CPU-Z, ver README da pasta). A leitura dos cards de S3 usa `linkedom` como DOM nos testes. As fixtures são anonimizadas (domínios `s1.example`…, nomes e códigos de campanha trocados) e os testes usam lojas fictícias definidas em `apps/server/src/test-setup.ts`, sem ler o `.env`.

## 13. Execução e deploy

Desenvolvimento:

```bash
pnpm install
pnpm dev          # servidor :8787 + web :5173 (proxy /api)
pnpm scan 750w    # busca pelo terminal
pnpm scan --sweep # confere os caminhos de varredura (1ª página, sem gravar)
pnpm test
```

Requisitos: Node 22.13+, pnpm e Google Chrome instalado.

Versões: `version` nos `package.json` (a da raiz vale para o app), histórico no `CHANGELOG.md`, tag `vX.Y.Z` no git. `pnpm release X.Y.Z` (`scripts/release.mjs`) atualiza todos os pacotes e abre a seção da versão no CHANGELOG.

Servidor sem tela (em uso: notebook com Ubuntu; scripts e passo a passo em `deploy/`, fora do git):

- Node 22 e pnpm só do usuário (`~/.local/opt/node`), código clonado em `~/Upgradezin`, `.env` e `data/` na pasta.
- Google Chrome instalado, rodando sob `xvfb-run` (headless é barrado).
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
| 1.3 | Categoria e filtros lembrados entre visitas; ordenação "Maior Desconto" | feito |
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
| — | Identificar gargalo e sugerir upgrades a partir do setup importado ([§17.3](#173-identificar-gargalo-e-sugerir-upgrades)) | feito |
| 7.4 | Varredura de categoria: histórico de todo produto à venda (S1) | feito ([§8.2](#82-preços-e-rotina-de-coleta)) |

### A fazer

Na ordem em que devem entrar; login por último.

1. **Cobertura de S2 e S3:** feito até agora (nov/2026): intervalo mínimo de 3 min, busca do site sem rajada, fila sem ir à loja em pausa, modo lento de 15 min, resultado completado pelo banco ([§4.3](#43-política-de-coleta)). Falta: amostras (memória em S2 e S3, placa de vídeo em S2), caminhos de categoria (`STORE_S2_CATEGORIES` só tem fonte, placa-mãe e processador; S3 nenhum), medir nos logs se 3 min bastam, e varredura de categoria nelas se aceitarem (ver [§16](#16-questões-em-aberto)).
2. **Consumo da RX 9050** na tabela `GPU_POWER` (sem valor oficial conferido; até lá a fonte fica "não deu para estimar" com ela).
3. **Condições do cupom:** feito para a S1 ([§6.3](#63-cupons)). Falta S2 e S3, que só dão a % no anúncio (a página de cupons da S3 lista código e condições; avaliar ler uma vez por dia).
4. **Frete:** depois do login, com o CEP que a pessoa informar.
5. **Variantes do mesmo modelo** separadas por part number (etapa 2).
6. **Alertas de preço** (etapa 7).
7. **Gabinete × placa de vídeo e cooler:** feito pela ficha técnica da S1 ([§17.1.1](#1711-regras-de-compatibilidade)). Falta: ficha de S2 e S3 (peça vendida só nelas fica "confira") e a altura do cooler, que muitas fichas não trazem (só a do fan).
8. **Usuários e login** (etapa 6): obrigatório antes de abrir o app para outras pessoas; o link público já existe.

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
- **Atualização (nov/2026):** o catálogo de peças passou a ficar em SQLite ([ADR-005](#adr-005-catálogo-de-peças-em-sqlite-importado-uma-vez-do-opendb)), e depois os preços ([ADR-006](#adr-006-preços-no-banco-coletados-por-rotina)). O histórico agora sai de uma rotina que cobre todos os termos do formulário, não só o que alguém procurou: o motivo original para não gravar deixou de valer.

### ADR-003: Sem marketplaces abertos

- **Contexto:** em marketplaces abertos é comum receber produto usado ou com defeito anunciado como novo, e é difícil controlar a reputação de cada vendedor.
- **Decisão:** só lojas que vendem e entregam o próprio estoque. Ofertas de terceiros dentro dessas lojas (marketplace da S1) ficam escondidas por padrão.

### ADR-004: Navegador padrão e pausa no bloqueio

- **Contexto:** S2 e S3 usam proteção anti-bot (Cloudflare). Nos testes, um navegador real passou no começo, mas as lojas escalaram: a S3 passou a pedir confirmação interativa e a S2 a devolver 403 com página de "manutenção".
- **Decisão:** o Google Chrome instalado, aberto pelo Playwright. Bloqueio pausa a loja (backoff), a UI mostra o status com o link da mesma busca no site da loja, e a busca segue nas outras.
- **Revisão:** começou com o Chromium do Playwright; passou a usar o **Google Chrome instalado** (`channel: chrome`), aberto em sessão anônima, com a janela fora da área visível e fechado ao fim de cada busca. Continua sem nenhuma modificação: o Chrome segue se identificando como automatizado. Interceptar rede e minimizar a janela foram descartados porque quebravam a página de verificação.
- **Consequência:** a cobertura de S2 e S3 depende de as lojas aceitarem esse volume baixo. S1 responde a HTTP simples e funciona de ponta a ponta; S3 funciona com o Chrome instalado; S2 limita depois da primeira página.

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

### ADR-008: Varredura de categoria para o histórico

- **Contexto:** o histórico só cobria o que aparecia na primeira página de algum termo do formulário (120 itens por termo na S1, ordenados pelos mais procurados). Produto fora desse topo não tinha histórico nenhum, e o que tinha era recoletado só quando o termo vencia. Para quem usa, o mais útil é ver o histórico de qualquer peça à venda. Os ≈110 termos custam mais páginas por volta (≥110) do que a categoria inteira (75 na S1).
- **Decisão:** a rotina varre a página de cada categoria da loja, algumas páginas por hora, com orçamento próprio e retomando de onde parou ([§8.2](#82-preços-e-rotina-de-coleta)). Os termos continuam: dão a relevância da loja e a consulta na hora. A busca do site junta a eles os anúncios da varredura que batem com o termo pelas specs ([§8.2](#82-preços-e-rotina-de-coleta)). "Nunca a categoria inteira" segue valendo para a busca ao vivo ([ADR-001](#adr-001-busca-ao-vivo-em-volume-de-pessoa)); a varredura é da rotina, no mesmo volume de pessoa (uma consulta por vez, intervalo, limite por hora, pausa no bloqueio).
- **Consequências:** todo produto da categoria na S1 ganha um ponto de histórico por dia, no mínimo. S2 e S3 (navegador, modo lento) ficam de fora por enquanto: a página de categoria também derrubaria a cobertura delas com bloqueio, e o adapter não sabe ler. Caminhos de categoria no `.env` (`STORE_Sx_SWEEP`), como o resto do que identifica a loja; hoje ficam no banco, editados no admin ([§4.7](#47-lojas-por-id)).

### ADR-007: CPU-Z como única entrada do setup atual

- **Contexto:** para sugerir upgrades, o app precisa saber o PC atual. O navegador só entrega uma parte: o nome da placa de vídeo em alguns navegadores (Firefox, Safari e Brave escondem), núcleos, memória arredondada e o monitor; nunca o modelo do processador nem a placa-mãe, que definem o que dá para trocar. Outras entradas possíveis: relatório do dxdiag (sem placa-mãe nem detalhe de memória), um comando do PowerShell para colar no terminal ou um programa próprio.
- **Decisão:** só o relatório do CPU-Z, lido no navegador. Um formato só, estável entre versões, de um programa conhecido e gratuito, com tudo o que importa (placa-mãe, cada pente com XMP, PCIe, discos, monitor). Comando para colar no terminal fica fora: é o mesmo gesto do golpe do falso CAPTCHA ("aperte Win+R e cole"), e um site não deve ensinar isso; um programa próprio teria o mesmo problema de confiança e seria barrado por antivírus.
- **Consequências:** um passo a mais para a pessoa (baixar o CPU-Z e salvar o relatório), com o passo a passo na tela; só Windows (o CPU-Z é de Windows); um leitor e duas fixtures para manter.

## 16. Questões em aberto

- [ ] **Fonte de specs para categorias complexas.** Para fonte, o título basta. Para placa-mãe (nº de M.2, slots, VRM, PCIe), o título não traz tudo. Opções:
  1. Facetas nativas das lojas (S1 `meta.filters`, S2 `aggregations` e campos como `socket`, `formato_placa`, `tipo_de_memoria`): sempre atualizadas, sem manutenção. **Recomendado como base.**
  2. Página do produto (ficha técnica) só para os itens que passarem nos filtros principais: mais requisições.
  3. Base externa de specs: avaliar disponibilidade, atualização e termos de uso. Agregadores sem API pública e com termos que proíbem coleta ficam fora.
- [ ] **Cobertura confiável de S2 e S3.** Opções: (1) feeds de produto de programas de afiliados (XML/CSV com preço e estoque, atualizados periodicamente, não ao vivo); (2) pedir às lojas acesso ou liberação para uso não comercial; (3) aceitar a cobertura parcial (atual).
- [ ] **Profundidade por termo:** `MAX_PAGES_*` atuais (S1 1×120, S2 1×36, S3 1×300) bastam? Na S2, a 1ª página já traz os itens mais relevantes, e páginas seguintes disparam o limite da loja. Na S1, a varredura de categoria ([ADR-008](#adr-008-varredura-de-categoria-para-o-histórico)) cobre o que passa da 1ª página.
- [ ] **Amostras que faltam:** memória RAM em S2 e S3 e placa de vídeo em S2 (a loja limitou o acesso na coleta). Sem elas, essas combinações filtram só pelo título (sem caminho de categoria no `.env`) e não têm fixture. Coletar uma página de cada, com calma, quando houver oportunidade.
- [x] **Condições de cupom:** lidas do texto da S1 (limitado, mínimo, validade, PIX) e aplicadas no preço ([§6.3](#63-cupons)). S2 e S3 seguem só com a %.
- [ ] **Frete:** ignorar (atual) ou estimar por CEP?
- [ ] **Ritmo próprio da S2.** Medido em nov/2026: a S2 marca a sessão automatizada na 1ª página e, depois de alguns bloqueios, recusa também sessões novas do mesmo endereço por um tempo; com 20–25 min entre consultas, às vezes passa e às vezes não. Já dá para escolher o modo da rotina por loja (normal, reduzido, lento; [§8.2](#82-preços-e-rotina-de-coleta)), mas o intervalo mínimo (3 min) e a 1ª pausa (15 min) ainda valem igual para S2 e S3. Com o registro de consultas do admin (aba Consultas), decidir com dados um intervalo e uma pausa só da S2.
- [x] **Licença** do repositório: proprietária, todos os direitos reservados (`LICENSE`, `"license": "UNLICENSED"`). Sem licença o padrão já seria esse, mas o aviso explícito deixa claro; impedir de fato a cópia só com o repositório privado.

## 17. Ideias futuras

> Status: implementados a montagem (17.1), com a checagem de compatibilidade ([§17.1.1](#1711-regras-de-compatibilidade)), a tela ([§9.2](#92-frontend)) e o compartilhamento por link, a importação do setup atual pelo CPU-Z (17.2) e a identificação de gargalo com sugestões de upgrade (17.3). Público: quem curte PC e quer ver preço, montar e comparar. As três primeiras se encaixam: a montagem é o centro, a importação do setup atual preenche a montagem, e as sugestões apontam o que vale trocar.

```
 CPU-Z .txt ──► Importar setup atual (17.2) ──► Montar o PC (17.1) ◄── busca por peça (banco)
                         │                         ▲
                         └──► Sugerir upgrades (17.3) ─┘  (cada sugestão abre a peça na montagem)
```

### 17.1 Montar o PC (montagem dinâmica)

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

Lacunas conhecidas: slots de memória só aparecem no título de 1% das placas (Mini-ITX = 2 e ATX = 4 são deduções seguras; Micro-ATX varia); cooler incluso só quando o anúncio diz. Medidas físicas (comprimento da placa de vídeo, altura do cooler, máximos e radiadores do gabinete, conector 12V-2x6) não aparecem nos títulos: vêm da ficha técnica da página do produto (`specsheet.ts`), lida sob demanda só das peças que entram na montagem (`GET /api/sheets`, guardada 30 dias), hoje só na S1; a altura do cooler falta em muitas fichas (só a do fan). Nos cards de resultado, a observação "confira a medida" não aparece: a ficha só é lida quando a peça entra na montagem. Conferido contra os ≈4 mil anúncios do banco (nov/2026): encaixe, geração, TDP e consumo do processador, chipset e memória da placa-mãe e tipo da memória reconhecidos em 99–100%; RX 9050 fora da tabela de consumo (sem valor oficial conferido).
- **Total sempre à mostra:** barra fixa com o total à vista com cupom, a soma por loja ("tudo na S1: R$ X") e a melhor combinação entre lojas.
- **Ordem flexível:** começar pela placa de vídeo, por exemplo, é permitido; a montagem só avisa as dependências que ficaram para trás.
- **Sem conta:** a montagem fica no navegador (`localStorage`). Compartilhar grava uma cópia no servidor e gera um link curto (`/m/<id>`), aberto só para leitura e com preços atualizados pelo banco.
- **Usabilidade a desenhar:** lista vertical de peças com ícone (como a tela inicial), cada uma com "Escolher" / "Trocar"; no celular, uma peça por vez com avanço; preço e compatibilidade sempre visíveis; nunca mais de um clique para voltar a uma peça.

### 17.2 Importar setup atual (CPU-Z)

> **Implementado** (`packages/shared/src/cpuz.ts`, `apps/web/src/pc.ts`, `ImportPc`). Ver [ADR-007](#adr-007-cpu-z-como-única-entrada-do-setup-atual).

A pessoa gera o relatório no CPU-Z (aba **About** → **Save Report (.TXT)**) e solta o arquivo na montagem. A montagem passa a ter **as peças que ela tem hoje**, marcadas como "Atual": sem preço, fora do total, mas conferidas na compatibilidade. A partir daí, troca o que quiser e vê o custo só do que muda.

- **Lido no navegador, nunca enviado ao servidor** (proteções contra arquivo forjado em [§10](#10-segurança-e-privacidade)). O leitor guarda só campos de peça: números de série, UUID, caminhos de dispositivo, datas e nome da máquina ficam de fora. O perfil completo (com discos, monitor e erros WHEA, para as sugestões) fica em `localStorage` (`upgradezin.pc.v1`).
- **Formato:** seções com o título sublinhado por traços; em cada linha, `Chave<TABs>Valor`, com subitens indentados por TAB. Arquivo em UTF-8/ANSI ou UTF-16.
- **Peças no mesmo formato das ofertas:** o nome de cada peça passa pelos mesmos extratores dos títulos das lojas (`extractCpuSpecs`, `extractGpuSpecs`, `extractMotherboardSpecs`), e o relatório completa o que o nome não diz (encaixe, chipset, tipo de memória, slots, núcleos, TDP, VRAM). Assim a compatibilidade e as buscas da montagem funcionam sem regra nova.
- **Peças atuais funcionam juntas:** um problema que envolve só peças "Atual" (ex. "pode precisar de BIOS") não aparece. Uma peça nova continua sendo conferida contra as atuais.
- **Fonte e cooler** não aparecem no relatório. Na prévia da importação, a pessoa pode informar a fonte (potência, marca, PFC ativo, eficiência mínima; tudo opcional, e sem potência a fonte não entra). Ela vai para a montagem como "Atual" e para a análise, e fica guardada para a próxima importação. Na montagem, "Já Tenho" faz o mesmo com uma fonte escolhida numa loja.

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

> **Implementado** (`packages/shared/src/perf.ts`, `packages/shared/src/upgrade.ts`, `PcAnalysis`). Entrada "Identificar Gargalo" na tela inicial.

Com o PC importado (17.2), o app diz o que segura o desempenho e o que vale fazer. Cada sugestão de peça abre a busca já filtrada e roda; as peças do PC entram na montagem onde ela estiver vazia, para a compatibilidade conferir contra o que a pessoa tem, e escolher um produto troca a peça na montagem.

**Equilíbrio processador × placa de vídeo (`perf.ts`):**

- Tabela de desempenho relativo em jogos, aproximada e arredondada (médias de análises públicas em 1080p): placa de vídeo por chip (RTX 3060 = 100) e processador por geração e linha (Ryzen 5 5600 = 100), com os modelos fora da curva à parte (X3D, APUs sem cache) e Intel K a partir da 12ª. Vídeo integrado = 12.
- `cpuNeeded(gpu, resolução, Hz)`: processador que a placa pede para não esperar. Linear, calibrado em pares equilibrados (RTX 3060 + Ryzen 5 5600; RTX 4090 + Ryzen 7 9800X3D). Em 1440p e 4K a placa trabalha mais (fator 0,8 e 0,62); monitor de 120 Hz ou mais pede 5% a mais do processador.
- Razão = processador ÷ o que a placa pede. Acima de 1,2: a placa de vídeo é o gargalo; abaixo de 0,8: o processador. Modelo fora da tabela: "não deu para avaliar", sem chute.
- A tela mostra o veredito, uma frase com resolução e Hz do monitor e um medidor (escala logarítmica, equilíbrio no meio).

**Sugestões (`analyzePc`):**

| Tipo | Regra | Ação |
|---|---|---|
| Upgrade | Placa de vídeo é o gargalo: placas na faixa do que o processador aguenta (85% a 115% do ideal, e ao menos 30% acima da atual), só de séries vendidas novas. O texto cita até 4 da geração atual. Placa-mãe PCIe 3.0: ficam de fora as placas de 8 linhas (`GPU_PCIE_X8`), com o motivo no texto. Com a fonte informada, só as que cabem nela, ou o aviso de que a fonte entra na troca (ou "troque-a junto", se ela for simples); sem ela, a potência a partir da placa mais econômica | Busca de placa de vídeo com os modelos da faixa |
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

### 17.4 Outras ideias

| Ideia | Comentário |
|---|---|
| **Upgrade por orçamento** | "Tenho R$ 1.500: qual troca rende mais?" Combina 17.3 com os preços do banco e ordena as sugestões por ganho/preço. |
| **Upgrade × PC novo** | Compara o custo de trocar as peças sugeridas com o de uma montagem nova equivalente. |
| **Montagens prontas por faixa** | Pontos de partida ("entrada", "intermediário", "topo") que abrem na montagem para ajustar. Mantidas no repositório, revisadas quando sai geração nova. |
| **Checagem física** | Feito (nov/2026): placa de vídeo × gabinete, cooler × gabinete, radiador aceito e conector 12V-2x6 pela ficha técnica; BIOS que precisa de atualização já existia. Falta a ficha de S2 e S3. |
| **Consumo e conta de luz** | Estimativa de consumo da montagem e custo mensal por horas de uso, além da fonte recomendada. |
| **Preço por desempenho** | R$ por ponto de desempenho relativo (mesma tabela de 17.3), como ordenação em processador e placa de vídeo. |
| **Uma loja só × melhor combinação** | Na montagem, mostrar se comprar tudo numa loja compensa (frete, cupom de carrinho) frente a dividir entre as três. |
| **Alerta de preço** | Avisar quando um produto da montagem (ou marcado) cair de preço. O histórico já existe (§8.3, ADR-006); falta decidir por onde avisar (na tela, e-mail, Telegram). |

