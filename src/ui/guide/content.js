// Ghid de utilizare: UN singur modul de conținut, folosit de ecranul #/ghid și exportat în docs/GHID-UTILIZATOR.md (npm run guide). Stă în stratul „ui” ca să poată fi folosit și de ecranul de bun venit.
// Modul pur (fără Preact/DOM): se poate importa din node (teste, script).
// Text simplu cu marcaje: **îngroșat**, `cod`, [text](/rută) (rută a aplicației, ex. /import, /setari/fixe) și [text](/ghid/id) (altă secțiune din ghid).
// Toate exemplele sunt FICTIVE (XX 00 DEM etc.): nicio plăcuță, adresă sau șofer real.

const p = (x) => ({ t: 'p', x });
const ul = (items) => ({ t: 'ul', items });
const ol = (items) => ({ t: 'ol', items });
const note = (x) => ({ t: 'note', x });
const warn = (x) => ({ t: 'warn', x });
const ex = (x) => ({ t: 'ex', x });
const dl = (items) => ({ t: 'dl', items });
const steps = (items) => ({ t: 'steps', items }); // items: [{ x, to? }]
const card = (id, title, ...blocks) => ({ id, title, blocks });

/** „Noutăți în această versiune” (apare în blocul „Despre aplicație”). */
export const NEWS = {
  version: '1.0.0',
  items: [
    'Prima versiune, pentru administrator (un singur utilizator care vede tot).',
    'Cheltuieli și venituri pe camion, cu TVA, fără TVA sau fără document justificativ, în lei, euro, forinți și alte monede.',
    'Cheltuieli fixe lunare care se adaugă singure (leasing, RCA, ITP, rovinietă, abonamente).',
    'Import din Excel: tabelul de curse, exporturile SafeFleet (foaie de activitate și călătorii), extrase de card și e-Factura XML.',
    'Confruntare între cursele facturate și ce arată GPS-ul, plus raportul de km pe gol.',
    'Rapoarte și export Excel cu grafice, plus CSV pentru contabil.',
    'Fără bannere permanente: starea datelor este în iconița „Stare date”, iar notificările apar doar când ai de făcut ceva (backup, probleme de sincronizare).',
    'Backup JSON, mod local sau Google Drive, instalare pe ecranul principal al telefonului.',
    'Acest ghid, cu căutare, exemple și rețete pas cu pas.',
  ],
};

