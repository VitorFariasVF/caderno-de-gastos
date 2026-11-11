/* Caderno de Gastos — utilidades: dinheiro em centavos, datas ISO, texto, CSV, CNPJ. Tudo local. */
window.CG = (() => {
  const brlFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const norm = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const brl = c => brlFmt.format((c || 0) / 100).replace("-R$", "−R$").replace(/ /g, " ");
  const num = c => ((c || 0) / 100).toFixed(2).replace(".", ",");

  /* "R$ 1.234,56" · "1234.56" · "12,5" · "-12,50" · "(12,50)" → centavos, ou null */
  function parseMoney(v) {
    if (typeof v === "number") return isFinite(v) ? Math.round(v * 100) : null;
    let s = String(v == null ? "" : v).trim(); if (!s) return null;
    let neg = false; if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/r\$|\s/gi, ""); if (/^[-−–]/.test(s)) { neg = !neg; s = s.slice(1); } if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    if (!/^[\d.,]+$/.test(s)) return null;
    const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
    if (lc >= 0 && ld >= 0) { if (lc > ld) s = s.replace(/\./g, "").replace(",", "."); else s = s.replace(/,/g, ""); }
    else if (lc >= 0) { s = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, "") : s.replace(",", "."); }
    else if (ld >= 0) { if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, ""); }
    const n = parseFloat(s); if (!isFinite(n)) return null; const c = Math.round(n * 100); return neg ? -c : c;
  }
  const pad = n => String(n).padStart(2, "0");
  const okDate = (y, m, d) => { const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d; };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  /* dd/mm/aaaa · dd/mm/aa · aaaa-mm-dd · serial do Excel → "AAAA-MM-DD" ou null */
  function parseDate(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") { if (v < 20000 || v > 80000) return null; const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
    const s = String(v).trim(); let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return okDate(+m[1], +m[2], +m[3]) ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : null;
    if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(s))) { let y = +m[3]; if (y < 100) y += 2000; return okDate(y, +m[2], +m[1]) ? `${y}-${pad(+m[2])}-${pad(+m[1])}` : null; }
    if (/^\d{5}(\.\d+)?$/.test(s)) return parseDate(parseFloat(s));
    return null;
  }
  const fmtDate = iso => iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "";
  const monthKey = iso => iso.slice(0, 7);
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const monthLabel = k => MESES[+k.slice(5, 7) - 1] + " de " + k.slice(0, 4);
  const monthShort = k => MESES[+k.slice(5, 7) - 1].slice(0, 3) + "/" + k.slice(2, 4);
  const addMonths = (k, n) => { const y = +k.slice(0, 4), m = +k.slice(5, 7) - 1 + n; const d = new Date(y, m, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const daysIn = k => new Date(+k.slice(0, 4), +k.slice(5, 7), 0).getDate();
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const hashDup = g => `${g.data}|${g.valor}|${norm(g.estabelecimento)}`;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fnv = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, "0"); };

  /* CSV: detecta ; , ou tab; aspas; devolve matriz de strings */
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, ""); const first = text.split(/\r?\n/, 1)[0] || "";
    const cnt = ch => (first.match(new RegExp(ch === "\t" ? "\t" : "\\" + ch, "g")) || []).length; const d = [";", ",", "\t"].sort((a, b) => cnt(b) - cnt(a))[0];
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true; else if (c === d) { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some(x => x !== "")) rows.push(row); row = []; }
      else cur += c;
    }
    row.push(cur); if (row.some(x => x !== "")) rows.push(row); return rows;
  }
  const cnpjOk = s => {
    s = String(s).replace(/\D/g, ""); if (s.length !== 14 || /^(\d)\1+$/.test(s)) return false;
    const dv = n => { let sum = 0, w = n - 7; for (let i = 0; i < n; i++) { sum += +s[i] * w--; if (w < 2) w = 9; } const r = sum % 11; return r < 2 ? 0 : 11 - r; };
    return dv(12) === +s[12] && dv(13) === +s[13];
  };
  const fmtCnpj = s => { s = String(s).replace(/\D/g, ""); return s.length === 14 ? `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}` : s; };
  return { norm, brl, num, parseMoney, parseDate, today, fmtDate, monthKey, monthLabel, monthShort, addMonths, daysIn, uid, hashDup, esc, fnv, parseCSV, cnpjOk, fmtCnpj, pad };
})();
