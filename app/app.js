// LBZ aplikácia – hlavná časť (prihlásenie, roly, menu modulov)
// Ostrý režim: Supabase (e-mail + heslo). Kto sa raz prihlási, ostáva prihlásený.
// Bez nastavenia v config.js beží ukážkový režim s vymyslenými údajmi.

(function () {
  "use strict";

  var VERZIA = "0.6 BETA";

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
  function skladZapnuty() { return !!(SKLAD && SKLAD.zapnute()); }

  // ---------- prihlásenie ----------
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

  function render() {
    if (stav.rola) renderApp(); else renderLogin();
    var sk = document.getElementById("sklad-root");
    if (sk && SKLAD) SKLAD.mount(sk, sk.getAttribute("data-modul"));
  }

  // ---------- udalosti ----------
  root.addEventListener("click", function (e) {
    var t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.demo) { stav.rola = t.dataset.demo; stav.pouzivatel = "Ukážka – " + ROLY[t.dataset.demo].nazov; stav.modul = "prehlad"; render(); return; }
    if (t.dataset.login) { stav.login = t.dataset.login; stav.sprava = null; render(); return; }
    if (t.dataset.mod) { stav.modul = t.dataset.mod; stav.sprava = null; render(); window.scrollTo(0, 0); return; }
    if (t.id === "btn-odhlasit" || t.id === "btn-odhlasit-m") {
      if (OSTRY) db.auth.signOut();
      stav.rola = null; stav.pouzivatel = null; stav.modul = "prehlad"; stav.dbModuly = null; stav.login = "prihlasenie"; stav.sprava = null;
      if (SKLAD && SKLAD.nastavDb) SKLAD.nastavDb(null, null);
      render();
    }
  });

  root.addEventListener("submit", function (e) {
    var f = e.target;
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

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    // nová verzia appky sa zistí pri otvorení; po jej zapnutí sa stránka raz obnoví
    var malKontrolera = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", function () { if (malKontrolera) location.reload(); });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(function (reg) {
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") reg.update(); });
    }).catch(function () {});
  }
})();