export const GUIDE = {
  title: 'Ghid: cum se folosește aplicația',
  intro: 'Aplicația te ajută să vezi cât câștigă sau pierde fiecare camion. Nu trebuie să înțelegi totul din prima. Începe cu „Primii pași”, apoi caută ce te interesează.',
  sections: [
    {
      id: 'ce-este',
      title: '1. Ce este aplicația și ce nu este',
      cards: [
        card('ce-este-aplicatia', 'Ce face aplicația',
          p('Flota Costuri ține evidența banilor firmei tale de transport, **pe fiecare camion**.'),
          ul([
            'Notezi **cheltuieli** (motorină, service, rate, taxe) și **venituri**.',
            'Aduci **cursele** din tabelul tău Excel.',
            'Aduci **kilometrii** din exporturile Excel ale GPS-ului SafeFleet.',
            'Vezi **profitul** pe camion și pe flotă, **kilometrii pe gol** și rapoarte.',
            'Exporți totul în **Excel cu grafice** sau CSV pentru contabil.',
          ]),
          p('O cheltuială care nu are document (de exemplu 10 lei bacșiș la spălătorie) se poate nota, rămâne vizibilă și este marcată clar. Vezi [Fără document justificativ](/ghid/idee-fara-document).')),
        card('ce-nu-este', 'Ce NU este',
          ul([
            'Nu este program de contabilitate. Profitul de aici **nu este profit contabil sau fiscal**.',
            'Nu emite facturi și nu trimite nimic la ANAF (nici e-Factura, nici e-Transport). Poți doar să **importi** e-Facturi și să **notezi** un cod UIT pe o cursă.',
            'Nu se conectează singur la SafeFleet. Tu aduci fișierele Excel exportate din SafeFleet.',
            'Are un singur utilizator: administratorul. Nu există conturi pentru șoferi, contabil sau dispecer.',
          ]),
          note('Pentru orice decizie fiscală, verifică cu contabilul tău.')),
        card('unde-sunt-datele', 'Unde sunt datele tale',
          p('Aplicația nu are server. Datele stau în unul din două locuri:'),
          ul([
            '**Mod local:** în browserul acestui dispozitiv. Alt calculator, alt telefon sau alt browser înseamnă alt set de date, gol.',
            '**Mod Google:** într-un fișier din folderul ascuns al aplicației din Google Drive-ul tău. Te conectezi cu contul Google al administratorului.',
          ]),
          p('Ca să vezi unde sunt datele chiar acum și când ai făcut ultimul backup, apasă iconița „Stare date” (un disc sau un nor) din bara de sus. Nu există bannere permanente: aplicația te anunță doar când trebuie să faci ceva, de exemplu un backup.'),
          p('În ambele cazuri, fă **backup JSON** periodic: [cum fac backup](/ghid/rec-backup). Detalii: [mod local sau Google](/ghid/rec-google).'),
          warn('În mod local, dacă ștergi datele site-ului din browser, datele dispar. Backup-ul este singura copie.')),
      ],
    },
    {
      id: 'primii-pasi',
      title: '2. Primii pași, în ordine',
      cards: [
        card('primii-pasi-lista', 'Lista de 10 pași',
          p('Nu trebuie făcuți toți într-o zi. Ordinea asta evită cele mai multe confuzii. La fiecare pas, butonul te duce direct unde trebuie.'),
          steps([
            { x: '**1. Firma.** Numele, CUI, dacă ești plătitor de TVA și moneda de raportare (de obicei lei).', to: '/setari/firma' },
            { x: '**2. Camioane, remorci și șoferi.** Plăcuța este obligatorie. Leagă fiecare remorcă de un camion.', to: '/setari/camioane' },
            { x: '**3. Categorii.** Vin deja completate (combustibil, service, taxe de drum…). Adaugi doar ce lipsește.', to: '/setari/categorii' },
            { x: '**4. Țări și TVA.** Verifică cotele de TVA ale țărilor în care circulă camioanele. Sunt valori de pornire.', to: '/setari/tari' },
            { x: '**5. Monede.** Ce monede folosești (lei, euro, forinți…) și de unde vine cursul.', to: '/setari/valute' },
            { x: '**6. Cheltuieli fixe.** Leasing, RCA, ITP, rovinietă, GPS, chirie: le definești o dată și se adaugă singure în fiecare lună.', to: '/setari/fixe' },
            { x: '**7. Importă cursele** din tabelul tău Excel.', to: '/import' },
            { x: '**8. Importă GPS-ul**: exporturile Excel din SafeFleet (foaia de activitate zilnică și călătorii).', to: '/import' },
            { x: '**9. Verifică.** Ce a rămas „de verificat”, apoi confruntarea dintre curse și GPS.', to: '/verificare' },
            { x: '**10. Fă un backup.** Descarci o copie a datelor și o ții într-un loc sigur.', to: '/setari/date' },
          ]),
          note('Pe ecranul Acasă, cât timp ești la început, apare și o listă scurtă „Primii pași” cu 3 pași: camioanele, cursele și cheltuielile fixe.')),
      ],
    },
    {
      id: 'ecrane',
      title: '3. Pe scurt, fiecare ecran',
      cards: [
        card('ecran-acasa', 'Acasă',
          p('Imaginea de ansamblu a lunii alese (luna se schimbă din bara de sus, la fel și RON/EUR).'),
          ul([
            '**Patru cifre mari:** Profit operațional (cu profitul documentat dedesubt), Venit (fără TVA), Costuri și Km pe gol.',
            '**Clasamentul camioanelor**, de la cel mai slab. Apeși pe un rând și deschizi fișa camionului. Apeși pe Venit sau Cost și vezi lista din spate.',
            '**Alerte:** ce e de verificat, curse fără preț, steaguri GPS neconfirmate, scadențe (ITP, RCA…).',
            '**„Luna asta: ce s-a adăugat automat”:** cheltuielile fixe generate singure.',
            '**Grafic** cu profitul pe ultimele 12 luni.',
          ]),
          ex('Exemplu: XX 00 DEM apare la început în clasament, cu profit negativ. Apeși pe rând și vezi la „De ce pierde?” că rata de leasing și costurile comune au depășit venitul.')),
        card('ecran-camion', 'Camioane (fișa camionului)',
          p('Totul despre un singur camion, pe luna aleasă.'),
          ul([
            'Profit operațional și documentat, **profit/km** și **cost/km**.',
            'O explicație scurtă: **„De ce pierde?”** sau **„De ce câștigă?”**.',
            'Structura costurilor, km încărcați și goi, **golurile dintre curse**, scadențele camionului, cheltuielile în valută și cursele lui.',
            'Un panou „Calitatea datelor” care îți spune ce lipsește (de exemplu zile fără GPS).',
          ])),
        card('ecran-tranzactii', 'Cheltuieli și venituri',
          p('Lista tuturor cheltuielilor și veniturilor, cu totaluri în lei și euro.'),
          ul([
            '**Filtre:** lună, camion, categorie, stare, „fără document”, „curs manual”, căutare după furnizor, număr de document sau notă.',
            '**Adaugă rapid:** un rând de introducere pentru mai multe cheltuieli la rând.',
            '**Duplică ultima** (Alt+Shift+D) și **Copiază luna trecută** (pentru cheltuielile variabile).',
            '**Acțiuni pe selecție:** schimbi categoria sau camionul mai multor rânduri deodată. Poți anula în 15 secunde.',
          ]),
          p('Rețete: [adaug o cheltuială](/ghid/rec-cheltuiala), [copiez luna trecută](/ghid/rec-copiaza-luna).')),
        card('ecran-verificare', 'De verificat',
          p('Lista a ceea ce are nevoie de ochii tăi înainte să te bazezi pe cifre.'),
          ul([
            'Cheltuielile **generate automat** (marcate „Recurentă” și „Automat, de confirmat”): le confirmi pe toate odată, cu anulare 15 secunde, sau pe rând.',
            'Cursele **fără preț** sau marcate „de verificat”.',
            'Poți corecta suma după factura primită și confirma.',
            '**Închiderea lunii:** o listă de verificări, apoi „Închide luna”. O lună închisă nu se mai schimbă din greșeală. Se poate redeschide, cu motiv, iar acțiunea se jurnalizează.',
          ]),
          p('Pe Acasă, dacă luna nu e completă, apare un banner galben: „Luna nu e completă: N de verificat”.')),
        card('ecran-curse', 'Curse',
          p('Tabelul curselor: date încărcare → descărcare, camion, șofer, rută, preț net, km și stare.'),
          ul([
            'Filtre pe camion, lună, șofer, stare (de verificat, fără km) și căutare în rută.',
            '**Cursă nouă** sau **Import** din Excel.',
            '**Calculează km:** estimează kilometrii încărcați pe rută. Aplicația trimite către serviciile OpenStreetMap doar **numele locurilor**. Cifrele estimate apar cu „≈”.',
            '**Locuri de rezolvat:** locurile din rută pe care aplicația nu le-a recunoscut încă.',
            'Pe o cursă poți nota un **cod UIT** (doar evidență).',
          ]),
          p('Rețete: [import tabelul de curse](/ghid/rec-import-curse), [calculez km](/ghid/rec-calcul-km).')),
        card('ecran-import', 'Import',
          p('Aici aduci date din fișiere. Sunt patru tipuri:'),
          ul([
            '**Curse (Excel/CSV):** tabelul tău de curse.',
            '**GPS SafeFleet:** exporturile Excel „Foaie de activitate zilnică” și „Călătorii”.',
            '**Cheltuieli / extras card:** extrase de card de combustibil sau taxe de drum.',
            '**e-Factura XML:** facturi primite sau emise.',
          ]),
          note('Nimic nu se scrie până nu apeși „Importă”. Dacă greșești, în „Importuri recente” apeși „Anulează importul”.')),
        card('ecran-confruntare', 'Confruntare GPS',
          p('Compară ce ai **facturat** cu ce arată **GPS-ul**, pentru luna aleasă.'),
          ul([
            'Pentru fiecare cursă facturată: câte zile a fost camionul activ sau inactiv și dacă a oprit la locul de încărcare și la cel de descărcare.',
            '**Perioade fără factură:** zile în care camionul a mers, dar nu există nicio cursă.',
            '**Potriviri de locuri de confirmat:** aplicația îți propune „MEDIESU” = „Medieșu” și tu confirmi.',
            '**Steaguri** (mare, medie, info) cu stare neconfirmat, explicat sau ignorat și o notă a ta.',
            'Export în Excel.',
          ]),
          p('Rețetă: [găsesc cursele facturate fără GPS](/ghid/rec-confruntare).')),
        card('ecran-km-gol', 'Km pe gol',
          p('Cât a mers camionul fără marfă.'),
          ul([
            '**% km pe gol**, comparat cu un reper (medie 20%, țintă 5%). Reperul este orientativ și îl poți schimba în [Setări › Date](/setari/date).',
            '**Km GPS** împărțiți în încărcați și goi, **costul variabil** al kilometrilor goi și **venitul pe km încărcat**.',
            'Grafice pe zile, săptămâni sau luni, tabel pe camion, **goluri între curse** și un panou de calitate a datelor.',
          ]),
          warn('Dacă nu există date GPS, apare „—”, nu 0. „—” înseamnă necunoscut.')),
        card('ecran-rapoarte', 'Rapoarte',
          p('Lista de rapoarte din stânga:'),
          ul([
            'Clasamentul camioanelor, Profit lunar flotă, Cheltuieli pe categorii, Fișa camionului, Km pe gol.',
            'Confruntare GPS vs facturat, Calitatea datelor, Decizie pe cursă, Diurnă externă.',
            'TVA străin de recuperat, Sumar TVA, Jurnal contabil, Fără document, Neîncasat, Cursuri folosite și manuale.',
            '**Personalizat + Excel:** alegi perioada, valuta, gruparea, camioanele, categoriile și foile, apoi exporți un fișier Excel cu grafice. Mai există **Exportă CSV contabil**.',
          ]),
          p('Rețetă: [export în Excel](/ghid/rec-excel).')),
        card('ecran-setari', 'Setări',
          p('Zece secțiuni:'),
          ul([
            '**Firmă:** nume, CUI, plătitor de TVA, moneda de raportare, modul de recunoaștere a venitului, plafoanele pentru cheltuieli fără document.',
            '**Camioane, remorci, șoferi.**',
            '**Categorii** de cheltuieli.',
            '**Cheltuieli fixe:** șabloanele lunare.',
            '**Țări și TVA, Valute.**',
            '**Scadențe:** ITP, RCA, CASCO, tahograf, rovinietă, permis. Poți exporta un calendar `.ics` pentru telefon.',
            '**Alias-uri locuri:** „MEDIESU AURIT” din tabel = „Medieșu Aurit” din GPS.',
            '**Integrări:** conectarea la Google și lista serviciilor externe contactate.',
            '**Date, backup, accesibilitate:** backup, restaurare, repere km pe gol, date demo.',
          ])),
      ],
    },
    {
      id: 'idei',
      title: '4. Ideile de bază, explicate simplu',
      cards: [
        card('idee-profit', 'Cele două profituri',
          p('Pe Acasă vezi două cifre de profit. Diferența dintre ele este una singură.'),
          dl([
            ['Profit operațional', 'Venitul fără TVA minus **toate** costurile, inclusiv cele fără document, costurile comune repartizate pe camioane și amortizarea (dacă este bifată în Setări › Firmă). Este cifra principală: arată cât a rămas de fapt.'],
            ['Profit documentat', 'La fel, dar **nu scade** cheltuielile fără document justificativ. Arată cât câștigi „pe hârtie”.'],
          ]),
          ex('Exemplu: venit 10.000 lei, costuri cu documente 7.000 lei, cheltuieli fără document 300 lei. Profit operațional = 2.700 lei. Profit documentat = 3.000 lei.'),
          warn('Niciunul nu este profitul contabil sau fiscal.'),
          p('Venitul se poate „recunoaște” în trei feluri (Setări › Firmă): **pro-rata pe zile** (implicit, venitul cursei se împarte pe zilele ei), **la descărcare** sau **la încărcare**.')),
        card('idee-documente-tva', 'Document și TVA la o cheltuială',
          p('La fiecare cheltuială alegi ce document ai și cum este TVA-ul.'),
          dl([
            ['Documentare', 'Factură, Bon sau Fără document.'],
            ['TVA', 'Cu TVA, Fără TVA, 0% (scutit), TVA nedeductibil sau Taxare inversă.'],
            ['Introduci', 'Suma brută (cu TVA), netă (fără TVA) sau doar TVA. Aplicația calculează restul și le afișează: net, TVA, brut.'],
            ['TVA deductibil %', 'Ce parte din TVA se poate recupera (de exemplu la combustibil). Verifică procentul cu contabilul.'],
          ]),
          ex('Exemplu: factură de 1.000 lei fără TVA, cota 21%. TVA = 210 lei. Brut = 1.210 lei.')),
        card('idee-fara-document', 'Fără document justificativ',
          p('Uneori dai bani pentru ceva necesar, dar nu primești document: 10 lei omului care spală camionul. Nu poți fiscaliza suma, dar este un cost real.'),
          ul([
            'La cheltuială alegi **Documentare: Fără document**. Cheltuiala se marchează clar („Fără document”).',
            'Alegi **sursa banilor**: Banii firmei, Avans șofer sau Bani personali.',
            'Există plafoane (implicit 200 lei pe tranzacție și 1.000 lei pe lună pe camion, se schimbă în Setări › Firmă). **Peste plafon, justificarea scrisă este obligatorie.**',
            'Intră în **profitul operațional**, dar **nu** în cel documentat.',
          ]),
          note('Aplicația doar ține evidența. Cum se tratează fiscal aceste sume decide contabilul.')),
        card('idee-tari-tva', 'TVA în funcție de țară',
          p('Camioanele circulă în mai multe țări. La fiecare cheltuială alegi **țara**, iar aplicația propune cota de TVA a țării.'),
          ul([
            'Tabelul de cote este în [Setări › Țări și TVA](/setari/tari). Sunt **valori de pornire**: cotele se schimbă, deci verifică-le cu contabilul.',
            'Dacă schimbi o cotă, cheltuielile deja introduse **nu** se modifică.',
            'TVA plătit în străinătate apare în raportul „TVA străin de recuperat”, doar ca informare.',
          ])),
        card('idee-monede', 'Monede și curs de schimb',
          p('Poți introduce o sumă în lei, euro, forinți sau altă monedă. Aplicația păstrează suma originală și o convertește la curs.'),
          ul([
            'Cursul se ia pentru **data documentului**. Odată salvat, **rămâne neschimbat**: un curs nou nu îți rescrie istoricul.',
            'Cursul contabil implicit este cel **BNR**, pe care îl introduci lipind fișierul XML al BNR (în [Setări › Valute](/setari/valute)). Dacă lipsește, aplicația poate cere automat un curs indicativ de la BCE (Frankfurter). Se trimit doar codul monedei și data. Poți opri asta.',
            'Etichetele de lângă sumă arată sursa: **curs manual**, **BCE indicativ**, **curs vechi / estimat**.',
            'Sus alegi afișarea în **RON** sau **EUR**. Totalul în euro este suma valorilor în euro înghețate la data fiecărei intrări, deci nu este totalul în lei împărțit la cursul de azi.',
          ])),
        card('idee-fixe', 'Cheltuielile fixe care se adaugă singure',
          p('Pentru ce se plătește la fel în fiecare lună (rată de leasing, RCA, ITP, rovinietă, abonament GPS, chirie) definești un **șablon** o singură dată, în [Setări › Cheltuieli fixe](/setari/fixe).'),
          ul([
            'La deschiderea aplicației, aplicația adaugă **lunile lipsă**. Dacă n-ai deschis-o două luni, le adaugă pe amândouă.',
            'Nu apar dubluri: aceeași lună a aceluiași șablon se adaugă o singură dată.',
            'Cheltuielile generate apar ca **Recurentă** și **Automat, de confirmat** în [De verificat](/verificare).',
            'Dacă schimbi sau închei un șablon, **lunile trecute nu se modifică**.',
            'Ziua 31 se ajustează în lunile scurte (28, 29 sau 30). Dacă ceasul dispozitivului este greșit, generarea se oprește și apare un avertisment.',
          ])),
        card('idee-luna', 'Luna aferentă și lunile închise',
          p('Fiecare cheltuială aparține unei luni („aferent lunii”). Lunile se pot **închide** din De verificat › Închiderea lunii.'),
          p('Dacă primești mai târziu o factură pentru o lună deja închisă, aplicația îți propune să o înregistrezi **în luna curentă, aferentă lunii închise**. Lunile închise rămân neschimbate.')),
        card('idee-verificare', 'Ce înseamnă „de verificat”',
          p('Aplicația nu ascunde nesiguranța. Ce a intrat automat sau incomplet primește eticheta „de verificat”, iar cifrele includ sume **provizorii** (le vezi marcate). După ce confirmi, devin definitive.'),
          p('Exemple: o cheltuială fixă generată singură, o cursă fără preț, o rută pe care nu o recunoaște.')),
        card('idee-km', 'Kilometri încărcați, goi și GPS',
          ul([
            '**Km încărcați** ai unei curse vin din trei surse: introduși de tine, estimați pe rută (≈) sau din GPS.',
            '**Km goi** = km din GPS minus km încărcați. Încărcați + goi = GPS.',
            'În zilele de încărcare și descărcare, kilometrii pot fi „mixți”. Aplicația îi marchează.',
            'Exportul GPS „Călătorii” are adrese, deci permite calculul **golului dintre două curse**. Foaia de activitate zilnică are doar totaluri pe zi, deci rezultatul e mai puțin precis.',
          ])),
      ],
    },
    {
      id: 'retete',
      title: '5. Cum fac să…',
      cards: [
        card('rec-cheltuiala', 'Adaug o cheltuială',
          ol([
            'Apeși **Cheltuială nouă** în bara de sus (sau tasta `n`).',
            'Completezi suma, categoria și camionul.',
            'Dacă e nevoie, deschizi „Detalii”: țara, documentarea, TVA, furnizor, număr document, plată.',
            'Salvezi. Cu Ctrl+Enter salvezi și păstrezi valorile pentru următoarea.',
          ]),
          note('La categoriile de combustibil apare și câmpul „Litri”.')),
        card('rec-venit', 'Adaug un venit',
          ol(['Apeși **Venit nou** (tasta `v`).', 'Alegi tipul de venit și completezi suma.']),
          note('Veniturile din transport vin din tabelul de curse. Aici notezi doar alte venituri. Pentru o cursă folosești „Adaugă o cursă” sau Import.')),
        card('rec-fara-doc', 'Adaug o cheltuială fără document',
          ol([
            'Cheltuială nouă › suma › „Detalii”.',
            'La **Documentare** alegi **Fără document**.',
            'Alegi **Sursa banilor** (Banii firmei, Avans șofer, Bani personali).',
            'Dacă suma depășește plafonul, scrii **justificarea**.',
          ]),
          p('Explicații: [Fără document justificativ](/ghid/idee-fara-document).')),
        card('rec-moneda', 'Adaug o cheltuială în euro sau forinți',
          ol([
            'La suma cheltuielii alegi moneda (EUR, HUF, PLN, CZK…).',
            'Pui **data documentului**: cursul se ia la această dată.',
            'Cursul apare automat. Dacă nu, completezi tu cursul (lei la 1 unitate de monedă). Este marcat „curs manual”.',
          ])),
        card('rec-fixa', 'Adaug o cheltuială fixă lunară',
          ol([
            'Mergi la [Setări › Cheltuieli fixe](/setari/fixe) și apeși **Adaugă prima cheltuială** (sau „Cheltuială fixă nouă”).',
            'Alegi un model: Leasing / rate, RCA, CASCO, ITP, Rovinietă, Abonament tahograf, Abonament GPS, Contabil sau Chirie sediu.',
            'Alegi pentru cine este: un camion, mai multe camioane (sumă per camion), toată flota împărțit egal sau cost comun al firmei.',
            'Completezi suma, TVA, ziua din lună (1–31) și data de start. Data de final este opțională.',
            'Dacă vrei și lunile trecute, completezi „Generează și lunile trecute de la” (AAAA-LL).',
            'Salvezi. Cheltuielile apar în [De verificat](/verificare), ca „Automat, de confirmat”.',
          ])),
        card('rec-copiaza-luna', 'Copiez cheltuielile variabile din luna trecută',
          ol([
            'Mergi la [Cheltuieli și venituri](/tranzactii).',
            'Apeși **Copiază luna trecută** și confirmi.',
            'Se adaugă **ciorne „de verificat”**, cu data din luna curentă. Verifici sumele în De verificat.',
          ])),
        card('rec-import-curse', 'Import tabelul de curse',
          ol([
            'Mergi la [Import](/import), tipul **Curse (Excel/CSV)**.',
            'Apeși „Alege fișier” și alegi registrul `.xlsx` (o foaie pe camion pe an) sau un CSV.',
            'La „Foi și mapare” verifici că fiecare coloană (Data încărcare, Data descărcare, Nr camion / Nr remorcă, Șofer, Rută, Preț fără TVA, TVA, Total, Observații) a fost recunoscută. Dacă nu, o alegi tu.',
            'La **Valută + TVA** alegi moneda sumelor (tabelul nu o spune) și tratamentul TVA, verifici eșantionul de 5 rânduri și bifezi „Am verificat”. Fără asta, importul nu continuă.',
            'Dacă lipsesc camioane, bifezi „Creează-le la import”.',
            'Citești previzualizarea (poți filtra „Doar probleme”) și apeși **Importă**.',
          ]),
          note('Reimportul aceluiași fișier nu dublează cursele. Cursele care nu mai apar în fișier se păstrează. Rândurile fără preț sau cu doar total sunt marcate pentru verificare.'),
          p('Dacă ceva nu e bine, apeși „Anulează importul” din „Importuri recente”.')),
        card('rec-import-gps', 'Import exporturile SafeFleet (GPS)',
          ol([
            'Din SafeFleet exporți în Excel: **Foaie de activitate zilnică** (km pe zi) și **Călătorii** (cu adrese). Călătoriile sunt sursa principală, foaia zilnică este rezerva și verificarea.',
            'În [Import](/import) alegi **GPS SafeFleet** și „Alege fișiere GPS”. Poți alege **mai multe fișiere deodată** (câte unul pe camion sau perioadă).',
            'Plăcuța se citește din subsolul fișierului. Pentru plăcuțele fără camion, alegi tu camionul; alegerea se salvează.',
            'Verifici „Verificările încrucișate”: kilometrii din călătorii față de foaia zilnică și față de odometru (toleranță 0,5%).',
            'Apeși **Importă datele GPS**.',
          ]),
          note('Perioada nu se presupune: aplicația ia exact zilele din fișier. Reimportul aceleiași perioade înlocuiește zilele existente, nu le dublează.')),
        card('rec-calcul-km', 'Calculez kilometrii încărcați ai curselor',
          ol([
            'Mergi la [Curse](/curse).',
            'Apeși **Calculează km**. Poți urmări progresul și poți opri calculul.',
            'La „Locuri de rezolvat” confirmi locurile necunoscute (**Caută și confirmă în bloc**).',
          ]),
          note('Este o estimare pe rută (≈). Se trimit către OpenStreetMap doar numele locurilor. Dacă ai importat GPS, kilometrii din GPS sunt mai exacți. Un km introdus manual pe cursă nu este suprascris la reimport.')),
        card('rec-km-gol', 'Văd cât a mers camionul pe gol',
          ol([
            'Ai nevoie de **curse** și de **GPS** pentru aceeași perioadă.',
            'Mergi la [Km pe gol](/km-pe-gol).',
            'Alegi zile, săptămâni sau luni. Citești % km pe gol, kilometrii și costul.',
            'Pentru un camion anume deschizi fișa lui din [Camioane](/camion).',
          ]),
          warn('Dacă cursele și GPS-ul sunt din perioade diferite, nu există ce compara: apare „fără date GPS”.')),
        card('rec-confruntare', 'Găsesc cursele facturate fără GPS',
          ol([
            'Mergi la [Confruntare GPS](/confruntare) și alegi luna (și, dacă vrei, camionul).',
            'La „Curse facturate și dovada GPS” caută cursele cu „fără suport / fără GPS”, zile inactive sau „încărcare nevizitată”.',
            'Pentru fiecare steag alegi starea (neconfirmat, explicat, ignorat) și scrii o notă.',
            'Confirmi potrivirile de locuri propuse. „Fixează steagurile” salvează steagurile curente.',
            'Poți exporta rezultatul în Excel.',
          ])),
        card('rec-card', 'Import extras de card (combustibil, taxe de drum)',
          ol([
            'Mergi la [Import](/import), tipul **Cheltuieli / extras card**.',
            'Alegi extrasul (`.csv` sau `.xlsx`), furnizorul (de exemplu DKV, E100, Eurowag), moneda și țara implicită.',
            'Dacă antetul nu e recunoscut, alegi coloanele (minim Data și Suma) și bifezi „Salvează maparea pentru acest format”.',
            'Alegi categoria pentru fiecare tip de produs.',
            'Poți bifa „Leagă tranzacțiile de factura cu același număr”, ca să nu se numere de două ori. Liniile cu „posibilă dublură” sunt marcate.',
            'Apeși **Importă**.',
          ]),
          note('Formatul fiecărui furnizor îl salvezi tu la prima folosire.')),
        card('rec-efactura', 'Import e-Factura XML',
          ol([
            'Mergi la [Import](/import), tipul **e-Factura XML**.',
            'Alegi unul sau mai multe fișiere XML.',
            'Pentru fiecare factură alegi categoria. Aplicația o învață pentru furnizorul respectiv.',
            'Facturile sunt recunoscute ca venit (emisă) sau cheltuială (primită) după CUI-ul firmei. Verifică semnele de atenție (notă de credit, mai multe cote de TVA, direcție necunoscută).',
            'Apeși **Importă**.',
          ]),
          note('Fișierele XML le descarci tu. Aplicația nu se conectează la ANAF.')),
        card('rec-excel', 'Fac un export în Excel cu grafice',
          ol([
            'Mergi la [Rapoarte](/rapoarte) › **Personalizat + Excel**.',
            'Alegi perioada (De la, Până la), valuta de afișare (RON sau EUR) și gruparea (pe lună, camion, categorie, țară sau valută).',
            'Alegi camioanele, categoriile și **foile incluse** (Rezumat, Clasament, Profit lunar, Km pe gol, Curse, Cheltuieli, TVA, Jurnal contabil…).',
            'Apeși **Exportă Excel (.xlsx)**. Fișierul are grafice native.',
            'Pentru contabil, apeși **Exportă CSV contabil**.',
          ]),
          note('Cu camioane alese, costurile comune se repartizează doar pe ele, iar fiecare foaie poartă mențiunea „FILTRAT”. Deschide fișierul în Excel și verifică-l înainte să te bazezi pe el.')),
        card('rec-backup', 'Fac backup',
          ol([
            'Mergi la [Setări › Date](/setari/date) și apeși **Descarcă backup**. Același buton apare și în meniul ⋯ din bara de sus și în panoul „Stare date” (iconița cu discul sau norul din bara de sus). Când trece o săptămână fără backup, apare și o notificare cu butonul „Descarcă acum”.',
            'Se descarcă un fișier `flota-backup-AAAA-LL-ZZ-OOMM.json`.',
            'Pune-l într-un loc sigur: alt calculator, un stick, mail către tine.',
          ]),
          warn('Fă backup cel puțin o dată pe săptămână. Aplicația îți amintește când trece o săptămână.')),
        card('rec-restaurare', 'Restaurez un backup',
          ol([
            'Prima oară (ecran gol): pe ecranul de bun venit apeși **Restaurează un backup JSON** și alegi fișierul.',
            'Altfel: [Setări › Date](/setari/date) › **Restaurează din backup**, alegi fișierul și scrii cuvântul cerut, **RESTAUREAZĂ**.',
          ]),
          warn('Restaurarea **înlocuiește tot** ce ai acum. Înainte, aplicația îți descarcă automat un backup al stării curente (`flota-backup-inainte-de-restaurare-…`).')),
        card('rec-telefon', 'Folosesc aplicația pe telefon',
          ol([
            'Deschizi adresa aplicației în browserul telefonului.',
            'Pe **Android (Chrome):** meniul ⋮ › „Instalează aplicația” sau „Adaugă pe ecranul principal”.',
            'Pe **iPhone (Safari):** butonul Partajează › „Adaugă pe ecranul principal”.',
            'Pe telefon, bara de jos are: Acasă, Camioane, Adaugă, De verificat și Mai mult (acolo găsești restul ecranelor).',
          ]),
          warn('În mod local, telefonul are **propriile** date, separate de cele de pe calculator. Ca să vezi aceleași date, folosește Google Drive sau restaurează un backup.')),
        card('rec-google', 'Mă conectez cu Google și unde stau datele',
          ol([
            'La pornire alegi **Conectează Google** (sau „Continuă fără Google”, pentru mod local).',
            'Dacă ai pornit în mod local: [Setări › Integrări](/setari/integrari) › **Treci la Google**. Datele locale **nu** se unesc automat cu cele din Drive: descarcă întâi un backup.',
            'Datele se salvează într-un fișier din folderul **ascuns** al aplicației din Drive. Nu le vezi în lista ta de fișiere.',
            'O conectare pe zi este normală. Dacă ștergi „datele ascunse ale aplicației” din Drive, datele dispar.',
          ])),
        card('rec-moneda-raportare', 'Schimb moneda de raportare sau de afișare',
          ul([
            '**Afișare:** comutatorul RON / EUR din bara de sus. Schimbă doar cum vezi cifrele.',
            '**Raportare:** [Setări › Firmă](/setari/firma), „Moneda de raportare”.',
          ])),
        card('rec-inchid-luna', 'Închid o lună',
          ol([
            'Mergi la [De verificat](/verificare).',
            'Rezolvi ce e în listă (confirmi cheltuielile automate, pui prețuri la cursele fără preț).',
            'În cardul **Închiderea lunii** apeși „Închide luna” și citești lista de verificări. Dacă mai sunt avertismente, poți alege „Închide cu avertismente confirmate”.',
            'Pentru redeschidere trebuie să scrii un **motiv**. Acțiunea rămâne în jurnal.',
          ])),
        card('rec-confirm-auto', 'Confirm cheltuielile generate automat',
          ol([
            'Mergi la [De verificat](/verificare).',
            'Apeși **Confirmă toate** pentru cele automate (poți anula în 15 secunde), sau deschizi una și îi corectezi suma.',
            'Dacă a venit factura cu altă sumă, scrii suma brută de pe factură și apeși „Actualizează suma și confirmă”.',
          ])),
        card('rec-scadente', 'Notez scadențele (ITP, RCA, CASCO, tahograf, rovinietă)',
          ol([
            'Mergi la [Setări › Scadențe](/setari/expirari) și adaugi scadența pentru camion, remorcă sau șofer.',
            'Alertele apar pe Acasă la 30, 15 și 7 zile înainte și după scadență.',
            'Poți exporta un calendar `.ics` ca să primești mementouri în telefon. Aplicația nu trimite e-mail sau notificări.',
          ])),
        card('rec-anulez', 'Anulez ceva ce am făcut',
          ul([
            '**Ultima acțiune:** meniul ⋯ › „Anulează ultima acțiune”.',
            '**Un import:** [Import](/import) › „Importuri recente” › „Anulează importul”. Rândurile create se șterg, cele actualizate revin la valorile vechi.',
            '**Acțiuni în bloc** (confirmare, schimbare categorie): anulare în 15 secunde.',
          ])),
        card('rec-gol', 'Pornesc cu date reale, după ce m-am jucat cu datele demo',
          ol([
            '[Setări › Date](/setari/date) › „Date demo” › **Începe gol**.',
            'Aplicația descarcă mai întâi un backup, apoi golește datele demo.',
            'Același loc are și „Resetează demo”, dacă vrei să revii la datele de exemplu.',
          ]),
          note('Datele demo sunt fictive și sunt marcate „date demo”.')),
        card('rec-taste', 'Lucrez mai repede cu tastatura',
          ul([
            '`n` cheltuială nouă, `v` venit nou, `?` lista tastelor rapide.',
            '`g` apoi `h` Acasă, `g` apoi `l` Cheltuieli și venituri, `g` apoi `v` De verificat, `g` apoi `c` Curse.',
            'Alt+Shift+D duplică ultima intrare. În De verificat: `E` editează, `Del` șterge (cu anulare).',
            'Dacă folosești tastatura pentru dictare, oprești tastele rapide în [Setări › Date](/setari/date), la Accesibilitate.',
          ])),
      ],
    },
    {
      id: 'glosar',
      title: '6. Glosar',
      cards: [
        card('glosar-termeni', 'Cuvinte folosite în aplicație',
          dl([
            ['Cursă', 'Un transport facturat: de la încărcare la descărcare, cu un preț.'],
            ['Net / brut', 'Net = fără TVA. Brut = cu TVA.'],
            ['TVA', 'Taxa pe valoarea adăugată. Cota depinde de țară.'],
            ['TVA deductibil', 'Partea din TVA pe care o poți recupera.'],
            ['Cheltuială fără document justificativ', 'Cost real pentru care nu ai factură sau bon.'],
            ['Profit operațional', 'Venit minus toate costurile.'],
            ['Profit documentat', 'Venit minus costurile cu documente (fără cele fără document).'],
            ['Costuri comune', 'Costuri ale firmei, nu ale unui singur camion (chirie sediu, contabil). Se repartizează pe camioane.'],
            ['Amortizare de management', 'Costul lunar al unui camion cumpărat în rate, pus în profit ca să vezi imaginea completă.'],
            ['Pro-rata', 'Împărțit proporțional. De exemplu venitul unei curse de 3 zile, împărțit pe cele 3 zile.'],
            ['Km încărcați / km goi', 'Kilometri cu marfă, respectiv fără marfă.'],
            ['GPS', 'Sistemul de localizare al camionului. Aici: exporturile Excel din SafeFleet.'],
            ['Odometru', 'Kilometrajul camionului. Servește la verificarea sumei kilometrilor din GPS.'],
            ['Steag', 'Un semn de atenție la Confruntare GPS: ceva nu se potrivește între factură și GPS.'],
            ['Alias de loc', 'O pereche „nume din tabel” = „localitate din GPS”, ca aplicația să le potrivească.'],
            ['Curs de schimb', 'Câți lei valorează o unitate de altă monedă (BNR sau BCE).'],
            ['Lună închisă', 'O lună „blocată” ca să nu se schimbe din greșeală.'],
            ['UIT', 'Cod folosit la transportul de marfă cu risc fiscal. Aici îl poți nota pe cursă; aplicația nu îl transmite la ANAF.'],
            ['e-Factura', 'Sistemul ANAF de facturi electronice. Aici importi fișiere XML descărcate de tine.'],
            ['Backup', 'O copie a tuturor datelor, într-un fișier JSON.'],
            ['Sincronizare', 'Salvarea datelor și în Google Drive (doar în modul Google).'],
            ['Origine partajată', 'Pe github.io, toate site-urile aceluiași cont GitHub împart aceeași „origine” în browser. Vezi [Probleme frecvente](/ghid/pb-origine).'],
          ])),
      ],
    },
    {
      id: 'probleme',
      title: '7. Probleme frecvente',
      cards: [
        card('pb-nu-vad-date', 'Nu văd date sau ecranele sunt goale',
          ul([
            'Verifică **luna** din bara de sus: cifrele sunt pe luna aleasă.',
            'Verifică **filtrele** (apasă „Resetează filtrele”).',
            'În mod local, un alt browser, telefon sau calculator are **alt set de date**. Restaurează un backup sau folosește Google Drive.',
            'Poate ai golit datele demo și încă nu ai importat nimic.',
          ])),
        card('pb-fara-gps', 'O cursă apare „fără GPS”',
          ul([
            'Ai importat GPS pentru **zilele** acelei curse? Cursele din 2025 nu au GPS dacă exportul e din 2026.',
            'Plăcuța din export trebuie legată de camionul potrivit (la import: „Plăcuțe fără camion”).',
            'Locul din tabel poate fi scris diferit de localitatea din GPS: confirmă potrivirea în Confruntare GPS sau adaugă un [alias de loc](/setari/aliasuri).',
            '„—” înseamnă necunoscut, nu zero.',
          ])),
        card('pb-avertismente', 'Importul arată avertismente',
          ul([
            'Avertismentele nu opresc importul. Citește previzualizarea.',
            'Filtrează „Doar probleme” și poți descărca lista de erori (CSV).',
            'Coloane lipsă: alegi tu coloanele. Aplicația nu ghicește când antetul nu se recunoaște.',
            'Dacă ai importat greșit, [anulează importul](/ghid/rec-anulez).',
          ])),
        card('pb-google', 'Logarea Google nu merge',
          ul([
            '„Serviciul Google nu a putut fi încărcat”: ești offline sau o extensie îl blochează. Aplicația reîncearcă. Între timp poți continua în mod local.',
            'Permite ferestrele pop-up pentru adresa aplicației.',
            'Dacă Google spune că aplicația nu este verificată, apeși „Avansat” și continui (aplicația este în modul de testare, pentru contul tău).',
            'Pe github.io, logarea Google este oprită până se acceptă originea partajată în configurare. Vezi [Origine partajată](/ghid/pb-origine).',
          ])),
        card('pb-pierdut', 'Mi s-au pierdut datele',
          ul([
            'În **mod local**, datele sunt în browser. Ștergerea „datelor site-ului” sau a istoricului le șterge. Restaurează ultimul backup.',
            'În **mod Google**, „Delete hidden app data” din Drive șterge datele. Restaurează ultimul backup.',
            'Dacă ai restaurat un backup și lipsesc date mai noi, caută fișierul `flota-backup-inainte-de-restaurare-…` din Descărcări.',
          ])),
        card('pb-origine', 'Avertismentul „Origine partajată”',
          p('Pe adresele `nume.github.io`, **toate** site-urile aceluiași cont GitHub partajează același spațiu din browser. Un alt site publicat pe același cont ar putea, în teorie, citi datele acestei aplicații din browser.'),
          ul([
            'Nu publica alte site-uri pe contul acesta, sau folosește un cont GitHub dedicat doar pentru aplicație.',
            'Pe github.io, Google pornește doar dacă în `config.js` este `acceptSharedOrigin: true`.',
            'Avertismentul apare o singură dată, la prima deschidere, până apeși „Am înțeles”. După aceea îl găsești în [Setări › Date](/setari/date), la „Securitate”, unde îl poți afișa din nou.',
          ])),
        card('pb-eur', 'Totalul în euro nu coincide cu totalul în lei împărțit la curs',
          p('Este normal. Fiecare sumă își păstrează cursul din ziua ei. Totalul în euro este suma valorilor în euro de la acele date, nu un calcul cu cursul de azi.')),
        card('pb-luna-inchisa', 'Nu pot adăuga în luna trecută',
          p('Luna este închisă. Aplicația îți propune să înregistrezi suma în luna curentă, aferentă lunii închise. Sau redeschizi luna din De verificat, cu un motiv.')),
        card('pb-curs', 'Apare „Curs indisponibil”',
          p('Aplicația nu a găsit un curs pentru data documentului (offline sau monedă rară). Scrii cursul tu, în câmpul „Curs”. Va apărea marcat „curs manual”.')),
      ],
    },
    {
      id: 'nu-face',
      title: '8. Ce nu face încă',
      cards: [
        card('nu-face-inca', 'Lucruri care lipsesc în această versiune',
          p('Spunem clar ce nu există, ca să nu cauți degeaba:'),
          ul([
            '**Aplicație pentru șoferi** (poză la bon, introducere de pe telefonul șoferului).',
            '**Alte roluri**: contabil, dispecer. Există doar administratorul.',
            '**Sincronizare automată cu SafeFleet.** Aduci tu fișierele Excel.',
            '**Descărcare automată din SPV/ANAF** și **transmitere** e-Factura sau e-Transport.',
            '**Notificări** pe e-mail, push sau WhatsApp. Scadențele apar în aplicație sau în calendarul `.ics`.',
            '**Emitere de facturi**, e-CMR sau legătura cu bursele de transport.',
            '**Mentenanță** (planuri de service pe km): există calculul în aplicație, dar nu există încă un ecran.',
            '**Foaie de deplasare** ca formular dedicat. Există raportul „Diurnă externă”, pe care îl poți tipări din browser (Ctrl+P).',
            '**Mai mulți utilizatori.** Dacă deschizi aplicația pe două dispozitive, la o diferență apare „Conflict de sincronizare” și alegi tu ce păstrezi.',
          ]),
          note('Ai nevoie de ceva din listă? Spune-i celui care a construit aplicația: se adaugă ca etapă următoare.')),
      ],
    },
  ],
};

