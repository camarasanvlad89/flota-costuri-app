// Date demo FICTIVE (17.4, 11.4): construiește un DbDoc complet pentru modul local „date demo”, fără acces la fișiere.
// Datele GPS ale lui XX 00 DEM (oct. 2026) sunt cele ale celor două exporturi SafeFleet din docs/ref/ (138 de călătorii, 31 de zile,
// 8.376,3 km), încorporate aici ca tablouri compacte. Tabelul de curse al lui XX00DEM pe oct. 2026 este FICTIV (construit din localitățile
// văzute în călătorii, cu defecte deliberate pentru confruntarea GPS vs facturat), iar rândurile 121–147 (aug.–oct. 2025) sunt cele
// tastate din poza tabelului real (fixture-ul importatorului). Celelalte camioane (XX01DEM, XX02DEM), costurile, șabloanele,
// scadențele și planurile de service sunt generate determinist dintr-un PRNG cu sămânță.
//
// Defecte deliberate pentru XX00DEM, oct. 2026 (steagurile așteptate în reconcile.js):
//  - 09.10 SEINI - ARAD: zi cu GPS inactiv (IDLE_ON_COURSE);   - 13–15.10 și 14–16.10: pereche suprapusă (COURSE_OVERLAP);
//  - 21.10 BAIA MARE - SZOMBATHELY: loc niciodată vizitat (PLACE_NOT_VISITED);   - 17.10: zi cu GPS fără cursă (UNCOVERED_ACTIVE_PERIOD);
//  - 28–29.09 și 03.11: curse în afara intervalului GPS (NO_GPS_RANGE);   - 07.10 doar „Total”; 30.10 fără preț (COURSE_NO_PRICE).
import { allocate, convert, fromDecimalString, mulDiv, rateDiv, toDecimalString } from '../core/money.js';
import { addDays, eachDay, monthRange, daysInMonth } from '../core/dates.js';
import { detId } from '../core/ids.js';
import { defaultCategories } from '../data/categories-default.js';
import { defaultCountries, defaultRoVatRates } from '../data/vat-defaults.js';
import { defaultCurrencies } from '../data/currencies.js';
import { buildEntry } from './entry.js';
import { courseId, priceFromColumns } from './courses.js';
import { parseRoute } from './places.js';
import { normalizePlate, displayPlate } from '../core/plates.js';

export const DEMO_BADGE = 'date demo';
export const DEMO_NOTE = 'Date demo FICTIVE (plăcuțe, șoferi și sume inventate; localități reale, fără adrese stradale).';
export const DEMO_TODAY = '2026-11-18';
/** @param {object} doc  @returns {boolean} DbDoc-ul este setul demo (insigna „date demo” dispare la golire sau restaurare). */
export function isDemoDb(doc) { return !!(doc && doc.meta && doc.meta.demo); }

