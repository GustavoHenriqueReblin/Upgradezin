# Upgradezin: visão consolidada do projeto

Documento de entrada para quem chega ao projeto (pessoa ou agente) sem o histórico das conversas. Resume o que o projeto é, como funciona, as regras, as decisões, o estado atual e o que vem depois, e aponta para a referência detalhada em [ARCHITECTURE.md](ARCHITECTURE.md) (seções citadas como §N). O histórico de mudanças está no [CHANGELOG](../CHANGELOG.md).

Última consolidação: 25/11/2026, versão 0.3.0 (com mudanças ainda não lançadas no `[Não lançado]` do CHANGELOG).

---

## 1. Objetivos

Buscador de preços e assistente de montagem/upgrade de PC para o varejo brasileiro de hardware.

- **Preço real e recente** de peças novas, vendidas e entregues pela própria loja, em três lojas (S1, S2, S3), com o preço à vista (PIX, com cupom) separado do parcelado e a idade do preço sempre visível.
- **Comparação por produto, não por anúncio:** o mesmo modelo em várias lojas vira um item com várias ofertas.
- **Decisão técnica, não chute:** busca, filtros, compatibilidade, gargalo e sugestões de upgrade usam a **ficha técnica** de cada produto (lida das páginas das lojas, da web ou preenchida à mão), não só o título.
- **Ajudar quem não entende de hardware:** montar o PC peça por peça com a compatibilidade conferida, importar o PC atual (CPU-Z), ver o gargalo e o que vale trocar, e (em refino) montar pelo orçamento.
- **Self-hosted, volume de pessoa:** um processo, um SQLite, um servidor doméstico; as lojas são lidas devagar, uma página por vez, como uma pessoa navegando.

Fora do escopo: marketplaces abertos, usado/recondicionado, checkout, afiliados, uso comercial (ARCHITECTURE §2).

---

## 2. Estado atual (nov/2026)

- **Em produção** num servidor Ubuntu doméstico, com acesso público por túnel. A rotina de coleta, a varredura completa da madrugada e a rotina de fichas rodam lá. O servidor pode estar alguns commits atrás do `main`: o deploy é manual (seção 12).
- **Catálogo** (snapshot local de 25/11/2026) com 19.067 anúncios catalogados e 14.456 páginas de produto lidas.
- **Versão 0.3.0.** O `[Não lançado]` do CHANGELOG lista o que já está no código e ainda não virou versão.
- **Próximo marco:** validar e lançar a 1ª versão, com o comparador e a montagem com vários discos implementados (seção 11).

---

## 3. Funcionalidades

No admin, fichas em revisão podem ser concluídas com campos pendentes e reabertas. O monitoramento do servidor continua ativo em qualquer aba do painel.

O PC atual pode ser informado marcando Já Tenho nas peças da montagem ou importando um relatório do CPU-Z. Os dois caminhos alimentam o diagnóstico e as sugestões de upgrade. A importação coloca as peças na montagem automaticamente.

### Implementadas

