# CLAUDE.md

As instruções para agentes estão em [AGENTS.md](AGENTS.md), e a visão consolidada do projeto em [docs/PROJECT.md](docs/PROJECT.md). Leia os dois antes de mexer; a referência detalhada é [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

@AGENTS.md

Resumo do que mais importa:

- Nunca `git commit` nem push: sugira a mensagem em inglês, terminando com a linha `Co-Authored-By` do modelo.
- Lojas só como S1, S2, S3 (nunca o nome) em código, documentação e commits.
- Toda mudança com teste; suíte da raiz com `npx vitest run --reporter=json --outputFile=.vitest/full.json`, mais `pnpm -r typecheck` e `pnpm --filter web build`.
- Converse e escreva em português do Brasil; quando o mantenedor disser "só responde", responda curto e não mexa em código.
