/* Caderno de Gastos — service worker: abre sem internet depois da primeira visita.
   Guarda o app e os arquivos compartilhados do VF Tools (CSS/JS do site). Nada de dados do usuário passa por aqui. */
const V = "cg-v1", SHELL = ["./", "index.html", "app.css", "app.js", "lib.js", "db.js", "xlsx.js", "qr.js", "charts.js", "tool.js", "manifest.webmanifest"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return; const u = new URL(r.url);
  const own = u.origin === location.origin, site = u.hostname === "vitorfariasvf.github.io" && u.pathname.startsWith("/VF-Tools/");
  if (!own && !site) return;
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(r, { ignoreSearch: true });
    const net = fetch(r).then(res => { if (res && (res.ok || res.type === "opaque")) c.put(r, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || new Response("Sem conexão e este arquivo ainda não foi guardado.", { status: 503 });
  }));
});
