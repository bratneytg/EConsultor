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
  [/\b(miete|kaltmiete|warmmiete|mietzahlung|hausverwaltung|vermieter|hausgeld|alquiler|nebenkosten|wohnungsbau|immobilien|wg miete|mietkaution|kaution|gewobag|degewo|vonovia|howoge|gesobau|stadt und land|deutsche wohnen|wohnungsgenossenschaft|baugenossenschaft|comunidad de propietarios|hausmeister)\b/, 'housing'],
  [/(krankenkasse|techniker krankenkasse|\btk\b|\baok\b|barmer|\bdak\b|\bikk\b|versicherung|haftpflicht|hausrat|rechtsschutz|allianz|\bhuk|\bergo\b|\baxa\b|devk|generali|signal iduna|cosmos ?direkt|cosmos|lv 1871|seguro|barmenia|ottonova|debeka|provinzial|r\+v\b|nuernberger|gothaer|wuerttembergische|concordia|continentale|mapfre|mutua madrilena|sanitas|krankenversicherung|unfallversicherung|berufsunfaehigkeit|sterbegeld|zurich versicherung|\bvhv\b|\bvgh\b|\blvm\b|\bhdi\b)/, 'insurance'],
  [/(kreditrate|darlehen|tilgung|ratenzahlung|santander consumer|klarna|afterpay|creditplus|kreditkarte|abrechnung visa|abrechnung mastercard|prestamo|hipoteca|autokredit|ratenkredit|finanzierung|sollzinsen|dispozinsen|consors finanz|bank11|cashpresso|kreditrate|kredit\b|cuota prestamo)/, 'debt'],
  [/(vodafone|telekom|\bo2\b|telefonica|1&1|1und1|congstar|freenet|aldi ?talk|lebara|winsim|simyo|drillisch|\be\.?on\b|vattenfall|enbw|stadtwerke|rwe energie|strom\b|gas\b|wasserwerke|wasserbetriebe|wasserversorgung|abwasser|fernwaerme|heizkosten|heizung\b|abfall|entsorgung|muellabfuhr|stadtreinigung|\bbsr\b|netcologne|pyur|unitymedia|beitragsservice|rundfunk|ard zdf|yello|lichtblick|naturstrom|mobilfunk|internet\b|dsl\b|glasfaser|electricidad|endesa|iberdrola|naturgy|gasag|mainova|enercity|\bswm\b|abschlag|energie ?(ag|gmbh|versorgung)|\bewe\b|telefon\b|magenta|bundesnetzagentur|agua\b|luz\b|movistar|orange espana|digi mobil)/, 'utilities'],
  [/(netflix|spotify|disney ?plus|disney\+|dazn|prime video|amazon prime|apple\.com\/bill|apple music|apple tv|icloud|youtube ?(premium|music)|google (one|storage)|dropbox|openai|chatgpt|anthropic|claude\.ai|adobe|microsoft ?(365|office)|audible|sky (deutschland|ticket)|wow\b|rtl\+|paramount|crunchyroll|patreon|github|notion|1password|nordvpn|surfshark|expressvpn|deezer|tidal|duolingo|canva|bild plus|spiegel\+|der spiegel|zeit (online|digital)|faz\b|handelsblatt|new york times|substack|medium\.com|joyn|waipu|zattoo|kindle unlimited|mcfit|clever ?fit|fitx|urban sports|john reed|fitness|gym\b|n26 (you|metal|smart)|xing|linkedin|playstation plus|xbox game pass|nintendo switch online|twitch sub|only ?fans|hbo max|max\.com|apple one)/, 'subscriptions'],
  [/(rewe|aldi|lidl|edeka|kaufland|penny|netto|norma\b|tegut|denn.?s biomarkt|alnatura|biocompany|bio ?company|bio ?(laden|hof|markt)|globus|famila|marktkauf|hit markt|flink|picnic|getir|gorillas|mercadona|carrefour|\bdia\b|supermarkt|supermercado|hipercor|eroski|alcampo|bio ?markt|baeckerei|backerei|bakery|backwerk|ditsch|back-?factory|backstube|brotladen|konditorei|metzger|fleischer|wurst\b|wochenmarkt|getraenke|getranke|trinkgut|spaeti|spaetkauf|spaetverkauf|kiosk|hofladen|bauernhof|obst\b|gemuese|gemuse|hello ?fresh|marley spoon|too good to go|reformhaus|feinkost|asia ?(markt|shop)|lekkerland)/, 'groceries'],
  [/(mcdonald|burger king|\bkfc\b|starbucks|subway|lieferando|wolt|uber ?eats|just ?eat|domino|pizza|pizzeria|trattoria|osteria|restaurant|restaurante|cafe\b|cafeteria|coffee|dunkin|vapiano|imbiss|doener|doner|kebab|sushi|ramen|bistro|nordsee|kamps|gastronomie|gasthaus|gasthof|brauhaus|braeuhaus|\bbar\b|pub\b|biergarten|weinbar|kneipe|eisdiele|eiscafe|eis ?cafe|ristorante|mensa\b|studierendenwerk|studentenwerk|kantine|\bburger|\bleon\b|five guys|peter pane|block house|hans im glueck|sausalitos|wagamama|tapas|cerveceria|chiringuito|taverna|\bwok\b|thai\b|vietnam|grill\b|schnitzel|steakhaus|cocktail|lounge|bubble tea|dean ?& ?david|true value)/, 'dining'],
  [/(ryanair|easyjet|lufthansa|eurowings|booking\.com|airbnb|\bhotel\b|hostel|expedia|\btui\b|vueling|wizz|trivago|marriott|hilton|flughafen|airport|opodo|skyscanner|ferienwohnung|camping|jugendherberge|pension\b|reisebuero|reiseveranstalter|dertour|condor|transavia|klm\b|iberia|fluege|ferienhaus|urlaub)/, 'travel'],
  [/(deutsche bahn|\bdb (vertrieb|fernverkehr|regio)|flixbus|flixtrain|\bbvg\b|\bhvv\b|\bmvg\b|\bvrr\b|\brmv\b|\bkvb\b|\bvbb\b|\bssb\b|\bdvb\b|\blvb\b|\bvgn\b|\bkvv\b|\bmvv\b|uestra|bsag|rheinbahn|hochbahn|bogestra|verkehrsbetriebe|verkehrsverbund|nahverkehr|fahrkarte|fahrschein|bahncard|deutschlandticket|uber\b|bolt\b|free ?now|\blime\b|\btier\b|\bvoi\b|nextbike|call a bike|blablacar|shell|aral|esso|jet tankstelle|tankstelle|star tankstelle|\bagip\b|\beni\b|\bhem\b|orlen|\bbft\b|avia|total ?energies|tank ?(&|und) ?rast|raststaette|autohof|parkhaus|parkgebuehr|parken\b|apcoa|easypark|park ?now|sixt|share ?now|cambio|miles mobility|bahn\b|renfe|ouigo|trenitalia|metro\b|gasolina|\badac\b|tuev|\bdekra\b|\batu\b|werkstatt|\bkfz\b|autohaus|reifen|autowasch|waschstrasse|hauptzollamt|zulassungsstelle|fahrschule|toll ?collect|\bmaut\b|vignette|autoteile|auto-teile|peaje|\bsncf\b)/, 'transport'],
  [/(apotheke|pharmacy|farmacia|arzt|zahnarzt|praxis|dr\. ?med|optiker|augenoptik|fielmann|apollo|physio|klinik|krankenhaus|doctolib|shop.?apotheke|augenarzt|orthopaed|labor\b|laborarzt|hoergeraete|akustiker|friseur|frisor|barber|kosmetik|nagelstudio|nail studio|massage|sauna|wellness|therapeut|psycholog|heilpraktiker|logopaed|osteopath|chiropraktiker|sanitaetshaus|clinica|dentista|medico|hospital|peluqueria)/, 'health'],
  [/(universitaet|universitat|hochschule|\bvhs\b|volkshochschule|udemy|coursera|skillshare|sprachschule|goethe|babbel|studiengebuehr|semesterbeitrag|kita\b|kindergarten|kinderkrippe|\bhort\b|masterclass|schulbuch|schulgeld|nachhilfe|fahrschulunterricht|universidad|colegio|academia)/, 'education'],
  [/(kino\b|cinemaxx|cineplex|cinestar|ticketmaster|eventim|reservix|steam\b|playstation|nintendo|xbox|epic games|bowling|billard|minigolf|theater|theatre|museum|\bzoo\b|tierpark|freizeitpark|europa-?park|heide ?park|phantasialand|konzert|festival|lotto|tipico|bet365|twitch|spielbank|spielhalle|casino|escape room|sportverein|turnverein|\btsv\b|\bsv \w+|schwimmbad|stadtbad|freibad|hallenbad|therme\b|kletter|boulder|club\b|disco|nachtclub)/, 'leisure'],
  [/(amazon|amzn|zalando|h&m|zara|primark|ikea|mediamarkt|media markt|saturn|apple (store|retail)|decathlon|otto\b|ebay|kleinanzeigen|vinted|\bdm\b|dm-drogerie|drogerie|rossmann|mueller|tk maxx|action\b|\bobi\b|bauhaus|hornbach|toom|hagebau|baumarkt|douglas|asos|shein|temu|aliexpress|\bkik\b|c&a|deichmann|schuh|thalia|hugendubel|buchhandlung|sportscheck|intersport|globetrotter|conrad|notino|about you|etsy|tedi|woolworth|takko|new yorker|mango\b|bershka|pull ?& ?bear|fressnapf|zooplus|blumen|floristik|gaertnerei|dehner|garten|tchibo|pollin|cyberport|alternate|notebooksbilliger|thomann|euronics|lego\b|smyths|spielwaren|moebel|xxxlutz|\bpoco\b|roller\b|segmueller|jysk|galeria|karstadt|outlet|pandora|swarovski|pepco|el corte ingles|leroy merlin)/, 'shopping'],
];