| Área | O que faz | Referência |
|---|---|---|
| Busca por categoria | Formulário por categoria (potência, soquete, chipset, memória, linha de processador, fabricante de placa de vídeo, capacidade etc.) com a contagem de produtos em estoque em cada opção; o resultado vem do banco, filtrado pelas specs da ficha | §7, §9 |
| Filtros do resultado | Calculados dos próprios resultados, com contagem; filtros genéricos para cada campo da ficha; ordenações por categoria (R$ por watt, por GB, por TB…) | §7 |
| Produto | Página do produto (`/produto/<chave>`) com as ofertas de todas as lojas, a ficha completa e o histórico de preço (30/90 dias/tudo), selo "Menor Preço em 30 Dias" | §9 |
| Comparador | Seleção de peças de várias categorias, com tabelas separadas e rolagem horizontal. CPUs e GPUs têm índices de jogos e, com o PC atual informado, estimativas de ganho e equilíbrio | §14 |
| Montagem do PC | Oito categorias, com múltiplos discos NVMe e SATA. Busca e compatibilidade por peça, quantidade na memória, total por loja e na melhor combinação e compartilhamento por link (`/m/<id>`) | §17.1 |
| Montar pelo Orçamento | PC completo ou upgrade do PC atual, com até 3 opções. Acesso pela tela inicial e pelo Identificar Gargalo | §17.4 |
| Informar o PC atual | Marcação Já Tenho na montagem ou importação do relatório `.txt` do CPU-Z no navegador. O relatório preenche a montagem automaticamente | §17.2 |
| Identificar Gargalo | Equilíbrio processador × placa de vídeo na tela da pessoa (resolução e Hz do monitor), dicas (upgrade, grátis, atenção, observação) e as 3 melhores ofertas de cada dica | §17.3 |
| Admin (`/admin`) | Lojas, rotina por loja, intervalos, fila, pausas, registro de consultas, cobertura, produtos, fichas (lista, "Ler ficha", preencher/editar à mão, revisão), busca na web, monitor do servidor (CPU, memória, disco, rede), backups e merge de bancos | §9.3 |
| Rotinas no servidor | Coleta das páginas de categoria, varredura completa (também de madrugada), rotina de fichas, busca na web das fichas, backup noturno | §8.2, §8.3 |

### Implementadas, mas escondidas do site

| Funcionalidade | Por quê | Como religar |
|---|---|---|
| "Não achou? Buscar nas lojas" (texto livre que vai às lojas) | A varredura completa já traz praticamente todas as peças | `STORE_TEXT_SEARCH = true` em `apps/web/src/App.tsx` |

### Planejadas

Ver seção 11 (o caminho até a 1ª versão e depois).

---

## 4. Arquitetura

Monorepo pnpm, TypeScript em tudo, Node 22.13 ou superior para o servidor. A auditoria de orçamento requer Node 22.16 ou superior.

```
apps/server     Fastify + node:sqlite: API, rotinas de coleta, fichas, busca na web, admin
apps/server/extension   extensão do Chrome que abre as páginas das lojas
apps/web        React + Vite + Tailwind: o site e o admin
packages/shared tipos e regras puras usadas pelos dois lados (normalização, fichas,
                compatibilidade, desempenho, gargalo, sugestões, orçamento)
docs/           ARCHITECTURE.md (referência), PROJECT.md (este)
deploy/         serviços e scripts do servidor (fora do git)
```

**Como a loja é lida** (§4): um Chrome comum por loja, com perfil fixo em `data/chrome/<loja>`, e a extensão em `apps/server/extension`, que abre cada página numa aba, espera carregar, devolve o HTML e fecha a aba. Sem Playwright e sem porta de depuração. Os adapters (`apps/server/src/adapters/s1.ts`, `s2.ts`, `s3.ts`) só montam a URL e interpretam o HTML. Em cada loja, uma página por vez (rotina, varredura, fichas, busca na web e "Ler ficha" na mesma fila), com intervalo aleatório entre páginas, limite de páginas por hora e pausa automática quando a loja bloqueia.

**Fluxo de dados:**

1. A **rotina** lê as páginas de categoria de cada loja (caminhos configurados no admin) e grava cada anúncio em `listings` e as mudanças de preço em `price_points`. A **varredura completa** lê todas as páginas de todas as categorias (também de madrugada, `NIGHTLY_SWEEP_HOUR`, padrão 1h).
2. A **rotina de fichas** abre a página de produto de cada anúncio sem ficha completa, guarda o texto da ficha em `sheet_pages` e os campos lidos em `sheet_<categoria>`.
3. A **busca na web** pergunta à IA do Google o JSON da ficha dos produtos que as lojas não completaram (`sheet_web`); o admin completa à mão o resto (`sheet_manual`).
4. O **site** lê do banco: cada oferta sai com a ficha juntada do produto (`applySheets` em `apps/server/src/prices/offer-sheets.ts`), e as specs da ficha valem no lugar das lidas do título.

