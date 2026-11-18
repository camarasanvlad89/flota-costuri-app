// Categorii implicite (Category, 3.3). Editabile în Setări > Categorii; nu se șterg dacă sunt folosite (doar arhivare).
// defaultVat = punct de pornire pentru formular; deductiblePct și tratamentul se verifică cu contabilul.
// `group` este folosit și de Country.nonRefundableGroups (TVA străin nerambursabil pe grupă).

/** @typedef {{ treatment:'taxed'|'none'|'zero'|'nondeductible'|'reverse', vatRegime:'domestic'|'ic'|'import'|'outOfScope',
 *   deductiblePct:number, refundable:boolean }} CategoryVatDefault */
/** @typedef {{ id:string, name:string, group:string, kind:'expense'|'income'|'recovery', offsetsCategoryId:string|null,
 *   varKm:boolean, personnel:boolean, accountCode:string|null, defaultVat:CategoryVatDefault, icon:string, order:number, archived:boolean }} Category */

export const CATEGORY_GROUPS = Object.freeze({
  fuel: 'Combustibil',
  tolls: 'Taxe de drum',
  vehicle: 'Vehicul și service',
  insurance: 'Asigurări și taxe auto',
  personnel: 'Personal',
  finance: 'Finanțare',
  overhead: 'Costuri comune',
  other: 'Altele',
  income: 'Venituri',
});

const taxed = (deductiblePct = 100, refundable = true, vatRegime = 'domestic') => ({ treatment: 'taxed', vatRegime, deductiblePct, refundable });
const none = (vatRegime = 'outOfScope') => ({ treatment: 'none', vatRegime, deductiblePct: 0, refundable: false });
const zero = () => ({ treatment: 'zero', vatRegime: 'domestic', deductiblePct: 0, refundable: false });

// [id, nume, grupă, kind, varKm, personnel, accountCode, defaultVat, icon, offsets]
const ROWS = [
  ['cat_fuel', 'Combustibil', 'fuel', 'expense', true, false, '6022', taxed(100), 'fuel'],
  ['cat_adblue', 'AdBlue', 'fuel', 'expense', true, false, '6022', taxed(100), 'fuel'],
  ['cat_toll_ro', 'Rovinietă / taxă de drum RO', 'tolls', 'expense', true, false, '635', none('outOfScope'), 'road'],
  ['cat_toll_hu', 'Taxă de drum HU (HU-GO)', 'tolls', 'expense', true, false, '635', taxed(100), 'road'],
  ['cat_toll_de', 'Taxă de drum DE (Toll Collect)', 'tolls', 'expense', true, false, '635', taxed(100), 'road'],
  ['cat_toll_hr', 'Taxă de drum HR', 'tolls', 'expense', true, false, '635', taxed(100), 'road'],
  ['cat_toll_other', 'Taxă de drum altă țară', 'tolls', 'expense', true, false, '635', taxed(100), 'road'],
  ['cat_parking', 'Parcare', 'tolls', 'expense', true, false, '628', taxed(100), 'parking'],
  ['cat_service', 'Service și reparații', 'vehicle', 'expense', true, false, '6024', taxed(100), 'wrench'],
  ['cat_parts', 'Piese', 'vehicle', 'expense', true, false, '6024', taxed(100), 'wrench'],
  ['cat_tires', 'Anvelope', 'vehicle', 'expense', true, false, '6024', taxed(100), 'tire'],
  ['cat_itp', 'ITP / inspecții tehnice', 'vehicle', 'expense', false, false, '628', taxed(100), 'check'],
  ['cat_wash', 'Spălătorie', 'vehicle', 'expense', false, false, '628', taxed(100), 'wash'],
  ['cat_rca', 'Asigurare RCA', 'insurance', 'expense', false, false, '613', zero(), 'shield'],
  ['cat_casco', 'Asigurare CASCO / marfă (CMR)', 'insurance', 'expense', false, false, '613', zero(), 'shield'],
  ['cat_road_tax', 'Impozit pe mijloace de transport', 'insurance', 'expense', false, false, '635', none('outOfScope'), 'doc'],
  ['cat_fines', 'Amenzi și penalități', 'other', 'expense', false, false, '6581', none('outOfScope'), 'alert'],
  ['cat_salary', 'Salarii și contribuții', 'personnel', 'expense', false, true, '641', none('outOfScope'), 'people'],
  ['cat_diurna', 'Diurnă', 'personnel', 'expense', false, true, '625', none('outOfScope'), 'people'],
  ['cat_lease', 'Rată leasing (operațional)', 'finance', 'expense', false, false, '612', taxed(100), 'bank'],
  ['cat_interest', 'Dobânzi și comisioane', 'finance', 'expense', false, false, '666', zero(), 'bank'],
  ['cat_principal', 'Principal rată (în afara profitului)', 'finance', 'expense', false, false, '162', none('outOfScope'), 'bank'],
  ['cat_gps', 'GPS / tahograf / abonamente', 'overhead', 'expense', false, false, '626', taxed(100), 'signal'],
  ['cat_accountant', 'Contabil', 'overhead', 'expense', false, false, '628', taxed(100), 'doc'],
  ['cat_rent', 'Chirie / parcare bază', 'overhead', 'expense', false, false, '612', taxed(100), 'home'],
  ['cat_phone', 'Telefon și internet', 'overhead', 'expense', false, false, '626', taxed(100), 'phone'],
  ['cat_other', 'Alte cheltuieli', 'other', 'expense', false, false, '628', taxed(100), 'more'],
  // Venituri: cursele vin din tabelul de curse (D12); aici doar „alt venit” și recuperări.
  ['cat_inc_freight', 'Transport marfă', 'income', 'income', false, false, '704', taxed(0), 'truck'],
  ['cat_inc_other', 'Alt venit', 'income', 'income', false, false, '708', taxed(0), 'plus'],
  ['cat_rec_fuel', 'Recuperare combustibil', 'income', 'recovery', false, false, null, taxed(0), 'undo', 'cat_fuel'],
  ['cat_rec_damage', 'Recuperare daune / reparații', 'income', 'recovery', false, false, null, taxed(0), 'undo', 'cat_service'],
];

/** @type {ReadonlyArray<Category>} */
export const DEFAULT_CATEGORIES = Object.freeze(ROWS.map((r, i) => Object.freeze({
  id: r[0], name: r[1], group: r[2], kind: r[3], offsetsCategoryId: r[9] || null,
  varKm: r[4], personnel: r[5], accountCode: r[6], defaultVat: Object.freeze({ ...r[7] }),
  icon: r[8], order: (i + 1) * 10, archived: false,
})));

export function defaultCategories() {
  return DEFAULT_CATEGORIES.map((c) => ({ ...c, defaultVat: { ...c.defaultVat } }));
}

/** Categoria în care cade principalul unei rate (costClass 'cashOnly'). */
export const PRINCIPAL_CATEGORY_ID = 'cat_principal';
