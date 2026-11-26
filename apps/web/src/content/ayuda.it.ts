import type { Traduccion } from './ayuda';

export const AYUDA_IT: Record<string, Traduccion> = {
  "modos-de-uso": {
    titulo: "Due modi di usare EConsultor: ogni giorno o una volta al mese",
    resumen: "Puoi annotare ogni spesa al momento oppure caricare l'estratto conto una volta al mese. Scegli quello che ti riesce meglio.",
    claves: ["giornaliero", "mensile", "estratto conto", "manuale", "routine", "come inizio", "modalità"],
    texto: [
      "Non esiste un modo giusto. Questi sono i due più comuni e si possono combinare:",
      "- Ogni giorno (30 secondi): tocca «Aggiungi», scrivi l'importo, scegli la categoria e hai finito. È il più preciso e mantiene la tua serie. Il promemoria giornaliero ti ricorda di farlo se te ne dimentichi.",
      "- Una volta al mese (5 minuti): scarica l'estratto conto della tua banca (CSV o PDF) e caricalo in Impostazioni › Importa. EConsultor riconosce date, importi e categorie e tu controlli i dubbi prima di salvare.",
      "- Misto: importa l'estratto ogni mese e annota a mano solo i pagamenti in contanti, che non compaiono in banca.",
      "I grafici e i consigli migliorano con ogni mese in più. Con 2 o 3 mesi le tue abitudini si vedono già chiaramente.",
    ],
    accion: "Importa un estratto conto",
  },
  "primer-paso": {
    titulo: "I tuoi primi cinque minuti",
    resumen: "Cosa fare subito dopo aver creato l'account perché l'app inizi a essere utile.",
    claves: ["primi passi", "iniziare", "inizio", "nuovo", "tutorial"],
    texto: [
      "- 1. Annota o importa i movimenti dell'ultimo mese: così i grafici non partono vuoti.",
      "- 2. Inserisci le entrate fisse (stipendio) e le spese che si ripetono (affitto, assicurazioni, abbonamenti). Con questi dati EConsultor calcola quanto ti resta libero ogni mese.",
      "- 3. Guarda «Consigli»: troverai suggerimenti basati sui tuoi numeri.",
      "- 4. Attiva il promemoria giornaliero in Impostazioni se vuoi creare l'abitudine.",
      "Tutto il resto è facoltativo e puoi tornare qui quando vuoi.",
    ],
  },
  "interfaz-sencilla-profesional": {
    titulo: "Interfaccia semplice o professionale",
    resumen: "Due livelli di dettaglio: l'essenziale a colpo d'occhio, o l'analisi completa.",
    claves: ["modalità", "semplice", "pro", "professionale", "interfaccia", "cambiare vista"],
    texto: [
      "La versione Semplice mostra il tuo saldo, un grafico chiaro e le categorie principali. È pensata per essere letta in dieci secondi.",
      "La versione Professionale aggiunge il flusso del denaro, il polso finanziario, la tua settimana tipo e il confronto degli ultimi 12 mesi.",
      "Si cambia in Impostazioni › Interfaccia e la scelta viene salvata nel tuo account, quindi è la stessa su telefono e computer.",
    ],
    accion: "Vai alle Impostazioni",
  },
  "anotar-movimientos": {
    titulo: "Aggiungere, modificare ed eliminare un movimento",
    resumen: "Il pulsante «+» apre la scheda per annotare. Puoi aggiungerne diversi di seguito.",
    claves: ["annotare", "aggiungere", "spesa", "entrata", "modificare", "eliminare", "categoria", "data", "nota"],
    texto: [
      "Tocca il pulsante «+» (o «Aggiungi» sul computer). Scegli se è una spesa o un'entrata, scrivi l'importo, la categoria e, se vuoi, una nota. La data è oggi, ma puoi cambiarla per annotare qualcosa di qualche giorno fa.",
      "«Salva e aggiungi un altro» lascia la scheda aperta per annotare più spese di seguito, per esempio al ritorno dalla spesa.",
      "Per correggere qualcosa, apri Movimenti e tocca il movimento: potrai modificarlo o eliminarlo.",
    ],
    accion: "Vedi i movimenti",
  },
  "importar-extracto": {
    titulo: "Importare l'estratto conto (CSV, Excel o PDF)",
    resumen: "Carica il file della tua banca e EConsultor compila i tuoi movimenti.",
    claves: ["importare", "estratto conto", "csv", "pdf", "banca", "excel", "xlsx", "ods", "nexi", "italia", "carta di credito", "spese come entrate", "invertire", "n26", "bbva", "santander", "ing", "deutsche bank", "sparkasse", "caricare"],
    texto: [
      "Sul sito della tua banca cerca «estratto conto», «movimenti» o «esporta» e scarica il file in CSV o Excel (.xlsx, il più affidabile) oppure in PDF. Vengono letti anche i fogli di LibreOffice (.ods). Un vecchio Excel (.xls) va prima salvato come .xlsx o CSV.",
      "Poi apri Impostazioni › Importa (o il pulsante di importazione in Movimenti) e scegli il file. Vedrai un elenco di ciò che è stato capito: data, descrizione, importo e categoria proposta.",
      "- Controlla ciò che è in grigio o senza categoria e correggilo.",
      "- Se il server ha l'IA attiva, puoi lasciare che aiuti a categorizzare e a leggere i PDF difficili. Prima dell'invio vengono rimossi IBAN, e-mail e numeri lunghi.",
      "- I PDF che sono solo un'immagine (estratti scansionati o screenshot) vengono letti con l'OCR. È meno preciso di un PDF con testo o di un CSV: controlla date, importi e segni prima di salvare.",
      "- Estratti di carte (Nexi, Visa, Mastercard…): molte banche riportano le spese con segno positivo. EConsultor lo rileva e conta quelle righe come spese; i rimborsi e il pagamento della carta vengono trattati a parte. Se comunque tutto risulta al contrario, tocca «Inverti spese ed entrate» sopra l'elenco.",
      "- Comprende date e numeri di Spagna, Germania e Italia (05/11/2026, 5 nov 2026, 1.234,56).",
      "- Impara da te: se hai già categorizzato un esercente, lo ripete con i successivi. Ciò che non si può sapere (una persona, un riferimento numerico) resta in «Altro» perché tu lo controlli.",
      "- I movimenti che hai già (e i giroconti tra i tuoi conti) compaiono deselezionati per non duplicarli; selezionali se vuoi davvero importarli.",
      "- Funziona con qualsiasi banca: se le colonne non hanno il nome che ci aspettiamo, vengono dedotte dal contenuto e ricevi un avviso perché tu possa verificarle.",
      "- Più conti: prima di importare scegli a quale conto appartiene l'estratto. Se sembra un estratto che hai già caricato (molte date, importi ed esercenti coincidono con un altro conto), ricevi un avviso nel caso tu abbia sbagliato file.",
      "Se un file non viene capito, usa il pulsante per segnalare i problemi e dicci di quale banca si tratta; non serve allegare nulla con i tuoi dati.",
    ],
    accion: "Importa ora",
  },
  "varias-cuentas": {
    titulo: "Più conti bancari",
    resumen: "Importa gli estratti di tutti i tuoi conti senza mischiarli né duplicarli.",
    claves: ["conti", "più conti", "carta", "duplicati", "ripetuto", "estratto ripetuto", "giroconto", "conto cointestato"],
    texto: [
      "Se hai più di un conto o una carta, quando importi un estratto scrivi o scegli il nome del conto (per esempio «N26», «Carta Nexi»). Ogni movimento resta associato al suo conto e puoi filtrare i Movimenti per conto.",
      "EConsultor confronta ciò che carichi con ciò che hai già: se quasi tutte le date, gli importi e gli esercenti coincidono con un altro conto, ti avvisa che forse hai caricato due volte lo stesso estratto e lascia quei movimenti deselezionati.",
      "I giroconti tra i tuoi conti non contano né come spesa né come entrata, così i grafici non si gonfiano.",
    ],
  },
  "idioma": {
    titulo: "Cambiare la lingua dell'app",
    resumen: "Inglese, spagnolo, italiano o tedesco.",
    claves: ["lingua", "inglese", "spagnolo", "italiano", "tedesco", "english", "español", "deutsch"],
    texto: [
      "Per impostazione predefinita l'app è in inglese. Cambiala in Impostazioni › Lingua, oppure nella schermata di accesso. La scelta viene salvata nel tuo account, quindi è la stessa su telefono e computer.",
      "Cambia tutto: menu, grafici, consigli, avvisi e messaggi di errore. I nomi delle categorie e degli esercenti dei tuoi movimenti non vengono tradotti.",
    ],
  },
  "novedades": {
    titulo: "Novità",
    resumen: "Un avviso ti racconta i miglioramenti ogni volta che l'app si aggiorna.",
    claves: ["novità", "aggiornamento", "versione", "modifiche", "cosa c'è di nuovo", "update"],
    texto: [
      "Quando esce una nuova versione, all'apertura dell'app compare una finestra con le funzioni aggiunte, le sezioni nuove e gli errori corretti. Puoi rivederla in Impostazioni › Novità.",
      "Se l'app rileva una versione più recente mentre è aperta, te lo segnala con un avviso per ricaricarla.",
    ],
  },
  "saldo-del-mes": {
    titulo: "Saldo del mese",
    resumen: "Come salgono e scendono i tuoi risparmi nel corso del mese.",
    claves: ["saldo", "grafico", "linea", "bilancio", "mese", "previsione"],
    texto: [
      "Mostra il saldo accumulato del mese giorno per giorno: entrate meno spese. Se scende sotto zero, stai spendendo più di quanto hai incassato finora.",
      "Tocca o passa il mouse sul grafico per vedere il valore di ogni giorno. Nel mese in corso, in alto compare «Chiusura prevista»: quanto ti resterebbe a fine mese se continui con questo ritmo.",
      "Con «Vedi tabella» ottieni gli stessi dati in forma di tabella.",
    ],
  },
  "rio-del-dinero": {
    titulo: "Il fiume dei tuoi soldi",
    resumen: "Un diagramma che collega da dove entra il denaro con dove va.",
    claves: ["sankey", "fiume", "flusso", "entrate", "spese", "professionale"],
    texto: [
      "Disegna come scorre il tuo denaro dalle entrate alle categorie di spesa e a ciò che ti resta. Più la fascia è larga, più denaro c'è.",
      "Serve a vedere a colpo d'occhio quanta parte dello stipendio se ne va in casa, cibo o svago. Disponibile nell'interfaccia professionale.",
    ],
  },
  "pulso-financiero": {
    titulo: "Il tuo polso finanziario (il punteggio da 0 a 100)",
    resumen: "Un voto complessivo e le quattro abitudini che lo compongono.",
    claves: ["polso", "punteggio", "voto", "indicatori", "tasso di risparmio", "spese fisse", "stabilità", "costanza", "salute finanziaria"],
    texto: [
      "L'anello riassume la tua salute economica in un voto da 0 a 100 («In costruzione», «Solida», «Eccellente»…). Si compone di quattro abitudini:",
      "- Risparmio (peso 40 %): obiettivo, risparmiare il 20 % o più di ciò che incassi.",
      "- Spese fisse (20 %): l'ideale è che non superino la metà delle tue entrate.",
      "- Stabilità (20 %): che le tue spese siano simili da un mese all'altro.",
      "- Costanza (20 %): annotare almeno 20 giorni al mese.",
      "Ogni abitudine mostra il suo obiettivo, così sai cosa migliorare per prima.",
    ],
  },
  "mapa-y-semana": {
    titulo: "«La tua settimana»",
    resumen: "Scopri in quali giorni della settimana spendi di più.",
    claves: ["settimana", "fine settimana", "giorni", "giorno della settimana"],
    texto: [
      "«La tua settimana» fa la media della spesa per giorno della settimana negli ultimi tre mesi. Se i sabati spiccano, sai dove guardare.",
    ],
  },
  "doce-meses": {
    titulo: "Ultimi 12 mesi e cambio di mese",
    resumen: "Confronta i mesi e naviga nella tua cronologia.",
    claves: ["mesi", "cronologia", "confrontare", "anno", "mese precedente", "navigare"],
    texto: [
      "Le barre degli ultimi 12 mesi mettono a confronto entrate e spese. Tocca un mese per aprirlo negli altri grafici.",
      "In alto puoi cambiare mese con le frecce. Non si può navigare nel futuro: la previsione compare solo nel mese in corso.",
    ],
  },
  "tabla-accesible": {
    titulo: "Vedere i grafici come tabella",
    resumen: "Ogni grafico ha una vista a tabella con gli stessi dati.",
    claves: ["tabella", "accessibilità", "daltonismo", "lettore di schermo", "copiare dati"],
    texto: [
      "Tocca «Vedi tabella» su qualsiasi grafico. È utile se preferisci cifre esatte, se usi un lettore di schermo o se non distingui bene alcuni colori.",
    ],
  },
  "consejos": {
    titulo: "Come vengono generati i consigli",
    resumen: "Due schede: generali e approfonditi. Regole sui tuoi numeri e, se vuoi, intelligenza artificiale.",
    claves: ["consigli", "ia", "intelligenza artificiale", "claude", "raccomandazioni", "risparmiare", "premium", "approfondito", "dettagliati", "specifici", "esercenti", "abbonamenti"],
    texto: [
      "I consigli nascono dai tuoi movimenti: tasso di risparmio, spese fisse e variabili, abbonamenti, tendenza, spesa del fine settimana e regolarità delle entrate. Ognuno indica il risparmio mensile che potresti ottenere.",
      "Con abbastanza storico (circa 10 movimenti) e l'IA attiva sul server, un assistente scrive consigli più personalizzati. All'IA viene inviato solo un riepilogo anonimo di cifre, mai note, nomi né movimenti singoli.",
      "La scheda «Approfondito» guarda gli ultimi 3 mesi esercente per esercente: quali addebiti si ripetono ogni mese, in quali piccole spese se ne va il denaro, quali categorie salgono, quanto spendi nel fine settimana e quanto resta non classificato. Ogni consiglio ha una sezione «Cosa fare». È un'analisi locale; l'IA interviene solo se tocchi «Migliora con l'IA» e accetti l'avviso (viene inviato un riepilogo senza date né note). Servono circa 15 movimenti.",
      "Non è consulenza finanziaria professionale: sono idee basate sui tuoi dati.",
    ],
    accion: "Vedi i miei consigli",
  },
  "prevision-fin-de-mes": {
    titulo: "Previsione di fine mese",
    resumen: "Quanto ti resterà se continui con questo ritmo.",
    claves: ["previsione", "forecast", "fine mese", "quanto mi resta", "proiezione"],
    texto: [
      "EConsultor proietta le tue entrate e spese fino a fine mese con il tuo ritmo degli ultimi mesi e ciò che hai già annotato. Più i dati sono aggiornati, più è affidabile.",
      "È una stima, non una promessa: una spesa grande e imprevista cambia il risultato.",
    ],
  },
  "racha": {
    titulo: "La serie di giorni",
    resumen: "I giorni consecutivi in cui hai annotato qualcosa.",
    claves: ["serie", "costanza", "abitudine", "fuoco", "giorni consecutivi"],
    texto: [
      "Ogni giorno consecutivo in cui annoti qualcosa si somma alla tua serie, che compare nel riepilogo del mese. Se si interrompe, puoi riprenderla quando vuoi.",
    ],
  },
  "recordatorio-diario": {
    titulo: "Promemoria giornaliero",
    resumen: "Un avviso all'ora che scegli per annotare le spese del giorno.",
    claves: ["promemoria", "avviso", "notifica", "push", "ora", "9", "mattina"],
    texto: [
      "In Impostazioni › Promemoria giornaliero attiva l'avviso e scegli l'ora (nel tuo fuso orario). Viene inviato solo se quel giorno non hai ancora annotato nulla.",
      "- Nell'app Android l'avviso lo programma il telefono stesso, funziona con l'app chiusa e non serve altro.",
      "- Nel browser devi anche consentire le notifiche del dispositivo.",
      "- Su iPhone: apri il sito in Safari, tocca Condividi › «Aggiungi alla schermata Home», apri EConsultor da lì e attiva gli avvisi.",
    ],
    accion: "Configura l'avviso",
  },
  "app-android": {
    titulo: "Installare l'app Android",
    resumen: "La stessa EConsultor in un'app, con l'avviso giornaliero nativo.",
    claves: ["android", "apk", "app", "installare", "cellulare", "telefono", "scaricare"],
    texto: [
      "Scarica il file APK dal link in Impostazioni, aprilo e, se Android lo chiede, consenti l'installazione di app da questa fonte. Poi apri EConsultor e accedi.",
      "L'app mostra esattamente lo stesso account del sito. Ha l'avviso giornaliero all'ora scelta, il caricamento degli estratti e funziona anche se chiudi il browser.",
      "Se non c'è ancora un link di download, la persona che gestisce il server può fornirtelo.",
    ],
  },
  "instalar-como-app": {
    titulo: "Installarla come app dal browser (iPhone, computer)",
    resumen: "EConsultor si può installare senza app store.",
    claves: ["pwa", "installare", "iphone", "ios", "schermata home", "safari", "chrome", "desktop"],
    texto: [
      "- iPhone/iPad: in Safari tocca Condividi › «Aggiungi alla schermata Home».",
      "- Android: in Chrome, menu › «Installa app» (oppure usa l'app Android).",
      "- Computer: in Chrome o Edge, l'icona di installazione nella barra degli indirizzi.",
    ],
  },
  "verificacion-dos-pasos": {
    titulo: "Verifica in due passaggi",
    resumen: "Un codice dal tuo telefono oltre alla password.",
    claves: ["2fa", "due passaggi", "sicurezza", "autenticatore", "totp", "codici di recupero", "google authenticator"],
    texto: [
      "In Impostazioni › Sicurezza tocca «Attiva», scansiona il codice QR con un'app di autenticazione (Google Authenticator, Authy, 1Password…) e scrivi il codice di 6 cifre.",
      "Conserva i codici di recupero in un posto sicuro: ognuno vale una sola volta se perdi il telefono e non vengono mostrati di nuovo.",
    ],
    accion: "Attiva ora",
  },
  "huella-y-sesion": {
    titulo: "Accedere con l'impronta e disconnessione per inattività",
    resumen: "Accesso con l'impronta del telefono e sessione che si chiude da sola dopo 10 minuti.",
    claves: ["impronta", "biometria", "passkey", "face id", "inattività", "resta connesso", "disconnettersi", "10 minuti", "sessione"],
    texto: [
      "Per sicurezza, se non tocchi l'app per 10 minuti la sessione si chiude e dovrai accedere di nuovo. Se preferisci di no, attiva «Resta connesso» in Impostazioni › Sicurezza (su un dispositivo condiviso è meglio lasciarlo spento).",
      "In Impostazioni › Sicurezza puoi attivare «Accedi con l'impronta»: il telefono conserva una chiave che si sblocca solo con la tua impronta, il volto o il PIN. La tua impronta non lascia mai il dispositivo né arriva al server. Puoi registrare fino a 5 dispositivi e rimuoverli quando vuoi.",
      "Nell'app Android l'impronta usa il lettore del telefono (anche il volto o il PIN di sistema): accedi con la password, attivala in Impostazioni › Sicurezza e la prossima volta te la chiederà all'accesso. Nel browser devi aprire l'app dal suo indirizzo sicuro (https) e avere impronta o PIN configurati sul telefono.",
      "Se perdi il telefono, accedi con la password e rimuovi quel dispositivo.",
    ],
    accion: "Vai a Sicurezza",
  },
  "exportar-borrar": {
    titulo: "Esportare o cancellare i tuoi dati",
    resumen: "Sono tuoi: puoi portarli via o eliminarli quando vuoi.",
    claves: ["esportare", "cancellare", "eliminare account", "gdpr", "json", "privacy", "scaricare dati"],
    texto: [
      "In Impostazioni › I tuoi dati puoi esportare tutto in un file JSON, cancellare solo i movimenti (conservando l'account) o eliminare l'account in modo definitivo. Eliminandolo spariscono anche le tue segnalazioni di errori.",
    ],
    accion: "I tuoi dati",
  },
  "privacidad": {
    titulo: "Cosa viene salvato e chi può vederlo",
    resumen: "Spiegato con chiarezza, incluso ciò che vede chi gestisce il server.",
    claves: ["privacy", "dati", "cifratura", "amministratore", "profilo finanziario", "chi vede", "ia", "sicurezza"],
    texto: [
      "I tuoi dati sono salvati cifrati sul server. Le password non vengono memorizzate, solo un'impronta irreversibile. Le sessioni usano cookie protetti.",
      "Chi gestisce il server dispone di un pannello di controllo per verificare che tutto funzioni. Per impostazione predefinita mostra solo informazioni tecniche e conteggi (quanti account, quanti movimenti), senza i tuoi importi.",
      "Se l'amministratore attiva l'opzione dei profili finanziari, il pannello può mostrare un profilo aggregato della tua situazione (livello di risparmio, tendenza, categorie principali e previsione) per capire come si usa l'app. Deve informartene e puoi chiedere di disattivarla o eliminare il tuo account quando vuoi.",
      "Se l'IA è attiva, riceve solo un riepilogo numerico anonimo; mai il tuo nome, la tua e-mail, le tue note né i singoli movimenti.",
    ],
  },
  "reportar-fallo": {
    titulo: "Segnalare un errore o proporre un'idea",
    resumen: "C'è un pulsante discreto nell'angolo in alto a destra.",
    claves: ["segnalare", "errore", "bug", "suggerimento", "idea", "problema", "aiuto"],
    texto: [
      "Nell'angolo in alto a destra c'è una piccola icona a forma di insetto, quasi trasparente: toccala, raccontaci cosa è successo e invia. Vengono allegate solo la schermata in cui eri e il tipo di dispositivo, mai i tuoi movimenti.",
      "Puoi inviare fino a 10 segnalazioni al giorno. Le legge direttamente la persona che gestisce il server.",
    ],
  },
};