O site não consulta a loja na hora (a busca ao vivo existe, desligada por padrão).

---

## 5. Banco (SQLite, `data/upgradezin.db`)

Migrações por `PRAGMA user_version` em `apps/server/src/db/db.ts`: só acrescentar no fim, nunca editar uma que já rodou. Detalhe em §8.1.

| Tabela | Conteúdo |
|---|---|
| `meta` | chave/valor: pausas por loja, configuração das rotinas, intervalos por loja, categorias da varredura, marca do leitor de fichas (`sheet-reader`) |
| `listings` | um anúncio (loja + código): título, URL, chave de modelo, EAN, part number, a última oferta (JSON `Offer`), `product_key` (mesmo produto em outras lojas) e `group_key` |
| `price_points` | histórico: um ponto quando preço, cupom, oferta ou estoque mudam |
| `store_attempts` | cada consulta a uma loja (90 dias): origem, resultado, motivo de bloqueio, duração |
| `store_configs` | nome, site, caminhos e cores de cada loja (os nomes reais ficam só aqui, nunca no código) |
| `sheet_pages` | texto da ficha de cada página de produto lida (null: a página não tinha ficha) |
| `sheet_<categoria>` | os campos lidos de cada página, uma coluna por campo de `SHEET_FIELDS`; as colunas seguem a lista (o servidor cria e apaga ao subir) |
| `sheet_web` | perguntas e respostas da busca na web, por produto e campo |
| `sheet_web_transition` | situação da ficha antes e depois de cada consulta registrada (migração 16) |
| `sheet_manual` | campos preenchidos à mão no admin (têm prioridade) |
| `sheet_completion` | fichas concluídas manualmente por categoria e produto (migração 15) |
| `page_errors` | páginas de produto que deram erro (fora da fila de fichas por 6 h; com 2 falhas seguidas, a oferta sai do app) |
| `shared_builds` | montagens compartilhadas por link |

Tabelas antigas (`search_terms`, `term_runs`, `listing_terms`, `parts`, `part_codes`, `product_sheets`) foram removidas por migrações.

**No navegador** (localStorage, só da pessoa): montagem e marcações Já Tenho (`upgradezin.build.v1`), perfil lido do CPU-Z (`upgradezin.pc.v1`, só os dados tratados, nunca o arquivo), categoria e filtros (`upgradezin.ui.v1`), últimas buscas por orçamento (`upgradezin.budget.v1`). Com o login planejado, o PC atual e as montagens vão para a conta.

---

## 6. Regras de negócio

**Lojas e ofertas**
- Três lojas, identificadas só como **S1, S2, S3** no código, na documentação e nos commits. Nomes, domínios e caminhos ficam em `store_configs`, editados no admin.
- Só produto novo da própria loja; marketplace e open box escondidos por padrão.
- Preço que vale: à vista com cupom (`effectiveCash`).
- Produto = anúncios com o mesmo `product_key`: mesmo part number, EAN, chave do título ou assinatura de placa de vídeo (§6.2).

**Catálogo**
- Processadores Threadripper, Xeon, EPYC e Opteron ficam fora (plataformas de workstation/servidor que o app não conhece; rendem menos em jogos).
- "Gabinete ATX" na busca são os gabinetes onde uma placa ATX **cabe** (incluindo os que aceitam E-ATX).

