/* Caderno de Gastos — gráficos acessíveis feitos à mão. Cada um traz resumo em texto e tabela de dados.
   Barras horizontais e de progresso são HTML/CSS (texto real); colunas e linha são SVG. Cor nunca é o único sinal. */
window.CGCharts = (() => {
  const { esc, brl } = CG;
  const table = (heads, rows, cap) => `<details class="dt"><summary>Ver tabela de dados</summary><table><caption class="sr-only">${esc(cap)}</caption><thead><tr>${heads.map(h => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></details>`;

  /* barras horizontais ordenadas: items [{label, value, color, extra}] */
  function bars(items, o = {}) {
    const total = items.reduce((s, i) => s + Math.max(0, i.value), 0), max = Math.max(1, ...items.map(i => Math.abs(i.value)));
    if (!items.length) return "";
    const li = items.map(i => `<li><span class="bl">${esc(i.label)}${i.extra ? `<small>${esc(i.extra)}</small>` : ""}</span><span class="bt" aria-hidden="true"><span class="bf" style="width:${Math.max(1, Math.round(Math.abs(i.value) / max * 100))}%;background:${i.color || "var(--accent)"}"></span></span><span class="bv">${brl(i.value)}${total > 0 && i.value > 0 ? ` · ${Math.round(i.value / total * 100)}%` : ""}</span></li>`).join("");
    const sum = o.summary || `${items.length} itens; maior: ${items[0].label}, ${brl(items[0].value)}.`;
    return `<figure class="ch"><figcaption class="sr-only">${esc(sum)}</figcaption><ol class="bars">${li}</ol>${table(["Item", "Valor", "Parte do total"], items.map(i => [i.label, brl(i.value), total > 0 && i.value > 0 ? Math.round(i.value / total * 100) + "%" : "—"]), o.title || "Dados do gráfico")}</figure>`;
  }

  /* progresso por meta: items [{label, spent, meta, color}] → estado em texto + padrão */
  function progress(items) {
    if (!items.length) return "";
    const li = items.map(i => {
      const pct = i.meta > 0 ? i.spent / i.meta : 0, st = pct >= 1 ? "over" : pct >= .8 ? "warn" : "ok", txt = st === "over" ? "Estourou a meta" : st === "warn" ? "Atenção: acima de 80%" : "Dentro da meta";
      return `<li class="pr ${st}"><span class="bl">${esc(i.label)}<small>${brl(i.spent)} de ${brl(i.meta)} · ${Math.round(pct * 100)}%</small></span><span class="bt" aria-hidden="true"><span class="bf" style="width:${Math.min(100, Math.round(pct * 100))}%"></span><i class="mk"></i></span><span class="bv st">${txt}</span></li>`;
    }).join("");
    return `<figure class="ch"><ol class="bars">${li}</ol>${table(["Categoria", "Gasto", "Meta", "Uso"], items.map(i => [i.label, brl(i.spent), brl(i.meta), (i.meta > 0 ? Math.round(i.spent / i.meta * 100) : 0) + "%"]), "Orçamento por categoria")}</figure>`;
  }

  /* colunas com linha de média: items [{label, value}] */
  function columns(items, o = {}) {
    if (!items.length) return "";
    const W = 640, H = 240, pl = 8, pr = 8, pt = 26, pb = 34, n = items.length, bw = Math.min(56, (W - pl - pr) / n * .62), step = (W - pl - pr) / n;
    const max = Math.max(1, ...items.map(i => i.value)), y = v => pt + (H - pt - pb) * (1 - Math.max(0, v) / max), avg = o.avg != null ? o.avg : items.reduce((s, i) => s + i.value, 0) / n;
    const bs = items.map((i, k) => { const x = pl + step * k + (step - bw) / 2, yy = y(i.value), cur = i.current; return `<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, H - pb - yy).toFixed(1)}" rx="3" class="col${cur ? " cur" : ""}"/><text x="${(x + bw / 2).toFixed(1)}" y="${(yy - 6).toFixed(1)}" text-anchor="middle" class="cv">${esc(CG.brl(i.value).replace(",00", ""))}</text><text x="${(x + bw / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="cl">${esc(i.label)}</text>`; }).join("");
    const sum = o.summary || `Gasto por mês: ${items.map(i => i.label + " " + brl(i.value)).join("; ")}. Média: ${brl(avg)}.`;
    return `<figure class="ch"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(sum)}" class="svg">${bs}<line x1="${pl}" x2="${W - pr}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}" class="avg"/><text x="${W - pr}" y="${(y(avg) - 5).toFixed(1)}" text-anchor="end" class="cv">média ${esc(brl(avg))}</text></svg>${table(["Mês", "Total"], items.map(i => [i.label, brl(i.value)]), "Gasto por mês")}</figure>`;
  }

  /* linha acumulada do mês atual (cheia) vs anterior (tracejada) */
  function cumLine(cur, prev, days, o = {}) {
    const W = 640, H = 180, pl = 8, pr = 8, pt = 14, pb = 24, max = Math.max(1, cur[cur.length - 1] || 0, prev[prev.length - 1] || 0);
    const x = d => pl + (W - pl - pr) * (d - 1) / Math.max(1, days - 1), y = v => pt + (H - pt - pb) * (1 - v / max);
    const path = a => a.map((v, i) => `${i ? "L" : "M"}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const sum = o.summary || "Gasto acumulado ao longo do mês.";
    return `<figure class="ch"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(sum)}" class="svg">${prev.length ? `<path d="${path(prev)}" class="ln prev"/>` : ""}<path d="${path(cur)}" class="ln"/><text x="${pl}" y="${H - 6}" class="cl">dia 1</text><text x="${W - pr}" y="${H - 6}" text-anchor="end" class="cl">dia ${days}</text></svg><p class="legend"><span class="lg cur">Este mês (linha cheia)</span>${prev.length ? `<span class="lg prv">Mês anterior (tracejada)</span>` : ""}</p></figure>`;
  }
  return { bars, progress, columns, cumLine, table };
})();
