// SheetJS este INCLUS în pachet (D2), dar inițializat leneș: codul bibliotecii e doar o funcție definită la pornire
// (parsare ieftină) și rulează abia la prima citire a `globalThis.XLSX` (import .xlsx). Fără `import()` dinamic,
// fără `eval`/`new Function` (CSP). `src/import/xlsx-reader.js` citește `globalThis.XLSX` ⇒ nicio modificare în cod.
import { readFileSync } from 'node:fs';

/** @param {string} vendorFile calea către vendor/xlsx.full.min.js */
export function xlsxLazyPrelude(vendorFile) {
  const src = readFileSync(vendorFile, 'utf8');
  // Codul bibliotecii nu trebuie să conțină terminatori de bloc care ar rupe un <script> inline.
  return `/* SheetJS CE (vendored, init leneș) */\n(function(g){\nvar real;\nfunction init(){\n` +
    `  Object.defineProperty(g,'XLSX',{value:undefined,writable:true,configurable:true,enumerable:false});\n` +
    `  var lib=(function(){\n${src}\n;return typeof XLSX!=='undefined'?XLSX:undefined;}).call(g);\n` +
    `  real=lib||g.XLSX;\n` +
    `  Object.defineProperty(g,'XLSX',{value:real,writable:true,configurable:true,enumerable:false});\n  return real;\n}\n` +
    `Object.defineProperty(g,'XLSX',{configurable:true,enumerable:false,get:init,set:function(v){Object.defineProperty(g,'XLSX',{value:v,writable:true,configurable:true,enumerable:false});}});\n` +
    `})(typeof globalThis!=='undefined'?globalThis:window);\n`;
}