**Fichas técnicas** (§8.3)
- Cada categoria tem campos fixos (`packages/shared/src/sheet/fields.ts`), **principais** (sem eles a ficha está incompleta) e **opcionais**.
- Junção campo a campo: à mão > páginas das lojas > título > web > estimativa > padrão da categoria.
- **"Não tem" × "não sei":** campo que o produto pode não ter tem um valor de "não tem" (`none`: "Não", 0 ou false); vazio é "não sei". O "não tem" automático cede para um valor de verdade de outra fonte; o à mão vale contra tudo.
- Fila: a rotina abre só páginas de produto sem ficha completa; a busca na web pergunta de produto com campo vazio (principal ou opcional) ainda não perguntado. A fila prioriza oferta nova da própria loja em estoque, depois oferta nova da própria loja sem estoque e por fim as demais. Dentro de cada grupo, campos principais têm preferência. O admin mostra a quantidade por prioridade. O pedido inclui somente as lacunas e orienta a conferir o modelo exato em manuais e datasheets; o que nem a web completa vai para a revisão manual ("precisa de você").
- Mudou o leitor ou a lista de campos: sobe `READER_VERSION` (`packages/shared/src/sheet/read.ts`, hoje 15) e o servidor relê todas as páginas guardadas ao subir, sem abrir as lojas.

**Compatibilidade** (`packages/shared/src/compat.ts`, §17.1.1)
- Erro (não funciona), ressalva, "não deu para confirmar" e observação; nunca vira "ok" por padrão.
- Confere: soquete; chipset × geração (incluindo "precisa de BIOS"); DDR4/DDR5; slots de memória; memória máxima da placa; MHz da placa e do processador; vídeo integrado; cooler × soquete e TDP; gabinete × placa-mãe; comprimento da placa de vídeo, altura do cooler e radiador × gabinete; slots M.2 e portas SATA; placa de vídeo x8 em PCIe 3.0; fonte × consumo (com a recomendação do fabricante da placa de vídeo como piso); conector de 16 pinos.
- Memória abaixo de 32 GB é **observação**, não pendência: 32 GB é o recomendado.
- Peças que já funcionam juntas no PC importado não geram aviso entre si (exceto a fonte).

**Sugestões de upgrade**
- Nunca sugerir placa de vídeo com **menos memória de vídeo** que a atual (seria downgrade), nem placa sem essa informação.
- Cada dica e o orçamento mostram **3 opções** (1ª, 2ª e 3ª).

---

## 7. Algoritmos

### 7.1 Desempenho em jogos (`packages/shared/src/perf.ts`, `cpuScore.ts`)
- **Placa de vídeo:** tabela por chip (`GPU_PERF`), média de análises em 1080p; RTX 3060 12 GB = 100.
- **Processador:** pela ficha, quando tem os campos: IPC da arquitetura × clock máximo / 4,4 × fator de cache L3 (X3D com L3 ≥ 96 MB ×1,28; AMD com L3 ≤ 16 MB ×0,9) × fator de núcleos. Sem ficha, a tabela por linha e geração (`cpuPerf`). Ryzen 5 5600 = 100. O IPC por arquitetura é uma tabela no código (não um campo da ficha).
- **Equilíbrio:** `cpuNeeded(gpu, resolução, hz)` = (60 + 0,4 × gpu × fator da resolução) × 1,05 se ≥ 120 Hz; fator 1 (1080p), 0,8 (1440p), 0,62 (4K). `gpuMatching` é o inverso. Processador ÷ o que a placa pede ≥ 1,2: a placa de vídeo é o gargalo; ≤ 0,8: o processador.

### 7.2 Gargalo e dicas (`packages/shared/src/upgrade.ts`, §17.3)
A partir do PC importado e da ficha do processador (GET `/api/sheets/cpu`): veredito, placas de vídeo na faixa do que o processador aguenta (cabendo na fonte, com aviso de banda PCIe quando aplicável), processador do mesmo encaixe ou troca de plataforma, memória (XMP, single channel, 32 GB), disco do sistema, monitor, fonte, erros WHEA.

### 7.3 Melhores ofertas de cada dica (`packages/shared/src/picks.ts`)
Do banco (cache de 1 min): processador e placa de vídeo, uma por modelo, só as compatíveis (chipset, fonte, memória de vídeo mínima); primeiro as que resolvem o gargalo (≥ 90% do equilíbrio), da mais barata, depois mais desempenho por real; ganho mínimo de 15%. Memória, fonte e SSD: as mais baratas que servem. 3 por dica.

