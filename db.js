/* Caderno de Gastos — armazenamento (IndexedDB) e controle de versões. Nada sai do aparelho.
   Lojas: gastos, categorias, fotos, versoes, meta. Se o IndexedDB não existir (aba anônima), usa memória e avisa. */
window.DB = (() => {
  const NAME = "caderno-de-gastos", STORES = { gastos: "id", categorias: "id", fotos: "id", versoes: "id", meta: "key" };
  let db = null; const mem = {}; let volatile = false;
  const open = () => new Promise(res => {
    const fallback = () => { volatile = true; Object.keys(STORES).forEach(s => { mem[s] = mem[s] || new Map(); }); res(); };
    if (!window.indexedDB) return fallback();
    let req; try { req = indexedDB.open(NAME, 1); } catch (e) { return fallback(); }
    req.onupgradeneeded = () => { const d = req.result; for (const [s, k] of Object.entries(STORES)) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: k }); };
    req.onsuccess = () => { db = req.result; db.onversionchange = () => db.close(); res(); };
    req.onerror = req.onblocked = fallback;
  });
  const run = (store, mode, fn) => new Promise((res, rej) => {
    const t = db.transaction(store, mode), st = t.objectStore(store); let out;
    out = fn(st); t.oncomplete = () => res(out && "result" in out ? out.result : out); t.onerror = t.onabort = () => rej(t.error);
  });
  const all = store => volatile ? Promise.resolve([...mem[store].values()]) : run(store, "readonly", s => s.getAll());
  const get = (store, key) => volatile ? Promise.resolve(mem[store].get(key)) : run(store, "readonly", s => s.get(key));
  const put = (store, obj) => volatile ? (mem[store].set(obj[STORES[store]], obj), Promise.resolve()) : run(store, "readwrite", s => { s.put(obj); });
  const putMany = (store, arr) => volatile ? (arr.forEach(o => mem[store].set(o[STORES[store]], o)), Promise.resolve()) : run(store, "readwrite", s => { arr.forEach(o => s.put(o)); });
  const del = (store, key) => volatile ? (mem[store].delete(key), Promise.resolve()) : run(store, "readwrite", s => { s.delete(key); });
  const clear = store => volatile ? (mem[store].clear(), Promise.resolve()) : run(store, "readwrite", s => { s.clear(); });
  const meta = {
    get: async (k, d) => { const r = await get("meta", k); return r ? r.value : d; },
    set: (k, v) => put("meta", { key: k, value: v })
  };
  const usage = async () => { try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } } catch (_) {} return null; };
  const persist = async () => { try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch (_) { return false; } };
  return { open, all, get, put, putMany, del, clear, meta, usage, persist, get volatile() { return volatile; } };
})();

/* ---------- Versões: cada versão é uma cópia completa dos dados (sem fotos) ---------- */
window.Ver = (() => {
  const KEEP_AUTO = 30;
  const FIELDS = ["data", "valor", "estabelecimento", "categoriaId", "pagamento", "nota", "origem"];
  const snapData = (gastos, cats) => ({ gastos: gastos.map(g => ({ ...g })), categorias: cats.map(c => ({ ...c })) });
  async function create(gastos, cats, kind, label) {
    const live = gastos.filter(g => !g.removido), data = snapData(gastos, cats), json = JSON.stringify(data);
    const v = { id: CG.uid(), at: Date.now(), kind, label: label || "", n: live.length, total: live.reduce((s, g) => s + g.valor, 0), hash: CG.fnv(json), json };
    await DB.put("versoes", v); await prune(); return v;
  }
  async function list() { return (await DB.all("versoes")).sort((a, b) => b.at - a.at); }
  async function prune() {
    const l = await list(), auto = l.filter(v => v.kind === "auto" || v.kind === "dia");
    for (const v of auto.slice(KEEP_AUTO)) await DB.del("versoes", v.id);
  }
  const parse = v => JSON.parse(v.json);
  /* diferenças por id entre duas fotografias { gastos, categorias } */
  function diff(a, b) {
    const A = new Map(a.gastos.filter(g => !g.removido).map(g => [g.id, g])), B = new Map(b.gastos.filter(g => !g.removido).map(g => [g.id, g]));
    const added = [], removed = [], changed = [];
    for (const [id, g] of B) { const o = A.get(id); if (!o) added.push(g); else { const f = FIELDS.filter(k => String(o[k] == null ? "" : o[k]) !== String(g[k] == null ? "" : g[k])); if (f.length) changed.push({ id, antes: o, depois: g, campos: f }); } }
    for (const [id, g] of A) if (!B.has(id)) removed.push(g);
    return { added, removed, changed };
  }
  return { create, list, parse, diff, FIELDS };
})();
