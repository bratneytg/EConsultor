import { categoryById } from '@econsultor/shared';
import { merchantKey } from './merchant.js';
import { norm } from './parse.js';
import type { RawRow } from './types.js';

type Rule = [RegExp, string];

/**
 * Reglas por comercio/concepto (alemán, español, inglés). Se evalúan en orden: lo más específico primero.
 * El texto llega sin acentos y en minúsculas (`norm`): «Bäckerei» → «backerei», «Straße» → «strasse».
 */
const EXPENSE_RULES: Rule[] = [
  [/\b(\baffitto|canone (di )?locazione|\blocazione\b|condominio|spese condominiali|amministratore di condominio|\bimmobiliare|miete|kaltmiete|warmmiete|mietzahlung|hausverwaltung|vermieter|hausgeld|alquiler|nebenkosten|wohnungsbau|immobilien|wg miete|mietkaution|kaution|gewobag|degewo|vonovia|howoge|gesobau|stadt und land|deutsche wohnen|wohnungsgenossenschaft|baugenossenschaft|comunidad de propietarios|hausmeister)\b/, 'housing'],
  [/(assicurazion[ei]|unipol(sai)?|reale mutua|poste ?vita|vittoria assic|cattolica assic|sara assic|\blinear\b|genertel|direct line|\bitas\b|amissima|premio polizza|\bpolizza|krankenkasse|techniker krankenkasse|\btk\b|\baok\b|barmer|\bdak\b|\bikk\b|versicherung|haftpflicht|hausrat|rechtsschutz|allianz|\bhuk|\bergo\b|\baxa\b|devk|generali|signal iduna|cosmos ?direkt|cosmos|lv 1871|seguro|barmenia|ottonova|debeka|provinzial|r\+v\b|nuernberger|gothaer|wuerttembergische|concordia|continentale|mapfre|mutua madrilena|sanitas|krankenversicherung|unfallversicherung|berufsunfaehigkeit|sterbegeld|zurich versicherung|\bvhv\b|\bvgh\b|\blvm\b|\bhdi\b)/, 'insurance'],
  [/(\brata\b|\bmutuo\b|finanziamento|\bprestito\b|findomestic|\bagos\b|compass banca|cofidis|rateizz|\bnexi rate|cessione del quinto|carta revolving|interessi (passivi|su rate)|\bkreditrate|kreditrate|darlehen|tilgung|ratenzahlung|santander consumer|klarna|afterpay|creditplus|kreditkarte|abrechnung visa|abrechnung mastercard|prestamo|hipoteca|autokredit|ratenkredit|finanzierung|sollzinsen|dispozinsen|consors finanz|bank11|cashpresso|kreditrate|kredit\b|cuota prestamo)/, 'debt'],
  [/(\benel\b|edison|\bhera\b|\ba2a\b|plenitude|\biren\b|\bacea\b|sorgenia|bolletta|luce e gas|\butenza|\btim\b|wind ?tre|\biliad\b|fastweb|ho\.? mobile|\bkena\b|poste ?mobile|very mobile|tiscali|\beolo\b|canone rai|acquedotto|ricarica (telefonica|sim|tim|vodafone|wind|iliad|ho)|\btari\b|rifiuti|metano|teleriscaldamento|publiacqua|abbanoa|\bamga\b|\bgas\b e luce|vodafone|telekom|\bo2\b|telefonica|1&1|1und1|congstar|freenet|aldi ?talk|lebara|winsim|simyo|drillisch|\be\.?on\b|vattenfall|enbw|stadtwerke|rwe energie|strom\b|gas\b|wasserwerke|wasserbetriebe|wasserversorgung|abwasser|fernwaerme|heizkosten|heizung\b|abfall|entsorgung|muellabfuhr|stadtreinigung|\bbsr\b|netcologne|pyur|unitymedia|beitragsservice|rundfunk|ard zdf|yello|lichtblick|naturstrom|mobilfunk|internet\b|dsl\b|glasfaser|electricidad|endesa|iberdrola|naturgy|gasag|mainova|enercity|\bswm\b|abschlag|energie ?(ag|gmbh|versorgung)|\bewe\b|telefon\b|magenta|bundesnetzagentur|agua\b|luz\b|movistar|orange espana|digi mobil)/, 'utilities'],
  [/(now ?tv|mediaset infinity|sky (italia|wifi|q)|raiplay|discovery\+|tim ?vision|google play|google \*|playstation|virgin active|technogym|paramount|netflix|spotify|disney ?plus|disney\+|dazn|prime video|amazon prime|apple\.com\/bill|apple music|apple tv|icloud|youtube ?(premium|music)|google (one|storage)|dropbox|openai|chatgpt|anthropic|claude\.ai|adobe|microsoft ?(365|office)|audible|sky (deutschland|ticket)|wow\b|rtl\+|paramount|crunchyroll|patreon|github|notion|1password|nordvpn|surfshark|expressvpn|deezer|tidal|duolingo|canva|bild plus|spiegel\+|der spiegel|zeit (online|digital)|faz\b|handelsblatt|new york times|substack|medium\.com|joyn|waipu|zattoo|kindle unlimited|mcfit|clever ?fit|fitx|urban sports|john reed|fitness|gym\b|n26 (you|metal|smart)|xing|linkedin|playstation plus|xbox game pass|nintendo switch online|twitch sub|only ?fans|hbo max|max\.com|apple one)/, 'subscriptions'],
  [/(\bcoop\b|coop alleanza|\bconad\b|esselunga|eurospin|\bpam\b|panorama|despar|interspar|eurospar|todis|\biper\b|ipercoop|bennet|tigros|supermercat[io]|alimentari|macelleria|salumeria|panificio|\bforno\b|ortofrutta|fruttivendolo|pescheria|gastronomia|naturasi|\bunes\b|\bcrai\b|\bprix\b|\bsimply\b|enoteca|\bsigma\b supermercati|supermarket|grocer|rewe|aldi|lidl|edeka|kaufland|penny|netto|norma\b|tegut|denn.?s biomarkt|alnatura|biocompany|bio ?company|bio ?(laden|hof|markt)|globus|famila|marktkauf|hit markt|flink|picnic|getir|gorillas|mercadona|carrefour|\bdia\b|supermarkt|supermercado|hipercor|eroski|alcampo|bio ?markt|baeckerei|backerei|bakery|backwerk|ditsch|back-?factory|backstube|brotladen|konditorei|metzger|fleischer|wurst\b|wochenmarkt|getraenke|getranke|trinkgut|spaeti|spaetkauf|spaetverkauf|kiosk|hofladen|bauernhof|obst\b|gemuese|gemuse|hello ?fresh|marley spoon|too good to go|reformhaus|feinkost|asia ?(markt|shop)|lekkerland)/, 'groceries'],
  [/(ristorant[ei]|trattoria|pizzeria|osteria|tavola calda|caffetteria|\bcaffe\b|gelateria|pasticceria|paninoteca|rosticceria|hamburgeria|pizza al taglio|focacceria|agriturismo|enoteca bar|aperitivo|birreria|\bburger|mcdonald|burger king|\bkfc\b|starbucks|subway|lieferando|wolt|uber ?eats|just ?eat|domino|pizza|pizzeria|trattoria|osteria|restaurant|restaurante|cafe\b|cafeteria|coffee|dunkin|vapiano|imbiss|doener|doner|kebab|sushi|ramen|bistro|nordsee|kamps|gastronomie|gasthaus|gasthof|brauhaus|braeuhaus|\bbar\b|pub\b|biergarten|weinbar|kneipe|eisdiele|eiscafe|eis ?cafe|ristorante|mensa\b|studierendenwerk|studentenwerk|kantine|\bburger|\bleon\b|five guys|peter pane|block house|hans im glueck|sausalitos|wagamama|tapas|cerveceria|chiringuito|taverna|\bwok\b|thai\b|vietnam|grill\b|schnitzel|steakhaus|cocktail|lounge|bubble tea|dean ?& ?david|true value)/, 'dining'],
  [/(alitalia|\bita airways|volotea|neos\b|aeroporto|agenzia viaggi|\bhotel\b|b&b|\bb ?& ?b\b|affittacamere|\bvacanz|ryanair|easyjet|lufthansa|eurowings|booking\.com|airbnb|\bhotel\b|hostel|expedia|\btui\b|vueling|wizz|trivago|marriott|hilton|flughafen|airport|opodo|skyscanner|ferienwohnung|camping|jugendherberge|pension\b|reisebuero|reiseveranstalter|dertour|condor|transavia|klm\b|iberia|fluege|ferienhaus|urlaub)/, 'travel'],
  [/(trenitalia|\bitalo\b|\batm\b|\batac\b|\btrenord|telepass|autostrad[ae]|\bq8\b|\bip\b (station|distributore)|\beni station|distributore|carburant[ei]|benzina|gasolio|\bpedaggio|\bparcheggio|\bstrisce blu|\bparkimeter|\bbus\b|metropolitana|biglietto (bus|treno|metro)|abbonamento (trasporti|atm|bus)|\bmoovit|\bmycicero|\btaxi\b|\bfreenow|\bcarwash|autolavaggio|officina|\bgommista|revisione auto|\bbollo auto|\baci\b|deutsche bahn|\bdb (vertrieb|fernverkehr|regio)|flixbus|flixtrain|\bbvg\b|\bhvv\b|\bmvg\b|\bvrr\b|\brmv\b|\bkvb\b|\bvbb\b|\bssb\b|\bdvb\b|\blvb\b|\bvgn\b|\bkvv\b|\bmvv\b|uestra|bsag|rheinbahn|hochbahn|bogestra|verkehrsbetriebe|verkehrsverbund|nahverkehr|fahrkarte|fahrschein|bahncard|deutschlandticket|uber\b|bolt\b|free ?now|\blime\b|\btier\b|\bvoi\b|nextbike|call a bike|blablacar|shell|aral|esso|jet tankstelle|tankstelle|star tankstelle|\bagip\b|\beni\b|\bhem\b|orlen|\bbft\b|avia|total ?energies|tank ?(&|und) ?rast|raststaette|autohof|parkhaus|parkgebuehr|parken\b|apcoa|easypark|park ?now|sixt|share ?now|cambio|miles mobility|bahn\b|renfe|ouigo|trenitalia|metro\b|gasolina|\badac\b|tuev|\bdekra\b|\batu\b|werkstatt|\bkfz\b|autohaus|reifen|autowasch|waschstrasse|hauptzollamt|zulassungsstelle|fahrschule|toll ?collect|\bmaut\b|vignette|autoteile|auto-teile|peaje|\bsncf\b)/, 'transport'],
  [/(farmacia|parafarmacia|ospedale|\basl\b|\bausl\b|policlinico|poliambulatorio|studio (medico|dentistico)|\bdentista|\boculista|ottica|centro medico|analisi (cliniche|del sangue)|laboratorio analisi|fisioterap|\bparrucchier|estetista|\bbarbiere|lenti a contatto|\bticket sanitario|apotheke|pharmacy|farmacia|arzt|zahnarzt|praxis|dr\. ?med|optiker|augenoptik|fielmann|apollo|physio|klinik|krankenhaus|doctolib|shop.?apotheke|augenarzt|orthopaed|labor\b|laborarzt|hoergeraete|akustiker|friseur|frisor|barber|kosmetik|nagelstudio|nail studio|massage|sauna|wellness|therapeut|psycholog|heilpraktiker|logopaed|osteopath|chiropraktiker|sanitaetshaus|clinica|dentista|medico|hospital|peluqueria)/, 'health'],
  [/(universita|\bateneo\b|iscrizione (corso|università)|tasse universitarie|\bscuola\b|asilo nido|\basilo\b|corso di|libri scolastic|universitaet|universitat|hochschule|\bvhs\b|volkshochschule|udemy|coursera|skillshare|sprachschule|goethe|babbel|studiengebuehr|semesterbeitrag|kita\b|kindergarten|kinderkrippe|\bhort\b|masterclass|schulbuch|schulgeld|nachhilfe|fahrschulunterricht|universidad|colegio|academia)/, 'education'],
  [/(\bcinema\b|teatro|concerto|biglietteria|vivaticket|ticketone|\bgardaland|\bparco divertimenti|stabilimento balneare|\bpiscina|\bpalestra\b|\bsala giochi|lotteria|superenalotto|\bsnai\b|\blottomatica|\bsisal\b|kino\b|cinemaxx|cineplex|cinestar|ticketmaster|eventim|reservix|steam\b|playstation|nintendo|xbox|epic games|bowling|billard|minigolf|theater|theatre|museum|\bzoo\b|tierpark|freizeitpark|europa-?park|heide ?park|phantasialand|konzert|festival|lotto|tipico|bet365|twitch|spielbank|spielhalle|casino|escape room|sportverein|turnverein|\btsv\b|\bsv \w+|schwimmbad|stadtbad|freibad|hallenbad|therme\b|kletter|boulder|club\b|disco|nachtclub)/, 'leisure'],
  [/(\bovs\b|\bcalzedonia|\bintimissimi|\btezenis|\bmediaworld|\bunieuro|\bleroy merlin|\bbricocenter|\bibs\b|\bmaisons du monde|\bflying tiger|\bsephora|\bkiko\b|\bprofumeria|\bcartoleria|\btabaccheria|\btabacchi|\bpandora|\bscarpe|\babbigliamento|\bcalzature|\bgiocattoli|\bferramenta|\bmondadori|\bfeltrinelli|\blibreria|\bgarden|\bbrico|\beurospin shop|amazon|amzn|zalando|h&m|zara|primark|ikea|mediamarkt|media markt|saturn|apple (store|retail)|decathlon|otto\b|ebay|kleinanzeigen|vinted|\bdm\b|dm-drogerie|drogerie|rossmann|mueller|tk maxx|action\b|\bobi\b|bauhaus|hornbach|toom|hagebau|baumarkt|douglas|asos|shein|temu|aliexpress|\bkik\b|c&a|deichmann|schuh|thalia|hugendubel|buchhandlung|sportscheck|intersport|globetrotter|conrad|notino|about you|etsy|tedi|woolworth|takko|new yorker|mango\b|bershka|pull ?& ?bear|fressnapf|zooplus|blumen|floristik|gaertnerei|dehner|garten|tchibo|pollin|cyberport|alternate|notebooksbilliger|thomann|euronics|lego\b|smyths|spielwaren|moebel|xxxlutz|\bpoco\b|roller\b|segmueller|jysk|galeria|karstadt|outlet|pandora|swarovski|pepco|el corte ingles|leroy merlin)/, 'shopping'],
];

