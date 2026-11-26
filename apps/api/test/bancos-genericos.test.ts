import { describe, expect, it } from 'vitest';
import { categorize } from '../src/modules/import/categorize.js';
import { rowsFromCsv } from '../src/modules/import/csv.js';

/** Formatos reales (resumidos) de bancos de Alemania, España e Italia: lo que sale tiene que ser lo mismo. */
const read = (csv: string) => {
  const { rows, warnings } = rowsFromCsv(csv);
  return { rows: rows.map((r) => ({ ...r, ...categorize(r) })), warnings };
};
const find = (rows: ReturnType<typeof read>['rows'], text: string) => {
  const r = rows.find((x) => `${x.name} ${x.reference}`.toLowerCase().includes(text.toLowerCase()));
  expect(r, `no encuentro «${text}»`).toBeTruthy();
  return r!;
};

describe('lectura genérica de extractos de distintos bancos', () => {
  it('Sparkasse (CAMT, ;, años de dos cifras, texto sin tildes)', () => {
    const { rows } = read(`"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"
"DE89370400440532013000";"05.11.26";"05.11.26";"KARTENZAHLUNG";"REWE SAGT DANKE 04.11.";"";"";"";"";"";"";"REWE Markt GmbH";"";"";"-23,47";"EUR";"Umsatz gebucht"
"DE89370400440532013000";"06.11.26";"06.11.26";"MIETE";"Miete November Whg 4";"";"";"";"";"";"";"Vonovia SE";"DE02120300000000202051";"";"-780,00";"EUR";"Umsatz gebucht"
"DE89370400440532013000";"28.11.26";"28.11.26";"GEHALT/RENTE";"Lohn/Gehalt 11/2026";"";"";"";"";"";"";"DHL Delivery GmbH";"";"";"1.987,12";"EUR";"Umsatz gebucht"
`);
    expect(rows).toHaveLength(3);
    expect(find(rows, 'rewe')).toMatchObject({ date: '2026-11-05', amountMinor: -2347, categoryId: 'groceries' });
    expect(find(rows, 'vonovia')).toMatchObject({ amountMinor: -78000, categoryId: 'housing' });
    expect(find(rows, 'dhl')).toMatchObject({ date: '2026-11-28', amountMinor: 198712, categoryId: 'salary' });
  });

  it('DKB (cabecera tras el preámbulo, pagador y receptor, «Vorgemerkt» se omite)', () => {
    const { rows, warnings } = read(`"Konto";"Girokonto";
"";
"Kontostand vom 25.11.2026:";"1.234,56 €";
"";
"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"
"02.11.26";"02.11.26";"Gebucht";"Max Mustermann";"LIDL SAGT DANKE";"Kartenzahlung";"Ausgang";"";"-18,99";"";"";""
"03.11.26";"03.11.26";"Gebucht";"Max Mustermann";"Deutsche Bahn";"Fahrkarte";"Ausgang";"";"-29,90";"";"";""
"04.11.26";"04.11.26";"Vorgemerkt";"Max Mustermann";"Shell Station";"Tanken";"Ausgang";"";"-60,00";"";"";""
"05.11.26";"05.11.26";"Gebucht";"Max Mustermann";"Netflix International";"Abo";"Ausgang";"";"-13,99";"";"";""
"06.11.26";"06.11.26";"Gebucht";"Max Mustermann";"Apotheke am Markt";"Kartenzahlung";"Ausgang";"";"-8,45";"";"";""
"28.11.26";"28.11.26";"Gebucht";"DHL Group";"Max Mustermann";"Gehalt November";"Eingang";"";"2.100,00";"";"";""
`);
    expect(rows).toHaveLength(5);
    expect(warnings.join(' ')).toMatch(/pendientes/);
    expect(find(rows, 'lidl')).toMatchObject({ name: 'LIDL SAGT DANKE', amountMinor: -1899, categoryId: 'groceries' });
    expect(find(rows, 'bahn').categoryId).toBe('transport');
    expect(find(rows, 'netflix').categoryId).toBe('subscriptions');
    expect(find(rows, 'apotheke').categoryId).toBe('health');
    expect(find(rows, 'dhl')).toMatchObject({ name: 'DHL Group', amountMinor: 210000, categoryId: 'salary' });
  });

  it('ING-DiBa (preámbulo largo, «Buchung» como fecha, dos columnas «Währung»)', () => {
    const { rows } = read(`Umsatzanzeige;Datei erstellt am: 25.11.2026 10:00
;
IBAN;DE12 5001 0517 0648 4898 90
Kontoname;Girokonto
Bank;ING
Kunde;Max Mustermann
Zeitraum;01.11.2026 - 25.11.2026
Saldo;1.234,56;EUR
Sortierung;Datum absteigend
;
Buchung;Valuta;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Saldo;Währung;Betrag;Währung
24.11.2026;24.11.2026;Kaufland Berlin;Lastschrift;Kartenzahlung Kaufland;1.234,56;EUR;-45,10;EUR
20.11.2026;20.11.2026;Vattenfall Europe;Lastschrift;Abschlag Strom;1.279,66;EUR;-62,00;EUR
`);
    expect(rows).toHaveLength(2);
    expect(find(rows, 'kaufland')).toMatchObject({ date: '2026-11-24', amountMinor: -4510, categoryId: 'groceries' });
    expect(find(rows, 'vattenfall')).toMatchObject({ amountMinor: -6200, categoryId: 'utilities' });
  });

  it('N26 en alemán y Commerzbank/comdirect (importes en «Umsatz in EUR», «Betrag (EUR)»)', () => {
    const n26 = read(`"Datum","Empfänger","Kontonummer","Transaktionstyp","Verwendungszweck","Kategorie","Betrag (EUR)","Betrag (Fremdwährung)","Fremdwährung","Wechselkurs"
"2026-11-03","Edeka Müller","","MasterCard Zahlung","","Lebensmittel & Lebensmittelgeschäft","-12.30","","",""
"2026-11-04","Rewe","","MasterCard Zahlung","","Lebensmittel & Lebensmittelgeschäft","-8.20","","",""
`);
    expect(n26.rows).toHaveLength(2);
    expect(n26.rows[0]).toMatchObject({ date: '2026-11-03', amountMinor: -1230, categoryId: 'groceries' });
    const cd = read(`Buchungstag;Wertstellung (Valuta);Vorgang;Buchungstext;Umsatz in EUR
03.11.2026;03.11.2026;Lastschrift / Belastung;Buchungstext: SPOTIFY AB;-10,99
04.11.2026;04.11.2026;Übertrag / Überweisung;Buchungstext: Erstattung Zalando;45,00
`);
    expect(cd.rows).toHaveLength(2);
    expect(cd.rows[0]).toMatchObject({ amountMinor: -1099, categoryId: 'subscriptions' });
    expect(cd.rows[1]).toMatchObject({ amountMinor: 4500, categoryId: 'refunds' });
  });

  it('BBVA / Santander / ING España (fechas dd/mm/aaaa, «F.Valor», importes con € y miles)', () => {
    const bbva = read(`F.Valor;Fecha;Concepto;Movimiento;Importe;Divisa;Disponible;Observaciones
05/11/2026;05/11/2026;COMPRA EN MERCADONA VALENCIA;Tarjeta;-34,20;EUR;1.200,00;
06/11/2026;06/11/2026;RECIBO IBERDROLA CLIENTES;Recibo;-58,90;EUR;1.141,10;
30/11/2026;30/11/2026;NOMINA EMPRESA SL;Transferencia;1.650,00;EUR;2.791,10;
`);
    expect(bbva.rows).toHaveLength(3);
    expect(find(bbva.rows, 'mercadona')).toMatchObject({ date: '2026-11-05', amountMinor: -3420, categoryId: 'groceries' });
    expect(find(bbva.rows, 'iberdrola').categoryId).toBe('utilities');
    expect(find(bbva.rows, 'nomina')).toMatchObject({ amountMinor: 165000, categoryId: 'salary' });
    const ing = read(`F. VALOR;CATEGORÍA;SUBCATEGORÍA;DESCRIPCIÓN;COMENTARIO;IMAGEN;IMPORTE (€);SALDO (€)
05/11/2026;Alimentación;Supermercado;Pago con tarjeta en CARREFOUR;;;-27,45;980,00
`);
    expect(ing.rows[0]).toMatchObject({ date: '2026-11-05', amountMinor: -2745, categoryId: 'groceries' });
    const san = read(`Fecha Operación;Fecha Valor;Concepto;Importe;Saldo
07/11/2026;07/11/2026;COMPRA TARJ. 5540 ZARA ESPAÑA;-39,95;500,00
`);
    expect(san.rows[0]).toMatchObject({ amountMinor: -3995, categoryId: 'shopping' });
  });

  it('Intesa Sanpaolo, Fineco, Poste (Entrate/Uscite, Addebiti/Accrediti, «Valuta» como divisa)', () => {
    const intesa = read(`Data;Operazione;Dettagli;Conto o carta;Contabilizzazione;Categoria;Valuta;Importo
05/11/2026;PAGAMENTO POS;ESSELUNGA MILANO VIA ROMA;Conto;CONTABILIZZATO;Alimentari;EUR;-42,17
10/11/2026;BONIFICO;Stipendio DHL Express;Conto;CONTABILIZZATO;Entrate;EUR;1.800,00
`);
    expect(intesa.rows).toHaveLength(2);
    expect(find(intesa.rows, 'esselunga')).toMatchObject({ date: '2026-11-05', amountMinor: -4217, categoryId: 'groceries' });
    expect(find(intesa.rows, 'stipendio').categoryId).toBe('salary');
    const fineco = read(`Data_Operazione;Data_Valuta;Entrate;Uscite;Descrizione;Descrizione_Completa;Stato
05/11/2026;05/11/2026;;42,17;Pagamento POS;ESSELUNGA MILANO;Contabilizzato
12/11/2026;12/11/2026;1.800,00;;Bonifico;Stipendio DHL;Contabilizzato
13/11/2026;13/11/2026;;19,99;Pagamento POS;AMAZON EU SARL;Autorizzato
`);
    expect(fineco.rows).toHaveLength(2);
    expect(fineco.rows[0]).toMatchObject({ amountMinor: -4217, categoryId: 'groceries' });
    expect(fineco.rows[1]).toMatchObject({ amountMinor: 180000 });
    const poste = read(`Data Contabile;Data Valuta;Addebiti;Accrediti;Descrizione Operazioni
05/11/2026;05/11/2026;12,40;;PAGAMENTO POS FARMACIA CENTRALE
06/11/2026;06/11/2026;;300,00;BONIFICO A VOSTRO FAVORE DA ROSSI MARIO
`);
    expect(poste.rows[0]).toMatchObject({ amountMinor: -1240, categoryId: 'health' });
    expect(poste.rows[1]?.amountMinor).toBe(30000);
  });

  it('Revolut / PayPal: estados rechazados o pendientes no cuentan', () => {
    const rev = read(`Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-11-03 10:11:12,2026-11-03 10:11:15,Lieferando,-18.50,0.00,EUR,COMPLETED,100.00
CARD_PAYMENT,Current,2026-11-04 08:00:00,,Uber,-12.00,0.00,EUR,REVERTED,100.00
CARD_PAYMENT,Current,2026-11-05 08:00:00,,Zalando,-59.90,0.00,EUR,PENDING,100.00
`);
    expect(rev.rows).toHaveLength(1);
    expect(rev.rows[0]).toMatchObject({ date: '2026-11-03', amountMinor: -1850, categoryId: 'dining' });
    const pp = read(`"Datum","Uhrzeit","Zeitzone","Name","Typ","Status","Währung","Brutto","Entgelt","Netto"
"03.11.2026","10:00:00","CET","Spotify AB","Zahlung","Abgeschlossen","EUR","-9,99","0,00","-9,99"
"04.11.2026","11:00:00","CET","Booking.com","Zahlung","Ausstehend","EUR","-120,00","0,00","-120,00"
`);
    expect(pp.rows).toHaveLength(1);
    expect(pp.rows[0]?.categoryId).toBe('subscriptions');
  });

  it('cabeceras desconocidas: deduce fecha, importe y texto por el contenido y lo avisa', () => {
    const { rows, warnings } = read(`Tag;Info;Wert;Stand
05.11.2026;REWE MARKT BERLIN;-12,34;1.000,00
06.11.2026;SHELL TANKSTELLE;-55,00;945,00
07.11.2026;GEHALT DHL;1.900,00;2.845,00
`);
    expect(rows).toHaveLength(3);
    expect(warnings.join(' ')).toMatch(/deducido las columnas/);
    expect(rows[0]).toMatchObject({ date: '2026-11-05', amountMinor: -1234, categoryId: 'groceries' });
    expect(rows[1]?.categoryId).toBe('transport');
    expect(rows[2]).toMatchObject({ amountMinor: 190000, categoryId: 'salary' });
  });

  it('sin cabecera alguna', () => {
    const { rows } = read(`05/11/2026;PAGAMENTO POS ESSELUNGA;-42,17
06/11/2026;PAGAMENTO POS FARMACIA;-9,90
`);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-11-05', amountMinor: -4217 });
  });

  it('un archivo sin fechas ni importes sigue dando un error claro', () => {
    expect(() => rowsFromCsv('uno;dos\ntres;cuatro\n')).toThrow(/No reconozco las columnas/);
  });
});
