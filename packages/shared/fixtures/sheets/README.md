# Fichas técnicas (fixtures)

Usadas por `packages/shared/src/specsheet.test.ts`. Cada arquivo é só o HTML do campo da ficha técnica de uma página de produto da S1 (o texto que o fabricante ou a loja cadastrou), sem o resto da página: nada de nome, domínio, preço ou dados de sessão da loja.

| Arquivo | Cobre |
|---|---|
| `gpu.html` | "Dimensões:" numa linha e as medidas na seguinte (o maior lado é o comprimento), part number em "Modelo" |
| `case.html` | comprimento máximo da placa de vídeo, altura máxima do cooler, radiadores por posição (sem confundir com as ventoinhas) |
| `cooler.html` | ficha sem a altura do dissipador (só a medida do fan, que não vale), part number |
