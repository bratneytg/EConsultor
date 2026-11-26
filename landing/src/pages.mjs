// Plantillas HTML de la web. Una función por página; el idioma y los datos llegan en `c`.
import { LANGS } from './content.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ICON = {
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  download: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>',
  lock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  menu: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
};

const base = (code) => LANGS.find((l) => l.code === code);
const href = (code, page = '') => `/${base(code).prefix}${page}`;

function head(c, { title, description, page = '', index = true }) {
  const alts = c.siteUrl
    ? LANGS.map((l) => `<link rel="alternate" hreflang="${l.code}" href="${esc(c.siteUrl + href(l.code, page))}">`).join('\n  ')
      + `\n  <link rel="alternate" hreflang="x-default" href="${esc(c.siteUrl + href('en', page))}">\n  <link rel="canonical" href="${esc(c.siteUrl + href(c.lang, page))}">`
    : '';
  const robots = index && c.legalOk ? 'index,follow' : 'noindex';
  return `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="theme-color" content="#0b0820">
  <meta name="robots" content="${robots}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:type" content="website">
  ${alts}
  <link rel="icon" href="/assets/icons/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png">
  <link rel="preload" href="/assets/fonts/bricolage-grotesque-latin-wdth-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/styles.css">`;
}

function langSwitch(c, page = '') {
  return `<nav class="lang" aria-label="${esc(c.t.ui.language)}">${LANGS.map((l) =>
    `<a href="${href(l.code, page)}" lang="${l.code}" hreflang="${l.code}" title="${esc(l.name)}"${l.code === c.lang ? ' aria-current="true"' : ''}>${l.code.toUpperCase()}</a>`).join('')}</nav>`;
}

function header(c, { page = '', full = true } = {}) {
  const t = c.t;
  const home = href(c.lang);
  if (!full) {
    return `<header class="top"><div class="wrap"><a class="brand" href="${home}"><img src="/assets/icons/icon-192.png" alt="" width="34" height="34">EConsultor</a><span class="grow"></span>${langSwitch(c, page)}<a class="login-m" href="${home}">${esc(t.foot.back)}</a></div></header>`;
  }
  const links = [['privacy', '#privacy'], ['benefits', '#benefits'], ['premium', '#premium'], ['install', '#install']];
  return `<header class="top">
    <div class="wrap">
      <a class="brand" href="#top" aria-label="${esc(t.ui.home)}"><img src="/assets/icons/icon-192.png" alt="" width="34" height="34">EConsultor</a>
      <nav class="nav" aria-label="${esc(t.ui.mainNav)}">
        ${links.map(([k, h]) => `<a href="${h}">${esc(t.nav[k])}</a>`).join('\n        ')}
      </nav>
      <span class="grow"></span>
      ${langSwitch(c)}
      <a class="login" href="${esc(c.app)}">${esc(t.nav.login)}</a>
      <details class="menu">
        <summary aria-label="${esc(t.ui.menu)}">${ICON.menu}</summary>
        <nav aria-label="${esc(t.ui.mainNav)}">
          ${links.map(([k, h]) => `<a href="${h}">${esc(t.nav[k])}</a>`).join('\n          ')}
          <div class="lang-m">${LANGS.map((l) => `<a href="${href(l.code)}" lang="${l.code}" hreflang="${l.code}"${l.code === c.lang ? ' aria-current="true"' : ''}>${esc(l.name)}</a>`).join('')}</div>
        </nav>
      </details>
    </div>
  </header>`;
}

function footer(c, page = '') {
  const t = c.t;
  return `<footer class="foot">
    <div class="wrap">
      <span>© ${c.year} EConsultor</span>
      <a href="${href(c.lang, 'impressum.html')}">${esc(t.foot.imprint)}</a>
      <a href="${href(c.lang, 'privacy.html')}">${esc(t.foot.privacy)}</a>
      <a href="mailto:${esc(c.contact)}">${esc(c.contact)}</a>
      <span class="grow"></span>
      ${langSwitch(c, page)}
    </div>
  </footer>`;
}

