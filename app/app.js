// LBZ aplikácia – kostra v0.1
// Jedna appka pre všetky roly: každý po prihlásení vidí len svoje moduly.
// Bez nastavenia v config.js beží v ukážkovom režime s vymyslenými údajmi.

(function () {
  "use strict";

  // ---------- roly a moduly (v ostrom režime prídu z databázy: rpc('moje_moduly')) ----------
  var ROLY = {
    manazer:           { nazov: "Manažér", interna: true },
    prevadzka:         { nazov: "Zamestnanec prevádzky", interna: true },
    vodic:             { nazov: "Vodič furmaniek", interna: true },
    zakaznicky_servis: { nazov: "Zákaznícky servis", interna: true },
    mzdarka:           { nazov: "Mzdárka / účtovníčka", interna: false },
    zakaznik:          { nazov: "Zákazník", interna: false }
  };

  var MODULY = [
    { kod: "prehlad",         nazov: "Prehľad",                 aktivny: true },
    { kod: "furmanky",        nazov: "Furmanky" },
    { kod: "sklad",           nazov: "Sklad" },
    { kod: "balenie",         nazov: "Balenie a štítky" },
    { kod: "dochadzka",       nazov: "Dochádzka a smeny" },
    { kod: "kniha_jazd",      nazov: "Kniha jázd" },
    { kod: "objednavky",      nazov: "Objednávky" },
    { kod: "komentare",       nazov: "Komentáre FB/IG" },
    { kod: "personalna",      nazov: "Personálna agenda" },
    { kod: "exporty",         nazov: "Exporty pre účtovníctvo" },
    { kod: "moje_objednavky", nazov: "Moje objednávky" },
    { kod: "sledovanie",      nazov: "Kde je moja furmanka" },
    { kod: "predplatne",      nazov: "Buchtové predplatné" },
    { kod: "vernost",         nazov: "Vernostné body" },
    { kod: "nastavenia",      nazov: "Nastavenia", aktivny: true }
  ];

  var PRISTUPY = {
    manazer: MODULY.map(function (m) { return m.kod; }),
    prevadzka: ["prehlad", "furmanky", "sklad", "balenie", "dochadzka", "kniha_jazd"],
    vodic: ["prehlad", "furmanky", "dochadzka", "kniha_jazd"],
    zakaznicky_servis: ["prehlad", "objednavky", "komentare"],
    mzdarka: ["prehlad", "dochadzka", "personalna", "exporty"],
    zakaznik: ["prehlad", "moje_objednavky", "sledovanie", "predplatne", "vernost"]
  };

  // ---------- ukážkové údaje (vymyslené, len na predvedenie rozloženia) ----------
  var UKAZKA = {
    trasy: [
      { nazov: "Južná", zastavky: 14, stav: "balí sa" },
      { nazov: "Stredná", zastavky: 9, stav: "zabalené" },
      { nazov: "Košická", zastavky: 11, stav: "na ceste" }
    ],
    sklad: [
      { nazov: "Buchty s tvarohom (mrazené)", ks: 180, min: 120 },
      { nazov: "Buchty s lekvárom (mrazené)", ks: 64, min: 120 },
      { nazov: "Buchty s makom (mrazené)", ks: 132, min: 100 },
      { nazov: "Buchty s orechmi (mrazené)", ks: 41, min: 80 }
    ],
    smena: [
      { pozicia: "Pečenie", ludia: 3, prisli: 3 },
      { pozicia: "Bar", ludia: 1, prisli: 1 },
      { pozicia: "Rozvoz", ludia: 2, prisli: 1 },
      { pozicia: "Obchod", ludia: 1, prisli: 1 }
    ],
    jazdy: { mesiac: "september", km: 2140, zapisane: 18, chyba: 2 },
    objednavky: { nove: 23, na_zaplatenie: 4, reklamacie: 1 },
    komentare: { caka: 7, citlive: 1 },
    zakaznik: { furmanka: "Stredná", den: "štvrtok 1. 10.", okno: "14:00 – 16:00", body: 340 }
  };

  var cfg = window.LBZ_CONFIG || {};
  var OSTRY = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  // Sklad a furmanky bežia naostro, keď je v config.js adresa skladového Apps Scriptu
  var SKLAD = window.LBZ_SKLAD && window.LBZ_SKLAD.zapnute() ? window.LBZ_SKLAD : null;
  if (SKLAD) MODULY.forEach(function (m) { if (m.kod === "sklad" || m.kod === "furmanky") m.aktivny = true; });
  var db = OSTRY ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

  var stav = { pouzivatel: null, rola: null, modul: "prehlad", loginTab: SKLAD && !OSTRY ? "pin" : "ucet", pin: "" };
  var root = document.getElementById("app");

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function el(html) { root.innerHTML = html; }

  // ---------- prihlásenie ----------
  function renderLogin() {
    var ucet = stav.loginTab === "ucet";
    var dots = "";
    for (var i = 0; i < 4; i++) dots += '<span class="' + (i < stav.pin.length ? "on" : "") + '"></span>';
    var keys = ["1","2","3","4","5","6","7","8","9","","0","⌫"].map(function (k) {
      return k === "" ? "<span></span>" : '<button type="button" data-pin="' + k + '" aria-label="' + (k === "⌫" ? "Zmazať" : k) + '">' + k + "</button>";
    }).join("");

    el(
      '<main class="login"><div class="login-card">' +
        '<div class="brand"><img class="brand-mark" src="icons/logo.svg" alt="">' +
          '<div><h1>Legendárne buchty</h1><p>Aplikácia pre tím a zákazníkov</p></div></div>' +
        '<div class="tabs" role="tablist">' +
          '<button role="tab" id="tab-ucet" aria-selected="' + ucet + '" data-tab="ucet">Môj účet</button>' +
          '<button role="tab" id="tab-pin" aria-selected="' + !ucet + '" data-tab="pin">Tablet na prevádzke</button>' +
        "</div>" +
        (ucet
          ? '<form class="panel" id="f-ucet">' +
              '<button type="button" class="btn" id="btn-google">Prihlásiť sa cez Google</button>' +
              '<div class="divider">alebo e-mailom</div>' +
              '<label class="field"><span class="label">E-mail</span><input id="in-email" type="email" autocomplete="email" placeholder="meno@firma.sk" required></label>' +
              '<button class="btn btn-primary" type="submit">Poslať prihlasovací odkaz</button>' +
              '<p class="muted" style="margin:0;font-size:14px">Odkaz na prihlásenie príde e-mailom, heslo si netreba pamätať.</p>' +
            "</form>"
          : '<div class="panel"><p style="margin:0">Zadajte svoj 4-miestny PIN</p>' +
              '<div class="pin-dots" aria-live="polite">' + dots + "</div>" +
              '<div class="pinpad">' + keys + "</div></div>") +
        (OSTRY ? "" :
          '<div class="demo"><strong>Ukážkový režim</strong>' +
          '<span style="font-size:14px">Databáza ešte nie je pripojená. Vyberte rolu a pozrite si, čo daná osoba uvidí.</span>' +
          '<div class="chips">' + Object.keys(ROLY).map(function (k) {
            return '<button class="chip" data-demo="' + k + '">' + esc(ROLY[k].nazov) + "</button>";
          }).join("") + "</div></div>") +
      "</div></main>"
    );
  }

  // ---------- appka ----------
  function mojeModuly() {
    var povolene = PRISTUPY[stav.rola] || [];
    return MODULY.filter(function (m) { return povolene.indexOf(m.kod) !== -1; });
  }

  function renderApp() {
    var moduly = mojeModuly();
    var nav = moduly.map(function (m) {
      return '<button data-mod="' + m.kod + '"' + (stav.modul === m.kod ? ' aria-current="page"' : "") + ">" +
        "<span>" + esc(m.nazov) + "</span>" + (m.aktivny ? "" : '<span class="soon">čoskoro</span>') + "</button>";
    }).join("");
    var bottom = moduly.filter(function (m) { return m.kod !== "nastavenia"; }).map(function (m) {
      return '<button data-mod="' + m.kod + '"' + (stav.modul === m.kod ? ' aria-current="page"' : "") + ">" + esc(m.nazov) + "</button>";
    }).join("");

    el(
      '<div class="shell">' +
        '<aside class="side"><div class="brand"><img class="brand-mark" src="icons/logo.svg" alt="">' +
          '<div><h1 style="font-size:18px">Legendárne buchty</h1><p>' + esc(ROLY[stav.rola].nazov) + "</p></div></div>" +
          '<nav class="nav" aria-label="Moduly">' + nav + "</nav>" +
          '<div class="who"><span>' + esc(stav.pouzivatel) + '</span><span class="muted" style="font-size:12px">verzia 0.3</span><button class="btn" id="btn-odhlasit">Odhlásiť</button></div>' +
        "</aside>" +
        '<main class="main">' +
          '<div class="mtop"><div class="brand"><img class="brand-mark" src="icons/logo.svg" alt=""><strong>' + esc(ROLY[stav.rola].nazov) + '</strong></div>' +
            '<button class="btn" id="btn-odhlasit-m">Odhlásiť</button></div>' +
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
    if (SKLAD) return SKLAD.kartaFurmanky();
    return '<section class="card"><h3>Furmanky dnes <span class="pill ok">' + UKAZKA.trasy.length + " trasy</span></h3><div class=\"rows\">" +
      UKAZKA.trasy.map(function (t) {
        var cls = t.stav === "na ceste" ? "ok" : t.stav === "balí sa" ? "warn" : "ok";
        return '<div class="row"><span>' + esc(t.nazov) + ' <span class="muted num">· ' + t.zastavky + ' zastávok</span></span><span class="pill ' + cls + '">' + esc(t.stav) + "</span></div>";
      }).join("") + "</div></section>";
  }
  function kartaSklad() {
    if (SKLAD) return SKLAD.kartaSklad();
    var nizke = UKAZKA.sklad.filter(function (p) { return p.ks < p.min; }).length;
    return '<section class="card"><h3>Sklad <span class="pill ' + (nizke ? "warn" : "ok") + '">' + (nizke ? nizke + " dochádza" : "v poriadku") + "</span></h3>" +
      UKAZKA.sklad.map(function (p) {
        var pct = Math.min(100, Math.round(p.ks / (p.min * 2) * 100));
        return '<div style="display:grid;gap:4px"><div class="row" style="border:0;padding:0"><span>' + esc(p.nazov) + '</span><span class="num">' + p.ks + ' ks</span></div>' +
          '<div class="bar"><i class="' + (p.ks < p.min ? "low" : "") + '" style="width:' + pct + '%"></i></div></div>';
      }).join("") + "</section>";
  }
  function kartaDochadzka() {
    var spolu = 0, prisli = 0;
    UKAZKA.smena.forEach(function (s) { spolu += s.ludia; prisli += s.prisli; });
    return '<section class="card"><h3>Dochádzka dnes <span class="pill ' + (prisli < spolu ? "warn" : "ok") + '"><span class="num">' + prisli + "/" + spolu + '</span> v práci</span></h3><div class="rows">' +
      UKAZKA.smena.map(function (s) {
        return '<div class="row"><span>' + esc(s.pozicia) + '</span><span class="num">' + s.prisli + " / " + s.ludia + "</span></div>";
      }).join("") + "</div></section>";
  }
  function kartaJazdy() {
    var j = UKAZKA.jazdy;
    return '<section class="card"><h3>Kniha jázd <span class="pill ' + (j.chyba ? "warn" : "ok") + '">' + (j.chyba ? j.chyba + " na doplnenie" : "kompletná") + "</span></h3>" +
      '<div class="big num">' + j.km.toLocaleString("sk-SK") + ' km</div><div class="muted">' + esc(j.mesiac) + ' · <span class="num">' + j.zapisane + "</span> zapísaných jázd</div></section>";
  }
  function kartaObjednavky() {
    var o = UKAZKA.objednavky;
    return '<section class="card"><h3>Objednávky</h3><div class="rows">' +
      '<div class="row"><span>Nové</span><span class="num">' + o.nove + "</span></div>" +
      '<div class="row"><span>Čakajú na platbu</span><span class="num">' + o.na_zaplatenie + "</span></div>" +
      '<div class="row"><span>Reklamácie</span><span class="pill warn num">' + o.reklamacie + "</span></div></div></section>";
  }
  function kartaKomentare() {
    var k = UKAZKA.komentare;
    return '<section class="card"><h3>Komentáre FB/IG</h3><div class="big num">' + k.caka + '</div><div class="muted">čaká na odpoveď, z toho <strong>' + k.citlive + "</strong> citlivý na kontrolu</div></section>";
  }

  function obsahModulu() {
    var r = stav.rola;
    if (stav.modul === "prehlad") {
      if (r === "zakaznik") {
        var z = UKAZKA.zakaznik;
        return hlavicka("Dobrý deň!", "Váš prehľad") + '<div class="grid">' +
          '<section class="card"><h3>Najbližšia furmanka</h3><div class="big">' + esc(z.den) + '</div><div class="muted">trasa ' + esc(z.furmanka) + ", okno " + esc(z.okno) + "</div></section>" +
          '<section class="card"><h3>Vernostné body</h3><div class="big num">' + z.body + '</div><div class="muted">za nákupy v e-shope a na predajni</div></section>' +
          "</div>";
      }
      var karty = [];
      if (r === "manazer" || r === "prevadzka" || r === "vodic") karty.push(kartaFurmanky());
      if (r === "manazer" || r === "prevadzka") karty.push(kartaSklad());
      if (r === "manazer" || r === "prevadzka" || r === "vodic" || r === "mzdarka") karty.push(kartaDochadzka());
      if (r === "manazer" || r === "prevadzka" || r === "vodic") karty.push(kartaJazdy());
      if (r === "manazer" || r === "zakaznicky_servis") karty.push(kartaObjednavky(), kartaKomentare());
      var dnes = new Date().toLocaleDateString("sk-SK", { weekday: "long", day: "numeric", month: "numeric" });
      return hlavicka("Dnes, " + dnes, "Prehľad") + '<div class="grid">' + karty.join("") + "</div>";
    }
    if (stav.modul === "nastavenia") {
      return hlavicka("Nastavenia", "Používatelia a prístupy") +
        '<div class="empty"><strong>Tu bude správa používateľov</strong><span class="muted">Priradenie rolí, PIN pre tablet a zapnutie modulov pre jednotlivé roly.</span></div>';
    }
    if (SKLAD && (stav.modul === "sklad" || stav.modul === "furmanky")) {
      return '<div id="sklad-root" data-modul="' + stav.modul + '"></div>';
    }
    var m = MODULY.filter(function (x) { return x.kod === stav.modul; })[0];
    return hlavicka(m.nazov, "Modul") +
      '<div class="empty"><strong>Tento modul ešte preklápame</strong>' +
      '<span class="muted">Kým nebude hotový, funguje pôvodný nástroj (skener v Upgates, Google tabuľky). Moduly pribúdajú postupne, po jednom.</span></div>';
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
    if (t.dataset.tab) { stav.loginTab = t.dataset.tab; stav.pin = ""; render(); return; }
    if (t.dataset.demo) { stav.rola = t.dataset.demo; stav.pouzivatel = "Ukážka – " + ROLY[t.dataset.demo].nazov; stav.modul = "prehlad"; render(); return; }
    if (t.dataset.mod) { stav.modul = t.dataset.mod; render(); window.scrollTo(0, 0); return; }
    if (t.dataset.pin) {
      if (t.dataset.pin === "⌫") stav.pin = stav.pin.slice(0, -1);
      else if (stav.pin.length < 4) stav.pin += t.dataset.pin;
      if (stav.pin.length === 4 && !OSTRY) { stav.rola = "prevadzka"; stav.pouzivatel = SKLAD ? "Tablet na prevádzke" : "Ukážka – tablet"; stav.pin = ""; stav.modul = SKLAD ? "sklad" : "prehlad"; }
      // Ostrý režim: PIN overí Edge Function (doplní sa v ďalšom kroku).
      render(); return;
    }
    if (t.id === "btn-google") {
      if (OSTRY) db.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.href } });
      else { stav.rola = "manazer"; stav.pouzivatel = "Ukážka – manažér"; render(); }
      return;
    }
    if (t.id === "btn-odhlasit" || t.id === "btn-odhlasit-m") {
      if (OSTRY) db.auth.signOut();
      stav.rola = null; stav.pouzivatel = null; stav.modul = "prehlad"; render();
    }
  });

  root.addEventListener("submit", function (e) {
    if (e.target.id !== "f-ucet") return; // ostatné formuláre si obsluhujú moduly samy
    e.preventDefault();
    var email = document.getElementById("in-email").value.trim();
    if (OSTRY) {
      db.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.href } });
      alertBox("Poslali sme odkaz na " + email + ". Otvorte e-mail a kliknite naň.");
    } else {
      stav.rola = "zakaznik"; stav.pouzivatel = email || "Ukážka – zákazník"; render();
    }
  });

  function alertBox(text) {
    var p = document.createElement("p");
    p.className = "muted"; p.setAttribute("role", "status"); p.textContent = text;
    var f = document.getElementById("f-ucet"); if (f) f.appendChild(p);
  }

  // ---------- ostrý režim: načítať rolu prihláseného ----------
  if (OSTRY) {
    db.auth.onAuthStateChange(function (_ev, session) {
      if (!session) { stav.rola = null; render(); return; }
      db.from("profily").select("meno, rola").eq("id", session.user.id).single().then(function (res) {
        if (res.data) { stav.rola = res.data.rola; stav.pouzivatel = res.data.meno || session.user.email; }
        render();
      });
    });
  }

  render();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    // updateViaCache "none" = nová verzia appky sa zistí hneď pri otvorení; po jej zapnutí sa stránka raz obnoví
    var malKontrolera = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", function () { if (malKontrolera) location.reload(); });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(function (reg) {
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") reg.update(); });
    }).catch(function () {});
  }
})();