// ------------------------------------------------------------------------------------------------ utilitare pure

const MARK = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;

/** Textul simplu al unui șir cu marcaje (pentru căutare). */
export function plain(s) {
  return String(s).replace(MARK, (_m, b, c, l) => b || c || l || '');
}

/** Împarte un șir cu marcaje în părți: { t:'text'|'b'|'code'|'link', x, to? }. */
export function inline(s) {
  const out = [];
  let last = 0;
  String(s).replace(MARK, (m, b, c, l, to, off) => {
    if (off > last) out.push({ t: 'text', x: s.slice(last, off) });
    if (b) out.push({ t: 'b', x: b }); else if (c) out.push({ t: 'code', x: c }); else out.push({ t: 'link', x: l, to });
    last = off + m.length;
    return m;
  });
  if (last < s.length) out.push({ t: 'text', x: s.slice(last) });
  return out;
}

/** Tot textul unui bloc, ca șir simplu. */
export function blockText(b) {
  if (b.x) return plain(b.x);
  if (b.items) return b.items.map((i) => (Array.isArray(i) ? i.map(plain).join(' ') : typeof i === 'string' ? plain(i) : plain(i.x))).join(' ');
  return '';
}
export function cardText(c) { return [c.title, ...c.blocks.map(blockText)].join(' '); }

