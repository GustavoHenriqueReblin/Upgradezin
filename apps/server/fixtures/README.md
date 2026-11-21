# Fixtures das lojas

Recortes **anonimizados** de páginas reais de busca, usados pelos testes dos parsers (`src/adapters/*.test.ts`) e pelo teste das três lojas pelo mesmo caminho (`src/adapters/load.test.ts`, que troca o Chrome por estas páginas com `usePageLoader`). Nenhum teste acessa as lojas.

| Arquivo | Origem | O que cobre |
|---|---|---|
| `s1-psu.html` | busca "fonte 750w" | `__NEXT_DATA__` com `data` em string JSON, selo de cupom, marketplace |
| `s1-motherboard.html` | busca "placa mae b550" | itens fora da categoria (kit, PC montado, acessório), selo que não é cupom |
| `s1-product.html` | página de produto | texto do selo de cupom com a porcentagem |
| `s2-psu.html` | busca "fonte 750W" | payload RSC em dois `self.__next_f.push`, cupom no nome da categoria, sem estoque, potência estruturada |
| `s2-motherboard.html` | busca "placa mae B550" | open box fora da categoria, socket deduzido do chipset |
| `s3-psu.html` | busca "fonte 750W" | cards `data-tss-*`, etiqueta de cupom, esgotado sem parcelamento |
| `s3-motherboard.html` | busca "placa mae B550" | formato pelo sufixo do modelo, cupom de 5% |
| `s1-cpu.html` | busca "processador" | specs completas, part number cortado (i5/i7 com o mesmo código), plataforma antiga descartada |
| `s1-gpu.html` | busca "placa de video" | chip/VRAM/tipo, acessório descartado pela categoria, marketplace com título "Gpu …" |
| `s1-ram.html` | busca "memoria ram" | kit 2x16 com RGB e cor, notebook e DDR3 descartadas |
| `s1-ssd.html` | buscas "ssd nvme" e "ssd sata" | NVMe com geração e leitura, SATA 2,5", "HD SSD", SSD com dissipador; dissipador avulso, case externo e SSD de servidor descartados |
| `s1-cooler.html` | buscas "cooler processador" e "water cooler" | air e water (radiador), encaixes listados, TDP; kit com processador (pela categoria), ventoinha e tela de monitoramento descartados |
| `s1-case.html` | busca "gabinete" | formato citado, pela torre e ausente, vidro, fans; tela de monitoramento descartada |
| `s2-cpu.html` | busca "processador" | formato "8-Core, 16-Threads", Core Ultra |
| `s3-cpu.html` | busca "processador" | cooler dito no título, LGA1155 e cooler avulso descartados |
| `s3-gpu.html` | busca "placa de video" | placa profissional descartada, GDDR ausente (DDR3), mesma placa da S1 |

## Regras

- **Sem identificar a loja:** domínios trocados por `s1.example`, `s2.example`, `s3.example`; nomes da loja por `S1`/`S2`/`S3`; códigos de campanha por códigos genéricos. Os testes usam lojas fictícias com esses domínios (`src/test-setup.ts`).
- **Mínimo necessário:** poucos itens por arquivo e só os campos que os parsers leem. Nada de scripts, cookies, tokens ou metadados de sessão.
- Os valores (preço, estoque, cupom) são os da data da coleta e não mudam: os testes conferem a leitura, não o preço atual.
- A estrutura em volta dos dados (`<script id="__NEXT_DATA__">`, `self.__next_f.push([1,"…"])`, classes dos cards da S3) é a mesma do site.

## Quando uma loja muda o layout

1. Rode com `DEBUG_DUMPS=true` para guardar em `data/debug/` a página que falhou, exatamente como a extensão a leu no Chrome da loja (o DOM depois de carregar), ou salve a página de busca no navegador (Ctrl+S, "somente HTML").
2. Recorte alguns itens com os campos usados, anonimize (domínio, nome da loja, códigos de campanha) e substitua o arquivo aqui.
3. Ajuste o parser até os testes passarem; acrescente um teste para o caso novo.