// ------------------------------------------------------------------------------------------------ GPS real (compact)
// [start, stop, poziție start, poziție stop, distanță în metri]; poziția = „[stradă, localitate, cod poștal, țară]” ca în export.
const GPS_TRIPS = [
  ["2026-10-01T05:45:54", "2026-10-01T08:51:35", "[Drum local, Orașu Nou, 447220, România]", "[Drum local, Hajdúdorog, 4087, Ungaria]", 162128],
  ["2026-10-01T10:49:46", "2026-10-01T11:48:32", "[Drum local, Hajdúdorog, 4087, Ungaria]", "[Drum local, Hajdúdorog, 4087, Ungaria]", 598],
  ["2026-10-01T12:37:26", "2026-10-01T13:59:06", "[Drum local, Hajdúdorog, 4087, Ungaria]", "[Drum local, Alsózsolca, 3571, Ungaria]", 101197],
  ["2026-10-01T14:02:56", "2026-10-01T14:05:16", "[Drum local, Alsózsolca, 3571, Ungaria]", "[Drum local, Alsózsolca, 3571, Ungaria]", 507],
  ["2026-10-01T14:14:16", "2026-10-01T14:18:01", "[Drum local, Alsózsolca, 3571, Ungaria]", "[Drum local, Alsózsolca, 3571, Ungaria]", 641],
  ["2026-10-01T15:31:42", "2026-10-01T15:59:04", "[Drum local, Alsózsolca, 3571, Ungaria]", "[Drum local, Alsózsolca, 3571, Ungaria]", 641],
  ["2026-10-01T16:09:50", "2026-10-01T19:24:32", "[Drum local, Alsózsolca, 3571, Ungaria]", "[Drum local, Dorolț, 447130, România]", 205912],
  ["2026-10-02T08:14:53", "2026-10-02T09:36:57", "[Drum local, Dorolț, 447130, România]", "[Drum local, Halmeu, 447145, România]", 45108],
  ["2026-10-02T11:41:54", "2026-10-02T12:20:05", "[Drum local, Halmeu, 447145, România]", "[Drum local, Satu Mare, 447145, România]", 8197],
  ["2026-10-02T13:00:44", "2026-10-02T13:07:09", "[Drum local, Satu Mare, 447145, România]", "[Drum local, Satu Mare, 447145, România]", 485],
  ["2026-10-02T15:11:59", "2026-10-02T16:23:42", "[Drum local, Satu Mare, 447145, România]", "[Drum local, Orașu Nou, 447220, România]", 34633],
  ["2026-10-05T07:29:51", "2026-10-05T08:39:17", "[Drum local, Orașu Nou, 447220, România]", "[Drum local, Satu Mare, 447356, România]", 42261],
  ["2026-10-05T08:46:55", "2026-10-05T12:25:58", "[Drum local, Satu Mare, 447356, România]", "[Drum local, Törökszentmiklós, 5200, Ungaria]", 237927],
  ["2026-10-05T13:02:24", "2026-10-05T13:29:34", "[Drum local, Törökszentmiklós, 5200, Ungaria]", "[Jász-Nagykun-Szolnok vármegye, 5081, Ungaria]", 17540],
  ["2026-10-05T13:48:13", "2026-10-05T13:53:03", "[Jász-Nagykun-Szolnok vármegye, 5081, Ungaria]", "[Jász-Nagykun-Szolnok vármegye, 5081, Ungaria]", 431],
  ["2026-10-05T14:46:17", "2026-10-05T16:36:04", "[Jász-Nagykun-Szolnok vármegye, 5081, Ungaria]", "[Drum local, Pest vármegye, 2151, Ungaria]", 133221],
  ["2026-10-05T16:54:41", "2026-10-05T17:00:04", "[Drum local, Pest vármegye, 2151, Ungaria]", "[Drum local, Pest vármegye, 2151, Ungaria]", 1273],
  ["2026-10-05T17:39:17", "2026-10-05T17:45:39", "[Drum local, Pest vármegye, 2151, Ungaria]", "[Drum local, Pest vármegye, 2151, Ungaria]", 948],
  ["2026-10-05T18:31:49", "2026-10-05T20:45:36", "[Drum local, Pest vármegye, 2151, Ungaria]", "[Drum local, Görbeháza, 4075, Ungaria]", 174626],
  ["2026-10-06T05:56:57", "2026-10-06T08:28:00", "[Drum local, Görbeháza, 4075, Ungaria]", "[Drum local, Satu Mare, 440247, România]", 154719],
  ["2026-10-06T08:31:22", "2026-10-06T08:36:59", "[Drum local, Satu Mare, 440247, România]", "[Drum local, Satu Mare, 440247, România]", 114],
  ["2026-10-06T08:59:47", "2026-10-06T09:04:36", "[Drum local, Satu Mare, 440247, România]", "[Drum local, Satu Mare, 440247, România]", 359],
  ["2026-10-06T09:05:20", "2026-10-06T09:12:01", "[Drum local, Satu Mare, 440247, România]", "[Drum local, Satu Mare, 440244, România]", 4450],
  ["2026-10-06T10:03:38", "2026-10-06T10:14:57", "[Drum local, Satu Mare, 440244, România]", "[Drum local, Satu Mare, 440211, România]", 419],
  ["2026-10-06T14:02:31", "2026-10-06T14:47:12", "[Drum local, Satu Mare, 440211, România]", "[Drum local, Medieșu Aurit, 447185, România]", 41467],
  ["2026-10-06T15:16:47", "2026-10-06T19:15:26", "[Drum local, Medieșu Aurit, 447185, România]", "[Drum local, Petelea, 547460, România]", 218349],
  ["2026-10-06T19:29:33", "2026-10-06T21:18:11", "[Drum local, Petelea, 547460, România]", "[Drum local, Ditrău, 537090, România]", 98353],
  ["2026-10-07T06:33:08", "2026-10-07T08:39:54", "[Drum local, Ditrău, 537090, România]", "[Drum local, Bălan, 535200, România]", 51654],
  ["2026-10-07T10:56:32", "2026-10-07T11:55:16", "[Drum local, Bălan, 535200, România]", "[Drum local, Miercurea Ciuc, 530152, România]", 37485],
  ["2026-10-07T12:53:58", "2026-10-07T13:03:11", "[Drum local, Miercurea Ciuc, 530152, România]", "[Drum local, Miercurea Ciuc, 530154, România]", 323],
  ["2026-10-07T13:31:27", "2026-10-07T13:45:07", "[Drum local, Miercurea Ciuc, 530154, România]", "[Drum local, Miercurea Ciuc, 530154, România]", 314],
  ["2026-10-07T13:53:15", "2026-10-07T18:40:27", "[Drum local, Miercurea Ciuc, 530154, România]", "[Drum local, Mociu, 407427, România]", 229330],
  ["2026-10-07T19:10:49", "2026-10-07T20:02:37", "[Drum local, Mociu, 407427, România]", "[Drum local, Jucu, 407350, România]", 34142],
  ["2026-10-07T20:20:36", "2026-10-07T20:30:42", "[Drum local, Jucu, 407350, România]", "[Drum local, Jucu, 407350, România]", 729],
  ["2026-10-07T20:43:03", "2026-10-07T21:43:24", "[Drum local, Cluj, 407354, România]", "[Drum local, Unguraș, 407570, România]", 45636],
  ["2026-10-08T09:19:42", "2026-10-08T09:33:30", "[Drum local, Unguraș, 407570, România]", "[Drum local, Unguraș, 407570, România]", 264],
  ["2026-10-08T10:31:45", "2026-10-08T12:57:19", "[Drum local, Unguraș, 407570, România]", "[Drum local, Cicârlău, 437095, România]", 115584],
  ["2026-10-08T14:12:46", "2026-10-08T14:41:40", "[Drum local, Cicârlău, 437095, România]", "[Drum local, Seini, 435400, România]", 10709],
  ["2026-10-12T07:09:51", "2026-10-12T08:06:15", "[Drum local, Seini, 435400, România]", "[Drum local, Dorolț, 447130, România]", 48359],
  ["2026-10-12T08:16:46", "2026-10-12T10:38:31", "[Drum local, Dorolț, 447130, România]", "[Drum local, Kisvárda, 4600, Ungaria]", 129211],
  ["2026-10-12T13:44:30", "2026-10-12T16:06:20", "[Drum local, Kisvárda, 4600, Ungaria]", "[Drum local, Alsózsolca, 3571, Ungaria]", 168325],
  ["2026-10-12T16:46:54", "2026-10-12T17:02:24", "[Drum local, Alsózsolca, 3571, Ungaria]", "[Drum local, Alsózsolca, 3571, Ungaria]", 607],
  ["2026-10-12T17:06:35", "2026-10-12T20:21:15", "[Drum local, Alsózsolca, 3571, Ungaria]", "[Drum local, Dorolț, 447130, România]", 205976],
  ["2026-10-13T07:34:20", "2026-10-13T08:39:58", "[Drum local, Dorolț, 447130, România]", "[Drum local, Halmeu, 447145, România]", 45246],
  ["2026-10-13T09:53:03", "2026-10-13T11:09:35", "[Drum local, Halmeu, 447145, România]", "[Drum local, Satu Mare, 440091, România]", 37238],
  ["2026-10-13T12:03:44", "2026-10-13T12:23:09", "[Drum local, Satu Mare, 440091, România]", "[Drum local, Satu Mare, 447356, România]", 9772],
  ["2026-10-13T12:36:54", "2026-10-13T15:12:47", "[Drum local, Satu Mare, 447356, România]", "[Drum local, Mădăraș, 417330, România]", 168512],
  ["2026-10-13T15:35:57", "2026-10-13T15:48:51", "[Drum local, Mădăraș, 417330, România]", "[Drum local, Salonta, 415500, România]", 4016],
  ["2026-10-13T15:48:55", "2026-10-13T17:22:14", "[Drum local, Salonta, 415500, România]", "[Drum local, Pecica, 317235, România]", 95920],
  ["2026-10-13T17:28:57", "2026-10-13T18:40:56", "[Drum local, Pecica, 317235, România]", "[Drum local, Szatymaz, 6763, Ungaria]", 92062],
  ["2026-10-13T18:41:00", "2026-10-13T19:11:40", "[Drum local, Szatymaz, 6763, Ungaria]", "[Drum local, Szatymaz, 6763, Ungaria]", 1169],
  ["2026-10-14T08:22:23", "2026-10-14T09:06:52", "[Drum local, Szatymaz, 6763, Ungaria]", "[Drum local, Kiskunmajsa, 6120, Ungaria]", 29393],
  ["2026-10-14T09:25:12", "2026-10-14T09:31:53", "[Drum local, Kiskunmajsa, 6120, Ungaria]", "[Drum local, Kiskunmajsa, 6120, Ungaria]", 503],
  ["2026-10-14T10:39:42", "2026-10-14T10:42:20", "[Drum local, Kiskunmajsa, 6120, Ungaria]", "[Drum local, Kiskunmajsa, 6120, Ungaria]", 175],
  ["2026-10-14T10:49:21", "2026-10-14T12:05:56", "[Drum local, Kiskunmajsa, 6120, Ungaria]", "[Drum local, Csanádpalota, 6913, Ungaria]", 94526],
  ["2026-10-14T12:28:17", "2026-10-14T13:13:34", "[Drum local, Csanádpalota, 6913, Ungaria]", "[Drum local, Arad, 310349, România]", 47565],
  ["2026-10-14T13:19:35", "2026-10-14T13:32:29", "[Drum local, Arad, 310349, România]", "[Drum local, Arad, 310165, România]", 4909],
  ["2026-10-14T13:49:45", "2026-10-14T15:21:09", "[Drum local, Arad, 310165, România]", "[Drum local, Mădăraș, 417330, România]", 85033],
  ["2026-10-14T15:53:20", "2026-10-14T19:21:42", "[Drum local, Mădăraș, 417330, România]", "[Drum local, Negrești-Oaș, 445202, România]", 224579],
  ["2026-10-14T19:21:46", "2026-10-14T19:31:08", "[Drum local, Negrești-Oaș, 445202, România]", "[Drum local, Negrești-Oaș, 445202, România]", 1377],
  ["2026-10-14T19:53:31", "2026-10-14T20:21:07", "[Drum local, Negrești-Oaș, 445202, România]", "[Drum local, Orașu Nou, 447220, România]", 16657],
  ["2026-10-15T07:56:53", "2026-10-15T09:16:17", "[Drum local, Orașu Nou, 447220, România]", "[Drum local, Satu Mare, 440091, România]", 38878],
  ["2026-10-15T09:43:56", "2026-10-15T10:00:36", "[Drum local, Satu Mare, 440091, România]", "[Drum local, Dorolț, 447130, România]", 11903],
  ["2026-10-15T10:10:01", "2026-10-15T10:31:58", "[Drum local, Dorolț, 447130, România]", "[Drum local, Jánkmajtis, 4741, Ungaria]", 12358],
  ["2026-10-15T12:57:29", "2026-10-15T13:35:03", "[Drum local, Jánkmajtis, 4741, Ungaria]", "[Drum local, Csengersima, 4743, Ungaria]", 11657],
  ["2026-10-15T13:44:40", "2026-10-15T17:53:58", "[Drum local, Csengersima, 4743, Ungaria]", "[Drum local, Arad, 310216, România]", 258906],
  ["2026-10-16T07:45:55", "2026-10-16T08:09:36", "[Drum local, Arad, 310216, România]", "[Drum local, Arad, 310218, România]", 7217],
  ["2026-10-16T08:16:12", "2026-10-16T08:18:08", "[Drum local, Arad, 310218, România]", "[Drum local, Arad, 310218, România]", 129],
  ["2026-10-16T09:08:22", "2026-10-16T12:38:19", "[Drum local, Arad, 310218, România]", "[Drum local, Pișcolt, 447250, România]", 198943],
  ["2026-10-16T12:55:57", "2026-10-16T14:20:04", "[Drum local, Pișcolt, 447250, România]", "[Drum local, Medieșu Aurit, 447185, România]", 81698],
  ["2026-10-16T15:05:57", "2026-10-16T15:11:38", "[Drum local, Medieșu Aurit, 447185, România]", "[Drum local, Medieșu Aurit, 447185, România]", 583],
  ["2026-10-16T15:22:10", "2026-10-16T15:31:39", "[Drum local, Medieșu Aurit, 447185, România]", "[Drum local, Medieșu Aurit, 447185, România]", 573],
  ["2026-10-16T15:35:18", "2026-10-16T16:04:28", "[Drum local, Medieșu Aurit, 447185, România]", "[Drum local, Orașu Nou, 447220, România]", 25751],
  ["2026-10-17T10:51:13", "2026-10-17T11:54:00", "[Drum local, Orașu Nou, 447220, România]", "[Baia Mare, 430173, România]", 39836],
  ["2026-10-17T12:25:03", "2026-10-17T12:34:14", "[Baia Mare, 430173, România]", "[Baia Mare, 430173, România]", 2006],
  ["2026-10-17T12:35:09", "2026-10-17T13:41:16", "[Baia Mare, 430173, România]", "[Drum local, Orașu Nou, 447220, România]", 39351],
  ["2026-10-17T14:16:00", "2026-10-17T14:20:51", "[Drum local, Orașu Nou, 447220, România]", "[Drum local, Orașu Nou, 447220, România]", 1658],
  ["2026-10-19T08:45:17", "2026-10-19T09:59:08", "[Drum local, Orașu Nou, 447220, România]", "[Drum local, Dorolț, 447130, România]", 44439],
  ["2026-10-19T10:05:48", "2026-10-19T10:32:17", "[Drum local, Dorolț, 447130, România]", "[Drum local, Porcsalma, 4761, Ungaria]", 20057],
  ["2026-10-19T10:44:23", "2026-10-19T10:48:03", "[Drum local, Porcsalma, 4761, Ungaria]", "[Drum local, Tyukod, 4762, Ungaria]", 640],
  ["2026-10-19T11:38:12", "2026-10-19T12:55:44", "[Drum local, Tyukod, 4762, Ungaria]", "[Drum local, Csengersima, 4743, Ungaria]", 20055],
  ["2026-10-19T13:08:53", "2026-10-19T15:30:13", "[Drum local, Csengersima, 4743, Ungaria]", "[Drum local, Biharia, 417050, România]", 125493],
  ["2026-10-19T15:44:57", "2026-10-19T18:20:02", "[Drum local, Biharia, 417050, România]", "[Drum local, Arad, 310216, România]", 133830],
  ["2026-10-20T07:27:37", "2026-10-20T09:18:10", "[Drum local, Arad, 310216, România]", "[Drum local, Bichișciaba, 5600, Ungaria]", 88400],
  ["2026-10-20T09:27:42", "2026-10-20T09:31:04", "[Drum local, Bichișciaba, 5600, Ungaria]", "[Drum local, Bichișciaba, 5600, Ungaria]", 675],
  ["2026-10-20T10:24:16", "2026-10-20T10:31:55", "[Drum local, Bichișciaba, 5600, Ungaria]", "[Drum local, Bichișciaba, 5600, Ungaria]", 362],
  ["2026-10-20T10:35:24", "2026-10-20T14:58:50", "[Drum local, Bichișciaba, 5600, Ungaria]", "[Drum local, Moftin, 447200, România]", 240000],
  ["2026-10-20T15:38:51", "2026-10-20T16:49:05", "[Drum local, Moftin, 447200, România]", "[Drum local, Orașu Nou, 447220, România]", 58690],
  ["2026-10-21T06:39:01", "2026-10-21T07:44:59", "[Drum local, Orașu Nou, 447220, România]", "[Drum local, Baia Mare, 430071, România]", 33472],
  ["2026-10-21T10:40:45", "2026-10-21T12:56:22", "[Drum local, Baia Mare, 430071, România]", "[Drum local, Unguraș, 407570, România]", 102531],
  ["2026-10-21T13:24:02", "2026-10-21T13:36:35", "[Drum local, Unguraș, 407570, România]", "[Drum local, Unguraș, 407570, România]", 312],
  ["2026-10-21T13:53:34", "2026-10-21T15:11:14", "[Drum local, Unguraș, 407570, România]", "[Drum local, Dej, 405200, România]", 12041],
  ["2026-10-21T15:22:00", "2026-10-21T17:56:29", "[Drum local, Dej, 405200, România]", "[Drum local, Orașu Nou, 447220, România]", 118622],
  ["2026-10-22T05:43:08", "2026-10-22T08:22:55", "[Drum local, Orașu Nou, 447220, România]", "[Drum local, Vásárosnamény, 4800, Ungaria]", 116578],
  ["2026-10-22T09:42:21", "2026-10-22T12:13:13", "[Drum local, Vásárosnamény, 4800, Ungaria]", "[Drum local, Alsózsolca, 3571, Ungaria]", 175701],
  ["2026-10-22T13:19:38", "2026-10-22T17:18:59", "[Drum local, Alsózsolca, 3571, Ungaria]", "[Drum local, Dorolț, 447133, România]", 205664],
  ["2026-10-23T07:35:53", "2026-10-23T08:31:46", "[Drum local, Dorolț, 447133, România]", "[Drum local, Halmeu, 447145, România]", 44461],
  ["2026-10-23T08:46:44", "2026-10-23T08:49:23", "[Drum local, Halmeu, 447145, România]", "[Drum local, Halmeu, 447145, România]", 129],
  ["2026-10-23T10:40:13", "2026-10-23T11:45:17", "[Drum local, Halmeu, 447145, România]", "[Drum local, Seini, 435400, România]", 39568],
  ["2026-10-23T17:10:55", "2026-10-23T17:34:44", "[Drum local, Seini, 435400, România]", "[Drum local, Orașu Nou, 447220, România]", 13606],
  ["2026-10-26T06:43:03", "2026-10-26T07:44:30", "[Drum local, Orașu Nou, 447220, România]", "[Drum local, Satu Mare, 440247, România]", 49999],
  ["2026-10-26T07:48:46", "2026-10-26T07:50:58", "[Drum local, Satu Mare, 440247, România]", "[Drum local, Satu Mare, 440247, România]", 205],
  ["2026-10-26T08:09:50", "2026-10-26T08:45:54", "[Drum local, Satu Mare, 440247, România]", "[Drum local, Dorolț, 447130, România]", 19562],
  ["2026-10-26T08:59:25", "2026-10-26T10:49:11", "[Drum local, Dorolț, 447130, România]", "[Drum local, Nyíregyháza, 4400, Ungaria]", 104812],
  ["2026-10-26T10:51:59", "2026-10-26T10:54:01", "[Drum local, Nyíregyháza, 4400, Ungaria]", "[Drum local, Nyíregyháza, 4400, Ungaria]", 256],
  ["2026-10-26T11:23:31", "2026-10-26T11:36:03", "[Drum local, Nyíregyháza, 4400, Ungaria]", "[Drum local, Nyíregyháza, 4400, Ungaria]", 303],
  ["2026-10-26T11:36:58", "2026-10-26T12:40:15", "[Drum local, Nyíregyháza, 4400, Ungaria]", "[Drum local, Vásárosnamény, 4800, Ungaria]", 74401],
  ["2026-10-26T12:44:42", "2026-10-26T12:46:03", "[Drum local, Vásárosnamény, 4800, Ungaria]", "[Drum local, Vásárosnamény, 4800, Ungaria]", 141],
  ["2026-10-26T13:56:12", "2026-10-26T14:05:25", "[Drum local, Vásárosnamény, 4800, Ungaria]", "[Drum local, Vásárosnamény, 4800, Ungaria]", 161],
  ["2026-10-26T14:22:57", "2026-10-26T16:05:10", "[Drum local, Vásárosnamény, 4800, Ungaria]", "[Drum local, Dorolț, 447133, România]", 71379],
  ["2026-10-26T16:12:44", "2026-10-26T17:19:18", "[Drum local, Dorolț, 447133, România]", "[Drum local, Valea lui Mihai, 415700, România]", 73132],
  ["2026-10-26T17:50:59", "2026-10-26T21:28:44", "[Drum local, Valea lui Mihai, 415700, România]", "[Drum local, Arad, România]", 207137],
  ["2026-10-27T06:24:00", "2026-10-27T07:37:12", "[Drum local, Arad, România]", "[Drum local, Timișoara, 300000, România]", 49306],
  ["2026-10-27T08:53:03", "2026-10-27T09:25:13", "[Drum local, Timișoara, 300000, România]", "[Drum local, Ghiroda, 307200, România]", 10275],
  ["2026-10-27T09:32:34", "2026-10-27T09:39:34", "[Drum local, Ghiroda, 307200, România]", "[Drum local, Ghiroda, 307200, România]", 226],
  ["2026-10-27T11:09:18", "2026-10-27T11:11:39", "[Drum local, Ghiroda, 307200, România]", "[Drum local, Ghiroda, 307200, România]", 370],
  ["2026-10-27T11:22:00", "2026-10-27T12:17:05", "[Drum local, Ghiroda, 307200, România]", "[Drum local, Traian Vuia, 307435, România]", 60251],
  ["2026-10-27T12:24:23", "2026-10-27T16:38:12", "[Drum local, Traian Vuia, 307435, România]", "[Drum local, Porumbacu de Jos, 557190, România]", 245243],
  ["2026-10-27T17:10:50", "2026-10-27T19:04:39", "[Drum local, Porumbacu de Jos, 557190, România]", "[Drum local, Zărnești, 505800, România]", 93156],
  ["2026-10-27T19:34:54", "2026-10-27T19:36:46", "[Drum local, Zărnești, 505800, România]", "[Drum local, Zărnești, 505800, România]", 103],
  ["2026-10-27T19:38:37", "2026-10-27T19:52:44", "[Drum local, Zărnești, 505800, România]", "[Drum local, Zărnești, 505800, România]", 734],
  ["2026-10-27T20:11:13", "2026-10-27T20:41:12", "[Drum local, Zărnești, 505800, România]", "[Drum local, Zărnești, 505800, România]", 1185],
  ["2026-10-28T07:10:59", "2026-10-28T08:06:44", "[Drum local, Zărnești, 505800, România]", "[Drum local, Brașov, România]", 23448],
  ["2026-10-28T08:50:21", "2026-10-28T11:14:22", "[Drum local, Brașov, România]", "[Drum local, Sighișoara, 545400, România]", 124207],
  ["2026-10-28T11:27:36", "2026-10-28T13:14:30", "[Drum local, Sighișoara, 545400, România]", "[Drum local, Mureș, 545205, România]", 90022],
  ["2026-10-28T13:30:34", "2026-10-28T17:36:15", "[Drum local, Mureș, 545205, România]", "[Drum local, Orașu Nou, 447220, România]", 234195],
  ["2026-10-29T07:38:48", "2026-10-29T08:14:47", "[Drum local, Orașu Nou, 447220, România]", "[Drum local, Negrești-Oaș, 445200, România]", 10669],
  ["2026-10-29T08:31:45", "2026-10-29T08:37:03", "[Drum local, Negrești-Oaș, 445200, România]", "[Drum local, Satu Mare, 445200, România]", 184],
  ["2026-10-29T09:40:13", "2026-10-29T11:24:14", "[Drum local, Satu Mare, 445200, România]", "[Drum local, Porcsalma, 4761, Ungaria]", 75478],
  ["2026-10-29T12:56:49", "2026-10-29T13:03:14", "[Drum local, Porcsalma, 4761, Ungaria]", "[Drum local, Tyukod, 4762, Ungaria]", 636],
  ["2026-10-29T14:25:56", "2026-10-29T14:38:00", "[Drum local, Tyukod, 4762, Ungaria]", "[Drum local, Tyukod, 4762, Ungaria]", 106],
  ["2026-10-29T15:10:03", "2026-10-29T20:11:07", "[Drum local, Tyukod, 4762, Ungaria]", "[Drum local, Arad, 310216, România]", 278623],
  ["2026-10-30T07:12:54", "2026-10-30T07:25:34", "[Drum local, Arad, 310216, România]", "[Drum local, Arad, 310163, România]", 5434],
  ["2026-10-30T07:30:20", "2026-10-30T08:12:04", "[Drum local, Arad, 310163, România]", "[Drum local, Orțișoara, 307305, România]", 41165],
  ["2026-10-30T08:29:50", "2026-10-30T08:36:32", "[Drum local, Orțișoara, 307305, România]", "[Drum local, Orțișoara, 307305, România]", 231],
  ["2026-10-30T09:37:35", "2026-10-30T14:42:48", "[Drum local, Orțișoara, 307305, România]", "[Drum local, Supur, 447290, România]", 267633],
  ["2026-10-30T15:12:57", "2026-10-30T16:16:32", "[Drum local, Supur, 447290, România]", "[Drum local, Hodod, 447156, România]", 39846],
  ["2026-10-30T17:54:22", "2026-10-30T19:26:37", "[Drum local, Hodod, 447156, România]", "[Drum local, Orașu Nou, 447220, România]", 71493]
];
const GPS_DAILY = [
  ["2026-10-01", 471624, 27178],
  ["2026-10-02", 88423, 8508],
  ["2026-10-03", 0, 0],
  ["2026-10-04", 0, 0],
  ["2026-10-05", 608227, 32024],
  ["2026-10-06", 518230, 32605],
  ["2026-10-07", 399613, 33915],
  ["2026-10-08", 126557, 9775],
  ["2026-10-09", 0, 0],
  ["2026-10-10", 0, 0],
  ["2026-10-11", 0, 0],
  ["2026-10-12", 552478, 30531],
  ["2026-10-13", 453935, 27567],
  ["2026-10-14", 504717, 30499],
  ["2026-10-15", 333702, 20840],
  ["2026-10-16", 314894, 19907],
  ["2026-10-17", 82851, 6635],
  ["2026-10-18", 0, 0],
  ["2026-10-19", 344514, 21638],
  ["2026-10-20", 388127, 24174],
  ["2026-10-21", 266978, 21890],
  ["2026-10-22", 497943, 28449],
  ["2026-10-23", 97764, 7218],
  ["2026-10-24", 0, 0],
  ["2026-10-25", 0, 0],
  ["2026-10-26", 601488, 36838],
  ["2026-10-27", 460849, 30276],
  ["2026-10-28", 471872, 30214],
  ["2026-10-29", 365696, 23917],
  ["2026-10-30", 425802, 27741],
  ["2026-10-31", 0, 0]
];