/** Casos que otra regla confundiría: se evalúan antes que nada. */
const PRIORITY_EXPENSE: Rule[] = [
  // Compra de valores, ETF, fondos o cripto: dinero que se invierte, no que se consume.
  [/(trade ?republic|scalable ?(capital|gmbh|broker)?|\bdegiro|flatex|interactive ?brokers|\bibkr\b|\betoro\b|\bxtb\b|\brobinhood|\bfreetrade|\btrading ?212|\bbux\b|justtrade|smartbroker|onvista|\bcomdirect.*(wertpapier|depot)|\bing.*(depot|wertpapier)|wertpapier|\bsparplan|\betf\b|\betfs\b|\bfondos? (de inversion|indexado)|\bindexa capital|myinvestor|renta ?4|selfbank|openbank.*(bolsa|fondos)|\bbroker|\bborsa\b|\bbolsa\b|compra (de )?(acciones|valores|etf|fondos?)|acquisto (titoli|azioni|etf)|\bazioni\b|\btitoli\b|\bfineco ?(invest|trading)|directa sim|\bbitpanda|\bcoinbase|\bkraken\b|\bbinance|bitvavo|crypto\.com|\bbitcoin|\bkryptow|\bcripto|\bsecurities|stock ?(purchase|order)|wertpapierkauf|wertpapierabrechnung|plan de pensiones|pensionsfonds|riester|ruerup|vermoegenswirksam|\bbausparen|bausparkasse|\bfondo pensione)/, 'investing'],
  [/\bpres\.? ?\d{6,}/, 'debt'],
  [/viajes el corte ingles/, 'travel'],
  [/\b(tk ?maxx|tkmaxx)\b/, 'shopping'],
  [/\bmd (spa|discount|supermercati|s\.?p\.?a)\b/, 'groceries'],
  [/\b(optica|opticas|optico|optiker)\b/, 'health'],
  [/\b(cines?|cinesa|yelmo|kinepolis|multicines|ocine)\b/, 'leisure'],
];