/** Căutare simplă, fără diacritice și fără majuscule. */
export const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filterGuide(guide, query) {
  const q = norm(query || '').trim();
  if (!q) return guide.sections;
  const words = q.split(/\s+/);
  return guide.sections
    .map((s) => ({ ...s, cards: s.cards.filter((c) => { const t = norm(cardText(c)); return words.every((w) => t.includes(w)); }) }))
    .filter((s) => s.cards.length);
}

/** Toate id-urile din ghid (secțiuni + cărți). */
export function allIds(guide = GUIDE) {
  const ids = new Map();
  for (const s of guide.sections) { ids.set(s.id, { section: s.id }); for (const c of s.cards) ids.set(c.id, { section: s.id, card: c.id }); }
  return ids;
}

/** Toate legăturile (rute sau /ghid/…) folosite în conținut, cu locul în care apar. */
export function allLinks(guide = GUIDE) {
  const out = [];
  const scan = (s, where) => { String(s).replace(MARK, (_m, _b, _c, l, to) => { if (to) out.push({ to, label: l, where }); return _m; }); };
  for (const s of guide.sections) for (const c of s.cards) for (const b of c.blocks) {
    if (b.x) scan(b.x, c.id);
    for (const i of b.items || []) { if (Array.isArray(i)) i.forEach((z) => scan(z, c.id)); else if (typeof i === 'string') scan(i, c.id); else { scan(i.x, c.id); if (i.to) out.push({ to: i.to, label: plain(i.x), where: c.id }); } }
  }
  return out;
}