// ------------------------------------------------------------------------------------------------ utilitare
const NOW = '2026-11-01T08:00:00.000Z';
const BY = 'demo';
const plateOf = (p) => normalizePlate(p);

/** Întreg aleator în [0, n). */
const ri = (rand, n) => Math.floor(rand() * n); // money-ok: PRNG, nu calcul de bani

/** PRNG determinist (mulberry32). */
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const base = (rec) => ({ createdAt: NOW, updatedAt: NOW, updatedBy: BY, createdBy: 'admin', ...rec });

const EUR_RON = '5.3442';                                 // curs pinned (ca în fixture-ul fx/pinned.json)
const PER_EUR = { HUF: '364.08', PLN: '4.27', CZK: '24.4' };
function rateFor(cur, date) {
  const common = { rateDate: date, manual: false, stale: false };
  if (cur === 'RON') return { ronPerUnit: '1', eurPerUnit: rateDiv('1', EUR_RON), source: 'ron', ...common };
  if (cur === 'EUR') return { ronPerUnit: EUR_RON, eurPerUnit: '1', source: 'bnr', ...common };
  const per = PER_EUR[cur];
  if (!per) throw new RangeError('monedă demo necunoscută: ' + cur);
  return { ronPerUnit: rateDiv(EUR_RON, per), eurPerUnit: rateDiv('1', per), source: 'bnr', ...common };
}
const parseGps = (t) => { const p = t.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim()); return { locality: p[p.length - 3], country: p[p.length - 1] }; };