/** Vocabulario añadido para Italia, Alemania y España (se evalúa después de las reglas principales). */
const EXTRA_EXPENSE: Rule[] = [
  [/(gimnasio|basic ?fit|\bgym\b|\bpalestra\b|fitness ?first|holmes place|anytime fitness)/, 'subscriptions'],
  [/(\bselex\b|naturasi|\bcrai\b|superconti|dia supermercad|\bdia (market|%)|\beroski|\bconsum\b|alcampo|bonpreu|caprabo|gadis|ahorramas|supercor|simply market|froiz|coviran|hipercor|bm supermercados|marktkauf|globus markt|famila|\bnahkauf|\bhit markt)/, 'groceries'],
  [/(glovo|deliveroo|roadhouse|\bwolt\b|uber ?eats|just ?eat|telepizza|foodora|cerveceria|taberna|\bmeson\b|asador|bocadiller|kebab|doener|imbiss|gaststaette|wirtshaus|brauhaus|biergarten|eiscafe|bar\/ristorante|\bcafeteria|food ?court|sushi|pasteleria|heladeria|autogrill|\bgrill\b)/, 'dining'],
  [/(repsol|cepsa|\bgalp\b|moeve|totalerg|tamoil|\bemt\b|\btmb\b|\btper\b|\bgtt\b|\bamt genova|cabify|\bbolt\b|free ?now|\buber\b|blablacar|\balsa\b|renfe|\bfgc\b|metro de|metrobus|bicimad|bicing|\blime\b|\btier\b|share ?now|flinkster|getaround|via ?verde|viacard|estacion de servicio|gasolinera|e-?scooter|ladestation|ladesaeule|\bapcoa|\bavis\b|\bhertz\b|europcar|rent a car|autovermietung|tuev|dekra|\bitv\b|taller mecanico|werkstatt|autolavaggio)/, 'transport'],
  [/(crociere|crucero|viajes (halcon|barcelo|el corte ingles)|logitravel|rumbo\b|edreams|skyscanner|kayak|\bparador|hostal|ferienwohnung|pension zur|reisebuero|reiseveranstalter|flixtrain|interrail)/, 'travel'],
  [/(centro dentistico|laboratorio analisi|\blab(oratorio)? analisi|clinica|policlinica|hospital|\bdentista|\bzahnarzt|\barzt|heilpraktiker|physiotherap|krankengymnastik|\bpsicolog|\bpsycholog|veterinari|tierarzt|\bsanitat|\bmedico\b|\bmedica\b)/, 'health'],
  [/(\bfnac\b|tigota|\bpearl\b|\blibri\b|libreria|\bthalia|casa del libro|worten|pc ?componentes|\bshein\b|\btemu\b|vinted|ali ?express|conforama|\bjysk|bershka|stradivarius|oysho|massimo dutti|lefties|new yorker|gamestop|kiabi|\bmaxi zoo|\bdepot\b|\bwish\b|\bnormal\b|rituals|\bhema\b|ernstings|takko|\bnkd\b|\bpimkie|\bmueller (drogerie|markt)|\bmüller\b|saturn\b|expert\b|euronics|cyberport|alternate\b|notebooksbilliger|\botto\b|tchibo|\bkik\b|\bacton\b|\baction\b)/, 'shopping'],
  [/(aguas de|canal de isabel|emasesa|\baigues|\bdigi\b|masmovil|\borange\b|yoigo|pepephone|jazztel|\blowi\b|holaluz|somenergia|\bepm\b|\bsoluzioni energia|\benergia (elettrica|y|pura)|\bsky wifi|vodafone|\bwtw\b|\bwoodoo\b|ewe tel)/, 'utilities'],
  [/(spielothek|spielhalle|casino|bowling|escape room|\bzoo\b|tierpark|freizeitpark|therme|schwimmbad|\bsauna|museum|museo|musei|theater|teatro|oper\b|konzert|festival|ticket ?master|entradas|\bdiscoteca|nachtclub|\bclub\b)/, 'leisure'],
  [/(\bschule\b|\bkindergarten|\bkita\b|colegio|escuela|guarderia|autoescuela|scuola guida|\bmatricula|\bmatricola|nachhilfe|\bfahrschule|studentenwerk|semesterbeitrag|studiengebuehr)/, 'education'],
];


