// Scriitor XLSX (OOXML) fără dependențe: foi, stiluri fixe, sharedStrings, formule cu cache,
// autoFilter, panouri înghețate, grafice native (vezi charts.js).
import { createZip } from './zip.js';
import { chartXml, drawingXml, esc } from './charts.js';
import { minorToDecimal, currencyExpLocal } from './csv-export.js';

export const ST = {
  DEFAULT: 0, HEADER: 1, MONEY: 2, MONEY0: 3, DATE: 4, TEXT: 5, PCT: 6, MONEY_B: 7,
  INT: 8, BOLD: 9, TITLE: 10, KM: 11, NOTE: 12, MONEY0_B: 13, DATETIME: 14, WARN: 15,
};

const XML_HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export { esc };

export function colLetter(i0) { // 0 -> A
  let n = i0 + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } // money-ok: indici de coloană / serial de dată, nu bani
  return s;
}

export function isoToSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000); // money-ok: indici de coloană / serial de dată, nu bani
}
function isoDtToSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(iso || '');
  if (!m) return null;
  const day = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000); // money-ok: indici de coloană / serial de dată, nu bani
  const frac = (+m[4] * 3600 + +m[5] * 60 + (+m[6] || 0)) / 86400;
  return String(day + Math.round(frac * 1e8) / 1e8); // money-ok: indici de coloană / serial de dată, nu bani
}