// ------------------------------------------------------------------------------------------------ curse
const DRIVERS = [['DORIAN', ['DORI']], ['KALMAN', ['KALI', 'KALMANAN']], ['ANDOR', []]];
const driverIdOf = (name) => (name ? 'drv_' + name.toLowerCase() : null);

// [încărcare, descărcare, șofer, rută, net, TVA, total, observații, K] — sume în lei cu virgulă ca text, exact ca în tabel; null = celulă goală
const T = (s) => (s == null ? null : fromDecimalString(String(s).replace(',', '.'), 'RON'));

// Rândurile 121–147 din poza tabelului real (XX00DEM 2025), tastate (aug.–oct. 2025). Șofer implicit DORIAN.
const ROWS_2025 = [
  ['07.08.2025', '09.08.2025', 'DORIAN', 'CAREI - SZEKESFEHERVAR', '2940,66', '617,54', '3558,20'],
  ['09.08.2025', '12.08.2025', 'DORIAN', 'GYOR - CAMPIA TURZII', '5033,85', '1057,11', '6090,96'],
  ['12.08.2025', '13.08.2025', 'DORIAN', 'TISZAVASVARI - EGER', '1552,22', '325,97', '1878,19'],
  ['13.08.2025', '14.08.2025', 'DORIAN', 'PRESOV - TARGU MURES', '3986,19', '837,10', '4823,29'],
  ['14.08.2025', '15.08.2025', 'DORIAN', 'TARGU MURES - HAJDUBOSZORMENY', '1556,30', '326,82', '1883,12'],
  ['15.08.2025', '16.08.2025', 'DORIAN', 'KISVARDA - ORADEA', '2105,13', '442,08', '2547,21'],
  ['16.08.2025', '16.08.2025', 'DORIAN', 'SIMLEU SILVANIEI - CEHU+ZALAU', '1250', '262,50', '1512,50'],
  ['19.08.2025', '20.08.2025', 'DORIAN', 'TOKAJ - BISTRITA', '2021,05', '424,42', '2445,47', 'lepakolni Kalman'],
  ['20.08.2025', '21.08.2025', 'KALMAN', 'SALGOTARJAN - KAPOSVAR', '3161,29', '663,87', '3825,16', 'lepakolni Dorian'],
  ['21.08.2025', '23.08.2025', 'DORIAN', 'GYOR - CAMPIA TURZII', '5057,06', '1061,98', '6119,04'],
  ['23.08.2025', '26.08.2025', 'DORIAN', 'TISZAUJVAROS - CSORNA', '2697,97', '566,57', '3264,54'],
  ['26.08.2025', '27.08.2025', 'DORIAN', 'PECS - SIBIU', null, null, null, null, 3900],
  ['27.08.2025', '28.08.2025', 'DORIAN', 'SANMARTIN - TAUTII MAGHERAUS', '950', '199,50', '1149,50'],
  ['29.08.2025', '30.08.2025', 'DORIAN', 'MATESZALKA - DEVA', '2105,58', '442,17', '2547,75'],
  ['30.08.2025', '31.08.2025', 'DORIAN', 'GYULA - SATU MARE', '2103,97', '441,83', '2545,80'],
  ['02.09.2025', '04.09.2025', 'DORIAN', 'CAREI - CROATIA', '4081,54', '857,12', '4938,66'],
  ['04.09.2025', '05.09.2025', 'DORIAN', 'CROATIA - SFANTU GHEORGHE', '5803,91', '1218,82', '7022,73'],
  ['06.09.2025', '09.09.2025', 'DORIAN', 'TARGU MURES - HAJDUBOSZORMENY', null, null, '1557,94'],
  ['09.09.2025', '10.09.2025', 'DORIAN', 'ZILINA - SEBES', '5265,79', '1105,82', '6371,61'],
  ['10.09.2025', '11.09.2025', 'DORIAN', 'APAHIDA - GILAU', '1180', '247,80', '1427,80'],
  ['12.09.2025', '12.09.2025', 'DORIAN', 'KISVARDA - SALONTA', null, null, '2107,90'],
  ['12.09.2025', '13.09.2025', 'DORIAN', 'CLUJ NAPOCA - TURDA', '950', '199,50', '1149,50', 'lepakolni Kalman'],
  ['13.09.2025', '16.09.2025', 'ANDOR', 'NAGYKALLO - LUGOJ', '2106,46', '442,36', '2548,82', 'lepakolni Dorian'],
  ['16.09.2025', '17.09.2025', 'DORIAN', 'LUGOJ - NAGYKALLO', '1686,16', '354,09', '2040,25'],
  ['17.09.2025', '18.09.2025', 'DORIAN', 'NAGYKALLO - ORADEA', '2107,66', '442,61', '2550,27'],
  ['18.09.2025', '19.09.2025', 'DORIAN', 'ORADEA - SALONTA + SACUENI +VALEA LUI MIHAI', '1320', '277,20', '1597,20'],
  ['19.09.2025', '20.09.2025', 'DORIAN', 'CAREI - SZEKESFEHERVAR', '2952,81', '620,09', '3572,90'],
];
const isoDmy = (s) => `${s.slice(6, 10)}-${s.slice(3, 5)}-${s.slice(0, 2)}`;