### 7.4 Montar pelo orçamento (`packages/shared/src/budget.ts`, §17.4)

Os perfis disponíveis são Jogos, Jogos e Trabalho e Produtividade. Nos dois perfis com trabalho, o pedido pode distinguir cargas de CPU de cargas com aceleração gráfica. A auditoria local ampliada mede a progressão de orçamento e a resposta da recomendação a mudanças no catálogo, mantendo o relatório original de 120 cenários como referência.

A montagem usa referências locais de CPU por modelo e ajustes de GPU por resolução. A metodologia, as fontes e os resultados da comparação com o catálogo local estão na seção 17.4 da arquitetura.
- Percorre pares de CPU e GPU, preserva variantes e compara 16 e 32 GB com SSDs de 500 GB, 1 TB e 2 TB. Jogos e Trabalho e Produtividade também avaliam 64 GB e SSD de 4 TB. Dimensiona refrigeração, fonte e placa-mãe a partir da potência estimada, características físicas e evidência disponível. Verifica se o cooler acompanha a variante anunciada.
- Com placa dedicada, combina o teto estimado da CPU com a nota de GPU em cada resolução. Entre opções de desempenho próximo, compara custo e benefícios marginais de RAM, SSD e peças de apoio conforme o perfil. As alternativas mostram diferenças de preço, capacidade ou ganho estimado.
- PC Comprável Agora usa estoque observado nas últimas 24 horas. PC Ideal também aceita o último preço em estoque registrado em até 90 dias, marcado como histórico na peça e no total.
- Marcas com **prioridade, não exclusividade** (`BUDGET_BRANDS`): produto de outra marca conta como mais caro na escolha (fonte +70%, memória +30%, placa de vídeo +20%, placa-mãe +15%).
- Upgrade: cada peça fica ou sai; só sugere troca que renda ≥ 10%; reaproveita a memória quando serve.

### 7.5 Leitor de fichas (`packages/shared/src/sheet/`)
`sheetText` transforma o bloco de especificações em linhas; `readSheet` procura os rótulos de cada campo e padrões no texto; nunca chuta. `readTitle` tira campos do título. `parseWebReply` lê o JSON da IA e valida tipo, opções e faixa; confiança baixa não entra.

### 7.6 Busca e opções do formulário
Cada opção do formulário gera um termo; `termMatches` decide pelas specs (não pelo texto) se o anúncio é do termo. `searchOptionCounts` conta produtos em estoque por opção (valores extras só com ≥ 3 produtos).

---

## 8. Decisões técnicas (e por quê)

ADRs completos em ARCHITECTURE §15. As principais:

| Decisão | Por quê |
|---|---|
| Self-hosted, um processo, `node:sqlite` | Poucos usuários; sem serviço de banco para manter; backup é um arquivo |
| Chrome comum + extensão, uma página por vez por loja | Volume de pessoa; nada de automação detectável; respeitar as lojas |
| **Sem evasão de detecção** | Bloqueio vira pausa automática da loja; captcha e verificações nunca são burlados nem clicados automaticamente |
| Site lê do banco (rotina + varredura), não da loja na hora | Resposta instantânea e carga previsível nas lojas |
| Ficha por categoria, uma tabela por categoria com colunas fixas | Filtrar e conferir compatibilidade por campo; reler tudo quando o leitor muda |
| Guardar o texto da ficha | Novos campos e correções do leitor sem abrir as lojas de novo |
| Desempenho por tabela + ficha, não benchmark próprio | Ordem de grandeza suficiente para gargalo e sugestão; manutenção simples |
| Lojas como S1/S2/S3 | Repositório público sem nome de loja; nomes só no banco |
| Sem marketplaces | Risco de usado/defeito como novo (ADR-003) |
| Cooler sem altura fica com a web | Produto que nem a ficha nem a web informam é de procedência duvidosa |
| Marca com prioridade, não exclusividade | Evitar peça "bomba" sem esconder oferta boa de verdade |
| CPU-Z lido só no navegador | Privacidade: o relatório nunca vai ao servidor |
| Sem cadastro (por enquanto) | Montagem e PC no navegador; login com Google planejado |

