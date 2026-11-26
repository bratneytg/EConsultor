import type { Traduccion } from './ayuda';

export const AYUDA_EN: Record<string, Traduccion> = {
  "modos-de-uso": {
    titulo: "Two ways to use EConsultor: daily or once a month",
    resumen: "Log each expense as it happens, or upload your bank statement once a month. Pick whichever suits you.",
    claves: ["daily", "monthly", "statement", "manual", "routine", "how do I start", "mode"],
    texto: [
      "There is no single right way. These are the two most common, and you can mix them:",
      "- Every day (30 seconds): tap “Add”, type the amount, pick the category and you're done. It's the most accurate and it keeps your streak going. The daily reminder nudges you if you forget.",
      "- Once a month (5 minutes): download your bank statement (CSV or PDF) and upload it in Settings › Import. EConsultor recognises dates, amounts and categories, and you review anything doubtful before saving.",
      "- Mixed: import the statement every month and only log cash payments by hand, since they don't show up at the bank.",
      "The charts and the advice get better with every month of data. With 2 or 3 months your habits are already clear.",
    ],
    accion: "Import a statement",
  },
  "primer-paso": {
    titulo: "Your first five minutes",
    resumen: "What to do right after creating your account so the app starts being useful.",
    claves: ["first steps", "start", "getting started", "new", "tutorial"],
    texto: [
      "- 1. Log or import last month's transactions so your charts don't start empty.",
      "- 2. Add your fixed income (salary) and the expenses that repeat (rent, insurance, subscriptions). With that, EConsultor works out how much is left free each month.",
      "- 3. Open “Advice”: you'll see recommendations based on your own numbers.",
      "- 4. Turn on the daily reminder in Settings if you want to build the habit.",
      "Everything else is optional and you can come back here any time.",
    ],
  },
  "interfaz-sencilla-profesional": {
    titulo: "Simple or professional interface",
    resumen: "Two levels of detail: the essentials at a glance, or the full analysis.",
    claves: ["mode", "simple", "pro", "professional", "interface", "switch view"],
    texto: [
      "Simple shows your balance, one clear chart and your main categories. It's meant to be read in ten seconds.",
      "Professional adds the flow of your money, the financial pulse, your typical week and a 12-month comparison.",
      "You change it in Settings › Interface and the choice is saved to your account, so it's the same on your phone and your computer.",
    ],
    accion: "Go to Settings",
  },
  "anotar-movimientos": {
    titulo: "Add, edit and delete a transaction",
    resumen: "The “+” button opens the add sheet. You can add several in a row.",
    claves: ["add", "log", "expense", "income", "edit", "delete", "category", "date", "note"],
    texto: [
      "Tap the “+” button (or “Add” on a computer). Choose expense or income, type the amount, the category and, if you like, a note. The date is today, but you can change it to log something from a few days ago.",
      "“Save and add another” keeps the sheet open so you can log several expenses in a row, for example after you get back from the shop.",
      "To fix something, open Transactions and tap the transaction: you can edit or delete it.",
    ],
    accion: "View transactions",
  },
  "importar-extracto": {
    titulo: "Import your bank statement (CSV, Excel or PDF)",
    resumen: "Upload the file from your bank and EConsultor fills in your transactions.",
    claves: ["import", "statement", "csv", "pdf", "bank", "excel", "xlsx", "ods", "nexi", "italy", "credit card", "expenses as income", "invert", "n26", "bbva", "santander", "ing", "deutsche bank", "sparkasse", "upload"],
    texto: [
      "On your bank's website look for “statement”, “transactions” or “export” and download the file as CSV or Excel (.xlsx, the most reliable) or as PDF. LibreOffice sheets (.ods) are read too. An old Excel file (.xls) must first be saved as .xlsx or CSV.",
      "Then open Settings › Import (or the import button in Transactions) and choose the file. You'll see a list of what was understood: date, description, amount and suggested category.",
      "- Check anything greyed out or without a category and fix it.",
      "- If the server has AI enabled, you can let it help categorise and read difficult PDFs. IBANs, emails and long numbers are removed before anything is sent.",
      "- PDFs that are just an image (scanned statements or screenshots) are read with OCR. It is less accurate than a text PDF or a CSV, so check dates, amounts and signs before saving.",
      "- Card statements (Nexi, Visa, Mastercard…): many banks list expenses as positive amounts there. EConsultor detects it and counts those lines as expenses; refunds and card payments are handled separately. If everything still comes out reversed, tap “Swap expenses and income” above the list.",
      "- It understands dates and numbers from Spain, Germany and Italy (05/11/2026, 5 Nov 2026, 1.234,56).",
      "- It learns from you: if you already categorised a merchant, it repeats that for the next ones. Whatever can't be known (a person, a reference number) stays in “Other” for you to review.",
      "- Transactions you already have (and transfers between your own accounts) show up unticked so they aren't duplicated; tick them if you really want to import them.",
      "- It works with any bank: if the columns aren't named the way we expect, they are worked out from their content and you get a notice so you can check them.",
      "- Several accounts: before importing you choose which account the statement belongs to. If it looks like a statement you already uploaded (many dates, amounts and merchants match another account), you get a warning in case you picked the wrong file.",
      "If a file isn't understood, use the report button and tell us which bank it is; there's no need to attach anything with your data.",
    ],
    accion: "Import now",
  },
  "varias-cuentas": {
    titulo: "Several bank accounts",
    resumen: "Import the statements of all your accounts without mixing them up or duplicating anything.",
    claves: ["accounts", "several accounts", "card", "duplicates", "repeated", "repeated statement", "transfer", "joint account"],
    texto: [
      "If you have more than one account or card, type or choose the account name when you import a statement (for example “N26”, “Nexi card”). Each transaction is tied to its account and you can filter Transactions by account.",
      "EConsultor compares what you upload with what you already have: if almost all dates, amounts and merchants match another account, it warns you that you may have uploaded the same statement twice and leaves those transactions unticked.",
      "Transfers between your own accounts count as neither expense nor income, so your charts don't get inflated.",
    ],
  },
  "idioma": {
    titulo: "Change the app language",
    resumen: "English, Spanish, Italian or German.",
    claves: ["language", "english", "spanish", "italian", "german", "español", "italiano", "deutsch"],
    texto: [
      "The app is in English by default. Change it in Settings › Language, or on the sign-in screen. The choice is saved to your account, so it's the same on your phone and your computer.",
      "It changes everything: menus, charts, advice, notices and error messages. The category and merchant names in your transactions are not translated.",
    ],
  },
  "novedades": {
    titulo: "What's new",
    resumen: "A notice tells you about the improvements every time the app updates.",
    claves: ["what is new", "news", "update", "version", "changes", "changelog"],
    texto: [
      "When a new version is released, a window appears when you open the app with the added features, new sections and fixed bugs. You can see it again in Settings › What's new.",
      "If the app detects a newer version while it's open, it lets you know with a notice so you can reload it.",
    ],
  },
  "saldo-del-mes": {
    titulo: "Balance of the month",
    resumen: "How your savings rise and fall through the month.",
    claves: ["balance", "chart", "line", "month", "forecast"],
    texto: [
      "It shows the running balance of the month, day by day: income minus expenses. If it drops below zero, you're spending more than you've earned so far.",
      "Tap or hover over the chart to see each day's value. In the current month, “Projected close” appears at the top: how much you would have left at the end of the month if you keep this pace.",
      "“View table” gives you the same data as a table.",
    ],
  },
  "rio-del-dinero": {
    titulo: "The river of your money",
    resumen: "A diagram linking where money comes in with where it goes.",
    claves: ["sankey", "river", "flow", "income", "expenses", "professional"],
    texto: [
      "It draws how your money flows from income to the spending categories and what's left. The wider the band, the more money.",
      "It's handy to see at a glance how much of your salary goes to housing, food or leisure. Available in the professional interface.",
    ],
  },
  "pulso-financiero": {
    titulo: "Your financial pulse (the 0–100 score)",
    resumen: "An overall score and the four habits that make it up.",
    claves: ["pulse", "score", "grade", "indicators", "savings rate", "fixed expenses", "stability", "consistency", "financial health"],
    texto: [
      "The ring sums up your financial health as a score from 0 to 100 (“Building”, “Solid”, “Excellent”…). It's made of four habits:",
      "- Savings (weight 40 %): goal, save 20 % or more of what you earn.",
      "- Fixed expenses (20 %): ideally they don't exceed half of your income.",
      "- Stability (20 %): that your spending is similar from one month to the next.",
      "- Consistency (20 %): log at least 20 days a month.",
      "Each habit shows its goal, so you know what to improve first.",
    ],
  },
  "mapa-y-semana": {
    titulo: "“Your week”",
    resumen: "Find out which days of the week you spend the most.",
    claves: ["week", "weekend", "days", "weekday"],
    texto: [
      "“Your week” averages spending per day of the week over the last three months. If Saturdays stand out, you know where to look.",
    ],
  },
  "doce-meses": {
    titulo: "Last 12 months and changing month",
    resumen: "Compare months and browse your history.",
    claves: ["months", "history", "compare", "year", "previous month", "browse"],
    texto: [
      "The bars for the last 12 months put income against expenses. Tap a month to open it in the rest of the charts.",
      "At the top you can change month with the arrows. You can't browse into the future: the forecast only appears in the current month.",
    ],
  },
  "tabla-accesible": {
    titulo: "View the charts as a table",
    resumen: "Every chart has a table view with the same data.",
    claves: ["table", "accessibility", "colour blindness", "screen reader", "copy data"],
    texto: [
      "Tap “View table” on any chart. It's useful if you prefer exact figures, if you use a screen reader or if you can't tell some colours apart.",
    ],
  },
  "consejos": {
    titulo: "How the advice is generated",
    resumen: "Two tabs: general and in depth. Rules on your numbers and, if you want, artificial intelligence.",
    claves: ["advice", "ai", "artificial intelligence", "claude", "recommendations", "save", "premium", "in depth", "detailed", "specific", "merchants", "subscriptions"],
    texto: [
      "The advice comes from your transactions: savings rate, fixed versus variable spending, subscriptions, trend, weekend spending and income regularity. Each tip states the monthly saving you could achieve.",
      "With enough history (about 10 transactions) and AI enabled on the server, an assistant writes more personalised advice. Only an anonymous summary of figures is sent to the AI, never notes, names or individual transactions.",
      "The “In depth” tab looks at your last 3 months merchant by merchant: which charges repeat every month, where small expenses eat your money, which categories are rising, how much you spend at the weekend and how much is left unclassified. Each tip comes with a “What to do” section. It's a local analysis; the AI only steps in if you tap “Improve with AI” and accept the notice (a summary without dates or notes is sent). About 15 transactions are needed.",
      "It isn't professional financial advice: it's ideas based on your own data.",
    ],
    accion: "See my advice",
  },
  "prevision-fin-de-mes": {
    titulo: "End-of-month forecast",
    resumen: "How much you'll have left if you keep this pace.",
    claves: ["forecast", "projection", "end of month", "how much is left"],
    texto: [
      "EConsultor projects your income and spending to the end of the month using your pace over the last months and what you've already logged. The more up to date your data, the more reliable it is.",
      "It's an estimate, not a promise: a large unexpected expense changes the result.",
    ],
  },
  "racha": {
    titulo: "The day streak",
    resumen: "The consecutive days on which you logged something.",
    claves: ["streak", "consistency", "habit", "fire", "days in a row"],
    texto: [
      "Every consecutive day you log something adds to your streak, shown in the month summary. If it breaks, you can pick it up again whenever you like.",
    ],
  },
  "recordatorio-diario": {
    titulo: "Daily reminder",
    resumen: "A notice at the time you choose to log the day's expenses.",
    claves: ["reminder", "notice", "notification", "push", "time", "9", "morning"],
    texto: [
      "In Settings › Daily reminder turn the notice on and choose the time (in your time zone). It's only sent if you haven't logged anything that day yet.",
      "- In the Android app the phone itself schedules the notice, it works with the app closed and nothing else is needed.",
      "- In the browser you also need to allow the device's notifications.",
      "- On iPhone: open the site in Safari, tap Share › “Add to Home Screen”, open EConsultor from there and turn the notices on.",
    ],
    accion: "Set up the reminder",
  },
  "app-android": {
    titulo: "Install the Android app",
    resumen: "The same EConsultor as an app, with the native daily reminder.",
    claves: ["android", "apk", "app", "install", "phone", "mobile", "download"],
    texto: [
      "Download the APK file from the link in Settings, open it and, if Android asks, allow installing apps from this source. Then open EConsultor and sign in.",
      "The app shows exactly the same account as the web. It has the daily reminder at the chosen time, statement upload and works even if you close the browser.",
      "If there's no download link yet, the person who runs the server can give it to you.",
    ],
  },
  "instalar-como-app": {
    titulo: "Install it as an app from the browser (iPhone, computer)",
    resumen: "EConsultor can be installed without an app store.",
    claves: ["pwa", "install", "iphone", "ios", "home screen", "safari", "chrome", "desktop"],
    texto: [
      "- iPhone/iPad: in Safari tap Share › “Add to Home Screen”.",
      "- Android: in Chrome, menu › “Install app” (or use the Android app).",
      "- Computer: in Chrome or Edge, the install icon in the address bar.",
    ],
  },
  "verificacion-dos-pasos": {
    titulo: "Two-step verification",
    resumen: "A code from your phone on top of your password.",
    claves: ["2fa", "two-step", "security", "authenticator", "totp", "recovery codes", "google authenticator"],
    texto: [
      "In Settings › Security tap “Turn on”, scan the QR code with an authenticator app (Google Authenticator, Authy, 1Password…) and type the 6-digit code.",
      "Keep the recovery codes somewhere safe: each works once if you lose your phone, and they are not shown again.",
    ],
    accion: "Turn on now",
  },
  "huella-y-sesion": {
    titulo: "Sign in with fingerprint and inactivity sign-out",
    resumen: "Access with your phone's fingerprint, and a session that closes itself after 10 minutes.",
    claves: ["fingerprint", "biometrics", "passkey", "face id", "inactivity", "stay signed in", "sign out", "10 minutes", "session"],
    texto: [
      "For security, if you don't touch the app for 10 minutes the session closes and you'll have to sign in again. If you'd rather not, turn on “Stay signed in” in Settings › Security (on a shared device, better leave it off).",
      "In Settings › Security you can turn on “Sign in with fingerprint”: the phone keeps a key that only unlocks with your fingerprint, face or PIN. Your fingerprint never leaves the device or reaches the server. You can register up to 5 devices and remove them whenever you want.",
      "In the Android app the fingerprint uses the phone's reader (also face or the system PIN): sign in with your password, turn it on in Settings › Security and next time it will ask for it when you sign in. In the browser you need to open the app from its secure address (https) and have a fingerprint or PIN set up on the phone.",
      "If you lose your phone, sign in with your password and remove that device.",
    ],
    accion: "Go to Security",
  },
  "exportar-borrar": {
    titulo: "Export or delete your data",
    resumen: "It's yours: take it with you or remove it whenever you want.",
    claves: ["export", "delete", "delete account", "gdpr", "json", "privacy", "download data"],
    texto: [
      "In Settings › Your data you can export everything as a JSON file, delete only the transactions (keeping the account) or delete the account for good. When you delete it, your bug reports disappear too.",
    ],
    accion: "Your data",
  },
  "privacidad": {
    titulo: "What is stored and who can see it",
    resumen: "Explained plainly, including what the person running the server sees.",
    claves: ["privacy", "data", "encryption", "administrator", "financial profile", "who sees", "ai", "security"],
    texto: [
      "Your data is stored encrypted on the server. Passwords aren't stored, only an irreversible fingerprint of them. Sessions use protected cookies.",
      "Whoever runs the server has a control panel to make sure everything works. By default it shows only technical information and counts (how many accounts, how many transactions), without your amounts.",
      "If the administrator turns on the financial-profile option, the panel can show an aggregate profile of your situation (savings level, trend, main categories and forecast) to understand how the app is used. They must tell you about it, and you can ask for it to be turned off or delete your account whenever you want.",
      "If AI is enabled, it only receives an anonymous numeric summary; never your name, your email, your notes or your individual transactions.",
    ],
  },
  "reportar-fallo": {
    titulo: "Report a bug or suggest an idea",
    resumen: "There's a discreet button in the top-right corner.",
    claves: ["report", "bug", "error", "suggestion", "idea", "problem", "help"],
    texto: [
      "In the top-right corner there's a small, almost transparent bug icon: tap it, tell us what happened and send. Only the screen you were on and the device type are attached, never your transactions.",
      "You can send up to 10 reports a day. They're read directly by the person who runs the server.",
    ],
  },
};