// Curse FICTIVE XX00DEM, oct. 2026 (formatul tabelului real; ISO în loc de dd.mm.yyyy). Vezi defectele deliberate în antet.
const ROWS_2026 = [
  ['2026-10-01', '2026-10-02', 'DORIAN', 'HAJDUDOROG - HALMEU', '2105,58', '442,17', '2547,75'],
  ['2026-10-05', '2026-10-05', 'DORIAN', 'SATU MARE - TOROKSZENTMIKLOS', '1686,16', '354,09', '2040,25'],
  ['2026-10-06', '2026-10-06', 'DORIAN', 'GORBEHAZA - PETELEA', '2697,97', '566,57', '3264,54'],
  ['2026-10-07', '2026-10-08', 'KALMAN', 'MIERCUREA CIUC - UNGURAS', null, null, '1557,94', 'lepakolni Dorian'],     // doar Total
  ['2026-10-09', '2026-10-09', 'DORIAN', 'SEINI - ARAD', '2107,66', '442,61', '2550,27'],                           // zi cu GPS inactiv
  ['2026-10-12', '2026-10-12', 'DORIAN', 'KISVARDA - ALSOZSOLCA', '2106,46', '442,36', '2548,82'],
  ['2026-10-13', '2026-10-15', 'DORIAN', 'SATU MARE - ARAD', '4081,54', '857,12', '4938,66'],                      // suprapusă cu următoarea
  ['2026-10-14', '2026-10-16', 'DORIAN', 'ARAD - MEDIESU AURIT', '2952,81', '620,09', '3572,90'],
  ['2026-10-19', '2026-10-19', 'DORIAN', 'TYUKOD - ARAD', '2106,46', '442,36', '2548,82'],
  ['2026-10-20', '2026-10-20', 'DORIAN', 'ARAD - MOFTIN', '1320', '277,20', '1597,20'],
  ['2026-10-21', '2026-10-21', 'DORIAN', 'BAIA MARE - SZOMBATHELY', '5057,06', '1061,98', '6119,04'],              // loc niciodată vizitat
  ['2026-10-22', '2026-10-22', 'DORIAN', 'VASAROSNAMENY - ALSOZSOLCA', '1552,22', '325,97', '1878,19'],
  ['2026-10-23', '2026-10-23', 'DORIAN', 'HALMEU - SEINI', '1250', '262,50', '1512,50'],
  ['2026-10-26', '2026-10-27', 'DORIAN', 'NYIREGYHAZA - TIMISOARA', '3161,29', '663,87', '3825,16'],
  ['2026-10-27', '2026-10-27', 'DORIAN', 'GHIRODA - ZARNESTI', '2697,97', '566,57', '3264,54'],                     // lanț în aceeași zi
  ['2026-10-28', '2026-10-28', 'DORIAN', 'ZARNESTI - SIGHISOARA', '2021,05', '424,42', '2445,47'],
  ['2026-10-29', '2026-10-29', 'DORIAN', 'NEGRESTI - ARAD', '2107,66', '442,61', '2550,27'],
  ['2026-10-30', '2026-10-30', 'KALMAN', 'ARAD - HODOD', null, null, null, 'lepakolni Kalman', 3900],             // fără preț + număr rătăcit în K
  ['2026-09-28', '2026-09-29', 'DORIAN', 'ARAD - TYUKOD', '1686,16', '354,09', '2040,25'],                          // înaintea intervalului GPS
  ['2026-11-03', '2026-11-03', 'DORIAN', 'SATU MARE - ARAD', '2106,46', '442,36', '2548,82'],                        // după intervalul GPS
];

