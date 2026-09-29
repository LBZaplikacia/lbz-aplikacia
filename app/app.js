// LBZ aplikácia – hlavná časť (prihlásenie, roly, menu modulov)
// Ostrý režim: Supabase (e-mail + heslo). Kto sa raz prihlási, ostáva prihlásený.
// Bez nastavenia v config.js beží ukážkový režim s vymyslenými údajmi.

(function () {
  "use strict";

  var VERZIA = "0.9 BETA";

  // ---------- roly a moduly (v ostrom režime prídu z databázy: rpc('moje_moduly')) ----------
  var ROLY = {
    it:                { nazov: "IT (správca)" },
    ceo:               { nazov: "CEO" },
    uctovnicka:        { nazov: "Účtovníčka / mzdárka" },
    prevadzka:         { nazov: "Zamestnanec prevádzky" },
    furman:            { nazov: "Furman (vodič)" },
    zakaznicky_servis: { nazov: "Zákaznícky servis" },
    zakaznik:          { nazov: "Zákazník" }
  };

  var MODULY = [
    { kod: "prehlad",         nazov: "Prehľad",                 aktivny: true },
    { kod: "sklad",           nazov: "Sklad" },
    { kod: "furmanky",        nazov: "Furmanky" },
    { kod: "balenie",         nazov: "Balenie a štítky" },
    { kod: "trasa",           nazov: "Moja trasa" },
    { kod: "dochadzka",       nazov: "Dochádzka a smeny" },
    { kod: "kniha_jazd",      nazov: "Kniha jázd" },
    { kod: "objednavky",      nazov: "Objednávky" },
    { kod: "komentare",       nazov: "Komentáre FB/IG" },
    { kod: "zamestnanci",     nazov: "Zamestnanci" },
    { kod: "exporty",         nazov: "Exporty pre účtovníctvo" },
    { kod: "moje_objednavky", nazov: "Moje objednávky" },
    { kod: "sledovanie",      nazov: "Kde je moja furmanka" },
    { kod: "nastavenia",      nazov: "Nastavenia",              aktivny: true }
  ];

  var PRISTUPY = {
    it: MODULY.map(function (m) { return m.kod; }),
    ceo: MODULY.map(function (m) { return m.kod; }),
    prevadzka: ["prehlad", "sklad", "furmanky", "balenie", "dochadzka", "kniha_jazd", "nastavenia"],
    furman: ["prehlad", "trasa", "furmanky", "dochadzka", "kniha_jazd", "nastavenia"],
    zakaznicky_servis: ["prehlad", "objednavky", "furmanky", "komentare", "nastavenia"],
    uctovnicka: ["prehlad", "dochadzka", "zamestnanci", "exporty", "nastavenia"],
    zakaznik: ["prehlad", "moje_objednavky", "sledovanie", "nastavenia"]
  };

  var UKAZKA = {
    trasy: [
      { nazov: "Južná", zastavky: 14, stav: "balí sa" },
      { nazov: "Stredná", zastavky: 9, stav: "zabalené" },
      { nazov: "Košická", zastavky: 11, stav: "na ceste" }
    ]
  };

  var cfg = window.LBZ_CONFIG || {};
  var OSTRY = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  var db = OSTRY ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;
  var SKLAD = window.LBZ_SKLAD || null;

  var stav = {
    pouzivatel: null, email: null, rola: null, modul: "prehlad",
    dbModuly: null,          // moduly z databázy (ostrý režim)
    login: "prihlasenie",    // prihlasenie | zabudnute | nove_heslo
    sprava: null,            // { typ: ok|chyba, text }
    nacitavam: OSTRY         // pri štarte čakáme na reláciu
  };
  var root = document.getElementById("app");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function el(html) { root.innerHTML = html; }
  function spravaHtml() {
    return stav.sprava ? '<p class="login-sprava ' + (stav.sprava.typ === "ok" ? "ok" : "chyba") + '" role="status">' + esc(stav.sprava.text) + "</p>" : "";
  }
  function interny() { return ["it", "ceo", "prevadzka", "furman", "zakaznicky_servis"].indexOf(stav.rola) > -1; }
  function spravca() { return stav.rola === "it" || stav.rola === "ceo"; }

  // ---------- Používatelia (IT a CEO) ----------
  // E-mail + rola sa uloží vopred; pri prvom prihlásení (Google alebo e-mail) dostane človek túto rolu sám.
  function nacitajPouzivatelov() {
    if (!OSTRY || !spravca() || stav.nacitavamPouz) return;
    stav.nacitavamPouz = true;
    db.rpc("pouzivatelia").then(function (r) {
      stav.nacitavamPouz = false;
      stav.pouzivatelia = r.error ? [] : (r.data || []);
      if (stav.modul === "nastavenia") render();
    });
  }
  function moznostiRol(vybrana) {
    return Object.keys(ROLY).map(function (k) {
      return '<option value="' + k + '"' + (k === vybrana ? " selected" : "") + ">" + esc(ROLY[k].nazov) + "</option>";
    }).join("");
  }
  function kartaPouzivatelia() {
    if (!stav.pouzivatelia) { nacitajPouzivatelov(); }
    var zoznam = stav.pouzivatelia || [];
    var ps = stav.spravaPouz ? '<p class="login-sprava ' + (stav.spravaPouz.typ === "ok" ? "ok" : "chyba") + '" role="status">' + esc(stav.spravaPouz.text) + "</p>" : "";
    return '<section class="card pouz-karta"><h3>Používatelia <span class="pill ok num">' + zoznam.length + "</span></h3>" +
      '<p class="muted" style="margin:0;font-size:14px">Pridajte e-mail a rolu. Človek sa potom prihlási cez Google (alebo e-mailom) a rolu dostane automaticky.</p>' +
      '<form id="f-pouzivatel" class="pouz-form">' +
        '<input id="in-p-meno" placeholder="Priezvisko Meno" autocomplete="off">' +
        '<input id="in-p-email" type="email" placeholder="e-mail" autocomplete="off" required>' +
        '<select id="in-p-rola">' + moznostiRol("prevadzka") + "</select>" +
        '<button class="btn btn-primary" type="submit">Pridať</button></form>' + ps +
      (stav.pouzivatelia === null || stav.pouzivatelia === undefined ? '<p class="muted" style="margin:0">Načítavam…</p>' :
        '<div class="pouz-zoznam">' + zoznam.map(function (u) {
          return '<div class="pouz-riadok' + (u.aktivny ? "" : " pouz-vyp") + '">' +
            '<span class="pouz-meno"><strong>' + esc(u.meno || u.email) + '</strong><span class="muted">' + esc(u.email) + " · " +
              (u.posledne_prihlasenie ? "prihlásený " + new Date(u.posledne_prihlasenie).toLocaleDateString("sk-SK") : u.ucet ? "účet založený" : "ešte sa neprihlásil") + "</span></span>" +
            '<select data-pouz-rola="' + esc(u.email) + '" aria-label="Rola">' + moznostiRol(u.rola) + "</select>" +
            '<label class="pouz-akt"><input type="checkbox" data-pouz-akt="' + esc(u.email) + '"' + (u.aktivny ? " checked" : "") + "> aktívny</label></div>";
        }).join("") + "</div>") + "</section>";
  }
  function ulozPouzivatela(email, meno, rola, aktivny) {
    return db.rpc("nastav_pouzivatela", { p_email: email, p_meno: meno || null, p_rola: rola, p_aktivny: aktivny }).then(function (r) {
      var res = r.data || {};
      stav.spravaPouz = { typ: res.ok ? "ok" : "chyba", text: res.ok ? email + " – uložené" : (res.text || "Neuložené") };
      stav.pouzivatelia = null; render();
      return res.ok;
    });
  }
  root.addEventListener("change", function (e) {
    var t = e.target, d = t.dataset;
    if (!d || !(d.pouzRola || d.pouzAkt)) return;
    var email = d.pouzRola || d.pouzAkt;
    var u = (stav.pouzivatelia || []).filter(function (x) { return x.email === email; })[0]; if (!u) return;
    ulozPouzivatela(email, null, d.pouzRola ? t.value : u.rola, d.pouzAkt ? t.checked : u.aktivny);
  });

  function skladZapnuty() { return !!(SKLAD && SKLAD.zapnute()); }

  // ---------- prihlásenie ----------
  var GOOGLE_IKONA = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';

  function renderLogin() {
    var hlavicka = '<div class="brand"><img class="brand-mark" src="icons/logo.svg" alt="">' +
      '<div><h1>Legendárne buchty <span class="beta">BETA</span></h1><p>Aplikácia pre tím a zákazníkov – testovacia verzia</p></div></div>';

    if (stav.nacitavam) {
      el('<main class="login"><div class="login-card">' + hlavicka + '<div class="panel"><p class="muted" style="margin:0">Načítavam…</p></div></div></main>');
      return;
    }

    if (!OSTRY) {
      el('<main class="login"><div class="login-card">' + hlavicka +
        '<div class="demo"><strong>Ukážkový režim</strong>' +
        '<span style="font-size:14px">Databáza nie je pripojená. Vyberte rolu a pozrite si, čo daná osoba uvidí.</span>' +
        '<div class="chips">' + Object.keys(ROLY).map(function (k) {
          return '<button class="chip" data-demo="' + k + '">' + esc(ROLY[k].nazov) + "</button>";
        }).join("") + "</div></div></div></main>");
      return;
    }

    var obsah;
    if (stav.login === "zabudnute") {
      obsah = '<form class="panel" id="f-zabudnute">' +
        '<h2 style="font-size:20px">Zabudnuté heslo</h2>' +
        '<p class="muted" style="margin:0;font-size:14px">Pošleme vám e-mail s odkazom na nastavenie nového hesla.</p>' +
        '<label class="field"><span class="label">E-mail</span><input id="in-email" type="email" autocomplete="email" required></label>' +
        spravaHtml() +
        '<button class="btn btn-primary" type="submit">Poslať odkaz</button>' +
        '<button class="btn" type="button" data-login="prihlasenie">Späť na prihlásenie</button></form>';
    } else if (stav.login === "nove_heslo") {
      obsah = '<form class="panel" id="f-nove-heslo">' +
        '<h2 style="font-size:20px">Nové heslo</h2>' +
        '<label class="field"><span class="label">Nové heslo (aspoň 6 znakov)</span><input id="in-heslo1" type="password" autocomplete="new-password" minlength="6" required></label>' +
        '<label class="field"><span class="label">Nové heslo ešte raz</span><input id="in-heslo2" type="password" autocomplete="new-password" minlength="6" required></label>' +
        spravaHtml() +
        '<button class="btn btn-primary" type="submit">Uložiť heslo</button></form>';
    } else {
      obsah = '<form class="panel" id="f-prihlasenie">' +
        (cfg.googleLogin ? '<div id="g-tlacidlo" class="g-tlacidlo">' + (gNonce ? "" : '<button class="btn btn-google" type="button" data-login="google">' + GOOGLE_IKONA + "Prihlásiť sa cez Google</button>") + "</div>" +
          '<div class="divider">alebo e-mailom</div>' : "") +
        '<label class="field"><span class="label">E-mail</span><input id="in-email" type="email" autocomplete="username" placeholder="meno@legendarnebuchty.sk" required></label>' +
        '<label class="field"><span class="label">Heslo</span><input id="in-heslo" type="password" autocomplete="current-password" required></label>' +
        spravaHtml() +
        '<button class="btn btn-primary" type="submit">Prihlásiť sa</button>' +
        '<button class="btn-link" type="button" data-login="zabudnute">Zabudli ste heslo?</button>' +
        '<p class="muted" style="margin:0;font-size:13px">Po prihlásení ostanete prihlásení aj po zatvorení appky.</p></form>';
    }
    el('<main class="login"><div class="login-card">' + hlavicka + obsah + "</div></main>");
  }

  // ---------- appka ----------
  function mojeModuly() {
    var zoznam;
    if (OSTRY && stav.dbModuly) {
      zoznam = stav.dbModuly.map(function (m) { return { kod: m.kod, nazov: m.nazov, aktivny: m.aktivny }; });
    } else {
      var povolene = PRISTUPY[stav.rola] || [];
      zoznam = MODULY.filter(function (m) { return povolene.indexOf(m.kod) !== -1; })
        .map(function (m) { return { kod: m.kod, nazov: m.nazov, aktivny: !!m.aktivny }; });
    }
    zoznam.forEach(function (m) {
      if (m.kod === "sklad" || m.kod === "furmanky") m.aktivny = skladZapnuty();
    });
    return zoznam;
  }

  function renderApp() {
    var moduly = mojeModuly();
    if (!moduly.some(function (m) { return m.kod === stav.modul; })) stav.modul = "prehlad";
    var nav = moduly.map(function (m) {
      return '<button data-mod="' + m.kod + '"' + (stav.modul === m.kod ? ' aria-current="page"' : "") + ">" +
        "<span>" + esc(m.nazov) + "</span>" + (m.aktivny ? "" : '<span class="soon">čoskoro</span>') + "</button>";
    }).join("");
    var bottom = moduly.filter(function (m) { return m.kod !== "nastavenia"; }).map(function (m) {
      return '<button data-mod="' + m.kod + '"' + (stav.modul === m.kod ? ' aria-current="page"' : "") + ">" + esc(m.nazov) + "</button>";
    }).join("");
    var rolaNazov = (ROLY[stav.rola] || {}).nazov || stav.rola;

    el(
      '<div class="shell">' +
        '<aside class="side"><div class="brand"><img class="brand-mark" src="icons/logo.svg" alt="">' +
          '<div><h1 style="font-size:18px">Legendárne buchty <span class="beta">BETA</span></h1><p>' + esc(rolaNazov) + "</p></div></div>" +
          '<nav class="nav" aria-label="Moduly">' + nav + "</nav>" +
          '<div class="who"><span>' + esc(stav.pouzivatel) + '</span><span class="muted" style="font-size:12px">verzia ' + VERZIA + '</span>' +
          '<button class="btn" id="btn-odhlasit">Odhlásiť</button></div>' +
        "</aside>" +
        '<main class="main">' +
          '<div class="mtop"><div class="brand"><img class="brand-mark" src="icons/logo.svg" alt=""><strong>' + esc(rolaNazov) + ' <span class="beta">BETA</span></strong></div>' +
            '<button class="btn" data-mod="nastavenia">Účet</button></div>' +
          obsahModulu() +
        "</main>" +
        '<nav class="bottom" aria-label="Moduly">' + bottom + "</nav>" +
      "</div>"
    );
  }

  function hlavicka(nadpis, podnadpis) {
    return '<div class="head"><div><div class="label">' + esc(podnadpis) + '</div><h2>' + esc(nadpis) + "</h2></div>" +
      (OSTRY ? "" : '<span class="badge-demo">ukážkové údaje</span>') + "</div>";
  }

  function kartaFurmanky() {
    if (skladZapnuty()) return SKLAD.kartaFurmanky();
    return '<section class="card"><h3>Furmanky dnes <span class="pill ok">' + UKAZKA.trasy.length + " trasy</span></h3><div class=\"rows\">" +
      UKAZKA.trasy.map(function (t) {
        return '<div class="row"><span>' + esc(t.nazov) + ' <span class="muted num">· ' + t.zastavky + ' zastávok</span></span><span class="pill ok">' + esc(t.stav) + "</span></div>";
      }).join("") + "</div></section>";
  }
  function kartaSklad() {
    if (skladZapnuty()) return SKLAD.kartaSklad();
    return '<section class="card"><h3>Sklad</h3><p class="muted" style="margin:0">Ukážkový režim.</p></section>';
  }
  function kartaPripravujeme(nazov, text) {
    return '<section class="card"><h3>' + esc(nazov) + ' <span class="soon">čoskoro</span></h3><p class="muted" style="margin:0">' + esc(text) + "</p></section>";
  }

  function obsahModulu() {
    var r = stav.rola;
    if (stav.modul === "prehlad") {
      if (r === "zakaznik") {
        return hlavicka("Dobrý deň!", "Legendárne buchty") +
          '<div class="empty"><strong>Zákaznícka časť sa pripravuje</strong>' +
          '<span class="muted">Zatiaľ nakupujte v e-shope.</span>' +
          '<a class="btn btn-primary" href="https://www.legendarnebuchty.sk" target="_blank" rel="noopener">Otvoriť e-shop</a></div>';
      }
      var karty = [];
      var kody = mojeModuly().map(function (m) { return m.kod; });
      if (kody.indexOf("sklad") > -1) karty.push(kartaSklad());
      if (kody.indexOf("furmanky") > -1) karty.push(kartaFurmanky());
      if (kody.indexOf("dochadzka") > -1) karty.push(kartaPripravujeme("Dochádzka a smeny", "Príchod, odchod, rozpis práce."));
      if (kody.indexOf("zamestnanci") > -1) karty.push(kartaPripravujeme("Zamestnanci", "Karty zamestnancov, dokumenty, výplatné pásky."));
      var dnes = new Date().toLocaleDateString("sk-SK", { weekday: "long", day: "numeric", month: "numeric" });
      return hlavicka("Dnes, " + dnes, "Prehľad") + '<div class="grid">' + karty.join("") + "</div>";
    }
    if (stav.modul === "nastavenia") {
      return hlavicka("Môj účet", "Nastavenia") +
        '<section class="card" style="max-width:520px"><h3>Prihlásený</h3>' +
          '<div class="rows"><div class="row"><span>Meno</span><span>' + esc(stav.pouzivatel) + '</span></div>' +
          '<div class="row"><span>E-mail</span><span>' + esc(stav.email || "") + '</span></div>' +
          '<div class="row"><span>Rola</span><span>' + esc((ROLY[r] || {}).nazov || r) + "</span></div></div></section>" +
        (OSTRY ? '<form class="card" id="f-zmena-hesla" style="max-width:520px"><h3>Zmeniť heslo</h3>' +
          '<label class="field"><span class="label">Nové heslo (aspoň 6 znakov)</span><input id="in-heslo1" type="password" autocomplete="new-password" minlength="6" required></label>' +
          '<label class="field"><span class="label">Nové heslo ešte raz</span><input id="in-heslo2" type="password" autocomplete="new-password" minlength="6" required></label>' +
          spravaHtml() +
          '<button class="btn btn-primary" type="submit">Uložiť nové heslo</button></form>' : "") +
        (OSTRY && spravca() ? kartaPouzivatelia() : "") +
        '<button class="btn" id="btn-odhlasit-m" style="max-width:520px">Odhlásiť sa</button>';
    }
    if (skladZapnuty() && (stav.modul === "sklad" || stav.modul === "furmanky")) {
      return '<div id="sklad-root" data-modul="' + stav.modul + '"></div>';
    }
    var m = mojeModuly().filter(function (x) { return x.kod === stav.modul; })[0] || { nazov: stav.modul };
    return hlavicka(m.nazov, "Modul") +
      '<div class="empty"><strong>Tento modul ešte pripravujeme</strong>' +
      '<span class="muted">Kým nebude hotový, funguje pôvodný nástroj. Moduly pribúdajú postupne, po jednom.</span></div>';
  }

  // ---------- Google priamo v appke (Google Identity Services) ----------
  // Okno Googlu potom ukazuje adresu appky, nie adresu Supabase. Ak sa knižnica Googlu
  // nenačíta, ostane záložné tlačidlo s presmerovaním cez Supabase.
  var gNonce = null, gPripraveny = false;
  function hexSha256(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    });
  }
  function pripravGoogle() {
    if (!OSTRY || !cfg.googleLogin || !cfg.googleClientId || gPripraveny || !window.crypto || !crypto.subtle) return;
    gPripraveny = true;
    var raw = Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(16)), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    var sc = document.createElement("script");
    sc.src = "https://accounts.google.com/gsi/client"; sc.async = true;
    sc.onload = function () {
      hexSha256(raw).then(function (hash) {
        google.accounts.id.initialize({
          client_id: cfg.googleClientId,
          nonce: hash,
          use_fedcm_for_prompt: true,
          callback: function (odpoved) {
            stav.sprava = { typ: "ok", text: "Prihlasujem…" }; render();
            db.auth.signInWithIdToken({ provider: "google", token: odpoved.credential, nonce: raw }).then(function (res) {
              if (res.error) { stav.sprava = { typ: "chyba", text: "Prihlásenie cez Google sa nepodarilo. Skúste znova alebo e-mail a heslo." }; render(); }
            });
          }
        });
        gNonce = raw;
        vykresliGoogle();
      });
    };
    document.head.appendChild(sc);
  }
  function vykresliGoogle() {
    var el = document.getElementById("g-tlacidlo");
    if (!el || !gNonce || !window.google || !google.accounts) return;
    el.innerHTML = "";
    google.accounts.id.renderButton(el, { type: "standard", theme: "outline", size: "large", text: "signin_with", shape: "rectangular", locale: "sk", logo_alignment: "center", width: Math.min(360, el.clientWidth || 320) });
  }

  function render() {
    if (stav.rola) renderApp(); else { renderLogin(); vykresliGoogle(); }
    var sk = document.getElementById("sklad-root");
    if (sk && SKLAD) SKLAD.mount(sk, sk.getAttribute("data-modul"));
  }

  // ---------- udalosti ----------
  root.addEventListener("click", function (e) {
    var t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.demo) { stav.rola = t.dataset.demo; stav.pouzivatel = "Ukážka – " + ROLY[t.dataset.demo].nazov; stav.modul = "prehlad"; render(); return; }
    if (t.dataset.login === "google") {
      // Google vráti používateľa späť na túto adresu; reláciu z adresy prevezme knižnica sama
      t.disabled = true;
      db.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: "select_account" } } })
        .then(function (res) { if (res.error) { stav.sprava = { typ: "chyba", text: "Prihlásenie cez Google teraz nejde. Skúste e-mail a heslo." }; render(); } });
      return;
    }
    if (t.dataset.login) { stav.login = t.dataset.login; stav.sprava = null; render(); return; }
    if (t.dataset.mod) { stav.modul = t.dataset.mod; stav.sprava = null; stav.spravaPouz = null; if (t.dataset.mod === "nastavenia") stav.pouzivatelia = null; render(); window.scrollTo(0, 0); return; }
    if (t.id === "btn-odhlasit" || t.id === "btn-odhlasit-m") {
      if (OSTRY) db.auth.signOut();
      stav.rola = null; stav.pouzivatel = null; stav.modul = "prehlad"; stav.dbModuly = null; stav.login = "prihlasenie"; stav.sprava = null;
      if (SKLAD && SKLAD.nastavDb) SKLAD.nastavDb(null, null);
      render();
    }
  });

  root.addEventListener("submit", function (e) {
    var f = e.target;
    if (f.id === "f-pouzivatel") {
      e.preventDefault();
      ulozPouzivatela(document.getElementById("in-p-email").value, document.getElementById("in-p-meno").value, document.getElementById("in-p-rola").value, true);
      return;
    }
    if (["f-prihlasenie", "f-zabudnute", "f-nove-heslo", "f-zmena-hesla"].indexOf(f.id) === -1) return; // ostatné formuláre si obsluhujú moduly
    e.preventDefault();
    var tlacidlo = f.querySelector('button[type="submit"]'); if (tlacidlo) tlacidlo.disabled = true;
    var hotovo = function (typ, text) { stav.sprava = { typ: typ, text: text }; render(); };

    if (f.id === "f-prihlasenie") {
      var email = document.getElementById("in-email").value.trim();
      db.auth.signInWithPassword({ email: email, password: document.getElementById("in-heslo").value }).then(function (res) {
        if (res.error) hotovo("chyba", "Nesprávny e-mail alebo heslo.");
        else stav.sprava = null; // zvyšok spraví onAuthStateChange
      });
    } else if (f.id === "f-zabudnute") {
      var mail = document.getElementById("in-email").value.trim();
      db.auth.resetPasswordForEmail(mail, { redirectTo: location.origin + location.pathname }).then(function (res) {
        hotovo(res.error ? "chyba" : "ok", res.error ? "E-mail sa nepodarilo odoslať, skúste to o chvíľu." : "Ak účet existuje, odkaz na nové heslo sme poslali na " + mail + ".");
      });
    } else {
      var h1 = document.getElementById("in-heslo1").value, h2 = document.getElementById("in-heslo2").value;
      if (h1 !== h2) { hotovo("chyba", "Heslá sa nezhodujú."); return; }
      db.auth.updateUser({ password: h1 }).then(function (res) {
        if (res.error) { hotovo("chyba", "Heslo sa nepodarilo uložiť (aspoň 6 znakov)."); return; }
        if (f.id === "f-nove-heslo") stav.login = "prihlasenie";
        hotovo("ok", "Heslo je zmenené.");
      });
    }
  });

  // ---------- ostrý režim: relácia, rola a moduly ----------
  function nacitajPouzivatela(session) {
    if (!session) {
      stav.rola = null; stav.dbModuly = null; stav.nacitavam = false; stav.uid = null;
      if (SKLAD && SKLAD.nastavDb) SKLAD.nastavDb(null, null);
      render(); return;
    }
    stav.email = session.user.email; stav.uid = session.user.id;
    Promise.all([
      db.from("profily").select("meno, rola, aktivny").eq("id", session.user.id).single(),
      db.rpc("moje_moduly")
    ]).then(function (v) {
      var p = v[0].data;
      stav.nacitavam = false;
      if (!p || !p.aktivny) { stav.rola = null; stav.sprava = { typ: "chyba", text: "Účet nie je aktívny. Kontaktujte vedenie." }; db.auth.signOut(); render(); return; }
      stav.rola = p.rola; stav.pouzivatel = p.meno || session.user.email;
      stav.dbModuly = v[1].data || [];
      if (SKLAD && SKLAD.nastavDb) SKLAD.nastavDb(interny() ? db : null, stav.rola);
      render();
    }).catch(function () { stav.nacitavam = false; stav.sprava = { typ: "chyba", text: "Bez spojenia so serverom." }; render(); });
  }

  if (OSTRY && /error_description=/.test(location.hash + location.search)) {
    stav.sprava = { typ: "chyba", text: "Prihlásenie cez Google sa nepodarilo. Skúste znova alebo e-mail a heslo." };
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
  }

  if (OSTRY) {
    db.auth.onAuthStateChange(function (udalost, session) {
      if (udalost === "PASSWORD_RECOVERY") { stav.login = "nove_heslo"; stav.rola = null; stav.nacitavam = false; render(); return; }
      if (udalost === "INITIAL_SESSION" || udalost === "SIGNED_IN" || udalost === "SIGNED_OUT") {
        if (stav.login === "nove_heslo" && udalost === "SIGNED_IN") return;
        // SIGNED_IN prichádza aj pri návrate do appky – ak je to ten istý používateľ, nič neprekresľujeme (nevypne sa kamera)
        if (udalost === "SIGNED_IN" && session && stav.uid === session.user.id && stav.rola) return;
        setTimeout(function () { nacitajPouzivatela(session); }, 0);
      }
    });
  }

  render();
  pripravGoogle();

  // pás „Bez signálu“ nad celou appkou (údaje sa neobnovujú)
  function pasSignalu() {
    var el = document.getElementById("offline-pas");
    if (navigator.onLine === false) {
      if (!el) { el = document.createElement("div"); el.id = "offline-pas"; el.setAttribute("role", "alert"); document.body.appendChild(el); }
      el.textContent = "⚠️ Bez signálu – údaje v appke nemusia byť aktuálne.";
      document.body.classList.add("bez-signalu");
    } else { if (el) el.remove(); document.body.classList.remove("bez-signalu"); }
  }
  window.addEventListener("online", pasSignalu);
  window.addEventListener("offline", pasSignalu);
  pasSignalu();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    // nová verzia appky sa zistí pri otvorení; po jej zapnutí sa stránka raz obnoví
    var malKontrolera = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", function () { if (malKontrolera) location.reload(); });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(function (reg) {
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") reg.update(); });
    }).catch(function () {});
  }
})();
