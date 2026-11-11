# Caderno de Gastos

Anote gastos por **foto da nota**, digitando ou importando planilha. Planilha Excel, **versões** e **relatórios**. Tudo no navegador: gastos, fotos e senhas nunca são enviados a servidores.

Parte do [VF Tools](https://vitorfariasvf.github.io/VF-Tools/). Segue o [padrão de design](https://github.com/VitorFariasVF/VF-Tools/blob/Main/DESIGN.md) do site.

## Como funciona
1. **Fotografe a nota** (câmera do celular ou galeria). O QR Code da nota fiscal (NFC-e) é lido quando o navegador permite e preenche CNPJ e mês. Você **confere** os campos ao lado da foto e salva em um toque. A leitura nunca salva sozinha.
2. **Ou digite** (valor primeiro, data de hoje, última categoria) **ou importe** uma planilha `.xlsx`/`.csv` (as colunas são reconhecidas e você pode ajustar).
3. **Veja os relatórios**: painel do mês, por categoria, por estabelecimento, evolução mensal, orçamento por categoria (alerta a 80% e 100%) e gastos recorrentes. Filtros por mês e categoria; “Baixar PDF” usa a impressão do navegador.
4. **Faça backup**: baixe a planilha. Ela tem as abas Gastos, Categorias, Resumo mensal, Histórico e uma aba oculta `_meta`. Dá para editar no Excel e importar de volta (ids estáveis, lista suspensa de categoria, datas e valores reais).

## Versões
Uma versão é uma cópia completa dos gastos e categorias (sem fotos). O caderno guarda uma por dia de uso, uma **antes de importar** e uma **antes de restaurar** (mantém as 30 automáticas mais recentes e todas as salvas por você). É possível comparar duas versões (adicionados, removidos, alterados) e restaurar. Restaurar nunca perde o estado atual.

## Dados e privacidade
- Gastos, categorias, fotos e versões ficam no **IndexedDB** do navegador. O app pede armazenamento persistente.
- **Fotos** vêm desmarcadas para guardar (podem mostrar CPF); a foto fica reduzida (até 1600 px). Elas não vão na planilha; o “Backup completo” (.zip) inclui a pasta `fotos/`.
- Se o navegador limpar os dados do site, só a planilha baixada protege o caderno. O app avisa quando há alterações sem backup.
- Seus gastos e fotos nunca são enviados. Ao abrir a página, o navegador baixa o CSS e os scripts do Doggy/animações compartilhados do site VF Tools (vitorfariasvf.github.io), o que revela seu IP a esse site; depois de carregada (service worker), a ferramenta abre sem internet.
- “Apagar tudo” pede para digitar APAGAR e oferece baixar a planilha antes. As versões de segurança (antes de importar/restaurar) ficam limitadas às 10 mais recentes.

## Importar planilhas
- Reconhece cabeçalhos como Data, Valor, Descrição/Estabelecimento, Categoria, Pagamento, Anotação, id. Valores como `R$ 1.234,56`, `1234.56` e `(50,00)` (estorno) e datas `dd/mm/aaaa`, `aaaa-mm-dd` ou do Excel.
- Antes de importar, mostra: novos, atualizados, em conflito (o caderno tem versão mais nova), possíveis duplicados, sem mudança e linhas com erro.
- Linhas com `id` conhecido atualizam **só as colunas que vieram na planilha** (o resto do gasto fica como está). Se a planilha não traz “Alterado em” (ou o caderno tem versão mais nova), a linha fica “em conflito” e só muda se você marcar a opção. Sem `id`, entram como novos (duplicados por data+valor+local ficam de fora, a menos que você marque).
- CSV em UTF-8 ou Windows-1252 (Excel/bancos) é reconhecido.

## Limites e observações
- **QR Code**: depende do `BarcodeDetector` (Chrome/Edge/Android). Em outros navegadores a foto serve de comprovante e os dados são digitados.
- A chave de acesso do QR **não traz o valor**; só algumas URLs trazem. O valor total é sempre conferido por você.
- OCR do texto da foto (opcional, sob demanda) ainda não está incluído.

## Estrutura
| Arquivo | Para quê |
|---|---|
| `index.html`, `app.css`, `app.js` | Telas e lógica |
| `lib.js` | Dinheiro em centavos, datas, CSV, CNPJ |
| `db.js` | IndexedDB e controle de versões |
| `xlsx.js` | Escrita/leitura de `.xlsx` e `.zip` sem biblioteca |
| `qr.js` | Foto reduzida, QR Code da nota |
| `charts.js` | Gráficos acessíveis (barras, colunas, linha, progresso) |
| `sw.js`, `manifest.webmanifest` | Modo offline e instalação como app |

## Rodar localmente
```bash
python3 -m http.server 8770
# abra http://localhost:8770
```

## Verificar a identidade
```bash
node VF-Tools/scripts/check-identity.js index.html
```
