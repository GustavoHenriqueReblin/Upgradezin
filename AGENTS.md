# AGENTS.md

Instruções para agentes de código que trabalham no Upgradezin (buscador de preços e assistente de montagem/upgrade de PC para o varejo brasileiro de hardware).

## Leia antes de mexer

1. [docs/PROJECT.md](docs/PROJECT.md): visão consolidada. Objetivos, estado atual, o que está implementado e o que é planejado, arquitetura, banco, regras de negócio, algoritmos, decisões, preferências do mantenedor, problemas conhecidos e roadmap.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): referência detalhada (coleta, fichas, compatibilidade, gargalo, orçamento, ADRs, roadmap em §14).
3. [CHANGELOG.md](CHANGELOG.md): o que mudou; `[Não lançado]` é o que está no código e ainda não virou versão.

## Regras que não se negociam

- **Nunca faça `git commit` nem push.** Sugira a mensagem (em inglês); o mantenedor commita.
- **Nunca escreva o nome das lojas** em código, documentação ou commit: só **S1**, **S2**, **S3**. Os nomes ficam no banco do servidor.
- **Toda mudança vem com teste.** Rode da raiz: `npx vitest run --reporter=json --outputFile=.vitest/full.json`, `pnpm -r typecheck` e `pnpm --filter web build`.
- **Sem evasão de detecção nas lojas:** uma página por vez por loja, pausa quando a loja bloqueia; nunca burle nem clique automaticamente em captcha ou verificação.
- **Nada de dados pessoais** do mantenedor em requisições a serviços externos. `.env` e `data/` nunca vão para o git.
- **Servidor de produção:** não escreva no banco com o serviço rodando; a senha de sudo nunca é guardada; o mantenedor reinicia o serviço. O repositório precisa continuar público (o deploy faz `git pull` sem credencial) e o túnel de acesso precisa continuar funcionando.

## Convenções

- Português do Brasil em textos do site, comentários e documentação; frases naturais. Botões e títulos do site em Title Case ("Levar para a Montagem"); nunca texto técnico na tela.
- TypeScript estrito, aspas simples, linhas de até ~200 colunas, comentários que explicam o porquê. Não rode Prettier sem opções (muda o estilo do repositório inteiro).
- Mudou o leitor de fichas ou a lista de campos: suba `READER_VERSION` em `packages/shared/src/sheet/read.ts` (o servidor relê as páginas guardadas ao subir).
- Migrações do banco: só acrescente no fim de `apps/server/src/db/db.ts`; nunca edite uma que já rodou.
- Ao mudar comportamento, atualize o CHANGELOG (`[Não lançado]`) e a seção correspondente da ARCHITECTURE e, se mudar o estado do projeto, o docs/PROJECT.md.
