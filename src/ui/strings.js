import { zileRo } from './selectors.js';

// Toate textele comune afișate. Ecranele își țin textele locale în constante proprii.
export const t = {
  appName: 'Flota Costuri',
  common: {
    save: 'Salvează', cancel: 'Anulează', close: 'Închide', delete: 'Șterge', edit: 'Editează', add: 'Adaugă',
    confirm: 'Confirmă', confirmAll: 'Confirmă toate', undo: 'Anulează', retry: 'Reîncearcă', next: 'Următorul', prev: 'Anteriorul',
    back: 'Înapoi', yes: 'Da', no: 'Nu', all: 'Toate', none: '—', search: 'Caută…', loading: 'Se încarcă datele…',
    export: 'Exportă', import: 'Importă', download: 'Descarcă', more: 'Mai multe', details: 'Detalii', optional: 'opțional',
    total: 'Total', month: 'Luna', year: 'Anul', from: 'De la', to: 'Până la', today: 'Azi', page: 'Pagina', of: 'din',
    rows: 'rânduri', noData: 'Nu există date', unknown: 'necunoscut', showAsTable: 'Arată ca tabel',
    undoLast: 'Anulează ultima acțiune', shortcuts: 'Taste rapide', provisional: 'provizoriu',
  },
  nav: {
    home: 'Acasă', trucks: 'Camioane', entry: 'Cheltuială nouă', income: 'Venit nou', ledger: 'Cheltuieli & venituri',
    verify: 'De verificat', courses: 'Curse', import: 'Import', reconcile: 'Confruntare GPS', emptykm: 'Km pe gol',
    reports: 'Rapoarte', settings: 'Setări', guide: 'Cum se folosește', guideTitle: 'Ghid: cum se folosește aplicația', groups: { work: 'Lucru', gps: 'GPS', analysis: 'Analiză', admin: 'Administrare' },
  },
  sync: {
    local: 'Mod local · salvat pe acest dispozitiv', idle: 'Sincronizat la', saving: 'Se salvează…', offline: 'Offline: lucrezi pe datele locale',
    authNeeded: 'Reconectează-te la Google', conflict: 'Conflict de sincronizare', error: 'Nu s-a putut sincroniza',
    savedLocal: 'Salvat local', syncedAt: 'Sincronizat la', reconnect: 'Reconectează',
  },
  banners: {
    sharedOrigin: 'Alte site-uri publicate pe contul tău GitHub Pages ar putea citi datele din acest browser. Nu publica alte site-uri pe acest cont sau folosește un domeniu propriu.',
    sharedOriginBlocked: 'Conectarea Google este oprită pe acest domeniu github.io (origine partajată). Pentru a o porni pune acceptSharedOrigin: true în config.js; vezi docs/GOOGLE-SETUP.md. Până atunci lucrezi în modul local.',
    memoryOnly: 'Datele se pierd la închidere; descarcă backup.',
    backupAge: (days) => (days == null ? 'Nu ai făcut încă niciun backup.' : days === 0 ? 'Ultimul backup: azi.' : days === 1 ? 'Ultimul backup: ieri.' : `Ultimul backup: acum ${zileRo(days)}.`),
    backupDue: (label) => (label === 'niciodată' ? 'Nu ai făcut încă niciun backup. Fă unul acum, ca să nu pierzi datele.' : `Ultimul backup: ${label}. Fă unul nou, ca să nu pierzi datele.`),
    syncFailed: (hhmm) => `Nu s-a putut sincroniza, datele afișate sunt cele locale (ultima sincronizare ${hhmm || '—'}).`,
    clock: 'Ceasul dispozitivului nu este corect: generarea cheltuielilor fixe este oprită.',
    nonBnr: (n) => `${n} sume folosesc un curs care nu este BNR.`,
  },
  errors: {
    title: 'A apărut o problemă.', body: 'Datele tale nu au fost modificate.', backup: 'Descarcă backup', reload: 'Reîncarcă',
    missingApi: (n) => `Funcția „${n}” nu este disponibilă în această versiune.`, notFound: 'Pagina nu există.',
    required: 'Câmp obligatoriu', badAmount: 'Sumă invalidă', closedMonth: 'Luna este închisă.',
  },
  states: {
    firstRun: ['Adaugă camioanele', 'Importă cursele', 'Adaugă cheltuielile fixe'],
    noCourses: 'Nu ai încă curse. Importă tabelul sau adaugă o cursă.',
    noEntries: 'Nu ai încă cheltuieli sau venituri în această perioadă.',
    queueEmpty: 'Nimic de verificat. Totul este confirmat.',
    noDriveData: 'Nu s-au găsit date. Începe gol sau restaurează un backup.',
    offlineNote: 'Offline: lucrezi pe datele locale',
  },
  notProfit: 'Niciunul dintre aceste profituri nu este profitul contabil sau fiscal.',
  eurNote: 'Totalurile în EUR sunt suma valorilor EUR înghețate la data fiecărei intrări; de aceea diferă de totalul în RON împărțit la cursul de azi.',
  vatWarn: 'Cotele sunt valori de pornire. Se schimbă; verifică-le cu contabilul.',
  demoBadge: 'date demo',
  months: ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'],
  monthsShort: ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'noi', 'dec'],
  status: { confirmed: 'Confirmat', pending: 'De verificat', auto_pending: 'Automat, de confirmat', flagged: 'Marcat', ok: 'Ok', review: 'De verificat' },
  docs: { invoice: 'Factură', receipt: 'Bon', none: 'Fără document' },
  payments: { card: 'Card', cash: 'Numerar', bank: 'Transfer', fuelcard: 'Card combustibil', driverCash: 'Numerar șofer' },
  vat: { taxed: 'Cu TVA', none: 'Fără TVA', zero: '0% (scutit)', nondeductible: 'TVA nedeductibil', reverse: 'Taxare inversă' },
  badges: {
    recurring: 'Recurentă', 'manual-fx': 'curs manual', 'stale-fx': 'curs vechi / estimat', 'ecb-fx': 'BCE indicativ', derived: 'derivat',
    nodoc: 'Fără document', demo: 'date demo', provisional: 'provizoriu', closed: 'lună închisă', foreign: 'TVA străin',
  },
  shortcutsHelp: [
    ['n', 'Cheltuială nouă'], ['v', 'Venit nou'], ['Alt+Shift+D', 'Duplică ultima intrare'], ['Ctrl+Enter', 'Salvează și păstrează valorile'],
    ['g apoi h', 'Acasă'], ['g apoi l', 'Cheltuieli & venituri'], ['g apoi v', 'De verificat'], ['E', 'Editează (în De verificat)'],
    ['Del', 'Șterge (cu Anulează)'], ['?', 'Această fereastră'],
  ],
};
export default t;
