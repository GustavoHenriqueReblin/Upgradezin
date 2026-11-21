# Relatórios do CPU-Z (fixtures)

Usados por `packages/shared/src/cpuz.test.ts` e `apps/web/src/pc.test.ts`.

| Arquivo | Origem | Cobre |
|---|---|---|
| `amd-am4-rx6600.txt` | relatório real (CPU-Z 2.17), recortado e anonimizado | AMD AM4, DDR4 com XMP rodando abaixo dele, Radeon, HD + SSD SATA + NVMe, fabricante da placa "Default string", pentes repetidos só com registradores |
| `intel-lga1700-rtx4060ti.txt` | montado no mesmo formato, valores de exemplo | Intel LGA1700, DDR5 com XMP, GeForce, fabricante por extenso, pendrive (fica fora) |

## Recortar um relatório novo

Ficam só as seções que o leitor usa: `Binaries`, `Processors Information` (primeiro bloco), `Chipset`, `Memory SPD`, `DMI` (`DMI BIOS`, `DMI Baseboard`, `DMI Physical Memory Array`, `DMI Memory Device`), `Storage`, `Graphics`, `Display Adapters` e `Software` (até `WHEA errors`).

Antes de versionar, troque por `XXXXXXXX` ou `(removido)`: números de série, UUID, `Device Path`, datas (fabricação, BIOS, instalação do Windows, WHEA), endereços físicos e o modelo e o ID do monitor. Mantenha os TABs e as linhas de traços.
