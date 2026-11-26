import { it } from 'vitest';
import { categorize } from '../src/modules/import/categorize.js';
const L: [string, string][] = [
 // España
 ['COMPRA TARJ. MERCADONA 0123','groceries'],['DIA SUPERMERCADOS','groceries'],['LIDL ESPANA','groceries'],['ALCAMPO','groceries'],['EROSKI CITY','groceries'],['CONSUM COOP V','groceries'],['CARREFOUR EXPRESS','groceries'],
 ['BAR EL RINCON','dining'],['RESTAURANTE LA TAGLIATELLA','dining'],['TELEPIZZA','dining'],['GLOVO','dining'],['JUST EAT','dining'],['CERVECERIA 100 MONTADITOS','dining'],['CAFETERIA UNIVERSIDAD','dining'],
 ['REPSOL ESTACION SERVICIO','transport'],['CEPSA','transport'],['RENFE VIAJEROS','transport'],['METRO DE MADRID','transport'],['EMT VALENCIA','transport'],['CABIFY','transport'],['BOLT.EU','transport'],['PEAJE AUTOPISTA AP-7','transport'],
 ['VIAJES EL CORTE INGLES','travel'],['IBERIA LINEAS AEREAS','travel'],['VUELING','travel'],['RENFE AVE','transport'],
 ['FARMACIA LOPEZ','health'],['CLINICA DENTAL','health'],['OPTICA UNIVERSITARIA','health'],['SANITAS','insurance'],['MAPFRE','insurance'],
 ['ZARA ESPANA','shopping'],['EL CORTE INGLES','shopping'],['MANGO OUTLET','shopping'],['PRIMARK','shopping'],['LEROY MERLIN','shopping'],['IKEA','shopping'],['AMAZON.ES','shopping'],['PULL&BEAR','shopping'],['FNAC','shopping'],
 ['ENDESA ENERGIA','utilities'],['IBERDROLA','utilities'],['NATURGY','utilities'],['MOVISTAR','utilities'],['VODAFONE ESPANA','utilities'],['AGUAS DE BARCELONA','utilities'],['CANAL DE ISABEL II','utilities'],['DIGI SPAIN','utilities'],['MASMOVIL','utilities'],['ORANGE','utilities'],
 ['ALQUILER PISO','housing'],['COMUNIDAD DE PROPIETARIOS','housing'],['HIPOTECA PRESTAMO','debt'],['CUOTA PRESTAMO PERSONAL','debt'],
 ['GIMNASIO BASIC FIT','subscriptions'],['CINES YELMO','leisure'],['TICKETMASTER ESPANA','leisure'],['MATRICULA UNIVERSIDAD','education'],['COLEGIO PRIVADO','education'],
 // Italia
 ['PAGAMENTO POS CONAD','groceries'],['LIDL ITALIA','groceries'],['CARREFOUR ITALIA','groceries'],['MD SPA DISCOUNT','groceries'],['PENNY MARKET','groceries'],['SELEX','groceries'],['NaturaSi','groceries'],['EUROSPIN','groceries'],
 ['BAR TABACCHI CENTRALE','dining'],['PIZZERIA DA MICHELE','dining'],['DELIVEROO','dining'],['JUST EAT ITALIA','dining'],['GLOVO ITALY','dining'],['AUTOGRILL','dining'],['MCDONALDS','dining'],['ROADHOUSE','dining'],['GELATERIA','dining'],
 ['ENI STATION','transport'],['TOTALERG','transport'],['TELEPASS','transport'],['TRENITALIA','transport'],['ITALO TRENO','transport'],['ATM MILANO','transport'],['TPER BOLOGNA','transport'],['FLIXBUS','transport'],['FREE NOW','transport'],['UBER TRIP','transport'],['EASYPARK','transport'],
 ['RYANAIR','travel'],['ALITALIA','travel'],['BOOKING.COM','travel'],['AIRBNB','travel'],['MSC CROCIERE','travel'],
 ['FARMACIA COMUNALE','health'],['CENTRO DENTISTICO','health'],['ASL ROMA','health'],['OTTICA','health'],['LAB ANALISI','health'],['UNIPOL ASSICURAZIONI','insurance'],['POSTE VITA','insurance'],
 ['ZARA ITALIA','shopping'],['H&M','shopping'],['MEDIAWORLD','shopping'],['UNIEURO','shopping'],['IKEA ITALIA','shopping'],['DECATHLON','shopping'],['ZALANDO','shopping'],['AMAZON EU SARL','shopping'],['LEROY MERLIN ITALIA','shopping'],['OVS','shopping'],['TIGOTA','shopping'],
 ['ENEL ENERGIA','utilities'],['EDISON','utilities'],['HERA COMM','utilities'],['A2A ENERGIA','utilities'],['TIM SPA','utilities'],['VODAFONE ITALIA','utilities'],['ILIAD','utilities'],['WINDTRE','utilities'],['FASTWEB','utilities'],['CANONE RAI','utilities'],['IREN MERCATO','utilities'],
 ['AFFITTO NOVEMBRE','housing'],['SPESE CONDOMINIALI','housing'],['RATA MUTUO','debt'],['FINANZIAMENTO AGOS','debt'],
 ['NETFLIX','subscriptions'],['SPOTIFY','subscriptions'],['DAZN','subscriptions'],['NOW TV','subscriptions'],['AMAZON PRIME','subscriptions'],['DISNEY PLUS','subscriptions'],
 ['PALESTRA FITNESS','subscriptions'],['CINEMA ODEON','leisure'],['VIVATICKET','leisure'],['UNIVERSITA BOCCONI','education'],['SCUOLA GUIDA','education'],
 // Alemania
 ['REWE SAGT DANKE','groceries'],['EDEKA','groceries'],['ALDI SUED','groceries'],['LIDL SAGT DANKE','groceries'],['PENNY','groceries'],['NETTO MARKEN-DISCOUNT','groceries'],['KAUFLAND','groceries'],['DM DROGERIE MARKT','shopping'],['ROSSMANN','shopping'],['BIO COMPANY','groceries'],['DENNS BIOMARKT','groceries'],['BAECKEREI MUELLER','groceries'],['METZGEREI','groceries'],['NORMA','groceries'],['TEGUT','groceries'],
 ['LIEFERANDO','dining'],['MCDONALDS DEUTSCHLAND','dining'],['BURGER KING','dining'],['STARBUCKS','dining'],['CAFE EINSTEIN','dining'],['RESTAURANT ZUR POST','dining'],['IMBISS','dining'],['DOENER','dining'],['WOLT','dining'],['SUBWAY','dining'],['VAPIANO','dining'],
 ['SHELL STATION','transport'],['ARAL TANKSTELLE','transport'],['ESSO','transport'],['TOTAL ENERGIES','transport'],['DB VERTRIEB','transport'],['DEUTSCHE BAHN','transport'],['BVG','transport'],['MVG','transport'],['HVV','transport'],['DEUTSCHLANDTICKET','transport'],['FLIXBUS','transport'],['PARKHAUS','transport'],['SIXT','transport'],['ADAC','transport'],['KFZ STEUER','transport'],['TUEV','transport'],['ATU AUTOTEILE','transport'],
 ['LUFTHANSA','travel'],['EUROWINGS','travel'],['BOOKING','travel'],['HOTEL ADLON','travel'],
 ['APOTHEKE AM MARKT','health'],['ZAHNARZT','health'],['ARZTPRAXIS','health'],['FIELMANN','health'],['DM-DROGERIE','shopping'],
 ['TECHNIKER KRANKENKASSE','insurance'],['ALLIANZ','insurance'],['HUK COBURG','insurance'],['HAFTPFLICHT','insurance'],
 ['ZALANDO','shopping'],['H&M','shopping'],['MEDIA MARKT','shopping'],['SATURN','shopping'],['IKEA','shopping'],['OTTO','shopping'],['TCHIBO','shopping'],['BAUHAUS','shopping'],['OBI','shopping'],['HORNBACH','shopping'],['AMAZON PAYMENTS','shopping'],['EBAY','shopping'],['DECATHLON','shopping'],['TK MAXX','shopping'],['C&A','shopping'],['KIK','shopping'],['ACTION','shopping'],['PEARL','shopping'],['CONRAD','shopping'],['ALTERNATE','shopping'],['NOTEBOOKSBILLIGER','shopping'],['LIBRI','shopping'],['THALIA','shopping'],['DOUGLAS','shopping'],
 ['VATTENFALL','utilities'],['E.ON','utilities'],['STADTWERKE','utilities'],['TELEKOM','utilities'],['VODAFONE','utilities'],['O2','utilities'],['1&1','utilities'],['RUNDFUNK BEITRAGSSERVICE','utilities'],['ABSCHLAG STROM','utilities'],['GASAG','utilities'],['BERLINER WASSERBETRIEBE','utilities'],
 ['MIETE NOVEMBER','housing'],['VONOVIA','housing'],['KALTMIETE','housing'],['HAUSVERWALTUNG','housing'],['NEBENKOSTEN','housing'],
 ['NETFLIX','subscriptions'],['SPOTIFY','subscriptions'],['DISNEY PLUS','subscriptions'],['AMAZON PRIME','subscriptions'],['DAZN','subscriptions'],['APPLE.COM/BILL','subscriptions'],['GOOGLE ONE','subscriptions'],['RTL+','subscriptions'],['SKY DEUTSCHLAND','subscriptions'],['OPENAI','subscriptions'],
 ['FITX','subscriptions'],['MCFIT','subscriptions'],['URBAN SPORTS CLUB','subscriptions'],['CINEMAXX','leisure'],['EVENTIM','leisure'],['KINO','leisure'],['SPIELOTHEK','leisure'],['STEAM GAMES','leisure'],['PLAYSTATION','subscriptions'],['NINTENDO','leisure'],
 ['UNIVERSITAET','education'],['SEMESTERBEITRAG','education'],['VOLKSHOCHSCHULE','education'],['UDEMY','education'],['KITA GEBUEHR','education'],['SCHULE','education'],
 ['DARLEHEN TILGUNG','debt'],['KREDITRATE','debt'],['KLARNA','debt'],
];
import { expect } from 'vitest';
/** Comercios habituales de Italia, Alemania y España: cada uno debe caer en su categoría. */
it('vocabulario de comercios de Italia, Alemania y España', () => {
  const bad: string[] = [];
  for (const [t, want] of L) { const c = categorize({ date: '2026-11-01', amountMinor: -1000, name: t }); if (c.categoryId !== want) bad.push(`${t} → ${c.categoryId} (${c.via}) esperado ${want}`); }
  expect(bad, bad.join('\n')).toEqual([]);
});