export function sanitizeSheetName(name, taken) {
  let n = String(name).replace(/[\[\]:*?\/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Foaie';
  let base = n, i = 2;
  while (taken.has(n.toLowerCase())) { const suf = ' ' + i++; n = base.slice(0, 31 - suf.length) + suf; }
  return n;
}

const DEC_RE = /^-?\d+(\.\d+)?$/;

export class Sheet {
  constructor(wb, name) {
    this.wb = wb; this.name = name; this.rows = []; // rows[r] = Map(col -> xml string)
    this.rowHeights = new Map(); this.cols = []; this.freeze = null; this.filter = null;
    this.charts = []; this.merges = []; this.maxCol = 0; this.tabColor = null;
  }
  /** Cell spec -> xml; vezi documentația modulului. */
  _cellXml(ref, spec, defStyle) {
    if (spec === null || spec === undefined || spec === '') return defStyle ? `<c r="${ref}" s="${defStyle}"/>` : '';
    let o = spec;
    if (typeof spec !== 'object') o = { v: spec };
    let s = o.s ?? defStyle ?? 0;
    const st = s ? ` s="${s}"` : '';
    if (o.f !== undefined) {
      const cached = o.v === undefined || o.v === null ? '' : (typeof o.v === 'string' && !DEC_RE.test(o.v) ? '' : `<v>${o.v}</v>`);
      const isStr = typeof o.v === 'string' && !DEC_RE.test(o.v);
      return `<c r="${ref}"${st}${isStr ? ' t="str"' : ''}><f>${esc(o.f)}</f>${isStr ? `<v>${esc(o.v)}</v>` : cached}</c>`;
    }
    if (o.m !== undefined && o.m !== null) {
      const cur = o.cur || 'RON';
      const exp = o.exp ?? currencyExpLocal(cur);
      if (!o.s) s = exp === 0 ? ST.MONEY0 : ST.MONEY;
      return `<c r="${ref}" s="${s}"><v>${minorToDecimal(o.m, exp)}</v></c>`;
    }
    if (o.n !== undefined && o.n !== null) {
      if (!DEC_RE.test(String(o.n))) throw new Error('Număr invalid în celulă ' + ref + ': ' + o.n);
      return `<c r="${ref}"${st}><v>${o.n}</v></c>`;
    }
    if (o.d !== undefined && o.d !== null) {
      const ser = isoToSerial(o.d);
      if (ser === null) return `<c r="${ref}"${st} t="s"><v>${this.wb._sst(String(o.d))}</v></c>`;
      return `<c r="${ref}" s="${o.s ?? ST.DATE}"><v>${ser}</v></c>`;
    }
    if (o.dt !== undefined && o.dt !== null) {
      const ser = isoDtToSerial(o.dt);
      if (ser === null) return `<c r="${ref}"${st} t="s"><v>${this.wb._sst(String(o.dt))}</v></c>`;
      return `<c r="${ref}" s="${o.s ?? ST.DATETIME}"><v>${ser}</v></c>`;
    }
    const v = o.v;
    if (v === null || v === undefined || v === '') return `<c r="${ref}"${st}/>`;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return `<c r="${ref}"${st}/>`;
      return `<c r="${ref}"${st}><v>${v}</v></c>`;
    }
    if (typeof v === 'boolean') return `<c r="${ref}"${st} t="b"><v>${v ? 1 : 0}</v></c>`;
    let str = String(v);
    if (str.length > 32767) str = str.slice(0, 32767);
    return `<c r="${ref}"${st} t="s"><v>${this.wb._sst(str)}</v></c>`;
  }
  /** Adaugă un rând (1-based la întoarcere). */
  addRow(cells, o = {}) {
    const r = this.rows.length + 1;
    const m = new Map();
    cells.forEach((c, i) => {
      const x = this._cellXml(colLetter(i) + r, c, o.style);
      if (x) m.set(i, x);
    });
    this.maxCol = Math.max(this.maxCol, cells.length);
    this.rows.push(m);
    if (o.height) this.rowHeights.set(r, o.height);
    return r;
  }
  addHeader(labels) { return this.addRow(labels.map((l) => ({ v: l, s: ST.HEADER })), { height: 30 }); }
  blank() { this.rows.push(new Map()); return this.rows.length; }
  setCols(widths) { this.cols = widths; }
  freezeAt(row, col = 0) { this.freeze = { row, col }; }
  autoFilter(rowHeader, lastRow, ncols) { this.filter = { r1: rowHeader, r2: Math.max(lastRow, rowHeader), n: ncols }; }
  merge(r1, c1, r2, c2) { this.merges.push(`${colLetter(c1)}${r1}:${colLetter(c2)}${r2}`); }
  /** Grafic nativ; spec din charts.js. anchor: {col,row,toCol,toRow} 0-based. */
  addChart(spec, anchor) { this.charts.push({ spec, anchor }); }
  get lastRow() { return this.rows.length; }
  ref(col0, r1, r2) {
    const q = `'${this.name.replace(/'/g, "''")}'`;
    return r2 === undefined ? `${q}!$${colLetter(col0)}$${r1}` : `${q}!$${colLetter(col0)}$${r1}:$${colLetter(col0)}$${r2}`;
  }

  xml(drawingRid) {
    let dimEndRow = Math.max(this.rows.length, 1);
    let out = XML_HDR + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    if (this.tabColor) out += `<sheetPr><tabColor rgb="${this.tabColor}"/></sheetPr>`;
    out += `<dimension ref="A1:${colLetter(Math.max(this.maxCol, 1) - 1)}${dimEndRow}"/>`;
    out += `<sheetViews><sheetView workbookViewId="0"${this.wb._firstSheet === this ? ' tabSelected="1"' : ''}${this.hideGrid ? ' showGridLines="0"' : ''}>`;
    if (this.freeze) {
      const { row, col } = this.freeze;
      const tl = `${colLetter(col)}${row + 1}`;
      const pane = row && col ? 'bottomRight' : row ? 'bottomLeft' : 'topRight';
      out += `<pane${col ? ` xSplit="${col}"` : ''}${row ? ` ySplit="${row}"` : ''} topLeftCell="${tl}" activePane="${pane}" state="frozen"/><selection pane="${pane}"/>`;
    }
    out += '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>';
    if (this.cols.length) {
      out += '<cols>' + this.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
    }
    out += '<sheetData>';
    this.rows.forEach((m, idx) => {
      const r = idx + 1;
      const h = this.rowHeights.get(r);
      if (!m.size && !h) return;
      const keys = [...m.keys()].sort((a, b) => a - b);
      out += `<row r="${r}"${h ? ` ht="${h}" customHeight="1"` : ''}>` + keys.map((k) => m.get(k)).join('') + '</row>';
    });
    out += '</sheetData>';
    if (this.filter) out += `<autoFilter ref="A${this.filter.r1}:${colLetter(this.filter.n - 1)}${this.filter.r2}"/>`;
    if (this.merges.length) out += `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`;
    out += '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>';
    out += '<pageSetup paperSize="9" orientation="landscape"/>';
    if (drawingRid) out += `<drawing r:id="${drawingRid}"/>`;
    return out + '</worksheet>';
  }
}

const STYLES_XML = XML_HDR + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="5"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd\\.mm\\.yyyy"/><numFmt numFmtId="166" formatCode="0.0%"/><numFmt numFmtId="167" formatCode="#,##0.0"/><numFmt numFmtId="168" formatCode="dd\\.mm\\.yyyy\\ hh:mm"/></numFmts>
<fonts count="5"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="16"/><color theme="1"/><name val="Calibri"/><family val="2"/></font><font><i/><sz val="10"/><color rgb="FF595959"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="16">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="3" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export class XlsxWorkbook {
  constructor(meta = {}) {
    this.sheets = []; this.names = new Set(); this._ss = new Map(); this._ssCount = 0;
    this.meta = { title: 'Flota costuri', creator: 'Flota costuri', created: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), ...meta };
    this._firstSheet = null;
  }
  _sst(s) {
    this._ssCount++;
    let i = this._ss.get(s);
    if (i === undefined) { i = this._ss.size; this._ss.set(s, i); }
    return i;
  }
  addSheet(name) {
    const n = sanitizeSheetName(name, this.names);
    this.names.add(n.toLowerCase());
    const sh = new Sheet(this, n);
    this.sheets.push(sh);
    if (!this._firstSheet) this._firstSheet = sh;
    return sh;
  }

  async build({ compress = true } = {}) {
    const files = [];
    const ct = [];
    const chartParts = [];
    const sheetXmls = [];
    let chartNo = 0, drawingNo = 0;
    const sheetRels = [];
    this.sheets.forEach((sh, i) => {
      const n = i + 1;
      let rid = null;
      if (sh.charts.length) {
        drawingNo++;
        rid = 'rId1';
        sheetRels[n] = `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNo}.xml"/>`;
        const anchors = [];
        const drels = [];
        sh.charts.forEach((c, k) => {
          chartNo++;
          chartParts.push({ no: chartNo, xml: chartXml(c.spec) });
          drels.push(`<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNo}.xml"/>`);
          anchors.push({ rid: `rId${k + 1}`, name: `Grafic ${chartNo}`, id: k + 2, ...c.anchor });
        });
        files.push({ name: `xl/drawings/drawing${drawingNo}.xml`, data: drawingXml(anchors) });
        files.push({ name: `xl/drawings/_rels/drawing${drawingNo}.xml.rels`, data: XML_HDR + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drels.join('')}</Relationships>` });
        ct.push(`<Override PartName="/xl/drawings/drawing${drawingNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
      }
      sheetXmls.push(sh.xml(rid));
    });
    for (const c of chartParts) {
      files.push({ name: `xl/charts/chart${c.no}.xml`, data: c.xml });
      ct.push(`<Override PartName="/xl/charts/chart${c.no}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
    }
    const sheetFiles = [];
    this.sheets.forEach((sh, i) => {
      const n = i + 1;
      sheetFiles.push({ name: `xl/worksheets/sheet${n}.xml`, data: sheetXmls[i] });
      if (sheetRels[n]) sheetFiles.push({ name: `xl/worksheets/_rels/sheet${n}.xml.rels`, data: XML_HDR + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels[n]}</Relationships>` });
      ct.unshift(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    });
    // sharedStrings (după ce toate foile și-au scris celulele)
    let sst = XML_HDR + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this._ssCount}" uniqueCount="${this._ss.size}">`;
    for (const s of this._ss.keys()) sst += `<si><t${/^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : ''}>${esc(s)}</t></si>`;
    sst += '</sst>';

    const defined = this.sheets.map((sh, i) => sh.filter
      ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${sh.name.replace(/'/g, "''")}'!$A$${sh.filter.r1}:$${colLetter(sh.filter.n - 1)}$${sh.filter.r2}</definedName>` : '').join('');
    const wbXml = XML_HDR + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr defaultThemeVersion="124226"/><bookViews><workbookView xWindow="240" yWindow="15" windowWidth="16095" windowHeight="9660"/></bookViews><sheets>'
      + this.sheets.map((sh, i) => `<sheet name="${esc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + '</sheets>' + (defined ? `<definedNames>${defined}</definedNames>` : '') + '<calcPr calcId="124519" fullCalcOnLoad="1"/></workbook>';
    const n = this.sheets.length;
    const wbRels = XML_HDR + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + this.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + `<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
    const contentTypes = XML_HDR + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + ct.join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
    const m = this.meta;
    const core = XML_HDR + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(m.title)}</dc:title><dc:creator>${esc(m.creator)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${esc(m.created)}</dcterms:created></cp:coreProperties>`;
    const app = XML_HDR + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application><AppVersion>12.0000</AppVersion></Properties>';
    const rootRels = XML_HDR + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';
    const all = [
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rootRels },
      { name: 'docProps/app.xml', data: app },
      { name: 'docProps/core.xml', data: core },
      { name: 'xl/workbook.xml', data: wbXml },
      { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
      { name: 'xl/styles.xml', data: STYLES_XML },
      { name: 'xl/sharedStrings.xml', data: sst },
      ...sheetFiles, ...files,
    ];
    return createZip(all, { compress });
  }
}
