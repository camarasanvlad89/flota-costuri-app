// Grafice native Excel (DrawingML chart). Ordinea elementelor urmează schema ECMA-376
// (și rezultatul XlsxWriter): Excel dă „repair” la orice abatere de ordine.
//
// spec: {
//   type: 'col'|'bar'|'line',  grouping: 'clustered'|'stacked'|'percentStacked',
//   title, catTitle?, valTitle?, valFmt?: '#,##0.00', legend?: boolean (implicit: >1 serie),
//   series: [{ name, nameRef?, catRef, valRef, cats: string[], vals: number[], color?: 'RRGGBB', invertColors?: boolean }]
// }

function esc(s) {
  return String(s)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export { esc };

const PALETTE = ['1F4E79', 'C55A11', '548235', '7F6000', '7030A0', '2E75B6', 'A5A5A5'];
const NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function txRich(text, sz = 1400, bold = true) {
  return `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${bold ? 1 : 0}"/></a:pPr><a:r><a:rPr lang="ro-RO" sz="${sz}" b="${bold ? 1 : 0}"/><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx>`;
}
function axisTitle(text) {
  return text ? `<c:title>${txRich(text, 1000, false)}<c:overlay val="0"/></c:title>` : '';
}
function strCache(arr) {
  return `<c:strCache><c:ptCount val="${arr.length}"/>${arr.map((s, i) => `<c:pt idx="${i}"><c:v>${esc(s)}</c:v></c:pt>`).join('')}</c:strCache>`;
}
function numCache(arr, fmt) {
  return `<c:numCache><c:formatCode>${esc(fmt)}</c:formatCode><c:ptCount val="${arr.length}"/>${arr.map((v, i) => (v === null || v === undefined || !Number.isFinite(v) ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('')}</c:numCache>`;
}

function serXml(s, idx, spec) {
  const color = s.color || PALETTE[idx % PALETTE.length];
  let x = `<c:ser><c:idx val="${idx}"/><c:order val="${idx}"/>`;
  if (s.nameRef) x += `<c:tx><c:strRef><c:f>${esc(s.nameRef)}</c:f>${strCache([s.name])}</c:strRef></c:tx>`;
  else x += `<c:tx><c:v>${esc(s.name)}</c:v></c:tx>`;
  if (spec.type === 'line') {
    x += `<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:round/></a:ln></c:spPr>`;
    x += `<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>`;
  } else {
    x += `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>`;
  }
  x += `<c:cat><c:strRef><c:f>${esc(s.catRef)}</c:f>${strCache(s.cats)}</c:strRef></c:cat>`;
  x += `<c:val><c:numRef><c:f>${esc(s.valRef)}</c:f>${numCache(s.vals, spec.valFmt || 'General')}</c:numRef></c:val>`;
  if (spec.type === 'line') x += '<c:smooth val="0"/>';
  return x + '</c:ser>';
}

export function chartXml(spec) {
  const horizontal = spec.type === 'bar';
  const grouping = spec.grouping || 'clustered';
  const series = spec.series.map((s, i) => serXml(s, i, spec)).join('');
  let plot;
  if (spec.type === 'line') {
    plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:axId val="10"/><c:axId val="20"/></c:lineChart>`;
  } else {
    const stacked = grouping !== 'clustered';
    plot = `<c:barChart><c:barDir val="${horizontal ? 'bar' : 'col'}"/><c:grouping val="${grouping}"/><c:varyColors val="0"/>${series}<c:gapWidth val="${stacked ? 60 : 150}"/>${stacked ? '<c:overlap val="100"/>' : ''}<c:axId val="10"/><c:axId val="20"/></c:barChart>`;
  }
  const catPos = horizontal ? 'l' : 'b';
  const valPos = horizontal ? 'b' : 'l';
  const fmt = esc(spec.valFmt || 'General');
  const catAx = `<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="${horizontal ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${catPos}"/>${axisTitle(spec.catTitle)}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/><c:crossAx val="20"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  const valAx = `<c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${valPos}"/><c:majorGridlines/>${axisTitle(spec.valTitle)}<c:numFmt formatCode="${fmt}" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="10"/><c:crosses val="${horizontal ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`;
  const showLegend = spec.legend ?? spec.series.length > 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace ${NS}><c:lang val="ro-RO"/><c:chart><c:title>${txRich(spec.title)}<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}${catAx}${valAx}</c:plotArea>${showLegend ? '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>' : ''}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`;
}

/** anchors: [{rid,name,id,col,row,toCol,toRow}] (0-based) */
export function drawingXml(anchors) {
  const body = anchors.map((a) => `<xdr:twoCellAnchor><xdr:from><xdr:col>${a.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${a.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${a.id}" name="${esc(a.name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${a.rid}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${body}</xdr:wsDr>`;
}