---

## 9. Preferências de desenvolvimento (do mantenedor)

- **Idioma:** conversas, textos do site, comentários e documentação em **português do Brasil**, frases naturais. Mensagens de commit em inglês.
- **Commits:** agentes **nunca** fazem `git commit` nem push. Sugerir a mensagem; o mantenedor commita. A mensagem termina com `Co-Authored-By: <modelo> <noreply@anthropic.com>` quando gerada por IA.
- **Nunca citar o nome das lojas** em commits, código ou documentação: só S1, S2, S3.
- **Sempre com testes:** toda mudança vem com teste (Vitest). Rodar a suíte da **raiz** do repositório: `npx vitest run --reporter=json --outputFile=.vitest/full.json` (o JSON padrão em `.vitest/json/` pode estar velho), mais `pnpm -r typecheck` e `pnpm --filter web build`.
- **Estilo de código:** TypeScript estrito, aspas simples, linhas longas (até ~200 colunas); comentários explicam o porquê, em português. Não há Prettier configurado: rodar Prettier sem as opções muda o estilo do repositório inteiro (se usar: `--single-quote --print-width 200`, só nos arquivos novos).
- **Textos do site:** botões e títulos em Title Case em português ("Levar para a Montagem"); nunca texto técnico na tela (o servidor manda códigos, a interface escolhe a frase).
- **Respostas:** diretas; quando o mantenedor diz "só responde", responder curto, sem mexer em código.
- **Servidor:** parar o serviço antes de escrever no banco do servidor; a senha de sudo nunca é guardada; o mantenedor reinicia o serviço; o repositório precisa continuar **público** (o deploy faz `git pull` sem credencial) e o túnel de acesso precisa continuar funcionando; `.env` e `data/` nunca vão para o git.
- **Privacidade:** dados pessoais do mantenedor nunca em requisições a serviços externos.

---

## 10. Problemas conhecidos

| Problema | Efeito | Situação |
|---|---|---|
| Queda de internet vira "página com erro" | Produtos bons ficam 6 h fora da fila de fichas; se pegar o mesmo produto duas vezes, ele sai do site até a página abrir | Correção proposta, não feita: 3 erros seguidos na mesma loja = rede fora, apagar os erros da sequência e pausar a loja ~10 min |
| Admin arredonda o progresso das fichas para 100% com itens na fila | Confunde (os itens podem estar parados por erro) | Mostrar "X com erro, voltam às HH:MM" e não arredondar para 100% |
| As ofertas das dicas (`picks.ts`) têm ranking próprio | Duas lógicas de escolha (dicas e orçamento) | Unificar com o motor do orçamento |
| Texto da dica de placa de vídeo cita chips sem saber a memória de vídeo de cada um | A frase pode citar um chip sem versão com memória suficiente (as ofertas e a busca já filtram) | Falta uma tabela de memória de vídeo por chip |
| Orçamento ainda em refino | Disponível na tela inicial e no Identificar Gargalo | Refinar: preço acima do normal, qualidade por modelo, mais avaliações |
| Memória e SSD caros nas lojas (nov/2026) | Montagens baratas saem sem placa de vídeo | Preço de mercado; nada a corrigir no motor |
| Processador sem informação de cooler na caixa (~100 ofertas) | O orçamento compra um cooler à parte por segurança | Ler da ficha quando houver |
| Campos opcionais pouco publicados (fases do VRM, cache DRAM) | Depois da web, podem encher a revisão manual | Se ficar demais: marcar campos que não vão para a revisão |
| Fila da web com ~7 mil perguntas depois dos campos novos | ~10 dias rodando no intervalo de 90–150 s | Esperado |
| Uma memória "32GB (2x16GB)" lida como 16 GB (XPG Spectrix D35G) | Caso isolado no leitor do título | A corrigir |
| Sem ESLint nem Prettier configurados | Estilo depende de quem escreve | Seguir o estilo dos arquivos vizinhos |