/** Palabras muy genéricas: valen para clasificar, pero con menos seguridad (se resaltan para revisar). */
const WEAK_EXPENSE: Rule[] = [
  [/(abo\b|abbonamento|abonnement|mitgliedschaft|mitgliedsbeitrag|membership|subscription|suscripcion)/, 'subscriptions'],
  [/(\bverein\b|vereinsbeitrag)/, 'leisure'],
  [/(\btickets?\b)/, 'leisure'],
  [/(\bbuch\b|\bbuecher\b|\bbuecherei\b)/, 'shopping'],
  [/(kontofuehrung|kontogebuehr|jahresgebuehr|bankgebuehr|kartengebuehr|entgelt|gebuehr|comision|comisiones|steuer\b|finanzamt|hundesteuer|grundsteuer|bussgeld|verwarnung|ordnungsamt|spende\b|spenden\b|donation)/, 'other_expense'],
];

const EXPENSE_ALL: Rule[] = [...PRIORITY_EXPENSE, ...EXPENSE_RULES, ...EXTRA_EXPENSE];

const INCOME_RULES: Rule[] = [
  [/(stipendio|emolumenti|retribuzione|competenze|busta paga|cedolino|\bnomina\b|\bsalario|gehalt|lohn\b|entgelt|verguetung|salary|nomina|arbeitgeber|dhl|deutsche post|payroll|lohn\/gehalt)/, 'salary'],
  [/(rimborso|storno|\breso\b|\bresi\b|restituzione|nota di credito|erstattung|rueckerstattung|refund|storno|retoure|reversal|rueckzahlung|steuererstattung|finanzamt|reembolso|devolucion)/, 'refunds'],
  [/(interessi attivi|dividendi|cedola|zinsen|dividende|ertrag|interest|trade republic|scalable|\betf\b|depot|degiro|bitpanda|coinbase|kraken|rendite)/, 'investments'],
  [/(honorar|rechnung|invoice|freelance|projekt|auftrag|factura)/, 'freelance'],
  [/(regalo|geschenk|gift|taschengeld|regalo|mama\b|papa\b|oma\b|opa\b)/, 'gifts'],
  [/(pensione|\binps\b|assegno unico|\bnaspi\b|cassa integrazione|\bbonus\b|accredito|bonifico (a vostro favore|ricevuto|in entrata|da )|incasso|kindergeld|elterngeld|bafoeg|bafog|arbeitslosengeld|wohngeld|familienkasse|agentur fuer arbeit|jobcenter|krankengeld|rente\b)/, 'other_income'],
];

