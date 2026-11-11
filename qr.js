/* Caderno de Gastos — leitura do QR Code da nota fiscal (NFC-e) e processamento de foto. Tudo local. */
window.QR = (() => {
  const UF = { 11: "RO", 12: "AC", 13: "AM", 14: "RR", 15: "PA", 16: "AP", 17: "TO", 21: "MA", 22: "PI", 23: "CE", 24: "RN", 25: "PB", 26: "PE", 27: "AL", 28: "SE", 29: "BA", 31: "MG", 32: "ES", 33: "RJ", 35: "SP", 41: "PR", 42: "SC", 43: "RS", 50: "MS", 51: "MT", 52: "GO", 53: "DF" };
  const supported = () => "BarcodeDetector" in window;
  /* Procura QR Codes numa imagem (ImageBitmap/canvas). Devolve textos lidos ou []. */
  async function scan(source) {
    if (!supported()) return [];
    try { const d = new BarcodeDetector({ formats: ["qr_code"] }); return (await d.detect(source)).map(b => b.rawValue).filter(Boolean); } catch (_) { return []; }
  }
  /* Extrai o que a chave de acesso (44 dígitos) e a URL trazem. A chave NÃO traz o valor; só algumas URLs trazem vNF. */
  function parseNota(text) {
    const out = { texto: text };
    const m = /(\d[\d\s]{42,60}\d)/.exec(text.replace(/[|=&?]/g, " ")); let key = null;
    if (m) { const d = m[1].replace(/\s/g, ""); const k = /\d{44}/.exec(d); if (k) key = k[0]; }
    if (key) {
      out.chave = key; out.uf = UF[+key.slice(0, 2)] || ""; const aa = key.slice(2, 4), mm = key.slice(4, 6); if (+mm >= 1 && +mm <= 12) out.mes = `20${aa}-${mm}`;
      out.cnpj = key.slice(6, 20); out.cnpjValido = CG.cnpjOk(out.cnpj); out.modelo = key.slice(20, 22); out.numero = String(+key.slice(25, 34));
    }
    const v = /[?&;|](?:vNF|vnf|valor|vTotal)=([\d.,]+)/i.exec(text); if (v) { const c = CG.parseMoney(v[1]); if (c != null) out.valor = c; }
    const dt = /[?&;|](?:dhEmi|dtEmi|data)=([^&|;]+)/i.exec(text); if (dt) { const d = CG.parseDate(decodeURIComponent(dt[1]).slice(0, 10)); if (d) out.data = d; }
    return out;
  }
  /* Foto → { blob (≤1600 px, JPEG .7), thumb (200 px), canvas, qr: [textos] }. Corrige a rotação EXIF. */
  async function prepPhoto(file) {
    let bmp; try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_) { bmp = await createImageBitmap(file); }
    const MAX = 1600, s = Math.min(1, MAX / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    let qr = await scan(bmp); if (!qr.length) qr = await scan(c);
    bmp.close && bmp.close();
    const toBlob = (cv, q) => new Promise(r => cv.toBlob(r, "image/jpeg", q));
    const blob = await toBlob(c, .7), ts = 200 / Math.max(w, h), t = document.createElement("canvas"); t.width = Math.max(1, Math.round(w * ts)); t.height = Math.max(1, Math.round(h * ts)); t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
    return { blob, thumb: await toBlob(t, .6), w, h, qr };
  }
  return { supported, scan, parseNota, prepPhoto };
})();