/** Palabras muy genéricas: valen para clasificar, pero con menos seguridad (se resaltan para revisar). */
const WEAK_EXPENSE: Rule[] = [
  [/(abo\b|abonnement|mitgliedschaft|mitgliedsbeitrag|membership|subscription|suscripcion)/, 'subscriptions'],
  [/(\bverein\b|vereinsbeitrag)/, 'leisure'],
  [/(\btickets?\b)/, 'leisure'],
  [/(\bbuch\b|\bbuecher\b|\bbuecherei\b)/, 'shopping'],
  [/(kontofuehrung|kontogebuehr|jahresgebuehr|bankgebuehr|kartengebuehr|entgelt|gebuehr|comision|comisiones|steuer\b|finanzamt|hundesteuer|grundsteuer|bussgeld|verwarnung|ordnungsamt|spende\b|spenden\b|donation)/, 'other_expense'],
];

const INCOME_RULES: Rule[] = [
  [/(gehalt|lohn\b|entgelt|verguetung|salary|nomina|arbeitgeber|dhl|deutsche post|payroll|lohn\/gehalt)/, 'salary'],
  [/(erstattung|rueckerstattung|refund|storno|retoure|reversal|rueckzahlung|steuererstattung|finanzamt|reembolso|devolucion)/, 'refunds'],
  [/(zinsen|dividende|ertrag|interest|trade republic|scalable|\betf\b|depot|degiro|bitpanda|coinbase|kraken|rendite)/, 'investments'],
  [/(honorar|rechnung|invoice|freelance|projekt|auftrag|factura)/, 'freelance'],
  [/(geschenk|gift|taschengeld|regalo|mama\b|papa\b|oma\b|opa\b)/, 'gifts'],
  [/(kindergeld|elterngeld|bafoeg|bafog|arbeitslosengeld|wohngeld|familienkasse|agentur fuer arbeit|jobcenter|krankengeld|rente\b)/, 'other_income'],
];

/** Movimientos entre cuentas/«Spaces» propios: no son ni ingreso ni gasto reales. */
const INTERNAL = /(\bspace\b|umbuchung|eigenes konto|eigene konto|uebertrag auf|transfer to (space|savings)|from space|to space|zwischen eigenen|traspaso entre)/;

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
  for (const [re, id] of income ? INCOME_RULES : EXPENSE_RULES) {
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