/** Movimientos entre cuentas/«Spaces» propios: no son ni ingreso ni gasto reales. */
const INTERNAL = /(pagamento ricevuto|pagamento (saldo|rata) carta|saldo (precedente )?carta|addebito (saldo|estratto conto|su c\/c|in conto)|ricarica carta|payment received|zahlung erhalten|abbuchung kreditkarte|giroconto|trasferimento tra (conti|carte)|\bspace\b|umbuchung|eigenes konto|eigene konto|uebertrag auf|transfer to (space|savings)|from space|to space|zwischen eigenen|traspaso entre)/;

const BANK_CATEGORY: Record<string, string> = {
  'food & groceries': 'groceries', 'restaurants & bars': 'dining', 'media & electronics': 'shopping', shopping: 'shopping',
  transport: 'transport', 'transport & car': 'transport', 'travel & holidays': 'travel', 'bills & utilities': 'utilities',
  'household & utilities': 'utilities', 'subscriptions & donations': 'subscriptions', 'health & beauty': 'health',
  'leisure & entertainment': 'leisure', 'insurances & finances': 'insurance', education: 'education',
  'lebensmittel & lebensmittelgeschaeft': 'groceries', 'restaurants & cafes': 'dining', gesundheit: 'health', einkaufen: 'shopping',
};