function makeCourse(row, i, o) {
  const [load0, unload0, driver, route, g, h, tot, note, stray] = row;
  const loadDate = o.dmy ? isoDmy(load0) : load0, unloadDate = o.dmy ? isoDmy(unload0) : unload0;
  const price = priceFromColumns({ net: T(g), vat: T(h), gross: T(tot), date: loadDate });
  const r = parseRoute(route);
  const eurPerUnit = rateDiv('1', EUR_RON);
  const toEur = (m) => (m == null ? null : convert(m, 'RON', 'EUR', eurPerUnit));
  const id = courseId({ plate: o.plate, loadDate, unloadDate, route }, o.ordinal);
  void i;
  return base({
    id, truckId: o.truckId, trailerPlate: o.trailer, driverId: driverIdOf(driver), driverRaw: driver,
    loadDate, unloadDate, invoiceDate: null, routeRaw: route, origin: r.origin, destinations: r.destinations,
    originCountry: r.originCountry, destCountry: r.destCountry, invoiceNo: null, clientName: null, uit: null,
    currency: 'RON', vatTreatment: price.vatTreatment, net: price.net, vatBp: price.vatBp, vat: price.vat, gross: price.gross,
    vatDerived: price.vatDerived, priceStatus: price.priceStatus, vatRateBasis: 'loadDate',
    fx: { ronPerUnit: '1', eurPerUnit, rateDate: loadDate, source: 'ron', manual: false, stale: false, dateBasis: 'loadDate' },
    ron: { net: price.net ?? 0, vat: price.vat ?? 0, gross: price.gross ?? 0 },
    eur: { net: toEur(price.net) ?? 0, vat: toEur(price.vat) ?? 0, gross: toEur(price.gross) ?? 0 },
    loadedKm: { meters: null, source: null, confidence: null, at: null },
    note: note || '', handoverTo: note && /lepakolni\s+(\S+)/i.test(note) ? note.match(/lepakolni\s+(\S+)/i)[1] : null,
    strayValues: stray != null ? [stray] : [], sheet: { file: o.file, name: o.sheet, row: o.row0 + i }, importId: null, manualFields: [],
    status: price.priceStatus === 'missing' ? 'review' : 'ok', demo: true,
  });
}