export function home(c) {
  const t = c.t;
  const w = t.who;
  const rows = w.rows.map((r) => {
    const title = r.kind === 'no' ? `<s>${esc(r.name)}</s>` : `<span>${esc(r.name)}</span>`;
    const mark = r.kind === 'you' ? ICON.check : r.kind === 'some' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    return `<li class="${r.kind}"><h3>${title}</h3><p>${esc(r.text)}</p><span class="state">${mark}${esc(r.state)}</span></li>`;
  }).join('\n          ');
  const ways = (k, extra = '') => {
    const w2 = t.install[k];
    return `<div class="way" id="${k}">
            <h3>${esc(w2.name)}</h3>
            <p>${esc(w2.text)}</p>
            <ol>${w2.steps.map((s) => `<li><span>${s(c)}</span></li>`).join('')}</ol>
            ${extra}
          </div>`;
  };
  const p = t.premium;
  const planItems = (items) => items.map((i) => `<li>${ICON.check}${esc(i)}</li>`).join('');
  return `<!doctype html>
<html lang="${t.htmlLang}">
<head>
  ${head(c, { title: t.meta.title, description: t.meta.description })}
</head>
<body>
  <a class="skip" href="#content">${esc(t.ui.skip)}</a>
  ${header(c)}
  <main id="content">
    <section class="hero glow" id="top">
      <div class="wrap">
        <div class="copy">
          <h1 class="display"><span>${esc(t.hero.h1a)}</span> <span class="g">${esc(t.hero.h1b)}</span></h1>
          <p class="lead">${esc(t.hero.lead)}</p>
          <div class="ctas">
            ${c.androidBtn}
            <a class="btn btn-ghost" href="#iphone">${esc(t.hero.iphone)}</a>
          </div>
          <p class="small">${esc(t.hero.smallA)} ${esc(t.hero.smallB)} <a href="${esc(c.app)}">${esc(t.nav.login)}</a></p>
        </div>
        <figure class="phones">
          <div class="phone a"><img src="/assets/img/app-resumen-${c.lang}.webp" width="780" height="1560" alt="${esc(t.hero.altSummary)}"></div>
          <div class="phone b"><img src="/assets/img/app-ian-${c.lang}.webp" width="780" height="1560" alt="${esc(t.hero.altIan)}"></div>
          <span class="badge">${ICON.lock}${esc(t.hero.badge)}</span>
          <figcaption>${esc(t.hero.caption)}</figcaption>
        </figure>
      </div>
    </section>

    <section class="who" id="privacy" aria-labelledby="h-who">
      <div class="wrap">
        <div class="head">
          <h2 class="display" id="h-who">${esc(w.title)}</h2>
          <p>${esc(w.intro)}</p>
        </div>
        <ul class="rows">
          ${rows}
        </ul>
        <p class="note">${esc(w.note)}</p>
      </div>
    </section>

    <section class="light benefits" id="benefits" aria-labelledby="h-benefits">
      <div class="wrap split">
        <div class="sticky">
          <h2 class="display" id="h-benefits">${esc(t.benefits.title)}</h2>
          <p class="intro">${esc(t.benefits.intro)}</p>
        </div>
        <ul class="points">
          ${t.benefits.items.map(([h, b]) => `<li><h3>${esc(h)}</h3><p>${esc(b)}</p></li>`).join('\n          ')}
        </ul>
      </div>
    </section>

    <section class="plus" id="premium" aria-labelledby="h-premium">
      <div class="wrap">
        <div>
          <h2 class="display" id="h-premium">${esc(p.title)}</h2>
          <p class="intro">${esc(p.intro)}</p>
          <div class="plans">
            <div class="plan">
              <h3>${esc(p.free.name)} <span>${esc(p.free.sub)}</span></h3>
              <ul>${planItems(p.free.items)}</ul>
            </div>
            <div class="plan pro">
              <h3>${esc(p.pro.name)} <span>${esc(p.pro.sub(c))}</span></h3>
              <ul>${planItems(p.pro.items)}</ul>
            </div>
          </div>
        </div>
        <div class="chat" role="img" aria-label="${esc(p.chat.aria)}">
          <div class="who-i"><span class="av" aria-hidden="true">I</span><div><b>Ian</b><span>${esc(p.chat.sub)}</span></div></div>
          <div class="bub me">${esc(p.chat.q)}</div>
          <div class="bub ian"><p>${esc(p.chat.a1)}</p><p>${esc(p.chat.a2)}</p></div>
          <p class="cnote">${esc(p.chat.note)}</p>
        </div>
      </div>
    </section>

    <section class="light install" id="install" aria-labelledby="h-install">
      <div class="wrap">
        <h2 class="display" id="h-install">${esc(t.install.title)}</h2>
        <p class="intro">${esc(t.install.intro)}</p>
        <div class="ways">
          ${ways('android', `${c.androidBtn}<p class="hint">${esc(t.install.android.hint)}</p>`)}
          ${ways('iphone', `<p class="hint">${esc(t.install.iphone.hint)}</p>`)}
          ${ways('desktop', `<a class="btn btn-line" href="${esc(c.app)}">${esc(t.install.desktop.btn)}</a>`)}
        </div>
      </div>
    </section>

    <section class="final glow" aria-labelledby="h-final">
      <div class="wrap">
        <h2 class="display" id="h-final">${esc(t.final.title)}</h2>
        <p>${esc(t.final.text)}</p>
        <a class="btn btn-primary" href="${esc(c.app)}">${esc(t.final.btn)}</a>
      </div>
    </section>
  </main>
  ${footer(c)}
</body>
</html>
`;
}