/**
 * Marcas conocidas para reconocer variantes: nombres cortados por el banco («starbuck», «lieferand») o con una
 * letra mal («mcdonlads»). Solo marcas largas y distintivas: así el parecido no confunde un comercio con otro.
 */
const BRANDS: [string, string][] = [
  ['starbucks', 'dining'], ['mcdonalds', 'dining'], ['lieferando', 'dining'], ['vapiano', 'dining'], ['nordsee', 'dining'], ['domino', 'dining'],
  ['burgerking', 'dining'], ['sausalitos', 'dining'],
  ['kaufland', 'groceries'], ['edeka', 'groceries'], ['alnatura', 'groceries'], ['mercadona', 'groceries'], ['carrefour', 'groceries'], ['hellofresh', 'groceries'],
  ['zalando', 'shopping'], ['primark', 'shopping'], ['decathlon', 'shopping'], ['mediamarkt', 'shopping'], ['rossmann', 'shopping'], ['hornbach', 'shopping'],
  ['deichmann', 'shopping'], ['fressnapf', 'shopping'], ['woolworth', 'shopping'], ['douglas', 'shopping'], ['amazon', 'shopping'],
  ['netflix', 'subscriptions'], ['spotify', 'subscriptions'], ['youtube', 'subscriptions'], ['audible', 'subscriptions'], ['crunchyroll', 'subscriptions'],
  ['vodafone', 'utilities'], ['telekom', 'utilities'], ['vattenfall', 'utilities'], ['stadtwerke', 'utilities'], ['congstar', 'utilities'],
  ['barmer', 'insurance'], ['allianz', 'insurance'], ['signal iduna', 'insurance'],
  ['flixbus', 'transport'], ['rheinbahn', 'transport'], ['tankstelle', 'transport'], ['easypark', 'transport'],
  ['ryanair', 'travel'], ['lufthansa', 'travel'], ['eurowings', 'travel'], ['booking', 'travel'], ['airbnb', 'travel'],
  ['apotheke', 'health'], ['fielmann', 'health'], ['cinemaxx', 'leisure'], ['eventim', 'leisure'],
];