---

## 11. Melhorias planejadas

### Entregas da 1ª versão (ARCHITECTURE §14)
1. ~~Montar pelo orçamento~~ (disponível na tela inicial e no diagnóstico de gargalo).
2. ~~Comparador de hardware~~ (seleção por categoria, com desempenho estimado para processadores e placas de vídeo).
3. ~~Mais de um disco na montagem~~ (NVMe, SATA e discos importados do CPU-Z).

### Próximos passos

1. Subir a versão e conferir a criação automática das novas colunas e a releitura das fichas guardadas.
2. Validar com o catálogo de produção os fluxos de comparação, busca e montagem com vários discos. Corrigir o que aparecer nessa validação antes de fechar a 1ª versão.
3. Quando a complementação das fichas terminar, rodar a matriz ampliada de orçamento com um dump atualizado. Comparar com o JSON de referência antes de retomar a calibração.

### Depois do lançamento
4. **Login com Google** (gratuito; projeto no Google Cloud e tela de consentimento): PC importado, montagens, buscas por orçamento e alertas na conta; o que está no navegador sobe no primeiro login.
5. **Alerta de preço** (abaixo de um valor ou menor preço em 30 dias; e-mail para começar).

### Melhorias
- Cupons da S2 e da S3 (hoje só a S1).
- Frete por CEP, depois do login.
- Variantes do mesmo modelo por part number (cor, versão OC).
- Detectar queda de rede na rotina de fichas (seção 10).
- Marcar "preço acima do normal" pelo histórico de 30 dias (já está no banco).
- Refinar a calibração do Montar pelo Orçamento e ampliar as referências de desempenho sustentado por modelo.
- Usar mais campos da ficha no ranking, como BIOS Flashback na placa-mãe e cache DRAM e TBW no SSD.

---

## 12. Como trabalhar

```bash
pnpm install
pnpm dev                 # servidor (8787) + site (Vite)
npx vitest run --reporter=json --outputFile=.vitest/full.json   # suíte (da raiz)
pnpm -r typecheck
pnpm --filter web build
```

- **Configuração:** `.env` (modelo em `.env.example`). Nunca commitar `.env` nem `data/`.
- **Deploy:** no servidor, `bash deploy/update.sh` (`git pull --ff-only`, `pnpm install --frozen-lockfile`, `pnpm build`) e o mantenedor reinicia o serviço (`sudo systemctl restart upgradezin`). A pasta `deploy/` fica fora do git (só existe no servidor e na máquina do mantenedor).
- **Lançar versão:** `pnpm release` (ver README, seção "Versões").
- **Onde mexer:**

| Assunto | Arquivo |
|---|---|
| Campos da ficha | `packages/shared/src/sheet/fields.ts` |
| Leitor da ficha (página, título, web) | `packages/shared/src/sheet/read.ts`, `title.ts`, `web.ts` |
| Junção da ficha, filas | `apps/server/src/prices/sheets.ts`, `sheet-routine.ts`, `web-fill.ts` |
| Ficha nas ofertas do site | `apps/server/src/prices/offer-sheets.ts`, `packages/shared/src/sheet/specs.ts` |
| Compatibilidade | `packages/shared/src/compat.ts`, `hardware.ts` |
| Desempenho, gargalo, dicas | `packages/shared/src/perf.ts`, `cpuScore.ts`, `upgrade.ts`, `picks.ts` |
| Orçamento | `packages/shared/src/budget.ts`, `apps/server/src/budget.ts`, `apps/web/src/components/BudgetView.tsx` |
| Lojas | `apps/server/src/adapters/s1.ts`, `s2.ts`, `s3.ts`, `stores.ts`, `browser.ts`, `pace.ts` |
| Rotas da API | `apps/server/src/index.ts`, `apps/server/src/admin/routes.ts` |
| Site | `apps/web/src/App.tsx` e `apps/web/src/components/` |
