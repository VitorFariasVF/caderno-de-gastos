/* Caderno de Gastos — anote gastos por foto, digitando ou importando planilha. Excel, versões e relatórios.
   Tudo roda no navegador: dados no IndexedDB, nada é enviado a servidor. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const { esc, brl, norm, uid } = CG, T = window.VFTool;
  const PAGS = ["Pix", "Débito", "Crédito", "Dinheiro", "Boleto", "Outro"];
  const PALETTE = ["#7dd3c0", "#f4a3a3", "#a9b8ff", "#f0b254", "#86efac", "#fdba74", "#c4a7e7", "#9ccfd8", "#e0b1cb", "#b8c0a0"];
  const DEFAULT_CATS = [["Mercado", 0], ["Restaurante", 1], ["Transporte", 2], ["Moradia", 3], ["Saúde", 4], ["Lazer", 5], ["Educação", 6], ["Contas", 7], ["Compras", 8], ["Outros", 9]];
  const S = { gastos: [], cats: [], meta: {}, view: "", f: { mes: "", cat: "", q: "" }, lim: 50, sel: new Set(), queue: [], qTotal: 0, edit: null, photo: null, undoFn: null, r: { mes: "", cat: "" } };

  /* ---------- avisos ---------- */
  const live = $("#live"), say = m => { live.textContent = ""; setTimeout(() => { live.textContent = m; }, 30); };
  const alertBox = $("#alert");
  const showAlert = m => { alertBox.className = "state error"; alertBox.innerHTML = `<p>${esc(m)}</p><button class="link" type="button" id="alert-x">Dispensar</button>`; alertBox.hidden = false; $("#alert-x").onclick = () => { alertBox.hidden = true; }; };
  let undoTimer = null;
  function showUndo(text, fn) {
    S.undoFn = fn; $("#undo-t").textContent = text; $("#undo").hidden = false; document.body.classList.add("has-undo"); say(text + " Para desfazer, use o botão Desfazer.");
    clearTimeout(undoTimer); undoTimer = setTimeout(hideUndo, 8000);
  }
  function hideUndo() { $("#undo").hidden = true; S.undoFn = null; document.body.classList.remove("has-undo"); }
  $("#undo").addEventListener("mouseenter", () => clearTimeout(undoTimer)); $("#undo").addEventListener("focusin", () => clearTimeout(undoTimer));
  $("#undo").addEventListener("focusout", () => { clearTimeout(undoTimer); undoTimer = setTimeout(hideUndo, 6000); });
  $("#undo").addEventListener("mouseleave", () => { clearTimeout(undoTimer); undoTimer = setTimeout(hideUndo, 4000); });
  $("#undo-b").addEventListener("click", async () => { const f = S.undoFn; hideUndo(); if (f) { await f(); say("Desfeito."); } });

  /* ---------- dados ---------- */
  function focusHeading() { const h = $("#v-" + S.view + " h2"); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }
  const liveG = () => S.gastos.filter(g => !g.removido);
  const catOf = id => S.cats.find(c => c.id === id) || { id: "", nome: "Sem categoria", cor: "#b8ad9e", meta: 0 };
  const catByName = n => S.cats.find(c => norm(c.nome) === norm(n));
  const months = () => [...new Set(liveG().map(g => CG.monthKey(g.data)))].sort().reverse();
  const nowMonth = () => CG.monthKey(CG.today());
  async function loadAll() {
    S.gastos = await DB.all("gastos"); S.cats = (await DB.all("categorias")).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    S.meta = { lastBackup: await DB.meta.get("lastBackup", null), changes: await DB.meta.get("changes", 0), device: await DB.meta.get("device", null), memory: await DB.meta.get("memory", {}) };
    if (!S.meta.device) { S.meta.device = uid(); await DB.meta.set("device", S.meta.device); }
    if (!S.cats.length) { S.cats = DEFAULT_CATS.map(([n, i]) => ({ id: "c" + uid(), nome: n, cor: PALETTE[i], meta: 0, ordem: i })); await DB.putMany("categorias", S.cats); }
  }
  async function dailySnapshot() {   // antes da primeira mudança do dia, guarda o estado
    const l = await Ver.list(), today = new Date().toDateString();
    if (!l.some(v => v.kind === "dia" && new Date(v.at).toDateString() === today) && S.gastos.length) await Ver.create(S.gastos, S.cats, "dia", "");
  }
  async function touch(n = 1) { S.meta.changes += n; await DB.meta.set("changes", S.meta.changes); }
  async function saveGasto(g) {
    await dailySnapshot(); g.alteradoEm = new Date().toISOString(); await DB.put("gastos", g);
    const i = S.gastos.findIndex(x => x.id === g.id); if (i >= 0) S.gastos[i] = g; else S.gastos.push(g); await touch();
    if (g.estabelecimento && g.categoriaId) { S.meta.memory[norm(g.estabelecimento)] = g.categoriaId; await DB.meta.set("memory", S.meta.memory); }
    if (S.meta.changes === 1) DB.persist();
  }
  async function setRemoved(ids, flag) {
    await dailySnapshot(); const now = new Date().toISOString(), put = [];
    for (const id of ids) { const g = S.gastos.find(x => x.id === id); if (g) { g.removido = flag; g.alteradoEm = now; put.push(g); } }
    await DB.putMany("gastos", put); await touch(put.length);
  }

  /* ---------- rotas ---------- */
  const VIEWS = ["inicio", "lancamentos", "relatorios", "backup"];
  function route(first) {
    const v = (location.hash.match(/^#\/(\w+)/) || [])[1]; const view = VIEWS.includes(v) ? v : "inicio";
    VIEWS.forEach(n => { $("#v-" + n).hidden = n !== view; });
    $$("#tabs a").forEach(a => { if (a.dataset.v === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    const changed = S.view !== view; S.view = view; render();
    if (changed && !first) { const h = $("#v-" + view + " h2"); if (h) { h.tabIndex = -1; h.focus({ preventScroll: false }); } window.scrollTo(0, 0); }
  }
  window.addEventListener("hashchange", () => route(false));
  function render() { ({ inicio: rInicio, lancamentos: rLanc, relatorios: rRel, backup: rBackup })[S.view](); }

  /* ---------- início ---------- */
  function sumBy(list) { return list.reduce((s, g) => s + g.valor, 0); }
  function rInicio() {
    const mk = nowMonth(), list = liveG().filter(g => CG.monthKey(g.data) === mk), day = +CG.today().slice(8);
    $("#h-mes").textContent = CG.monthLabel(mk).replace(/^./, c => c.toUpperCase()); $("#h-total").textContent = brl(sumBy(list));
    $("#h-sub").textContent = list.length ? `${list.length} ${list.length === 1 ? "lançamento" : "lançamentos"} · média de ${brl(Math.round(sumBy(list) / day))} por dia` : "Nenhum gasto neste mês ainda.";
    const rec = liveG().sort((a, b) => b.data < a.data ? -1 : b.data > a.data ? 1 : b.alteradoEm < a.alteradoEm ? -1 : 1).slice(0, 8);
    $("#recent").innerHTML = rec.map(g => `<li><button type="button" class="rec" data-edit="${g.id}"><span class="dot" style="background:${catOf(g.categoriaId).cor}" aria-hidden="true"></span><span class="rt"><b>${esc(g.estabelecimento || "Sem nome")}</b><small>${CG.fmtDate(g.data)} · ${esc(catOf(g.categoriaId).nome)}</small></span><span class="rv">${brl(g.valor)}</span><span class="sr-only">Editar</span></button></li>`).join("");
    $("#empty").hidden = S.gastos.some(g => !g.removido); $("#v-inicio h3.sec2").hidden = !rec.length;
    banner();
  }
  function banner() {
    const b = $("#bkbanner"), n = S.meta.changes, g = liveG().length;
    const need = g > 0 && (!S.meta.lastBackup ? true : n >= 3 || Date.now() - S.meta.lastBackup > 7 * 864e5 && n > 0);
    b.hidden = !need; if (need) b.innerHTML = `<p>${S.meta.lastBackup ? `Você tem <strong>${n} ${n === 1 ? "alteração" : "alterações"}</strong> desde o último backup.` : "Você ainda <strong>não baixou a planilha</strong>. Sem backup, limpar os dados do navegador apaga o caderno."} <button class="link" type="button" id="bk-now">Baixar planilha agora</button></p>`;
    const x = $("#bk-now"); if (x) x.onclick = exportXlsx;
  }

  /* ---------- lançamentos ---------- */
  function fillSelect(sel, opts, val) { sel.innerHTML = opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join(""); sel.value = opts.some(o => o[0] === val) ? val : opts[0][0]; return sel.value; }
  const monthOpts = () => [["", "Todos os meses"], ...months().map(m => [m, CG.monthLabel(m)])];
  const catOpts = (all = "Todas as categorias") => [["", all], ...S.cats.map(c => [c.id, c.nome])];
  function filtered() {
    const f = S.f, q = norm(f.q);
    return liveG().filter(g => (!f.mes || q || CG.monthKey(g.data) === f.mes) && (!f.cat || g.categoriaId === f.cat) && (!q || norm(g.estabelecimento + " " + (g.nota || "")).includes(q)))
      .sort((a, b) => a.data < b.data ? 1 : a.data > b.data ? -1 : a.alteradoEm < b.alteradoEm ? 1 : -1);
  }
  function rLanc() {
    if (!S.f.mes && !S.f._init) { S.f.mes = months().includes(nowMonth()) ? nowMonth() : (months()[0] || ""); S.f._init = true; }
    S.f.mes = fillSelect($("#f-mes"), monthOpts(), S.f.mes); S.f.cat = fillSelect($("#f-cat"), catOpts(), S.f.cat); fillSelect($("#bulkcat"), S.cats.map(c => [c.id, c.nome]), "");
    const list = filtered(), shown = list.slice(0, S.lim), tot = sumBy(list);
    $("#lsum").textContent = list.length ? `${list.length} ${list.length === 1 ? "lançamento" : "lançamentos"} · total ${brl(tot)}${S.f.q ? " · buscando em todos os meses" : ""}` : "";
    $("#lempty").hidden = list.length > 0; $("#lt").hidden = !list.length; $("#more").hidden = list.length <= S.lim;
    $("#ltb").innerHTML = shown.map(g => { const c = catOf(g.categoriaId), neg = g.valor < 0;
      return `<tr data-id="${g.id}"><td class="c-sel"><input type="checkbox" data-sel="${g.id}" ${S.sel.has(g.id) ? "checked" : ""} aria-label="Selecionar ${esc(g.estabelecimento || "gasto")} de ${CG.fmtDate(g.data)}"></td><td data-l="Data">${CG.fmtDate(g.data)}</td><td data-l="Local"><b>${esc(g.estabelecimento || "Sem nome")}</b>${g.nota ? `<small>${esc(g.nota)}</small>` : ""}${g.origem === "foto" ? '<small class="tag">foto</small>' : ""}</td><td data-l="Categoria"><span class="dot" style="background:${c.cor}" aria-hidden="true"></span>${esc(c.nome)}</td><td class="num" data-l="Valor">${brl(g.valor)}${neg ? ' <small class="tag">estorno</small>' : ""}</td><td class="c-act"><button class="btn sm" type="button" data-edit="${g.id}" aria-label="Editar gasto de ${esc(g.estabelecimento || "sem nome")} em ${CG.fmtDate(g.data)}">Editar</button></td></tr>`; }).join("");
    $("#selall").checked = shown.length > 0 && shown.every(g => S.sel.has(g.id)); selBar();
  }
  function selBar() { const n = S.sel.size; $("#selbar").hidden = !n; $("#selcount").textContent = `${n} ${n === 1 ? "selecionado" : "selecionados"}`; }
  $("#f-mes").onchange = e => { S.f.mes = e.target.value; S.lim = 50; S.sel.clear(); rLanc(); }; $("#f-cat").onchange = e => { S.f.cat = e.target.value; S.lim = 50; S.sel.clear(); rLanc(); };
  $("#f-q").oninput = e => { S.f.q = e.target.value; S.lim = 50; S.sel.clear(); rLanc(); }; $("#more").onclick = () => { S.lim += 50; rLanc(); };
  $("#ltb").addEventListener("change", e => { const c = e.target.closest("[data-sel]"); if (!c) return; c.checked ? S.sel.add(c.dataset.sel) : S.sel.delete(c.dataset.sel); selBar(); $("#selall").checked = filtered().slice(0, S.lim).every(g => S.sel.has(g.id)); });
  $("#selall").onchange = e => { filtered().slice(0, S.lim).forEach(g => e.target.checked ? S.sel.add(g.id) : S.sel.delete(g.id)); rLanc(); };
  $("#bulkapply").onclick = async () => {
    const ids = [...S.sel], cat = $("#bulkcat").value; if (!ids.length || !cat) return; await dailySnapshot();
    const put = [], old = new Map(); ids.forEach(id => { const g = S.gastos.find(x => x.id === id); if (g) { old.set(id, g.categoriaId); g.categoriaId = cat; g.alteradoEm = new Date().toISOString(); put.push(g); } });
    await DB.putMany("gastos", put); await touch(put.length); S.sel.clear(); rLanc();
    showUndo(`Categoria trocada para ${catOf(cat).nome} em ${put.length} ${put.length === 1 ? "lançamento" : "lançamentos"}.`, async () => { const back = []; old.forEach((c, id) => { const g = S.gastos.find(x => x.id === id); if (g) { g.categoriaId = c; g.alteradoEm = new Date().toISOString(); back.push(g); } }); await DB.putMany("gastos", back); await touch(back.length); render(); });
  };
  $("#bulkdel").onclick = async () => { const ids = [...S.sel]; if (!ids.length) return; await setRemoved(ids, true); S.sel.clear(); rLanc(); focusHeading(); showUndo(`${ids.length} ${ids.length === 1 ? "lançamento excluído" : "lançamentos excluídos"}.`, async () => { await setRemoved(ids, false); render(); }); };
  document.addEventListener("click", e => { const b = e.target.closest("[data-edit]"); if (b) { const g = S.gastos.find(x => x.id === b.dataset.edit); if (g) openGasto(g, null, b); } });

  /* ---------- diálogo do gasto ---------- */
  const gd = $("#gdlg"), G = { valor: $("#g-valor"), est: $("#g-estorno"), data: $("#g-data"), estab: $("#g-estab"), pag: $("#g-pag"), nota: $("#g-nota"), err: $("#g-err"), img: $("#g-img"), fig: $("#g-photo"), keep: $("#g-keep"), info: $("#g-info") };
  let gOpener = null, gCat = "", photoUrl = null, gConf = {};
  function renderChips() { $("#g-cats").innerHTML = S.cats.map(c => `<label class="chipr"><input type="radio" name="gcat" value="${c.id}" ${c.id === gCat ? "checked" : ""}><span><i class="dot" style="background:${c.cor}" aria-hidden="true"></i>${esc(c.nome)}</span></label>`).join(""); }
  $("#g-cats").addEventListener("change", e => { gCat = e.target.value; });
  function hints() { $("#g-valor-h").textContent = gConf.valor ? "Lido da foto: confira." : ""; $("#g-data-h").textContent = gConf.data ? "Só o mês foi lido: confira o dia." : ""; }
  function openGasto(g, photo, opener, info) {
    gOpener = opener || document.activeElement; S.edit = g; S.photo = photo || null; gConf = (photo && photo.conf) || {};
    $("#g-t").textContent = g ? "Editar gasto" : "Novo gasto"; G.err.hidden = true;
    const v = g ? g.valor : (photo && photo.valor != null ? photo.valor : null);
    G.valor.value = v == null ? "" : CG.num(Math.abs(v)); G.est.checked = v != null && v < 0;
    G.data.value = g ? g.data : (photo && photo.data) || CG.today(); G.estab.value = g ? g.estabelecimento || "" : (photo && photo.estab) || "";
    G.pag.value = g ? g.pagamento || "Pix" : (S.lastPag || "Pix"); G.nota.value = g ? g.nota || "" : "";
    gCat = g ? g.categoriaId : (S.lastCat && catOf(S.lastCat).id ? S.lastCat : S.cats[0].id); renderChips();
    $("#g-estab-l").innerHTML = [...new Set(liveG().map(x => x.estabelecimento).filter(Boolean))].slice(0, 200).map(s => `<option value="${esc(s)}">`).join("");
    G.info.hidden = !info; if (info) G.info.textContent = info;
    $("#g-del").hidden = !g; $("#g-stopq").hidden = !(S.qTotal > 1 && photo && S.queue.length > 0); $("#g-save2").hidden = !(photo && S.queue.length >= 0 && !g); $("#g-queue").hidden = !(S.qTotal > 1 && photo); if (S.qTotal > 1 && photo) $("#g-queue").textContent = `Nota ${S.qTotal - S.queue.length} de ${S.qTotal}`;
    showPhoto(g, photo); hints(); $("#g-keephint").hidden = G.keep.checked; gd.showModal(); (v == null ? G.valor : G.estab).focus(); if (v == null) G.valor.select();
  }
  async function showPhoto(g, photo) {
    if (photoUrl) { URL.revokeObjectURL(photoUrl); photoUrl = null; } G.fig.classList.remove("big");
    let blob = photo ? photo.blob : null; G.keep.checked = false;
    if (!blob && g && g.fotoId) { const f = await DB.get("fotos", g.fotoId); if (f) { blob = f.blob; G.keep.checked = true; } }
    G.fig.hidden = !blob; $("#g-keephint").hidden = G.keep.checked; if (blob) { photoUrl = URL.createObjectURL(blob); G.img.src = photoUrl; }
    if (photo && !photo.keepDefault) G.keep.checked = false;
  }
  $("#g-zoom").onclick = () => G.fig.classList.toggle("big");
  $("#g-rmphoto").onclick = () => { S.photo = null; G.fig.hidden = true; G.keep.checked = false; S.dropPhoto = true; G.valor.focus(); };
  G.valor.addEventListener("blur", () => { const c = CG.parseMoney(G.valor.value); if (c != null) G.valor.value = CG.num(Math.abs(c)); });
  G.estab.addEventListener("change", () => { const id = S.meta.memory[norm(G.estab.value)]; if (id && S.cats.some(c => c.id === id) && !S.edit) { gCat = id; renderChips(); } });
  $("#g-cancel").onclick = () => { const more = S.queue.length > 0 && S.photo; gd.close(); if (more) { T.toast("Nota pulada. Próxima da fila."); setTimeout(nextPhoto, 150); } };
  gd.addEventListener("close", () => { if (photoUrl) { URL.revokeObjectURL(photoUrl); photoUrl = null; } S.dropPhoto = false; if (gOpener && gOpener.isConnected) gOpener.focus(); else focusHeading(); });
  /* teclado virtual: o campo em foco rola para o meio do diálogo (a barra de ações fica fixa) */
  gd.addEventListener("focusin", e => { if (e.target.matches("input,select,textarea")) setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "auto" }), 250); });
  $("#g-keep").addEventListener("change", () => { $("#g-keephint").hidden = G.keep.checked; });
  $("#g-stopq").onclick = () => { S.queue = []; S.qTotal = 0; gd.close(); T.toast("Fila encerrada."); };
  G.data.addEventListener("input", () => { const d = CG.parseDate(G.data.value), t = CG.today(); const h = $("#g-data-h"); if (!d) { h.textContent = ""; return; } h.textContent = d > t ? "Data no futuro: confira." : d < CG.addMonths(t.slice(0, 7), -24) + "-01" ? "Data com mais de 2 anos: confira." : (gConf.data ? "Só o mês foi lido: confira o dia." : ""); });
  function gFail(m, el) { G.err.textContent = m; G.err.hidden = false; if (el) { el.setAttribute("aria-invalid", "true"); el.focus(); } }
  async function submitGasto(again) {
    G.err.hidden = true; [G.valor, G.data].forEach(x => x.removeAttribute("aria-invalid"));
    let c = CG.parseMoney(G.valor.value); if (c == null || c === 0) { gFail("Digite o valor do gasto. Ex.: 23,90.", G.valor); return; }
    c = Math.abs(c); if (G.est.checked) c = -c; const d = CG.parseDate(G.data.value); if (!d) { gFail("Escolha uma data válida.", G.data); return; }
    const old = S.edit, snapshot = old ? { ...old } : null, id = old ? old.id : uid();
    const g = { id, data: d, valor: c, moeda: "BRL", estabelecimento: G.estab.value.trim(), categoriaId: gCat, pagamento: G.pag.value, nota: G.nota.value.trim(), origem: old ? old.origem : (S.photo ? "foto" : "manual"), confianca: old ? old.confianca : (S.photo ? (S.photo.conf && Object.keys(S.photo.conf).length ? 0.5 : 0.9) : ""), criadoEm: old ? old.criadoEm : new Date().toISOString(), removido: false, fotoId: old ? old.fotoId : null };
    const photo = S.photo, keep = G.keep.checked && !G.fig.hidden;
    if (photo && keep) { await DB.put("fotos", { id, blob: photo.blob, thumb: photo.thumb }); g.fotoId = id; }
    else if (old && old.fotoId && (S.dropPhoto || !keep)) { await DB.del("fotos", old.fotoId); g.fotoId = null; }
    S.lastCat = gCat; S.lastPag = g.pagamento; await saveGasto(g); gd.close(); S.sel.delete(id);
    render(); say(old ? "Gasto atualizado." : "Gasto salvo."); showUndo(old ? "Gasto atualizado." : `Salvo: ${g.estabelecimento || "gasto"}, ${brl(g.valor)}.`, async () => { if (snapshot) { await saveGasto(snapshot); } else { await setRemoved([id], true); } render(); });
    if (photo && S.queue.length) setTimeout(nextPhoto, 150); else if (again) setTimeout(() => $("#cam").click(), 150);
  }
  $("#g-form").addEventListener("submit", e => { e.preventDefault(); submitGasto(false); });
  $("#g-save2").onclick = () => submitGasto(true);
  $("#g-del").onclick = async () => { const g = S.edit; if (!g) return; gd.close(); await setRemoved([g.id], true); render(); focusHeading(); showUndo(`Excluído: ${g.estabelecimento || "gasto"}, ${brl(g.valor)}.`, async () => { await setRemoved([g.id], false); render(); }); };
  $("#newmanual").onclick = e => openGasto(null, null, e.currentTarget); $("#add2").onclick = e => openGasto(null, null, e.currentTarget);

  /* ---------- fotos ---------- */
  $("#newphoto").onclick = () => $("#cam").click(); $("#newgal").onclick = () => $("#gal").click();
  $("#cam").onchange = e => startPhotos(e.target.files); $("#gal").onchange = e => startPhotos(e.target.files);
  function startPhotos(files) {
    files = [...files].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name)); if (!files.length) { return; }
    S.queue = files; S.qTotal = files.length; nextPhoto(); $("#cam").value = ""; $("#gal").value = "";
  }
  async function nextPhoto() {
    const f = S.queue.shift(); if (!f) { S.qTotal = 0; return; }
    say("Lendo a foto…"); document.body.setAttribute("aria-busy", "true");
    try {
      const p = await QR.prepPhoto(f); let info = "", valor = null, data = null, conf = {}, estab = "";
      if (p.qr.length) {
        const n = QR.parseNota(p.qr.find(t => /\d{44}/.test(t.replace(/\s/g, ""))) || p.qr[0]);
        if (n.chave) { const bits = [n.cnpj ? "CNPJ " + CG.fmtCnpj(n.cnpj) + (n.cnpjValido ? "" : " (confira, parece inválido)") : "", n.mes ? "mês " + CG.monthLabel(n.mes) : "", n.uf ? n.uf : ""].filter(Boolean); info = "QR Code lido. Encontramos " + bits.join(", ") + ". " + (n.valor != null ? "O valor veio no QR: confira." : "Informe o valor total."); }
        else info = "Um QR Code foi lido, mas não é de nota fiscal. Digite os dados.";
        if (n.valor != null) { valor = n.valor; conf.valor = true; }
        if (n.data) data = n.data; else if (n.mes) { const hoje = CG.today(); data = hoje.slice(0, 7) === n.mes ? hoje : n.mes + "-01"; if (data !== hoje) conf.data = true; }
        if (n.cnpj) { const prev = liveG().find(g => g.cnpj === n.cnpj); if (prev) estab = prev.estabelecimento; }
      } else info = QR.supported() ? "Não encontrei QR Code na foto. Digite o valor e confira a data." : "Este navegador não lê QR Code (no Chrome do Android costuma funcionar). Digite o valor e confira a data.";
      document.body.removeAttribute("aria-busy");
      openGasto(null, { blob: p.blob, thumb: p.thumb, valor, data, conf, estab }, null, info);
    } catch (e) {
      document.body.removeAttribute("aria-busy"); showAlert("Não consegui abrir essa foto. Tente de novo, escolha outra, ou digite o gasto."); S.queue = []; S.qTotal = 0;
    }
  }

  /* ---------- relatórios ---------- */
  const cap = s => s.replace(/^./, c => c.toUpperCase());
  const pct = (a, b) => b ? Math.round((a - b) / Math.abs(b) * 100) : null;
  function rRel() {
    const ms = months(); if (!ms.length) { $("#rep").innerHTML = '<div class="state"><p>Ainda não há gastos para os relatórios. Adicione alguns em <a href="#/inicio">Início</a>.</p></div>'; fillSelect($("#r-mes"), [["", "—"]], ""); fillSelect($("#r-cat"), catOpts(), ""); return; }
    if (!S.r.mes || !ms.includes(S.r.mes)) S.r.mes = ms.includes(nowMonth()) ? nowMonth() : ms[0];
    S.r.mes = fillSelect($("#r-mes"), ms.map(m => [m, CG.monthLabel(m)]), S.r.mes); S.r.cat = fillSelect($("#r-cat"), catOpts(), S.r.cat);
    const mk = S.r.mes, pk = CG.addMonths(mk, -1), all = liveG(), isNow = mk === nowMonth(), dim = CG.daysIn(mk), cut = isNow ? +CG.today().slice(8) : dim;
    const inM = (g, k) => CG.monthKey(g.data) === k, cf = g => !S.r.cat || g.categoriaId === S.r.cat;
    const cur = all.filter(g => inM(g, mk) && cf(g)), prev = all.filter(g => inM(g, pk) && cf(g)), prevCut = prev.filter(g => +g.data.slice(8) <= cut), prevHas = all.some(g => inM(g, pk));
    const tot = sumBy(cur), avg = Math.round(tot / Math.max(1, cut)), proj = isNow ? avg * dim : tot;
    let out = ""; const card = (h, body, note) => `<div class="rcard"><h3 class="sec2">${esc(h)}</h3>${note ? `<p class="auto">${esc(note)}</p>` : ""}${body}</div>`;
    /* 1. painel */
    const daily = Array(dim).fill(0), dailyP = Array(CG.daysIn(pk)).fill(0); cur.forEach(g => { daily[+g.data.slice(8) - 1] += g.valor; }); prev.forEach(g => { dailyP[+g.data.slice(8) - 1] += g.valor; });
    const cum = a => { let s = 0; return a.map(v => (s += v)); }, cc = cum(daily).slice(0, cut), cp = prevHas ? cum(dailyP) : [];
    let cmp; const pt = sumBy(prevCut), p = pct(tot, pt);
    if (!prevHas) cmp = "Faltam dados do mês anterior para comparar."; else if (Math.abs(pt) < 5000) cmp = `Mês anterior${isNow ? ` até o dia ${cut}` : ""}: ${brl(pt)} (base pequena, sem porcentagem).`; else cmp = `${brl(Math.abs(tot - pt))} ${tot >= pt ? "a mais" : "a menos"} (${Math.abs(p)}%) que ${CG.monthLabel(pk)}${isNow ? ` até o dia ${cut}` : ""} (${brl(pt)}).`;
    const top = [...cur].sort((a, b) => b.valor - a.valor).slice(0, 5);
    out += card("Painel do mês", `<div class="kpis"><div><small>Total</small><b>${brl(tot)}</b></div><div><small>Média por dia</small><b>${brl(avg)}</b></div><div><small>${isNow ? "Projeção do mês" : "Lançamentos"}</small><b>${isNow ? brl(proj) : cur.length}</b></div></div>${CGCharts.cumLine(cc, cp, dim, { summary: `Gasto acumulado em ${CG.monthLabel(mk)}: ${brl(tot)} até o dia ${cut}.` })}${top.length ? `<h4>Maiores gastos</h4><ol class="toplist">${top.map(g => `<li><span>${CG.fmtDate(g.data)} · ${esc(g.estabelecimento || "Sem nome")}</span><b>${brl(g.valor)}</b></li>`).join("")}</ol>` : ""}`, cur.length ? `Em ${CG.monthLabel(mk)} você gastou ${brl(tot)} em ${cur.length} ${cur.length === 1 ? "lançamento" : "lançamentos"}. ${cmp}` : "Sem gastos neste mês com esses filtros.");
    /* 2. categoria */
    const byCat = new Map(); cur.forEach(g => byCat.set(g.categoriaId, (byCat.get(g.categoriaId) || 0) + g.valor)); let rows = [...byCat].map(([id, v]) => ({ label: catOf(id).nome, value: v, color: catOf(id).cor, id })).sort((a, b) => b.value - a.value);
    if (rows.length > 7) { const rest = rows.slice(6), s = rest.reduce((a, r) => a + r.value, 0); rows = [...rows.slice(0, 6), { label: "Outras (" + rest.length + ")", value: s, color: "#b8ad9e" }]; }
    let catNote = ""; if (rows.length) { const t = rows[0], pv = prev.filter(g => g.categoriaId === t.id).reduce((a, g) => a + g.valor, 0); catNote = `A maior categoria foi ${t.label}: ${brl(t.value)}` + (tot > 0 ? ` (${Math.round(t.value / tot * 100)}% do total)` : "") + (t.id && prevHas && pv >= 5000 ? `, ${Math.abs(pct(t.value, pv))}% ${t.value >= pv ? "a mais" : "a menos"} que em ${CG.monthLabel(pk)}.` : "."); }
    out += card("Por categoria", CGCharts.bars(rows, { title: "Gasto por categoria" }), catNote);
    /* 3. estabelecimento */
    const byE = new Map(); cur.forEach(g => { const k = norm(g.estabelecimento) || "(sem nome)"; const o = byE.get(k) || { label: g.estabelecimento || "Sem nome", value: 0, n: 0 }; o.value += g.valor; o.n++; byE.set(k, o); });
    const eRows = [...byE.values()].sort((a, b) => b.value - a.value).slice(0, 10).map(o => ({ label: o.label, value: o.value, extra: `${o.n} ${o.n === 1 ? "compra" : "compras"} · ticket médio ${brl(Math.round(o.value / o.n))}` }));
    out += card("Por estabelecimento (top 10)", CGCharts.bars(eRows, { title: "Gasto por estabelecimento" }), "");
    /* 4. evolução */
    const span = Array.from({ length: 12 }, (_, i) => CG.addMonths(mk, i - 11)), perM = span.map(k => ({ label: CG.monthShort(k), value: all.filter(g => inM(g, k) && cf(g)).reduce((s, g) => s + g.valor, 0), has: all.some(g => inM(g, k)), current: k === mk })), withData = perM.filter(m => m.has);
    const evAvg = Math.round(withData.reduce((s, m) => s + m.value, 0) / Math.max(1, withData.length)), narrow = ($("#rep").clientWidth || 640) < 560;
    out += card("Evolução mensal", withData.length >= 3 ? (narrow ? CGCharts.bars(withData.map(m => ({ label: m.label, value: m.value, color: m.current ? "var(--accent)" : "var(--muted)" })), { noPct: true, title: "Gasto por mês", summary: `Gasto por mês. Média: ${brl(evAvg)}.` }) + `<p class="legend"><span class="lg">Média de ${esc(brl(evAvg))} por mês. O mês escolhido está em âmbar.</span></p>` : CGCharts.columns(withData, { avg: evAvg })) : `<p class="muted">Poucos meses para um gráfico (${withData.length}). Quando houver 3 meses ou mais, ele aparece.</p>${CGCharts.table(["Mês", "Total"], withData.map(m => [m.label, brl(m.value)]), "Gasto por mês")}`, "");
    /* 5. orçamento */
    const budget = S.cats.filter(c => c.meta > 0).map(c => ({ label: c.nome, spent: all.filter(g => inM(g, mk) && g.categoriaId === c.id).reduce((s, g) => s + g.valor, 0), meta: c.meta }));
    out += card("Orçamento por categoria", budget.length ? CGCharts.progress(budget) : '<p class="muted">Nenhuma meta definida. <button class="link" type="button" id="goals">Definir metas</button></p>', "");
    /* 6. recorrentes */
    const rec = recurring(all); out += card("Recorrentes e assinaturas", rec.length ? `<ul class="toplist">${rec.map(r => `<li><span>${esc(r.label)} <small>(${r.months} meses seguidos)</small></span><b>${brl(r.valor)}</b></li>`).join("")}</ul>` : '<p class="muted">Nenhum gasto repetido por 3 meses seguidos com o mesmo valor foi encontrado.</p>', rec.length ? `Gastos fixos estimados: ${brl(rec.reduce((s, r) => s + r.valor, 0))} por mês.` : "");
    $("#rep").innerHTML = out; const gb = $("#goals"); if (gb) gb.onclick = openCats;
  }
  function recurring(all) {
    const m = new Map(); all.forEach(g => { if (g.valor <= 0 || !g.estabelecimento) return; const k = norm(g.estabelecimento) + "|" + g.valor; const o = m.get(k) || { label: g.estabelecimento, valor: g.valor, ms: new Set() }; o.ms.add(CG.monthKey(g.data)); m.set(k, o); });
    const out = []; for (const o of m.values()) { const ms = [...o.ms].sort(); let best = 1, run = 1; for (let i = 1; i < ms.length; i++) { run = CG.addMonths(ms[i - 1], 1) === ms[i] ? run + 1 : 1; best = Math.max(best, run); } if (best >= 3) out.push({ label: o.label, valor: o.valor, months: best }); }
    return out.sort((a, b) => b.valor - a.valor).slice(0, 10);
  }
  $("#r-mes").onchange = e => { S.r.mes = e.target.value; rRel(); }; $("#r-cat").onchange = e => { S.r.cat = e.target.value; rRel(); };
  $("#printbtn").onclick = () => window.print();

  /* ---------- categorias e metas ---------- */
  const cd = $("#cdlg"); let cOpener = null;
  function cRows(list) { $("#c-list").innerHTML = list.map((c, i) => { const used = liveG().some(g => g.categoriaId === c.id); return `<div class="crow" data-id="${c.id}"><div class="field"><label for="cn${i}">Nome</label><input id="cn${i}" value="${esc(c.nome)}" maxlength="30" autocomplete="off"></div><div class="field"><label for="cc${i}">Cor</label><select id="cc${i}">${PALETTE.map((p, k) => `<option value="${p}" ${p === c.cor ? "selected" : ""}>Cor ${k + 1}</option>`).join("")}</select></div><div class="field"><label for="cm${i}">Meta mensal (R$)</label><input id="cm${i}" inputmode="decimal" value="${c.meta ? CG.num(c.meta) : ""}" placeholder="sem meta" autocomplete="off"></div><button type="button" class="btn sm" data-rm="${c.id}" ${used ? "disabled title=\"Há gastos nesta categoria\"" : ""} aria-label="Remover categoria ${esc(c.nome)}">Remover</button></div>`; }).join(""); }
  let cDraft = [];
  function openCats(e) { cOpener = e && e.currentTarget || document.activeElement; cDraft = S.cats.map(c => ({ ...c })); cRows(cDraft); $("#c-err").hidden = true; cd.showModal(); }
  const readCats = () => $$(".crow", cd).map((r, i) => ({ ...cDraft.find(c => c.id === r.dataset.id), nome: $("input", r).value.trim(), cor: $("select", r).value, meta: CG.parseMoney($$("input", r)[1].value) || 0, ordem: i }));
  $("#c-add").onclick = () => { cDraft = readCats(); cDraft.push({ id: "c" + uid(), nome: "", cor: PALETTE[cDraft.length % PALETTE.length], meta: 0 }); cRows(cDraft); const l = $$(".crow input", cd); const x = $$(".crow", cd).pop(); if (x) $("input", x).focus(); };
  $("#c-list").addEventListener("click", e => { const b = e.target.closest("[data-rm]"); if (!b || b.disabled) return; cDraft = readCats().filter(c => c.id !== b.dataset.rm); cRows(cDraft); });
  $("#c-cancel").onclick = () => cd.close(); cd.addEventListener("close", () => { if (cOpener && cOpener.isConnected) cOpener.focus(); });
  $("#catsbtn").onclick = openCats;
  $("#c-form").addEventListener("submit", async e => {
    e.preventDefault(); const list = readCats(), err = $("#c-err"); err.hidden = true;
    if (list.some(c => !c.nome)) { err.textContent = "Toda categoria precisa de um nome."; err.hidden = false; return; }
    if (new Set(list.map(c => norm(c.nome))).size !== list.length) { err.textContent = "Há categorias com o mesmo nome."; err.hidden = false; return; }
    if (!list.length) { err.textContent = "Deixe pelo menos uma categoria."; err.hidden = false; return; }
    await dailySnapshot(); const removed = S.cats.filter(c => !list.some(x => x.id === c.id)); for (const c of removed) await DB.del("categorias", c.id);
    await DB.putMany("categorias", list); S.cats = list; await touch(); cd.close(); render(); say("Categorias salvas.");
  });

  /* ---------- planilha: exportar ---------- */
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  async function deliver(blob, name) {
    const file = new File([blob], name, { type: blob.type });
    if (isIOS && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return true; } catch (e) { if (e && e.name === "AbortError") return false; } }
    const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); return true;
  }
  const stamp = () => CG.today();
  async function buildXlsx() {
    const g = liveG().sort((a, b) => a.data < b.data ? -1 : a.data > b.data ? 1 : 0), vers = await Ver.list();
    const rows = [["id", "Data", "Valor", "Estabelecimento", "Categoria", "Pagamento", "Anotação", "Origem", "Confiança", "Foto", "Alterado em"].map(v => ({ t: "h", v }))];
    g.forEach(x => rows.push([x.id, { t: "d", v: x.data }, { t: "m", v: x.valor / 100 }, x.estabelecimento, catOf(x.categoriaId).nome, x.pagamento, x.nota, x.origem, x.confianca === "" || x.confianca == null ? "" : { t: "p", v: x.confianca }, x.fotoId ? "sim" : "", x.alteradoEm]));
    const cats = [["id", "Nome", "Cor", "Meta mensal"].map(v => ({ t: "h", v }))]; S.cats.forEach(c => cats.push([c.id, c.nome, c.cor, c.meta ? { t: "m", v: c.meta / 100 } : ""]));
    const resumo = [["Mês", "Categoria", "Total", "Lançamentos"].map(v => ({ t: "h", v }))], agg = new Map(); g.forEach(x => { const k = CG.monthKey(x.data) + "|" + catOf(x.categoriaId).nome; const o = agg.get(k) || { v: 0, n: 0 }; o.v += x.valor; o.n++; agg.set(k, o); });
    [...agg].sort().forEach(([k, o]) => { const [m, c] = k.split("|"); resumo.push([m, c, { t: "m", v: o.v / 100 }, o.n]); });
    const hist = [["Data e hora", "Tipo", "Nome", "Lançamentos", "Total", "Código"].map(v => ({ t: "h", v }))]; vers.forEach(v => hist.push([new Date(v.at).toLocaleString("pt-BR"), KIND[v.kind] || v.kind, v.label, v.n, { t: "m", v: v.total / 100 }, v.hash]));
    const hash = CG.fnv(JSON.stringify(g.map(x => [x.id, x.data, x.valor, x.estabelecimento, x.categoriaId, x.alteradoEm])));
    const meta = [["chave", "valor"], ["app", "caderno-de-gastos"], ["esquema", "1"], ["dispositivo", S.meta.device], ["exportadoEm", new Date().toISOString()], ["lancamentos", String(g.length)], ["hash", hash]];
    return { blob: XLSX.build([
      { name: "Gastos", rows, cols: [14, 12, 14, 30, 16, 12, 28, 10, 11, 7, 26], freeze: true, filter: true, validations: [{ sqref: "E2:E5000", formula: "Categorias!$B$2:$B$200" }, { sqref: "F2:F5000", formula: '"' + PAGS.join(",") + '"' }] },
      { name: "Categorias", rows: cats, cols: [14, 22, 12, 16], freeze: true }, { name: "Resumo mensal", rows: resumo, cols: [12, 22, 14, 12], freeze: true },
      { name: "Histórico", rows: hist, cols: [20, 20, 28, 12, 14, 12], freeze: true }, { name: "_meta", rows: meta, cols: [16, 40], hidden: true }]), hash };
  }
  async function exportXlsx() {
    try { const { blob } = await buildXlsx(); const ok = await deliver(blob, `caderno-de-gastos-${stamp()}.xlsx`); if (ok) { S.meta.lastBackup = Date.now(); S.meta.changes = 0; await DB.meta.set("lastBackup", S.meta.lastBackup); await DB.meta.set("changes", 0); render(); T.toast("Planilha baixada."); say("Planilha baixada. Backup atualizado."); } }
    catch (e) { showAlert("Não consegui gerar a planilha: " + (e.message || e)); }
  }
  async function exportZip() {
    try {
      const { blob } = await buildXlsx(), files = [{ name: `caderno-de-gastos-${stamp()}.xlsx`, data: new Uint8Array(await blob.arrayBuffer()) }], fotos = await DB.all("fotos");
      for (const f of fotos) if (S.gastos.some(g => g.id === f.id && !g.removido)) files.push({ name: `fotos/${f.id}.jpg`, data: new Uint8Array(await f.blob.arrayBuffer()) });
      files.push({ name: "LEIA-ME.txt", data: "Backup completo do Caderno de Gastos.\nA planilha .xlsx tem os gastos; a pasta fotos/ tem os comprovantes (nome = id do gasto).\nPara restaurar os gastos, use Importar planilha. As fotos não são reimportadas automaticamente.\n" });
      const ok = await deliver(XLSX.zip(files), `caderno-de-gastos-completo-${stamp()}.zip`); if (ok) { S.meta.lastBackup = Date.now(); S.meta.changes = 0; await DB.meta.set("lastBackup", S.meta.lastBackup); await DB.meta.set("changes", 0); render(); T.toast("Backup completo baixado."); }
    } catch (e) { showAlert("Não consegui gerar o backup: " + (e.message || e)); }
  }
  $("#exp").onclick = exportXlsx; $("#expzip").onclick = exportZip;

  /* ---------- planilha: importar ---------- */
  const id_ = $("#idlg"); let IM = null, iOpener = null;
  const FIELDS = [["id", "id (opcional)", ["id"]], ["data", "Data", ["data", "date", "dia", "data da compra", "vencimento"]], ["valor", "Valor", ["valor", "total", "value", "preco", "quantia", "montante", "valor (r$)", "valor r$"]], ["estabelecimento", "Estabelecimento", ["estabelecimento", "descricao", "local", "loja", "nome", "historico", "favorecido", "destino", "lancamento"]], ["categoria", "Categoria", ["categoria", "tipo", "grupo"]], ["pagamento", "Pagamento", ["pagamento", "forma de pagamento", "forma", "meio"]], ["nota", "Anotação", ["anotacao", "nota", "observacao", "obs", "memo", "observacoes"]], ["alterado", "Alterado em (opcional)", ["alterado em", "alteradoem", "atualizado em"]]];
  $("#imp").onclick = e => { iOpener = e.currentTarget; $("#impfile").click(); }; $("#goimport")?.addEventListener("click", () => $("#impfile").click());
  $("#impfile").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return; hideAlertBox();
    try {
      let rows, metaSheet = null;
      if (/\.xlsx$/i.test(f.name)) { const wb = await XLSX.read(await f.arrayBuffer()); const sh = wb.sheets.find(s => norm(s.name) === "gastos") || wb.sheets.find(s => s.state === "visible" && s.rows.length); if (!sh) throw new Error("A planilha não tem abas com dados."); rows = sh.rows; const m = wb.sheets.find(s => s.name === "_meta"); if (m) metaSheet = Object.fromEntries(m.rows.map(r => [r[0], r[1]])); }
      else { const u8 = new Uint8Array(await f.arrayBuffer()); let t; try { t = new TextDecoder("utf-8", { fatal: true }).decode(u8); } catch (_) { t = new TextDecoder("windows-1252").decode(u8); } rows = CG.parseCSV(t); }
      rows = rows.filter(r => r.some(c => c !== "" && c != null)); if (rows.length < 2) throw new Error("A planilha precisa de uma linha de títulos e pelo menos um gasto.");
      IM = { name: f.name, head: rows[0].map(h => String(h == null ? "" : h)), rows: rows.slice(1), map: {}, meta: metaSheet };
      FIELDS.forEach(([k, , syn]) => { const i = IM.head.findIndex(h => syn.includes(norm(h))); IM.map[k] = i; });
      openImport();
    } catch (err) { showAlert("Não consegui ler esse arquivo: " + (err.message || err) + " Use um .xlsx do Excel ou um CSV."); }
  };
  const hideAlertBox = () => { alertBox.hidden = true; };
  function openImport() {
    $("#i-file").textContent = `${IM.name} · ${IM.rows.length} linhas`; $("#i-err").hidden = true;
    $("#i-map").innerHTML = FIELDS.map(([k, label]) => `<div class="field"><label for="im-${k}">${label}${k === "data" || k === "valor" ? " *" : ""}</label><select id="im-${k}" data-k="${k}"><option value="-1">(não importar)</option>${IM.head.map((h, i) => `<option value="${i}" ${IM.map[k] === i ? "selected" : ""}>${esc(h || "Coluna " + (i + 1))}</option>`).join("")}</select></div>`).join("");
    $("#i-dups").checked = false; $("#i-conf").checked = false; plan(); id_.showModal();
  }
  $("#i-map").addEventListener("change", e => { const s = e.target.closest("[data-k]"); if (s) { IM.map[s.dataset.k] = +s.value; plan(); } });
  const val = (r, k) => { const i = IM.map[k]; return i >= 0 ? r[i] : ""; };
  function plan() {
    const P = { novos: [], atual: [], conf: [], dups: [], erros: [], igual: 0, newCats: new Set() }, seen = new Set(liveG().map(CG.hashDup)), byId = new Map(S.gastos.map(g => [g.id, g]));
    IM.rows.forEach((r, n) => {
      const line = n + 2, dRaw = val(r, "data"), d = CG.parseDate(dRaw && dRaw.date !== undefined ? dRaw.date : dRaw), v = CG.parseMoney(val(r, "valor"));
      if (!d || v == null) { P.erros.push(`Linha ${line}: ${!d ? "data inválida" : "valor inválido"}`); return; }
      const cname = String(val(r, "categoria") || "").trim(), cat = cname ? catByName(cname) : null; if (cname && !cat) P.newCats.add(cname);
      const mp = k => IM.map[k] >= 0, g = { id: String(val(r, "id") || "").trim(), data: d, valor: v, estabelecimento: String(val(r, "estabelecimento") || "").trim(), cname, categoriaId: cat ? cat.id : null, pagamento: PAGS.includes(String(val(r, "pagamento") || "").trim()) ? String(val(r, "pagamento")).trim() : "", nota: String(val(r, "nota") || "").trim(), alt: String(val(r, "alterado") || "") };
      const ex = g.id ? byId.get(g.id) : null;
      if (ex && !ex.removido) {
        const same = ex.data === g.data && ex.valor === g.valor && (!mp("estabelecimento") || (ex.estabelecimento || "") === g.estabelecimento) && (!mp("categoria") || !cname || catOf(ex.categoriaId).nome === cname) && (!mp("nota") || (ex.nota || "") === g.nota) && (!mp("pagamento") || !g.pagamento || ex.pagamento === g.pagamento);
        if (same) P.igual++; else if (!g.alt || ex.alteradoEm > g.alt) P.conf.push(g); else P.atual.push({ g, ex });
        return;
      }
      const h = CG.hashDup(g); if (seen.has(h)) { P.dups.push(g); return; } seen.add(h); P.novos.push(g);
    });
    const mp = k => IM.map[k] >= 0; IM.P = P; const parts = [`${P.novos.length} novos`, `${P.atual.length} atualizados`, `${P.conf.length} em conflito`, `${P.dups.length} possíveis duplicados`, `${P.igual} sem mudança`, `${P.erros.length} com erro`];
    $("#i-sum").innerHTML = `<p><strong>${parts.join(" · ")}</strong></p>${P.newCats.size ? `<p>Categorias novas que serão criadas: ${[...P.newCats].map(esc).join(", ")}. Se for erro de digitação, corrija a planilha e importe de novo.</p>` : ""}${P.conf.length ? `<p class="small">“Em conflito”: o caderno tem uma versão mais nova do gasto, ou a planilha não traz a coluna “Alterado em”. Eles só mudam se você marcar a opção abaixo.</p>` : ""}${P.atual.length ? `<details class="dt"><summary>Ver o que será atualizado (${P.atual.length})</summary><ul class="dl">${P.atual.slice(0, 20).map(({ g, ex }) => `<li>${CG.fmtDate(ex.data)} · ${esc(ex.estabelecimento || "Sem nome")}<small>${[ex.data !== g.data ? `data ${CG.fmtDate(ex.data)} → ${CG.fmtDate(g.data)}` : "", ex.valor !== g.valor ? `valor ${brl(ex.valor)} → ${brl(g.valor)}` : "", mp("estabelecimento") && (ex.estabelecimento || "") !== g.estabelecimento ? `local “${esc(ex.estabelecimento || "")}” → “${esc(g.estabelecimento)}”` : "", mp("nota") && (ex.nota || "") !== g.nota ? "anotação" : "", mp("categoria") && g.cname && catOf(ex.categoriaId).nome !== g.cname ? `categoria ${esc(catOf(ex.categoriaId).nome)} → ${esc(g.cname)}` : ""].filter(Boolean).join("; ")}</small></li>`).join("")}</ul></details>` : ""}${P.erros.length ? `<p class="small">${P.erros.slice(0, 5).map(esc).join("<br>")}${P.erros.length > 5 ? `<br>… e mais ${P.erros.length - 5}` : ""}</p>` : ""}${IM.meta && IM.meta.hash ? `<p class="small">Planilha gerada por este caderno em ${esc(String(IM.meta.exportadoEm || "").slice(0, 10))}.</p>` : ""}`;
    const ok = !(IM.map.data < 0 || IM.map.valor < 0); $("#i-ok").disabled = !ok; if (!ok) { $("#i-err").textContent = "Escolha as colunas de Data e Valor."; $("#i-err").hidden = false; } else $("#i-err").hidden = true;
  }
  $("#i-cancel").onclick = () => id_.close(); id_.addEventListener("close", () => { if (iOpener && iOpener.isConnected) iOpener.focus(); });
  $("#i-form").addEventListener("submit", async e => {
    e.preventDefault(); if (IM.busy) return; IM.busy = true; const P = IM.P, withDups = $("#i-dups").checked, withConf = $("#i-conf").checked; const btn = $("#i-ok"); btn.disabled = true;
    await Ver.create(S.gastos, S.cats, "pre-import", IM.name); const now = new Date().toISOString(), put = [], cats = [];
    for (const n of P.newCats) { const c = { id: "c" + uid(), nome: n, cor: PALETTE[(S.cats.length + cats.length) % PALETTE.length], meta: 0, ordem: S.cats.length + cats.length }; cats.push(c); }
    if (cats.length) { await DB.putMany("categorias", cats); S.cats.push(...cats); }
    const cid = g => g.categoriaId || (g.cname ? (catByName(g.cname) || {}).id : null) || (S.cats.find(c => norm(c.nome) === "outros") || S.cats[0]).id;
    const mk = (g, id) => ({ id: id || uid(), data: g.data, valor: g.valor, moeda: "BRL", estabelecimento: g.estabelecimento, categoriaId: cid(g), pagamento: g.pagamento || "Outro", nota: g.nota, origem: "import", confianca: "", criadoEm: now, alteradoEm: now, removido: false, fotoId: null });
    P.novos.forEach(g => { const ex = g.id && S.gastos.find(x => x.id === g.id); put.push(mk(g, ex ? null : g.id)); });
    if (withDups) P.dups.forEach(g => put.push(mk(g)));
    const mp = k => IM.map[k] >= 0, upd = (ex, g) => ({ ...ex, data: g.data, valor: g.valor, estabelecimento: mp("estabelecimento") ? g.estabelecimento : ex.estabelecimento, categoriaId: mp("categoria") && g.cname ? cid(g) : ex.categoriaId, pagamento: mp("pagamento") && g.pagamento ? g.pagamento : ex.pagamento, nota: mp("nota") ? g.nota : ex.nota, alteradoEm: now });
    P.atual.forEach(({ g, ex }) => put.push(upd(ex, g)));
    if (withConf) P.conf.forEach(g => { const ex = S.gastos.find(x => x.id === g.id); if (ex) put.push(upd(ex, g)); });
    await DB.putMany("gastos", put); put.forEach(g => { const i = S.gastos.findIndex(x => x.id === g.id); if (i >= 0) S.gastos[i] = g; else S.gastos.push(g); }); await touch(put.length);
    id_.close(); S.f._init = false; render(); say(`Importação concluída: ${put.length} lançamentos.`); T.toast(`${put.length} lançamentos importados.`); showAlertOK(`Importação concluída: ${put.length} lançamentos. Uma versão “antes de importar” foi guardada em Planilha e versões.`);
  });
  function showAlertOK(m) { alertBox.className = "note-box"; alertBox.innerHTML = `<p>${esc(m)}</p><button class="link" type="button" id="alert-x">Dispensar</button>`; alertBox.hidden = false; $("#alert-x").onclick = () => { alertBox.hidden = true; alertBox.className = "state error"; }; }

  /* ---------- planilha e versões ---------- */
  const KIND = { dia: "Automática do dia", auto: "Automática", manual: "Salva por você", "pre-import": "Antes de importar", "pre-restore": "Antes de restaurar" };
  async function rBackup() {
    const lb = S.meta.lastBackup; $("#bkstatus").textContent = lb ? `Último backup: ${new Date(lb).toLocaleString("pt-BR")}. ${S.meta.changes} ${S.meta.changes === 1 ? "alteração" : "alterações"} desde então.` : "Você ainda não baixou a planilha.";
    const u = await DB.usage(); $("#stor").textContent = (u ? `Armazenamento usado: ${(u.used / 1048576).toFixed(1).replace(".", ",")} MB. ` : "") + "Se o navegador limpar os dados do site, só a planilha baixada protege o caderno.";
    const vs = await Ver.list(); $("#vers").innerHTML = vs.length ? vs.map(v => `<li class="ver"><div><b>${esc(v.label || KIND[v.kind] || v.kind)}</b><small>${new Date(v.at).toLocaleString("pt-BR")} · ${esc(KIND[v.kind] || "")} · ${v.n} lançamentos · ${brl(v.total)}</small></div><div class="vact"><button class="btn sm" type="button" data-vcmp="${v.id}">Comparar</button><button class="btn sm" type="button" data-vres="${v.id}">Restaurar</button>${v.kind === "manual" ? `<button class="btn sm danger" type="button" data-vdel="${v.id}">Excluir</button>` : ""}</div></li>`).join("") : '<li class="muted">Ainda não há versões. Elas aparecem na primeira mudança do dia, antes de importar e quando você salvar uma.</li>';
  }
  const vd = $("#vdlg"); let vOpener = null;
  $("#savever").onclick = e => { vOpener = e.currentTarget; $("#v-label").value = ""; vd.showModal(); $("#v-label").focus(); };
  $("#v-cancel").onclick = () => vd.close(); vd.addEventListener("close", () => { if (vOpener && vOpener.isConnected) vOpener.focus(); });
  $("#v-form").addEventListener("submit", async e => { e.preventDefault(); await Ver.create(S.gastos, S.cats, "manual", $("#v-label").value.trim()); vd.close(); rBackup(); say("Versão salva."); T.toast("Versão salva."); });
  $("#vers").addEventListener("click", async e => {
    const c = e.target.closest("[data-vcmp]"), r = e.target.closest("[data-vres]"), d = e.target.closest("[data-vdel]");
    if (c) openDiff(c.dataset.vcmp, c.currentTarget || c);
    if (d) { if (confirm("Excluir esta versão? Isso não pode ser desfeito.")) { await DB.del("versoes", d.dataset.vdel); rBackup(); } }
    if (r) { const v = (await Ver.list()).find(x => x.id === r.dataset.vres); if (!v) return; if (!confirm(`Restaurar a versão de ${new Date(v.at).toLocaleString("pt-BR")}? O estado atual será salvo como uma versão antes, então nada se perde.`)) return;
      await Ver.create(S.gastos, S.cats, "pre-restore", ""); const data = Ver.parse(v); await DB.clear("gastos"); await DB.clear("categorias"); await DB.putMany("gastos", data.gastos); await DB.putMany("categorias", data.categorias); await loadAll(); await sweepPhotos(); await touch(); S.f._init = false; S.sel.clear(); render(); say("Versão restaurada."); T.toast("Versão restaurada."); }
  });
  const dd = $("#ddlg"); let dOpener = null;
  async function openDiff(vid, opener) {
    dOpener = opener; const vs = await Ver.list(), opts = [...vs.map(v => [v.id, `${v.label || KIND[v.kind]} — ${new Date(v.at).toLocaleString("pt-BR")}`]), ["atual", "Estado atual"]];
    fillSelect($("#d-a"), opts, vid); fillSelect($("#d-b"), opts, "atual"); const go = async () => {
      const get = async id => id === "atual" ? { gastos: S.gastos, categorias: S.cats } : Ver.parse(vs.find(v => v.id === id)); const df = Ver.diff(await get($("#d-a").value), await get($("#d-b").value));
      const row = g => `${CG.fmtDate(g.data)} · ${esc(g.estabelecimento || "Sem nome")} · ${brl(g.valor)}`, lim = a => a.slice(0, 40);
      $("#d-out").innerHTML = `<p><strong>${df.added.length} adicionados · ${df.removed.length} removidos · ${df.changed.length} alterados</strong></p>` + (df.added.length ? `<h4>Adicionados</h4><ul class="dl">${lim(df.added).map(g => `<li>${row(g)}</li>`).join("")}</ul>` : "") + (df.removed.length ? `<h4>Removidos</h4><ul class="dl">${lim(df.removed).map(g => `<li>${row(g)}</li>`).join("")}</ul>` : "") + (df.changed.length ? `<h4>Alterados</h4><ul class="dl">${lim(df.changed).map(c => `<li>${row(c.depois)}<small>${c.campos.map(k => `${k}: ${esc(String(k === "valor" ? brl(c.antes[k]) : c.antes[k] == null ? "" : c.antes[k]))} → ${esc(String(k === "valor" ? brl(c.depois[k]) : c.depois[k] == null ? "" : c.depois[k]))}`).join("; ")}</small></li>`).join("")}</ul>` : "") + (!df.added.length && !df.removed.length && !df.changed.length ? "<p>As duas versões são iguais.</p>" : "");
    };
    $("#d-a").onchange = go; $("#d-b").onchange = go; await go(); dd.showModal();
  }
  $("#d-close").onclick = () => dd.close(); dd.addEventListener("close", () => { if (dOpener && dOpener.isConnected) dOpener.focus(); });
  async function sweepPhotos() {
    const ids = new Set(S.gastos.filter(g => !g.removido).map(g => g.id)), fotos = await DB.all("fotos"), have = new Set(fotos.map(f => f.id)), put = [];
    for (const f of fotos) if (!ids.has(f.id)) await DB.del("fotos", f.id);
    S.gastos.forEach(g => { if (g.fotoId && !have.has(g.fotoId)) { g.fotoId = null; put.push(g); } }); if (put.length) await DB.putMany("gastos", put);
  }
  const wd = $("#wdlg"); let wOpener = null;
  $("#wipe").onclick = e => { wOpener = e.currentTarget; $("#w-word").value = ""; $("#w-ok").disabled = true; wd.showModal(); $("#w-word").focus(); };
  $("#w-word").oninput = e => { $("#w-ok").disabled = e.target.value.trim().toUpperCase() !== "APAGAR"; };
  $("#w-dl").onclick = exportXlsx; $("#w-cancel").onclick = () => wd.close(); wd.addEventListener("close", () => { if (wOpener && wOpener.isConnected) wOpener.focus(); });
  $("#w-form").addEventListener("submit", async e => { e.preventDefault(); if ($("#w-word").value.trim().toUpperCase() !== "APAGAR") return; wd.close(); for (const s of ["gastos", "categorias", "fotos", "versoes", "meta"]) await DB.clear(s); await loadAll(); S.f._init = false; render(); T.toast("Tudo apagado."); say("Todos os dados foram apagados."); });
  $("#resetdata").onclick = () => { if (confirm("Isso remove as preferências desta ferramenta neste navegador (tema e filtros). Seus gastos continuam; para apagar tudo use Planilha e versões > Zona de risco. Continuar?")) { T.clear(); location.reload(); } };

  /* ---------- início do app ---------- */
  $("#y").textContent = new Date().getFullYear();
  (async function init() {
    await DB.open(); if (DB.volatile) $("#volatile").hidden = false; await loadAll();
    if (!location.hash) history.replaceState(null, "", "#/inicio"); route(true);
    if ("serviceWorker" in navigator && /^https:|^http:\/\/localhost/.test(location.href)) navigator.serviceWorker.register("sw.js").catch(() => {});
    window.__cg = { S, DB, Ver, render, route };   // para testes
  })();
})();