/** ¿Hay un token que sea la marca cortada, o que difiera de ella en una letra? */
function fuzzyBrand(hay: string): string | null {
  const tokens = hay.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 6);
  for (const t of tokens) {
    for (const [brand, cat] of BRANDS) {
      const b = brand.replace(/\s/g, '');
      if (t === b) return cat;
      if (t.length >= 6 && b.length >= 7 && b.startsWith(t)) return cat; // cortado por el banco
      if (t.length === b.length && b.length >= 7 && oneEdit(t, b)) return cat;
    }
  }
  return null;
}

function oneEdit(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      diff++;
      // permite el cambio de dos letras contiguas («amzaon»)
      if (diff === 1 && a[i] === b[i + 1] && a[i + 1] === b[i]) { i++; continue; }
      if (diff > 1) return false;
    }
  }
  return diff <= 1;
}

export type Via = 'rule' | 'bank' | 'ai' | 'history' | 'default';
export interface Categorized { categoryId: string; confidence: 'high' | 'medium' | 'low'; via: Via; internal: boolean }

/** Lo que el usuario ya ha categorizado: comercio → categoría → veces. Se usa para aprender de sus propias correcciones. */
export type History = Map<string, Map<string, number>>;

export function haystack(r: Pick<RawRow, 'name' | 'reference'>): string {
  const text = norm(`${r.name ?? ''} ${r.reference ?? ''}`);
  // «PayPal … Ihr Einkauf bei Spotify»: lo que importa es el comercio detrás de la pasarela.
  const behind = text.match(/(?:einkauf|zahlung|kauf|bestellung) bei ([a-z0-9 .&*+-]{3,40})/);
  return behind ? `${behind[1]} ${text}` : text;
}

