import { categoryById } from '@econsultor/shared';
import { norm } from './parse.js';
import type { RawRow } from './types.js';

type Rule = [RegExp, string];

/** Reglas por comercio/concepto (alemán, español, inglés). Se evalúan en orden: lo más específico primero. */
const EXPENSE_RULES: Rule[] = [
  [/\b(miete|kaltmiete|warmmiete|mietzahlung|hausverwaltung|vermieter|hausgeld|alquiler|nebenkosten|wohnungsbau|immobilien|wg miete)\b/, 'housing'],
  [/(krankenkasse|techniker krankenkasse|\btk\b|\baok\b|barmer|\bdak\b|\bikk\b|versicherung|haftpflicht|hausrat|rechtsschutz|allianz|\bhuk|\bergo\b|\baxa\b|devk|generali|signal iduna|cosmos direkt|lv 1871|seguro)/, 'insurance'],
  [/(kreditrate|darlehen|tilgung|ratenzahlung|santander consumer|klarna|afterpay|creditplus|kreditkarte|abrechnung visa|abrechnung mastercard|prestamo|hipoteca)/, 'debt'],
  [/(vodafone|telekom|\bo2\b|telefonica|1&1|1und1|congstar|freenet|aldi ?talk|lebara|winsim|simyo|drillisch|e\.?on\b|vattenfall|enbw|stadtwerke|rwe energie|strom\b|gas\b|wasserwerke|netcologne|pyur|unitymedia|beitragsservice|rundfunk|yello|lichtblick|naturstrom|mobilfunk|internet\b|electricidad|endesa|iberdrola)/, 'utilities'],
  [/(netflix|spotify|disney ?plus|disney\+|dazn|prime video|amazon prime|apple\.com\/bill|apple music|apple tv|icloud|youtube ?(premium|music)|google (one|storage)|dropbox|openai|chatgpt|anthropic|claude\.ai|adobe|microsoft ?(365|office)|audible|sky (deutschland|ticket)|wow\b|rtl\+|paramount|crunchyroll|patreon|github|notion|1password|nordvpn|surfshark|expressvpn|deezer|tidal|duolingo|canva|bild plus|spiegel\+|mcfit|clever ?fit|fitx|urban sports|john reed|fitness|gym\b|n26 (you|metal|smart)|xing|linkedin)/, 'subscriptions'],
  [/(rewe|aldi|lidl|edeka|kaufland|penny|netto|norma\b|tegut|denn.?s biomarkt|alnatura|biocompany|globus|famila|marktkauf|hit markt|flink|picnic|getir|gorillas|mercadona|carrefour|\bdia\b|supermarkt|bio ?markt|baeckerei|backerei|bakery|metzger|wochenmarkt)/, 'groceries'],
  [/(mcdonald|burger king|\bkfc\b|starbucks|subway|lieferando|wolt|uber ?eats|just ?eat|domino|pizza|restaurant|cafe\b|coffee|dunkin|vapiano|imbiss|doener|kebab|sushi|bistro|nordsee|kamps|gastronomie|\bbar\b|pub\b|biergarten|eisdiele|ristorante|trattoria)/, 'dining'],
  [/(ryanair|easyjet|lufthansa|eurowings|booking\.com|airbnb|\bhotel\b|hostel|expedia|\btui\b|vueling|wizz|trivago|marriott|hilton|flughafen|airport|opodo|skyscanner|ferienwohnung)/, 'travel'],
  [/(deutsche bahn|\bdb (vertrieb|fernverkehr|regio)|flixbus|bvg|hvv|mvg|vrr|rmv|kvb|vbb|deutschlandticket|uber\b|bolt\b|free ?now|\blime\b|\btier\b|\bvoi\b|shell|aral|esso|jet tankstelle|tankstelle|star tankstelle|avia|total ?energies|parkhaus|parkgebuehr|apcoa|easypark|park ?now|sixt|share ?now|cambio|miles mobility|bahn\b|renfe|metro|gasolina)/, 'transport'],
  [/(apotheke|pharmacy|farmacia|arzt|zahnarzt|praxis|dr\. ?med|optiker|fielmann|apollo|physio|klinik|krankenhaus|doctolib|shop.?apotheke|augenarzt|orthopaed)/, 'health'],
  [/(universitaet|universitat|hochschule|\bvhs\b|volkshochschule|udemy|coursera|skillshare|sprachschule|goethe|babbel|studiengebuehr|semesterbeitrag|kita\b|kindergarten|masterclass|schulbuch)/, 'education'],
  [/(kino\b|cinemaxx|cineplex|ticketmaster|eventim|steam\b|playstation|nintendo|xbox|epic games|bowling|theater|theatre|museum|\bzoo\b|freizeitpark|konzert|lotto|twitch|spielbank|escape room)/, 'leisure'],
  [/(amazon|amzn|zalando|h&m|zara|primark|ikea|mediamarkt|media markt|saturn|apple (store|retail)|decathlon|otto\b|ebay|\bdm\b|dm-drogerie|rossmann|mueller|tk maxx|action\b|obi\b|bauhaus|hornbach|douglas|asos|shein|temu|aliexpress|\bkik\b|c&a|deichmann|thalia|sportscheck|conrad|notino|about you|etsy|paypal)/, 'shopping'],
];

const INCOME_RULES: Rule[] = [
  [/(gehalt|lohn\b|entgelt|verguetung|salary|nomina|arbeitgeber|dhl|deutsche post|payroll)/, 'salary'],
  [/(erstattung|rueckerstattung|refund|storno|retoure|reversal|rueckzahlung|steuererstattung|finanzamt|reembolso|devolucion)/, 'refunds'],
  [/(zinsen|dividende|ertrag|interest|trade republic|scalable|\betf\b|depot|degiro|bitpanda|coinbase|kraken|rendite)/, 'investments'],
  [/(honorar|rechnung|invoice|freelance|projekt|auftrag|factura)/, 'freelance'],
  [/(geschenk|gift|taschengeld|regalo)/, 'gifts'],
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

export interface Categorized { categoryId: string; confidence: 'high' | 'medium' | 'low'; via: 'rule' | 'bank' | 'ai' | 'default'; internal: boolean }

export function haystack(r: Pick<RawRow, 'name' | 'reference'>): string {
  return norm(`${r.name ?? ''} ${r.reference ?? ''}`);
}

export function categorize(r: RawRow): Categorized {
  const hay = haystack(r);
  const income = r.amountMinor > 0;
  const internal = INTERNAL.test(norm(`${r.name ?? ''} ${r.reference ?? ''} ${r.kind ?? ''}`));
  for (const [re, id] of income ? INCOME_RULES : EXPENSE_RULES) {
    if (re.test(hay)) return { categoryId: id, confidence: 'high', via: 'rule', internal };
  }
  if (!income && r.bankCategory) {
    const id = BANK_CATEGORY[norm(r.bankCategory)];
    if (id && categoryById(id)) return { categoryId: id, confidence: 'medium', via: 'bank', internal };
  }
  if (/(bargeld|geldautomat|\batm\b|cash26|auszahlung|cajero)/.test(hay)) return { categoryId: 'other_expense', confidence: 'medium', via: 'rule', internal };
  return { categoryId: income ? 'other_income' : 'other_expense', confidence: 'low', via: 'default', internal };
}