const owner = (c) => `${c.ownerName}<br>${c.ownerAddress}`;

export function imprint(c) {
  const l = c.t.legal;
  return `<!doctype html>
<html lang="${c.t.htmlLang}">
<head>
  ${head(c, { title: `${l.imprintTitle} · EConsultor`, description: l.contentP, page: 'impressum.html', index: false })}
</head>
<body class="legal-page">
  ${header(c, { page: 'impressum.html', full: false })}
  <main class="legal">
    <div class="wrap">
      <h1 class="display">${esc(l.imprintTitle)}</h1>
      <h2>${esc(l.responsible)}</h2>
      <p>${owner(c)}</p>
      <h2>${esc(l.contact)}</h2>
      <p>${esc(l.email)}: <a href="mailto:${esc(c.contact)}">${esc(c.contact)}</a>${c.phone ? `<br>${esc(l.phone)}: ${esc(c.phone)}` : ''}</p>
      <h2>${esc(l.contentH)}</h2>
      <p>${esc(l.contentP)}</p>
    </div>
  </main>
  ${footer(c, 'impressum.html')}
</body>
</html>
`;
}

export function privacy(c) {
  const l = c.t.legal;
  return `<!doctype html>
<html lang="${c.t.htmlLang}">
<head>
  ${head(c, { title: `${l.privacyTitle} · EConsultor`, description: l.siteP1, page: 'privacy.html', index: false })}
</head>
<body class="legal-page">
  ${header(c, { page: 'privacy.html', full: false })}
  <main class="legal">
    <div class="wrap">
      <h1 class="display">${esc(l.privacyTitle)}</h1>
      <h2>${esc(l.who)}</h2>
      <p>${c.ownerName}, ${c.ownerAddress}. ${esc(l.email)}: <a href="mailto:${esc(c.contact)}">${esc(c.contact)}</a>.</p>
      <h2>${esc(l.siteH)}</h2>
      <p>${esc(l.siteP1)}</p>
      <p>${esc(l.siteP2)}</p>
      <h2>${esc(l.appH)}</h2>
      <p>${esc(l.appP)}</p>
      <ul>${l.appLi.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      <h2>${esc(l.rightsH)}</h2>
      <p>${esc(l.rightsP)}</p>
    </div>
  </main>
  ${footer(c, 'privacy.html')}
</body>
</html>
`;
}

export { ICON };