/** Categoría que el usuario eligió otras veces para este comercio, si es clara. */
function fromHistory(r: RawRow, income: boolean, history: History): { categoryId: string; confidence: 'high' | 'medium' } | null {
  const key = merchantKey(r.name || r.reference)?.key;
  if (!key || key.length < 3) return null;
  const votes = history.get(key);
  if (!votes) return null;
  const valid = [...votes.entries()].filter(([id]) => categoryById(id)?.type === (income ? 'income' : 'expense') && id !== 'other_expense' && id !== 'other_income');
  const total = valid.reduce((s, [, n]) => s + n, 0);
  if (!total) return null;
  const [best, n] = valid.sort((a, b) => b[1] - a[1])[0]!;
  if (n / total < 0.7) return null;
  return { categoryId: best, confidence: n >= 3 ? 'high' : 'medium' };
}

export function categorize(r: RawRow, history?: History): Categorized {
  const hay = haystack(r);
  const income = r.amountMinor > 0;
  const internal = INTERNAL.test(norm(`${r.name ?? ''} ${r.reference ?? ''} ${r.kind ?? ''}`));
  for (const [re, id] of income ? INCOME_RULES : EXPENSE_ALL) {
    if (re.test(hay)) return { categoryId: id, confidence: 'high', via: 'rule', internal };
  }
  if (history) {
    const h = fromHistory(r, income, history);
    if (h) return { ...h, via: 'history', internal };
  }
  if (!income && r.bankCategory) {
    const id = BANK_CATEGORY[norm(r.bankCategory)];
    if (id && categoryById(id)) return { categoryId: id, confidence: 'medium', via: 'bank', internal };
  }
  if (!income) {
    const near = fuzzyBrand(hay);
    if (near) return { categoryId: near, confidence: 'medium', via: 'rule', internal };
    for (const [re, id] of WEAK_EXPENSE) if (re.test(hay)) return { categoryId: id, confidence: 'medium', via: 'rule', internal };
  }
  if (/(bargeld|geldautomat|\batm\b|cash26|auszahlung|cajero)/.test(hay)) return { categoryId: 'other_expense', confidence: 'medium', via: 'rule', internal };
  return { categoryId: income ? 'other_income' : 'other_expense', confidence: 'low', via: 'default', internal };
}

/** Construye el historial a partir de los movimientos que la persona ya tiene (su nota empieza por el comercio). */
export function buildHistory(txs: { note?: string; categoryId: string }[]): History {
  const h: History = new Map();
  for (const t of txs) {
    const key = merchantKey(t.note)?.key;
    if (!key) continue;
    const votes = h.get(key) ?? new Map<string, number>();
    votes.set(t.categoryId, (votes.get(t.categoryId) ?? 0) + 1);
    h.set(key, votes);
  }
  return h;
}

/** Palabras que dicen, por sí solas, que un movimiento entra a tu cuenta (nómina, devolución, abono…). */
const INCOME_WORDS = /(stipendio|emolumenti|retribuzione|busta paga|rimborso|storno|\breso\b|restituzione|nota di credito|accredito|bonifico (a vostro favore|ricevuto|in entrata|da )|giroconto da|incasso|pensione|gehalt|lohn\b|erstattung|gutschrift|rueckerstattung|retoure|refund|reversal|credited|nomina\b|abono|reembolso|devolucion|ingreso|transferencia (recibida|de )|ueberweisung von|zahlungseingang|geldeingang|payment received|pagamento ricevuto|zahlung erhalten)/;

/**
 * Pista léxica sobre el sentido del movimiento: +1 = parece un ingreso, −1 = parece un gasto, 0 = no se sabe.
 * Sirve para decidir qué signo usa cada extracto (los de tarjeta suelen poner los gastos en positivo).
 */
export function polarity(r: Pick<RawRow, 'name' | 'reference'>): 1 | -1 | 0 {
  const hay = haystack(r);
  if (INCOME_WORDS.test(hay)) return 1;
  for (const [re] of EXPENSE_ALL) if (re.test(hay)) return -1;
  if (/(kartenzahlung|lastschrift|abbuchung|pagamento (pos|carta|con carta)|acquisto|\bpos\b|compra|purchase|withdrawal|prelievo|addebito|bargeld|geldautomat)/.test(hay)) return -1;
  return 0;
}
