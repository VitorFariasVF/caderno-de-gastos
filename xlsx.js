/* Caderno de Gastos — planilha Excel (.xlsx) e .zip sem biblioteca externa.
   Escrita: zip sem compressão. Leitura: zip com ou sem compressão (DecompressionStream "deflate-raw"). */
window.XLSX = (() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

  /* ---------- ZIP ---------- */
  function zip(files) {   // files: [{name, data:Uint8Array|string}]
    const parts = [], central = []; let offset = 0; const now = new Date();
    const dtime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), ddate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
      const name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, dtime, true); lh.setUint16(12, ddate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dtime, true); ch.setUint16(14, ddate, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name); offset += 30 + name.length + data.length;
    }
    const csize = central.reduce((s, p) => s + p.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }
  async function inflate(u8) { const ds = new DecompressionStream("deflate-raw"), w = ds.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }
  async function unzip(buf) {   // → Map nome → Uint8Array
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65600); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error("Não é um arquivo .xlsx válido (zip não encontrado).");
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = new Map();
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Arquivo danificado.");
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      const lnl = dv.getUint16(off + 26, true), lxl = dv.getUint16(off + 28, true), start = off + 30 + lnl + lxl, raw = u8.subarray(start, start + csize);
      if (/\/$/.test(name)) continue;
      out.set(name, method === 0 ? raw.slice() : method === 8 ? await inflate(raw) : (() => { throw new Error("Compressão não suportada."); })());
    }
    return out;
  }

  /* ---------- Escrita de planilha ---------- */
  const X = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const colName = i => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const serial = iso => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 864e5);
  /* célula: string | number | null | {t:"d"|"m"|"p"|"h", v} — d=data, m=moeda (valor em reais), p=0,00, h=cabeçalho */
  function cellXml(c, r, i) {
    if (c == null || c === "") return "";
    const ref = colName(i) + r; let t = "s", v = c, s = 0;
    if (typeof c === "object") { t = c.t; v = c.v; }
    if (t === "h") return `<c r="${ref}" s="1" t="inlineStr"><is><t>${X(v)}</t></is></c>`;
    if (t === "d") { if (!v) return ""; return `<c r="${ref}" s="2"><v>${serial(v)}</v></c>`; }
    if (t === "m") return `<c r="${ref}" s="3"><v>${v}</v></c>`;
    if (t === "p") return `<c r="${ref}" s="4"><v>${v}</v></c>`;
    if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${X(v)}</t></is></c>`;
  }
  function sheetXml(sh) {
    const rows = sh.rows.map((row, ri) => `<row r="${ri + 1}">${row.map((c, ci) => cellXml(c, ri + 1, ci)).join("")}</row>`).join("");
    const cols = sh.cols ? `<cols>${sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    const nc = Math.max(1, ...sh.rows.map(r => r.length)), view = `<sheetViews><sheetView workbookViewId="0">${sh.freeze ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ""}</sheetView></sheetViews>`;
    const filter = sh.filter ? `<autoFilter ref="A1:${colName(nc - 1)}${Math.max(1, sh.rows.length)}"/>` : "";
    const dv = sh.validations && sh.validations.length ? `<dataValidations count="${sh.validations.length}">${sh.validations.map(v => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${v.sqref}"><formula1>${X(v.formula)}</formula1></dataValidation>`).join("")}</dataValidations>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}${cols}<sheetData>${rows}</sheetData>${filter}${dv}</worksheet>`;
  }
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="&quot;R$&quot;\\ #,##0.00;[Red]\\-&quot;R$&quot;\\ #,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0B254"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  function build(sheets) {   // → Blob .xlsx
    const files = [];
    files.push({ name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` });
    files.push({ name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` });
    files.push({ name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${X(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` });
    files.push({ name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
    files.push({ name: "xl/styles.xml", data: STYLES });
    sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) }));
    const b = zip(files); return new Blob([b], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  /* ---------- Leitura ---------- */
  const colIndex = ref => { const m = /^([A-Z]+)/.exec(ref); let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const xml = u8 => new DOMParser().parseFromString(dec.decode(u8), "application/xml");
  const txt = el => [...el.getElementsByTagName("t")].map(t => t.textContent).join("");
  const isDateFmt = (id, code) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (code && /[dmyh]/i.test(code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "")) && !/[#0]/.test(code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "")));
  async function read(buf) {
    const files = await unzip(buf), wb = xml(files.get("xl/workbook.xml") || (() => { throw new Error("Não é uma planilha do Excel (.xlsx)."); })());
    const rels = new Map([...xml(files.get("xl/_rels/workbook.xml.rels")).getElementsByTagName("Relationship")].map(r => [r.getAttribute("Id"), r.getAttribute("Target")]));
    const shared = files.has("xl/sharedStrings.xml") ? [...xml(files.get("xl/sharedStrings.xml")).getElementsByTagName("si")].map(txt) : [];
    const dateXf = new Set();
    if (files.has("xl/styles.xml")) {
      const st = xml(files.get("xl/styles.xml")), codes = new Map([...st.getElementsByTagName("numFmt")].map(n => [+n.getAttribute("numFmtId"), n.getAttribute("formatCode")]));
      const xfs = st.getElementsByTagName("cellXfs")[0]; if (xfs) [...xfs.getElementsByTagName("xf")].forEach((x, i) => { const id = +x.getAttribute("numFmtId"); if (isDateFmt(id, codes.get(id))) dateXf.add(i); });
    }
    const sheets = [];
    for (const s of wb.getElementsByTagName("sheet")) {
      const rid = s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || s.getAttribute("r:id"); let target = rels.get(rid) || ""; target = target.replace(/^\//, ""); const path = target.startsWith("xl/") ? target : "xl/" + target;
      const data = files.get(path); if (!data) continue; const doc = xml(data), rows = [];
      for (const r of doc.getElementsByTagName("row")) {
        const ri = +r.getAttribute("r") - 1, row = [];
        for (const c of r.getElementsByTagName("c")) {
          const ci = colIndex(c.getAttribute("r")), t = c.getAttribute("t"), st = +(c.getAttribute("s") || 0), vEl = c.getElementsByTagName("v")[0]; let v = "";
          if (t === "inlineStr") v = txt(c); else if (vEl) { const raw = vEl.textContent; if (t === "s") v = shared[+raw] || ""; else if (t === "str" || t === "e") v = raw; else if (t === "b") v = raw === "1"; else { v = parseFloat(raw); if (dateXf.has(st)) v = { date: CG.parseDate(v) || "" }; } }
          row[ci] = v;
        }
        for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = "";
        rows[ri] = row;
      }
      for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
      sheets.push({ name: s.getAttribute("name"), state: s.getAttribute("state") || "visible", rows });
    }
    return { sheets, files };
  }
  return { build, read, zip, unzip, crc32 };
})();