// Curse generate pentru celelalte camioane / luni (PRNG)
const ROUTE_POOL = [
  'ORADEA - NYIREGYHAZA', 'SATU MARE - DEBRECEN', 'ARAD - SZEGED', 'CLUJ NAPOCA - BUDAPEST', 'TURDA - SZEKESFEHERVAR', 'ZALAU - KAPOSVAR',
  'SIMLEU - GYOR', 'TIMISOARA - GYOR', 'HALMEU - MISKOLC', 'BAIA MARE - KOSICE', 'BISTRITA - EGER', 'DEJ - HAJDUDOROG', 'GYULA - ARAD',
  'ZALAU - TOROKSZENTMIKLOS', 'CAREI - DEBRECEN', 'ORASU NOU - SZOLNOK', 'MATESZALKA - CLUJ NAPOCA', 'SZEGED - TIMISOARA',
];
function genCourses(rand, truck, from, to, driver, skip) {
  const out = [];
  let d = from;
  let n = 0;
  while (d <= to) {
    const dow = new Date(d + 'T00:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6) { d = addDays(d, 1); continue; }
    const len = 1 + ri(rand, 3);
    const end = addDays(d, len - 1) > to ? to : addDays(d, len - 1);
    if (!(skip && skip(d, end))) {
      const route = ROUTE_POOL[ri(rand, ROUTE_POOL.length)];
      const net = 130000 + ri(rand, 450000);
      const vat = mulDiv(net, 2100, 10000);
      const dec = (m) => toDecimalString(m, 'RON').replace('.', ',');
      out.push([d, end, driver, route, dec(net), dec(vat), dec(net + vat)]);
      n++;
    }
    d = addDays(end, 1 + (rand() < 0.5 ? 1 + ri(rand, 2) : 0));
  }
  void n;
  return out;
}

// ------------------------------------------------------------------------------------------------ construirea documentului
const MONTHS = ['2026-07', '2026-08', '2026-09', '2026-10'];

/**
 * Construiește DbDoc-ul demo (determinist pentru aceeași sămânță). Toate datele sunt FICTIVE.
 * @param {number} [seed=1]
 * @param {{ today?:string }} [o]  `today` ancorează scadențele (alerte) și planurile de service; implicit 2026-11-18.
 * @returns {object} DbDoc (schemaVersion 1) cu `meta.demo = true`
 */
export function buildDemoDb(seed = 1, o = {}) {
  const rand = rng(seed);
  const today = o.today || DEMO_TODAY;
  const categories = defaultCategories();
  const countries = defaultCountries();
  const roVatRates = defaultRoVatRates();
  const currencies = defaultCurrencies();
  const company = {
    name: 'Transport Demo SRL (FICTIV)', cui: 'RO00000000', vatPayer: true, countryCode: 'RO', reportingCurrency: 'RON', fiscalYearStartMonth: 1,
    noDocCeilingMinor: 20000, noDocCeilingMonthlyPerTruckMinor: 100000, revenueRecognition: 'prorata', overheadAllocation: 'daysInFleet',
    profitIncludesDepreciation: true, closedThrough: null, homeBase: 'Orașu Nou', longStopHours: 6, excludeAutoPendingFromProfit: false,
  };

  // --- flotă
  const TRUCKS = [['XX00DEM', 'XX30DEM', 32], ['XX01DEM', 'XX31DEM', 31], ['XX02DEM', 'XX32DEM', 33]];
  const trucks = TRUCKS.map(([p, , l]) => base({
    id: 'trk_' + p.toLowerCase(), plate: p, plateDisplay: displayPlate(p), name: null, model: 'Tractor 4x2 (demo)', year: 2021, activeFrom: '2024-01-01', activeTo: null,
    normFuelL100: l, notes: 'Date demo',
  }));
  const trailers = TRUCKS.map(([p, t]) => base({ id: 'trl_' + t.toLowerCase(), plate: t, type: 'Prelată', activeFrom: '2024-01-01', activeTo: null }));
  const trailerAssignments = TRUCKS.map(([p, t]) => base({ id: detId('tas', p, t), trailerId: 'trl_' + t.toLowerCase(), truckId: 'trk_' + p.toLowerCase(), from: '2025-01-01', to: null }));
  const drivers = DRIVERS.map(([n, al]) => base({ id: driverIdOf(n), name: n, aliases: al, active: true }));
  const truckId = (p) => 'trk_' + p.toLowerCase();
  const DRV = { XX00DEM: 'DORIAN', XX01DEM: 'KALMAN', XX02DEM: 'ANDOR' };

  // --- GPS: XX00DEM real (oct. 2026), celelalte sintetice
  const gpsTrips = GPS_TRIPS.map(([start, stop, sp, ep, dist]) => base({
    id: detId('gpt', truckId('XX00DEM'), start), truckId: truckId('XX00DEM'), plate: 'XX00DEM', start, stop, startPos: sp, stopPos: ep, distanceM: dist, demo: true,
  }));
  const gpsDays = GPS_DAILY.map(([date, kmM, drivingS], i) => base({
    id: detId('gpd', truckId('XX00DEM'), date), truckId: truckId('XX00DEM'), plate: 'XX00DEM', date, kmM, drivingS,
    odoStartM: i === 0 ? 358257900 : null, odoStopM: i === GPS_DAILY.length - 1 ? 366635300 : null, demo: true,
  }));
  const octDays = eachDay('2026-10-01', '2026-10-31');

  // --- curse
  const courses = [];
  const addRows = (rows, o2) => rows.forEach((r, i) => courses.push(makeCourse(r, i, { ...o2, ordinal: 1 })));
  addRows(ROWS_2025, { dmy: true, plate: 'XX00DEM', truckId: truckId('XX00DEM'), trailer: 'XX30DEM', file: 'tabel-curse-poza-FICTIV.xlsx', sheet: 'XX00DEM 2025', row0: 121 });
  addRows(ROWS_2026, { plate: 'XX00DEM', truckId: truckId('XX00DEM'), trailer: 'XX30DEM', file: 'tabel-curse-XX00DEM-FICTIV.xlsx', sheet: 'XX00DEM 2026', row0: 2 });
  addRows(genCourses(rng(seed + 11), 'XX00DEM', '2026-07-01', '2026-09-25', 'DORIAN'), { plate: 'XX00DEM', truckId: truckId('XX00DEM'), trailer: 'XX30DEM', file: 'tabel-curse-XX00DEM-FICTIV.xlsx', sheet: 'XX00DEM 2026', row0: 40 });
  addRows(genCourses(rng(seed + 22), 'XX01DEM', '2026-07-01', '2026-10-30', 'KALMAN'), { plate: 'XX01DEM', truckId: truckId('XX01DEM'), trailer: 'XX31DEM', file: 'tabel-curse-XX01DEM-FICTIV.xlsx', sheet: 'XX01DEM 2026', row0: 2 });
  addRows(genCourses(rng(seed + 33), 'XX02DEM', '2026-07-01', '2026-10-30', 'ANDOR'), { plate: 'XX02DEM', truckId: truckId('XX02DEM'), trailer: 'XX32DEM', file: 'tabel-curse-XX02DEM-FICTIV.xlsx', sheet: 'XX02DEM 2026', row0: 2 });
  // id-uri unice (două curse identice generate ⇒ ordinal)
  const seen = new Map();
  for (const c of courses) { const n = (seen.get(c.id) || 0) + 1; seen.set(c.id, n); if (n > 1) c.id = detId(c.id, '#', n); }

  // GPS sintetic pentru XX01DEM / XX02DEM în oct. 2026: zile active în ferestrele curselor, între curse parcurs pe gol, weekend 0
  for (const p of ['XX01DEM', 'XX02DEM']) {
    const tid = truckId(p);
    const wins = courses.filter((c) => c.truckId === tid).map((c) => [c.loadDate, c.unloadDate]);
    for (const d of octDays) {
      const dow = new Date(d + 'T00:00:00Z').getUTCDay();
      const inCourse = wins.some(([a, b]) => d >= a && d <= b);
      let km = 0;
      if (dow !== 0 && dow !== 6) km = inCourse ? 280 + ri(rand, 180) : rand() < 0.25 ? 0 : 40 + ri(rand, 140);
      else if (rand() < 0.15) km = 60 + ri(rand, 80);
      gpsDays.push(base({ id: detId('gpd', tid, d), truckId: tid, plate: p, date: d, kmM: km * 1000 + ri(rand, 900), drivingS: km * 48, odoStartM: null, odoStopM: null, demo: true }));
    }
  }

  // --- intrări (cheltuieli / venituri)
  let seq = 0;
  const entries = [];
  const mk = (i) => {
    const e = buildEntry({ kind: 'expense', source: 'manual', documentation: 'invoice', status: 'confirmed', countryCode: 'RO', currency: 'RON', entered: 'gross', targetType: 'truck', ...i },
      { company, countries, categories, roVatRates, rate: rateFor(i.currency || 'RON', i.date), now: NOW, id: detId('ent', 'demo', ++seq) });
    e.updatedBy = BY;
    e.demo = true;
    entries.push(e);
    return e;
  };
  const kmOfMonth = (p, m) => {
    if (p === 'XX00DEM' && m === '2026-10') return 8376;
    if (p !== 'XX00DEM' && m === '2026-10') return mulDiv(gpsDays.filter((d) => d.truckId === truckId(p) && d.date.startsWith('2026-10')).reduce((s, d) => s + d.kmM, 0), 1, 1000);
    return 7000 + ri(rand, 1700);
  };
  const workday = (m, k, n) => { // a k-a din n zile ~uniform în lună, evitând duminica
    const dim = daysInMonth(+m.slice(0, 4), +m.slice(5, 7));
    let day = Math.min(dim, 2 + Math.floor(((dim - 3) * k) / n)); // money-ok: zi din lună, nu bani
    let d = `${m}-${String(day).padStart(2, '0')}`;
    if (new Date(d + 'T00:00:00Z').getUTCDay() === 0) { day = Math.min(dim, day + 1); d = `${m}-${String(day).padStart(2, '0')}`; }
    return d;
  };
  for (const [p] of TRUCKS) {
    const tid = truckId(p);
    for (const m of MONTHS) {
      const km = kmOfMonth(p, m);
      const litres = mulDiv(km, 32, 100);
      const w = Array.from({ length: 5 }, () => 700 + ri(rand, 600));
      const parts = allocate(litres * 1000, w);                                             // mililitri pe alimentare
      parts.forEach((ml, k) => {
        const d = workday(m, k, 5);
        const foreign = k === 3;
        if (foreign && p !== 'XX02DEM') {
          mk({ date: d, truckId: tid, categoryId: 'cat_fuel', supplier: 'MOL (HU)', countryCode: 'HU', currency: 'HUF', minor: mulDiv(ml, 625 + ri(rand, 40), 1000), payment: 'fuelcard', fuel: { ml, odoM: null } });
        } else {
          mk({ date: d, truckId: tid, categoryId: 'cat_fuel', supplier: k % 2 ? 'OMV' : 'Petrom', minor: mulDiv(ml, 715 + ri(rand, 40), 1000), payment: 'fuelcard', fuel: { ml, odoM: null } });
        }
      });
      mk({ date: workday(m, 1, 3), truckId: tid, categoryId: 'cat_toll_hu', supplier: 'HU-GO', countryCode: 'HU', currency: 'HUF', minor: 18000 + ri(rand, 34000), payment: 'card' });
      mk({ date: workday(m, 2, 3), truckId: tid, categoryId: 'cat_toll_ro', supplier: 'CNAIR', minor: 2800 + ri(rand, 9000), payment: 'card', documentation: 'receipt' });
      mk({ date: workday(m, 2, 4), truckId: tid, categoryId: 'cat_adblue', supplier: 'Petrom', minor: 30000 + ri(rand, 40000), payment: 'fuelcard' });
      mk({ date: workday(m, 3, 4), truckId: tid, categoryId: 'cat_parking', supplier: 'Parcare Nădlac', minor: 4000 + ri(rand, 8000), documentation: 'receipt', payment: 'cash', moneySource: 'driverAdvance' });
      if (rand() < 0.55) mk({ date: workday(m, 2, 5), truckId: tid, categoryId: 'cat_service', supplier: 'Service Truck Demo', minor: 40000 + ri(rand, 310000), payment: 'bank' });
      mk({ date: `${m}-${String(daysInMonth(+m.slice(0, 4), +m.slice(5, 7))).padStart(2, '0')}`, truckId: tid, categoryId: 'cat_salary', supplier: 'Salariu ' + DRV[p],
        minor: 550000, vat: { treatment: 'none', rateBp: null, deductiblePct: 0 }, vatRegime: 'outOfScope', payment: 'bank' });
      mk({ date: `${m}-28`, truckId: tid, categoryId: 'cat_diurna', supplier: 'Diurnă ' + DRV[p], currency: 'EUR', minor: 48000 + ri(rand, 15000),
        vat: { treatment: 'none', rateBp: null, deductiblePct: 0 }, vatRegime: 'outOfScope', payment: 'bank' });
      mk({ date: workday(m, 4, 5), truckId: tid, categoryId: 'cat_other', supplier: 'Cheltuială mică (cash)', minor: 6000 + ri(rand, 13000), documentation: 'none', payment: 'cash', moneySource: 'driverAdvance', note: 'Fără document (demo)' });
    }
  }
  // câteva cazuri speciale pentru ecranele De verificat / TVA / fără document
  mk({ date: '2026-09-17', truckId: truckId('XX00DEM'), categoryId: 'cat_service', supplier: 'Werkstatt Demo GmbH', countryCode: 'DE', currency: 'EUR', minor: 93000, payment: 'card', note: 'Reparație în Germania (demo)' });
  mk({ date: '2026-10-12', truckId: truckId('XX01DEM'), categoryId: 'cat_other', supplier: 'Cheltuială peste plafon (cash)', minor: 48000, documentation: 'none', payment: 'cash', moneySource: 'driverAdvance',
    justification: 'Taxă locală plătită pe loc, fără bon (demo)', approvedAt: '2026-10-13T09:00:00.000Z' });
  mk({ date: '2026-10-29', truckId: truckId('XX02DEM'), categoryId: 'cat_service', supplier: 'Bon service de verificat', minor: 52000, documentation: 'receipt', status: 'pending', note: 'De verificat (demo)' });
  mk({ date: '2026-09-22', truckId: truckId('XX00DEM'), kind: 'income', incomeType: 'recovery', categoryId: 'cat_rec_fuel', supplier: 'Client demo', minor: 42000,
    vat: { treatment: 'none', rateBp: null, deductiblePct: 0 }, vatRegime: 'outOfScope', payment: 'bank', note: 'Recuperare combustibil (demo)' });
  mk({ date: '2026-10-15', truckId: truckId('XX02DEM'), kind: 'income', incomeType: 'other', categoryId: 'cat_inc_other', supplier: 'Client demo', minor: 80000,
    vat: { treatment: 'none', rateBp: null, deductiblePct: 0 }, vatRegime: 'outOfScope', payment: 'bank', note: 'Alt venit (demo)' });

  // --- șabloane de cheltuieli fixe (generate de catch-up la deschiderea aplicației)
  const VAT21 = { treatment: 'taxed', rateBp: 2100, deductiblePct: 100 };
  const tpls = [
    { id: 'tpl_lease', name: 'Rată leasing camion', categoryId: 'cat_lease', supplier: 'Leasing Demo IFN', frequency: 'monthly', dayOfMonth: 5, startDate: '2026-01-05', backfillFrom: '2026-09',
      target: { type: 'trucks', truckIds: trucks.map((t) => t.id) }, version: { currency: 'RON', entered: 'gross', minor: 520000, vat: VAT21, countryCode: 'RO', perTruck: { [truckId('XX00DEM')]: 520000, [truckId('XX01DEM')]: 480000, [truckId('XX02DEM')]: 455000 } } },
    { id: 'tpl_gps', name: 'Abonament GPS SafeFleet', categoryId: 'cat_gps', supplier: 'SafeFleet (demo)', frequency: 'monthly', dayOfMonth: 1, startDate: '2026-01-01', backfillFrom: '2026-09',
      target: { type: 'fleet', truckIds: [] }, version: { currency: 'RON', entered: 'gross', minor: 36000, vat: VAT21, countryCode: 'RO', perTruck: null } },
    { id: 'tpl_rent', name: 'Chirie parcare bază', categoryId: 'cat_rent', supplier: 'Parcare Orașu Nou (demo)', frequency: 'monthly', dayOfMonth: 1, startDate: '2026-01-01', backfillFrom: '2026-09',
      target: { type: 'company', truckIds: [] }, version: { currency: 'RON', entered: 'gross', minor: 150000, vat: VAT21, countryCode: 'RO', perTruck: null } },
    { id: 'tpl_accountant', name: 'Abonament contabil', categoryId: 'cat_accountant', supplier: 'Contabil Demo', frequency: 'monthly', dayOfMonth: 25, startDate: '2026-01-25', backfillFrom: '2026-09',
      target: { type: 'company', truckIds: [] }, version: { currency: 'RON', entered: 'gross', minor: 80000, vat: VAT21, countryCode: 'RO', perTruck: null } },
    { id: 'tpl_rca', name: 'Asigurare RCA (anuală)', categoryId: 'cat_rca', supplier: 'Asigurări Demo', frequency: 'yearly', dayOfMonth: 15, startDate: '2026-03-15', backfillFrom: '2026-03', spreadMonths: 12,
      target: { type: 'trucks', truckIds: trucks.map((t) => t.id) }, version: { currency: 'RON', entered: 'gross', minor: 960000, vat: { treatment: 'zero', rateBp: null, deductiblePct: 0 }, countryCode: 'RO', perTruck: { [truckId('XX00DEM')]: 960000, [truckId('XX01DEM')]: 940000, [truckId('XX02DEM')]: 910000 } } },
  ];
  const templates = tpls.map(({ version, ...t }) => base({ documentation: 'invoice', payment: 'bank', moneySource: 'company', financingId: null, active: true, spreadMonths: null, totalMinor: null, ...t }));
  const templateEvents = tpls.map((t) => base({ id: detId('tev', t.id, 'version', t.startDate.slice(0, 7)), templateId: t.id, type: 'version', period: t.startDate.slice(0, 7), payload: { ...t.version, components: null } }));

  // --- scadențe (A) și mentenanță (G): relative la `today` ca să apară în alerte
  const exp = (subjectType, subjectId, kind, days, note) => base({ id: detId('exp', subjectType, subjectId, kind), subjectType, subjectId, kind, dueDate: addDays(today, days), note: note || '', renewedAt: null, active: true });
  const expiries = [
    exp('truck', truckId('XX00DEM'), 'ITP', 17), exp('truck', truckId('XX01DEM'), 'RCA', 7), exp('truck', truckId('XX02DEM'), 'ITP', 120), exp('truck', truckId('XX00DEM'), 'RCA', 220),
    exp('truck', truckId('XX01DEM'), 'TAHO_CAL', 14), exp('truck', truckId('XX00DEM'), 'ROVINIETA', 75), exp('trailer', 'trl_xx30dem', 'ITP', 29),
    exp('driver', driverIdOf('ANDOR'), 'PERMIS', -8, 'Depășit (demo)'), exp('driver', driverIdOf('DORIAN'), 'CARD_TAHO', 300),
  ];
  const serviceItems = [
    base({ id: 'svc_cj26_ulei', subjectType: 'truck', subjectId: truckId('XX00DEM'), name: 'Revizie ulei și filtre', intervalKmM: 60000000, lastKmM: 330000000, lastDate: '2026-04-20', nextKmM: 390000000, active: true }),
    base({ id: 'svc_cj26_frane', subjectType: 'truck', subjectId: truckId('XX00DEM'), name: 'Verificare frâne', intervalKmM: 40000000, lastKmM: 328000000, lastDate: '2026-03-10', nextKmM: 368000000, active: true }),
    base({ id: 'svc_sm54_rev', subjectType: 'truck', subjectId: truckId('XX01DEM'), name: 'Revizie periodică', intervalMonths: 6, lastDate: '2026-05-25', nextDate: addDays(today, 12), active: true }),
    base({ id: 'svc_trl_frane', subjectType: 'trailer', subjectId: 'trl_xx30dem', name: 'Revizie remorcă', intervalMonths: 12, lastDate: '2026-02-01', nextDate: addDays(today, 70), active: true }),
  ];

  const financing = [
    base({ id: 'fin_cj26', truckId: truckId('XX00DEM'), type: 'operational', valueMinor: 0, currency: 'RON', startDate: '2025-01-05', endDate: '2029-01-05', interestBp: null, residualMinor: 0, usefulLifeMonths: 48 }),
    base({ id: 'fin_sm54', truckId: truckId('XX01DEM'), type: 'financial', valueMinor: 32000000, currency: 'RON', startDate: '2025-03-01', endDate: '2030-03-01', interestBp: 650, residualMinor: 4000000, usefulLifeMonths: 96 }),
  ];

  const aliases = [];
  const doc = {
    schemaVersion: 1,
    meta: { docId: 'demo', epoch: { id: 'demo', no: 1 }, appVersionMin: '1.0.0', devices: {}, demo: true, demoBadge: DEMO_BADGE, demoNote: DEMO_NOTE },
    singletons: {
      company,
      ui: { demo: true },
      importMappings: {},
      fx: { enabled: true, preferredSource: 'bnr' },
      benchmarks: { avgEmptyPct: 20, targetEmptyPct: 5, label: 'orientativ, sursă comercială' },
      a11y: { hotkeys: true },
      diurna: { defaultRateEur: 3500, ratesEur: {}, verified: false },
    },
    collections: {
      trucks, trailers, trailerAssignments, drivers, categories, countries, currencies, roVatRates,
      entries, templates, templateEvents, occurrences: [], financing,
      courses, places: [], aliases, routeCache: [], gpsDays, gpsTrips, rates: [], closures: [], flags: [], importLogs: [], audit: [],
      expiries, serviceItems, uitRules: [], supplierRules: [],
    },
  };
  void plateOf; void monthRange;
  return doc;
}