/** Textele vizibile din tot ghidul, într-un singur șir (teste de confidențialitate). */
export function guideFullText(guide = GUIDE) {
  return [guide.title, guide.intro, ...NEWS.items, ...guide.sections.flatMap((s) => [s.title, ...s.cards.map(cardText)])].join('\n');
}

// ------------------------------------------------------------------------------------------------ Markdown

const mdInline = (s) => String(s).replace(MARK, (_m, b, c, l, to) => (b ? `**${b}**` : c ? `\`${c}\`` : to.startsWith('/ghid/') ? `[${l}](#${to.slice(6)})` : `${l} (în aplicație: \`#${to}\`)`));
function mdBlock(b) {
  switch (b.t) {
    case 'p': return mdInline(b.x);
    case 'ul': return b.items.map((i) => `- ${mdInline(i)}`).join('\n');
    case 'ol': return b.items.map((i, n) => `${n + 1}. ${mdInline(i)}`).join('\n');
    case 'steps': return b.items.map((i, n) => `${n + 1}. ${mdInline(i.x.replace(/^\*\*\d+\.\s*/, '**'))}${i.to ? ` (în aplicație: \`#${i.to}\`)` : ''}`).join('\n');
    case 'dl': return b.items.map(([k, v]) => `- **${k}**: ${mdInline(v)}`).join('\n');
    case 'note': return `> **Notă:** ${mdInline(b.x)}`;
    case 'warn': return `> **Atenție:** ${mdInline(b.x)}`;
    case 'ex': return `> ${mdInline(b.x)}`;
    default: return '';
  }
}

export function toMarkdown(guide = GUIDE) {
  const out = [`# ${guide.title}`, '', guide.intro, '', '_Acest fișier este generat din conținutul ghidului din aplicație (`npm run guide`). Nu îl edita de mână._', ''];
  out.push('## Cuprins', '');
  for (const s of guide.sections) out.push(`- [${s.title}](#${s.id})`);
  out.push('');
  out.push(`## Noutăți în versiunea ${NEWS.version}`, '', ...NEWS.items.map((i) => `- ${i}`), '');
  for (const s of guide.sections) {
    out.push(`<a id="${s.id}"></a>`, `## ${s.title}`, '');
    for (const c of s.cards) {
      out.push(`<a id="${c.id}"></a>`, `### ${c.title}`, '');
      for (const b of c.blocks) out.push(mdBlock(b), '');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
