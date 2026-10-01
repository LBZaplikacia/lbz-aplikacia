// LBZ aplikácia – hlavná časť (prihlásenie, roly, menu modulov)
// Ostrý režim: Supabase (e-mail + heslo). Kto sa raz prihlási, ostáva prihlásený.
// Bez nastavenia v config.js beží ukážkový režim s vymyslenými údajmi.

(function () {
  "use strict";

  var VERZIA = "0.29.20 BETA";

  // ---------- roly a moduly (v ostrom režime prídu z databázy: rpc('moje_moduly')) ----------
  var ROLY = {
    it:                { nazov: "IT (správca)" },
    ceo:               { nazov: "CEO" },
    uctovnicka:        { nazov: "Účtovníčka / mzdárka" },
    prevadzka:         { nazov: "Prevádzka (spoločný účet)" },
    zamestnanec:       { nazov: "Zamestnanec (osobný účet)" },
    furman:            { nazov: "Furman (vodič)" },
    zakaznicky_servis: { nazov: "Zákaznícky servis" },
    prevadzkar:        { nazov: "Prevádzkár" },
    majitelka_arealu:  { nazov: "Majiteľka areálu" },
    zakaznik:          { nazov: "Zákazník" }
  };

  var MODULY = [
    { kod: "prehlad",         nazov: "Prehľad",                 aktivny: true },
    { kod: "chat",            nazov: "Chat" },
    { kod: "sklad",           nazov: "Sklad" },
    { kod: "furmanky",        nazov: "Furmanky" },
    { kod: "balenie",         nazov: "Balenie a štítky" },
    { kod: "trasa",           nazov: "Moja trasa" },
    { kod: "rozpis",          nazov: "Rozpis práce" },
    { kod: "dochadzka",       nazov: "Dochádzka a smeny" },
    { kod: "kniha_jazd",      nazov: "Kniha jázd" },
    { kod: "cestovne",        nazov: "Cestovné príkazy" },
    { kod: "objednavky",      nazov: "Objednávky" },
    { kod: "komentare",       nazov: "Komentáre FB/IG" },
    { kod: "zamestnanci",     nazov: "Zamestnanci" },
    { kod: "exporty",         nazov: "Exporty pre účtovníctvo" },
    { kod: "moje_objednavky", nazov: "Moje objednávky" },
    { kod: "sledovanie",      nazov: "Kde je moja furmanka" },
    { kod: "nastavenia",      nazov: "Nastavenia",              aktivny: true }
  ];

  // ikony modulov (bočná lišta na PC, spodná lišta v mobile)
  var IKONY = {
    prehlad: "🏠", chat: "💬", sklad: "🧊", furmanky: "🚚", balenie: "📦", trasa: "🗺️", rozpis: "📅", dochadzka: "🕒", kniha_jazd: "🚗",
    objednavky: "🧾", cestovne: "🧾", komentare: "💬", zamestnanci: "👥", exporty: "📊", moje_objednavky: "🛍️", sledovanie: "📍", nastavenia: "⚙️"
  };
  // jednotné čiarové ikony (SVG) – lišta na PC aj v mobile
  var P = {
    prehlad: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12.5h5"/>',
    sklad: '<path d="M3 7l9-4 9 4v13H3z"/><path d="M7 20v-7h10v7M7 16h10"/>',
    furmanky: '<path d="M2 6h11v10H2zM13 10h4l4 4v2h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    balenie: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
    trasa: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    rozpis: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    dochadzka: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    kniha_jazd: '<path d="M5 17h14M6 17l1.5-6h9L18 17M4 17v3h3v-3M17 17v3h3v-3"/><circle cx="8" cy="14" r=".6"/><circle cx="16" cy="14" r=".6"/>',
    cestovne: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 11h6M10 15h6M10 19h3"/>',
    objednavky: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    komentare: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    zamestnanci: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    exporty: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    moje_objednavky: '<path d="M6 7h12l-1 14H7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    sledovanie: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    nastavenia: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    viac: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
  };
  function ikona(k) { return '<svg class="ik" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[k] || P.viac) + "</svg>"; }
  // čo je v spodnej lište v mobile (max 4 + Viac)
  var LISTA = {
    it: ["aktivita", "odbery", "prehlad", "chat", "dochadzka", "kniha_jazd"], ceo: ["prehlad", "chat", "dochadzka", "kniha_jazd"],
    prevadzkar: ["aktivita", "odbery", "prehlad", "chat", "dochadzka", "rozpis"], prevadzka: ["prehlad", "chat", "sklad", "balenie"],
    zamestnanec: ["aktivita", "odbery", "prehlad", "chat", "dochadzka", "rozpis"], furman: ["prehlad", "chat", "trasa", "dochadzka"],
    zakaznicky_servis: ["aktivita", "odbery", "prehlad", "chat", "dochadzka", "objednavky"], uctovnicka: ["prehlad", "chat", "dochadzka", "zamestnanci"],
    majitelka_arealu: ["aktivita", "odbery", "prehlad", "kniha_jazd"], zakaznik: ["prehlad", "moje_objednavky", "sledovanie"]
  };
  var KRATKO = { cestovne: "Cesťák", rozpis: "Rozpis", balenie: "Balenie", trasa: "Trasa", dochadzka: "Dochádzka", kniha_jazd: "Jazdy", zamestnanci: "Ľudia", komentare: "Komentáre",
    exporty: "Exporty", moje_objednavky: "Objednávky", sledovanie: "Furmanka", nastavenia: "Účet" };

  var PRISTUPY = {
    it: MODULY.map(function (m) { return m.kod; }),
    ceo: MODULY.map(function (m) { return m.kod; }),
    prevadzka: ["aktivita", "odbery", "prehlad", "chat", "sklad", "balenie", "dochadzka", "kniha_jazd", "zamestnanci", "nastavenia"],
    zamestnanec: ["aktivita", "odbery", "prehlad", "chat", "dochadzka", "nastavenia"],
    furman: ["aktivita", "odbery", "prehlad", "chat", "trasa", "cestovne", "dochadzka", "rozpis", "zamestnanci", "nastavenia"],
    zakaznicky_servis: ["aktivita", "odbery", "prehlad", "chat", "dochadzka", "objednavky", "furmanky", "trasa", "komentare", "zamestnanci", "nastavenia"],
    uctovnicka: ["prehlad", "chat", "dochadzka", "zamestnanci", "cestovne", "nastavenia"],
    prevadzkar: ["aktivita", "odbery", "prehlad", "chat", "dochadzka", "rozpis", "sklad", "balenie", "kniha_jazd", "zamestnanci", "nastavenia"],
    majitelka_arealu: ["aktivita", "odbery", "prehlad", "kniha_jazd", "nastavenia"],
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
  var FURM = window.LBZ_FURMANKY || null;
  var ROZ = window.LBZ_ROZPIS || null;
  var OBJ = window.LBZ_OBJEDNAVKY || null;
  var BAL = window.LBZ_BALENIE || null;
  var TRA = window.LBZ_TRASA || null;
  var DOCH = window.LBZ_DOCHADZKA || null;
  var KNIHA = window.LBZ_KNIHA || null;
  var VYB = window.LBZ_VYBAVIT || null;
  var ULO = window.LBZ_ULOHY || null;
  var CHAT = window.LBZ_CHAT || null;
  var AKCIA = new URLSearchParams(location.search).get("akcia"); // skratka z ikony, spracuje sa po prihlásení
  var START_M = new URLSearchParams(location.search).get("m");
  var START_K = new URLSearchParams(location.search).get("k");   // konverzácia v chate (odkaz z upozornenia)
  // inštalácia appky (QR kód vedie na ?instal=1)
  var INSTAL = new URLSearchParams(location.search).get("instal") === "1", instalPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); instalPrompt = e; ukazInstal(); });
  function jeNainstalovana() { return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }
  function ukazInstal() {
    if (jeNainstalovana()) return;
    var zamietnute = false; try { zamietnute = localStorage.getItem("lbz_instal_nie") === "1"; } catch (e) { /* */ }
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!INSTAL && (zamietnute || !(instalPrompt || ios) || !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent))) return;
    if (!instalPrompt && !ios && !INSTAL) return;
    var b = document.getElementById("instal-banner");
    if (!b) { b = document.createElement("div"); b.id = "instal-banner"; b.className = "instal-banner"; document.body.appendChild(b); }
    b.innerHTML = '<img src="icons/icon-192.png" alt=""><div class="ib-txt"><b>Nainštalujte si appku Legendárne buchty</b><span>' +
      (instalPrompt ? "Bude na ploche ako bežná aplikácia, aj s upozorneniami." : ios ? "V Safari ťuknite na Zdieľať ⬆️ a potom „Pridať na plochu“." : "V menu prehliadača ⋮ zvoľte „Inštalovať aplikáciu“ alebo „Pridať na plochu“.") +
      '</span></div>' + (instalPrompt ? '<button class="btn btn-primary" id="ib-ano">Inštalovať</button>' : "") + '<button class="ib-x" id="ib-nie" aria-label="Zavrieť">✕</button>';
    var ano = document.getElementById("ib-ano");
    if (ano) ano.onclick = function () { instalPrompt.prompt(); instalPrompt.userChoice.then(function () { instalPrompt = null; b.remove(); }); };
    document.getElementById("ib-nie").onclick = function () { try { localStorage.setItem("lbz_instal_nie", "1"); } catch (e) { /* */ } b.remove(); };
  }
  setTimeout(ukazInstal, 1500);
  if (location.search) try { history.replaceState(null, "", location.pathname); } catch (e) {}
  // poradie kariet na Prehľade podľa roly (každý si ho môže upraviť – uloží sa v zariadení)
  var PORADIE = {
    it: ["aktivita", "odbery", "schvalenie", "cp", "statistiky", "sms", "dochadzka", "ulohy", "zdrav", "vybavit", "kniha", "rozpis", "furmanky", "sklad", "balenie", "trasa"],
    ceo: ["aktivita", "odbery", "schvalenie", "cp", "statistiky", "sms", "dochadzka", "ulohy", "zdrav", "vybavit", "kniha", "rozpis", "furmanky", "sklad", "balenie", "trasa"],
    prevadzkar: ["aktivita", "odbery", "schvalenie", "dochadzka", "ulohy", "rozpis", "vybavit", "sklad", "balenie", "kniha"],
    zamestnanec: ["aktivita", "odbery", "dochadzka", "zdrav", "ulohy", "furmanky", "rozpis", "vybavit"],
    prevadzka: ["aktivita", "odbery", "ulohy", "dochadzka", "sklad", "balenie", "furmanky", "vybavit"],
    furman: ["aktivita", "odbery", "cp", "sms", "dochadzka", "rozpis", "trasa", "vybavit", "ulohy"],
    zakaznicky_servis: ["aktivita", "odbery", "sms", "dochadzka", "ulohy", "zdrav", "furmanky", "rozpis", "vybavit"],
    majitelka_arealu: ["aktivita", "odbery", "kniha", "vybavit"]
  };
  var NAZVY_KARIET = { schvalenie: "🔔 Na schválenie", dochadzka: "🕒 Príchod a smeny", ulohy: "✅ Úlohy a Vybaviť", zdrav: "🩺 Zdravotné preukazy", vybavit: "📝 Vybaviť", kniha: "🚗 Kniha jázd", rozpis: "📅 Kto je v práci", furmanky: "🚚 Furmanky",
    sklad: "🧊 Sklad", balenie: "📦 Balenie", trasa: "🗺️ Trasa", statistiky: "📊 Denný prehľad", sms: "💬 SMS odpovede", odbery: "🛍️ Osobné odbery", aktivita: "⏱ Pracovný čas (automaticky)", cp: "🧾 Cestovný príkaz" };
  var ZAM = window.LBZ_ZAMESTNANCI || null;
  var CES = window.LBZ_CESTY || null;

  var stav = {
    pouzivatel: null, email: null, rola: null,
    modul: window.LBZ_REZIM ? "prehlad" : START_M || (window.lbzPamat && lbzPamat.nacitaj("modul")) || "prehlad",
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
    Promise.all([db.rpc("pouzivatelia"), db.rpc("ucty_osoby")]).then(function (v) {
      var r = v[0]; stav.nacitavamPouz = false;
      stav.uctyOsoby = v[1] && v[1].data && v[1].data.ok ? v[1].data : null;
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
            (stav.menoUpr === u.email ? '<span class="pouz-meno" style="display:flex;gap:6px;flex-wrap:wrap"><input id="in-p-premenuj" value="' + esc(u.meno || "") + '" placeholder="Priezvisko Meno" style="flex:1;min-width:140px;border:1px solid var(--line);border-radius:8px;padding:8px;font:inherit"><button class="btn btn-primary" data-pouz-meno-ok="' + esc(u.email) + '">Uložiť</button><button class="btn" data-pouz-meno-zrus="1">✕</button></span>' :
            '<span class="pouz-meno"><strong>' + esc(u.meno || u.email) + ' <button class="btn-link" data-pouz-meno="' + esc(u.email) + '" aria-label="Upraviť meno" style="font-size:13px">✏️</button></strong><span class="muted">' + esc(u.email) + " · " +
              (u.posledne_prihlasenie ? "prihlásený " + new Date(u.posledne_prihlasenie).toLocaleDateString("sk-SK") : u.ucet ? "účet založený" : "ešte sa neprihlásil") + "</span></span>") +
            '<select data-pouz-rola="' + esc(u.email) + '" aria-label="Rola">' + moznostiRol(u.rola) + "</select>" + vyberOsoby(u) +
            '<label class="pouz-akt"><input type="checkbox" data-pouz-akt="' + esc(u.email) + '"' + (u.aktivny ? " checked" : "") + "> aktívny</label></div>";
        }).join("") + "</div>") + "</section>";
  }
  // prepojenie účtu s kartou zamestnanca (keď sa prihlási iným e-mailom, než má v karte)
  var BEZ_KARTY = ["zakaznik", "it", "ceo", "prevadzka", "majitelka_arealu"];
  function vyberOsoby(u) {
    var uo = stav.uctyOsoby; if (!uo || !u.ucet) return "";
    var moja = (uo.ucty || {})[String(u.email || "").toLowerCase()];
    if (moja == null && BEZ_KARTY.indexOf(u.rola) > -1) return "";
    return '<select data-pouz-osoba="' + esc(u.email) + '" aria-label="Karta zamestnanca" style="grid-column:1/-1' + (moja == null ? ';border-color:#d9822b;border-width:2px' : "") + '">' +
      '<option value="">' + (moja == null ? "⚠️ priradiť kartu zamestnanca…" : "— bez karty —") + "</option>" +
      (uo.osoby || []).map(function (o) { return '<option value="' + o.id + '"' + (o.id === moja ? " selected" : "") + ">👤 " + esc(o.meno) + "</option>"; }).join("") + "</select>";
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
    if (d && d.pouzOsoba !== undefined) {
      var em = d.pouzOsoba, os = t.value ? +t.value : null;
      db.rpc("ucet_prirad", { p_email: em, p_osoba: os }).then(function (r) {
        var res = r.data || {};
        stav.spravaPouz = { typ: res.ok ? "ok" : "chyba", text: res.ok ? em + (os ? " – prepojené s kartou zamestnanca" : " – odpojené od karty") : (res.text || (r.error && r.error.message) || "Neuložené") };
        stav.pouzivatelia = null; stav.naSchv = null; render();
      });
      return;
    }
    if (!d || !(d.pouzRola || d.pouzAkt)) return;
    var email = d.pouzRola || d.pouzAkt;
    var u = (stav.pouzivatelia || []).filter(function (x) { return x.email === email; })[0]; if (!u) return;
    ulozPouzivatela(email, null, d.pouzRola ? t.value : u.rola, d.pouzAkt ? t.checked : u.aktivny);
  });

  function skladZapnuty() { return !!(SKLAD && SKLAD.zapnute()); }
  function furmankyZapnute() { return !!(FURM && FURM.mozem()); }
  function rozpisZapnuty() { return !!(ROZ && ROZ.mozem()); }
  function objednavkyZapnute() { return !!(OBJ && OBJ.mozem()); }
  function balenieZapnute() { return !!(BAL && BAL.mozem()); }
  function trasaZapnuta() { return !!(TRA && TRA.mozem()); }
  function dochadzkaZapnuta() { return !!(DOCH && DOCH.mozem()); }
  function knihaZapnuta() { return !!(KNIHA && KNIHA.mozem()); }
  function zamZapnute() { return !!(ZAM && ZAM.mozem()); }
  function cestyZapnute() { return !!(CES && CES.mozem()); }
  function chatZapnuty() { return !!(CHAT && CHAT.mozem()); }

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
      if (m.kod === "sklad") m.aktivny = skladZapnuty();
      if (m.kod === "furmanky") m.aktivny = furmankyZapnute();
      if (m.kod === "rozpis") m.aktivny = rozpisZapnuty();
      if (m.kod === "objednavky") m.aktivny = objednavkyZapnute();
      if (m.kod === "balenie") m.aktivny = balenieZapnute();
      if (m.kod === "trasa") m.aktivny = trasaZapnuta();
      if (m.kod === "dochadzka") m.aktivny = dochadzkaZapnuta();
      if (m.kod === "kniha_jazd") m.aktivny = knihaZapnuta();
      if (m.kod === "cestovne") m.aktivny = cestyZapnute();
      if (m.kod === "chat") m.aktivny = chatZapnuty();
      if (m.kod === "zamestnanci") { m.aktivny = zamZapnute(); KRATKO.zamestnanci = stav.rola === "zamestnanec" ? "Údaje" : "Ľudia"; if (stav.rola === "zamestnanec") m.nazov = "Moje údaje"; }
    });
    return zoznam;
  }

  function renderApp() {
    if (window.LBZ_REZIM === "vybavit") {   // samostatná mini-appka „Vybaviť“ (vlastná ikona na ploche / okno na PC)
      document.title = "Vybaviť – LBZ";
      el('<div class="rezim-vybavit"><main class="main">' + (ULO ? ULO.karta() : VYB ? VYB.karta() : "") +
        '<a class="btn-link rv-appka" href="./">Otvoriť celú aplikáciu LBZ →</a></main></div>');
      return;
    }
    var moduly = mojeModuly();
    // neznámy modul → Prehľad (v ostrom režime až keď sú načítané moduly z databázy, inak by sa pri štarte stratilo, kde bol)
    if ((!OSTRY || stav.dbModuly) && stav.modul !== "nastavenia" && !moduly.some(function (m) { return m.kod === stav.modul; })) stav.modul = "prehlad";   // Účet má každý
    if ((!OSTRY || stav.dbModuly) && window.lbzPamat) lbzPamat.uloz("modul", stav.modul);
    // v lište len hotové moduly; pripravované sú na Prehľade
    var hotove = moduly.filter(function (m) { return m.aktivny && m.kod !== "nastavenia"; });
    var polozka = function (m, trieda) {
      return '<button class="' + trieda + '" data-mod="' + m.kod + '" title="' + esc(m.nazov) + '"' + (stav.modul === m.kod ? ' aria-current="page"' : "") + ">" +
        '<span class="ri-ik">' + ikona(m.kod) + "</span><span>" + esc(KRATKO[m.kod] || m.nazov) + "</span></button>";
    };
    var ucet = { kod: "nastavenia", nazov: "Účet" };
    // mobil: 4 hlavné + Viac (ostatné moduly a Účet v paneli)
    var vsetky = hotove.concat([ucet]), pref = LISTA[stav.rola] || ["prehlad"];
    var hlavne = pref.map(function (k) { return vsetky.filter(function (m) { return m.kod === k; })[0]; }).filter(Boolean);
    vsetky.forEach(function (m) { if (hlavne.length < 4 && hlavne.indexOf(m) === -1 && m.kod !== "nastavenia") hlavne.push(m); });
    var ostatne = vsetky.filter(function (m) { return hlavne.indexOf(m) === -1; });
    if (ostatne.length === 1) { hlavne.push(ostatne[0]); ostatne = []; }
    var viacAktivne = ostatne.some(function (m) { return m.kod === stav.modul; });
    var spodna = hlavne.map(function (m) { return polozka(m, "bi"); }).join("") +
      (ostatne.length ? '<button class="bi" data-viac="1"' + (viacAktivne ? ' aria-current="page"' : "") + ' aria-expanded="' + !!stav.viac + '"><span class="ri-ik">' + ikona("viac") + "</span><span>Viac</span></button>" : "");
    var panel = stav.viac && ostatne.length ? '<button class="viac-pozadie" data-viac="0" aria-label="Zavrieť"></button><div class="viac-panel" role="dialog" aria-label="Ďalšie moduly">' +
      ostatne.map(function (m) { return polozka(m, "vp"); }).join("") + "</div>" : "";
    var rolaNazov = (ROLY[stav.rola] || {}).nazov || stav.rola;

    el(
      '<div class="shell">' +
        '<aside class="rail"><div class="rail-logo"><img src="icons/logo.svg" alt="Legendárne buchty"><span class="beta">BETA</span></div>' +
          '<nav class="rail-nav" aria-label="Moduly">' + hotove.map(function (m) { return polozka(m, "ri"); }).join("") + "</nav>" +
          '<div class="rail-dole">' + polozka(ucet, "ri") + "</div>" +
        "</aside>" +
        '<main class="main">' + obsahModulu() + "</main>" +
        '<nav class="bottom" aria-label="Moduly">' + spodna + "</nav>" + panel +
      "</div>"
    );
    document.title = "LBZ – " + (KRATKO[stav.modul] || (moduly.filter(function (m) { return m.kod === stav.modul; })[0] || {}).nazov || "aplikácia");
    void rolaNazov;
  }

  function hlavicka(nadpis, podnadpis, ozdobne) {
    return '<div class="head"><div><h2' + (ozdobne ? ' class="ozdobne"' : "") + ">" + esc(nadpis) + '</h2><div class="sub">' + esc(podnadpis) + "</div></div>" +
      (OSTRY ? "" : '<span class="badge-demo">ukážkové údaje</span>') + "</div>";
  }

  function kartaFurmanky() {
    if (furmankyZapnute()) return FURM.karta();
    return '<section class="card"><h3>Furmanky dnes <span class="pill ok">' + UKAZKA.trasy.length + " trasy</span></h3><div class=\"rows\">" +
      UKAZKA.trasy.map(function (t) {
        return '<div class="row"><span>' + esc(t.nazov) + ' <span class="muted num">· ' + t.zastavky + ' zastávok</span></span><span class="pill ok">' + esc(t.stav) + "</span></div>";
      }).join("") + "</div></section>";
  }
  // „Na schválenie“ – vedenie vidí na Prehľade, čo od zamestnancov čaká na jeho rozhodnutie
  function kartaSchvalenie() {
    if (!OSTRY || ["zakaznik", "majitelka_arealu"].indexOf(stav.rola) > -1) return "";   // žiadosť o výmenu smeny vidí každý zamestnanec, ktorého sa týka
    if (!stav.naSchv || Date.now() - stav.naSchv.cas > 60000) {
      var bolo = stav.naSchv; stav.naSchv = { cas: Date.now(), d: bolo ? bolo.d : null };
      db.rpc("na_schvalenie").then(function (r) {
        var st = JSON.stringify(stav.naSchv.d); stav.naSchv.d = r.data && r.data.ok ? r.data : null;
        if (JSON.stringify(stav.naSchv.d) !== st && stav.modul === "prehlad") render();
      });
    }
    var d = stav.naSchv.d; if (!d) return "";
    var pol = [d.osobne ? ["smeny", "🔄", "zmena smeny čaká na tvoje potvrdenie", "zmeny smien čakajú na tvoje potvrdenie", "zmien smien čaká na tvoje potvrdenie", "rozpis"]
      : ["smeny", "🔄", "zmena smeny", "zmeny smien", "zmien smien", "rozpis"], ["dochadzka", "🕒", "žiadosť v dochádzke", "žiadosti v dochádzke", "žiadostí v dochádzke", "dochadzka"],
      ["udaje", "👤", "zmena údajov", "zmeny údajov", "zmien údajov", "zamestnanci"],
      ["ucty", "🔗", "nový účet bez karty zamestnanca", "nové účty bez karty zamestnanca", "nových účtov bez karty zamestnanca", "nastavenia"]].filter(function (x) { return +d[x[0]] > 0; });
    if (!pol.length) return "";
    var spolu = pol.reduce(function (s, x) { return s + +d[x[0]]; }, 0);
    return '<section class="card schv-karta"><h3>🔔 ' + (d.osobne ? "Na potvrdenie" : "Na schválenie") + ' <span class="pill warn num">' + spolu + "</span></h3>" +
      '<div class="schv-zoz">' + pol.map(function (x) {
        var n = +d[x[0]];
        return '<button class="schv-pol" data-mod="' + x[5] + '"><span>' + x[1] + " <b>" + n + "</b> " + (n === 1 ? x[2] : n < 5 ? x[3] : x[4]) + "</span><span>›</span></button>";
      }).join("") + "</div></section>";
  }
  // upozornenia do mobilu – stav tohto zariadenia (bez nich neprídu správy, keď je appka zavretá)
  function pushStavNacitaj() {
    if (!OSTRY || !window.lbzPush || stav.pushStav !== undefined) return;
    stav.pushStav = null;
    lbzPush.stav().then(function (s) { stav.pushStav = s; if (stav.modul === "prehlad" || stav.modul === "nastavenia") render(); });
  }
  function pushTlacidlo() {
    return '<button class="btn btn-primary" data-push-zapni' + (stav.pushPrace ? " disabled" : "") + ">" + (stav.pushPrace ? "Zapínam…" : "🔔 Zapnúť upozornenia") + "</button>";
  }
  // úvodný návod (1. 10. 2026): najprv príchod do práce, potom nainštalovať appku – kým nie je nainštalovaná alebo skrytá
  function kartaStart() {
    if (jeNainstalovana() || !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) return "";
    try { if (localStorage.getItem("lbz_start_skryte")) return ""; } catch (x) { /* */ }
    var ios = /iPhone|iPad/i.test(navigator.userAgent);
    return '<section class="card start-karta"><h3>👋 Vitaj v novej appke LBZ</h3><ol class="start-kroky">' +
      (dochadzkaZapnuta() ? "<li><b>Najprv sa prihlás do práce</b> – v karte „🕒 Príchod a smeny“ nižšie ťukni <b>Príchod</b>.</li>" : "") +
      "<li><b>Nainštaluj si appku na plochu</b> – " + (ios
        ? "otvor túto stránku v <b>Safari</b> → ťukni <b>Zdieľať</b> (štvorček so šípkou ⬆️) → <b>Pridať na plochu</b> → <b>Pridať</b>."
        : "v Chrome ťukni vpravo hore <b>⋮</b> → <b>Pridať na plochu</b> (alebo „Inštalovať aplikáciu“) → <b>Inštalovať</b>.") + "</li>" +
      "<li>Odteraz appku otváraj <b>len z ikony LBZ</b> na ploche a zapni si <b>🔔 upozornenia</b>.</li></ol>" +
      '<div class="f-akcie">' + (instalPrompt ? '<button class="btn btn-primary" data-start-instal>📲 Nainštalovať</button>' : "") +
      '<button class="btn" data-start-skry>Hotovo, skryť</button></div></section>';
  }
  function kartaPush() {
    pushStavNacitaj();
    if (stav.pushStav !== "vypnute" && stav.pushStav !== "zakazane") return "";
    return '<section class="card schv-karta"><h3>🔕 Upozornenia sú vypnuté</h3><p class="muted" style="margin:0">Zapni ich, aby ti správy z chatu a žiadosti prišli do mobilu aj vtedy, keď je appka zavretá – aj s číslom na ikone.</p>' +
      (stav.pushStav === "zakazane" ? '<p class="s-varovanie" style="margin:0">Upozornenia sú pre appku zakázané v telefóne. Povoľ ich: podrž prst na ikone appky → Informácie o aplikácii → Upozornenia → zapnúť.</p>' : pushTlacidlo()) + "</section>";
  }
  function kartaPushUcet() {
    pushStavNacitaj();
    var s = stav.pushStav, text = s === "zapnute" ? "✅ Na tomto zariadení sú zapnuté." : s === "zakazane" ? "🔕 Zakázané v nastaveniach telefónu – podrž prst na ikone appky → Informácie o aplikácii → Upozornenia → zapnúť." :
      s === "nepodporuje" ? (/iPhone|iPad/.test(navigator.userAgent) ? "Na iPhone fungujú, keď appku pridáš na plochu (Zdieľať → Pridať na plochu) a otvoríš ju z ikony." : "Tento prehliadač upozornenia nepodporuje.") : s ? "Na tomto zariadení sú vypnuté." : "Zisťujem…";
    return '<section class="card" style="max-width:520px"><h3>🔔 Upozornenia do mobilu</h3><p class="muted" style="margin:0">' + esc(text) + "</p>" +
      (s === "vypnute" ? pushTlacidlo() : "") + (s === "zapnute" ? '<button class="btn" data-push-test>Poslať skúšobné upozornenie</button>' : "") +
      (stav.pushSprava ? '<p class="muted" style="margin:0">' + esc(stav.pushSprava) + "</p>" : "") +
      '<p class="muted r-mala" style="margin:0">Upozornenia chodia na účet, ktorý je na tomto zariadení práve prihlásený. Ak ti na Samsungu/Xiaomi neprichádzajú pri zavretej appke, vypni pre Chrome šetrenie batérie (Nastavenia → Aplikácie → Chrome → Batéria → Bez obmedzení).</p></section>';
  }
  function kartaSklad() {
    if (skladZapnuty()) return SKLAD.kartaSklad();
    return '<section class="card"><h3>Sklad</h3><p class="muted" style="margin:0">Ukážkový režim.</p></section>';
  }
  function poradieKariet(dostupne) {
    var ul = nacitajPoradie();
    var zaklad = PORADIE[stav.rola] || PORADIE.it;
    var poradie = (ul.poradie || []).concat(zaklad).concat(dostupne).filter(function (k, i, a) { return a.indexOf(k) === i && dostupne.indexOf(k) > -1; });
    var skryte = ul.skryte || [];
    return { vsetky: poradie, skryte: skryte, viditelne: poradie.filter(function (k) { return skryte.indexOf(k) === -1; }) };
  }
  // poradie a skryté karty Prehľadu – trvalo v tomto zariadení (pamäť obrazovky lbzPamat platí len 12 h)
  function nacitajPoradie() {
    try { var x = JSON.parse(localStorage.getItem("lbz_prehlad_karty") || "null"); if (x && typeof x === "object") return x; } catch (e) {}
    return (window.lbzPamat && lbzPamat.nacitaj("prehlad_karty")) || {};
  }
  function ulozPoradie(por) { try { localStorage.setItem("lbz_prehlad_karty", JSON.stringify(por ? { poradie: por.vsetky, skryte: por.skryte } : {})); } catch (e) {} }
  function kartaPrisposobit(por) {
    if (por.vsetky.length < 2) return "";
    return '<details class="prisposobit"' + (stav.prisposobit ? " open" : "") + '><summary data-prisp="1">⚙️ Prispôsobiť prehľad</summary><ul class="prisp-zoz">' + por.vsetky.map(function (k, i) {
      var skr = por.skryte.indexOf(k) > -1;
      return '<li class="' + (skr ? "prisp-skr" : "") + '"><span>' + esc(NAZVY_KARIET[k] || k) + "</span>" +
        '<button class="btn-ikona btn" data-prisp-hore="' + k + '"' + (i === 0 ? " disabled" : "") + ' aria-label="Vyššie">↑</button>' +
        '<button class="btn-ikona btn" data-prisp-dole="' + k + '"' + (i === por.vsetky.length - 1 ? " disabled" : "") + ' aria-label="Nižšie">↓</button>' +
        '<button class="btn" data-prisp-skry="' + k + '">' + (skr ? "Zobraziť" : "Skryť") + "</button></li>";
    }).join("") + '</ul><button class="btn-link" data-prisp-reset="1">Pôvodné poradie</button></details>';
  }
  function kartaPripravujeme(zoznam) {
    if (!zoznam.length) return "";
    return '<section class="card pripravujeme"><h3>Pripravujeme</h3><div class="prip-zoznam">' + zoznam.map(function (m) {
      return '<span class="prip"><span aria-hidden="true">' + (IKONY[m.kod] || "•") + "</span>" + esc(m.nazov) + "</span>";
    }).join("") + "</div></section>";
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
      var kh = {};
      kh.schvalenie = kartaSchvalenie();
      var kPush = kartaPush();
      var moje = mojeModuly(), kody = moje.map(function (m) { return m.kod; });
      if (dochadzkaZapnuta()) kh.dochadzka = DOCH.karta();
      if (ULO) kh.ulohy = ULO.karta();
      if (kody.indexOf("sklad") > -1) kh.sklad = kartaSklad();
      if (kody.indexOf("rozpis") > -1 && rozpisZapnuty()) kh.rozpis = ROZ.karta();
      if (VYB && !ULO && r !== "majitelka_arealu") kh.vybavit = VYB.karta();   // Vybaviť je súčasťou karty Úlohy
      if (kody.indexOf("furmanky") > -1) kh.furmanky = kartaFurmanky();
      if (kody.indexOf("balenie") > -1 && balenieZapnute()) kh.balenie = BAL.karta();
      if (kody.indexOf("trasa") > -1 && trasaZapnuta()) { kh.trasa = TRA.karta(); if (TRA.kartaSms) kh.sms = TRA.kartaSms(); }
      if (OBJ && OBJ.kartaStat && OSTRY) kh.statistiky = OBJ.kartaStat();
      if (knihaZapnuta()) kh.kniha = KNIHA.karta();
      if (zamZapnute() && ZAM.karta) kh.zdrav = ZAM.karta();
      if (cestyZapnute()) { var kCp = CES.karta(); if (kCp) kh.cp = kCp; }
      // osobné odbery a automatický pracovný čas sa dajú tiež presúvať a skryť v „Prispôsobiť prehľad“
      var kOdb = OBJ && OBJ.mozemOdbery() && OSTRY && r !== "ceo" ? OBJ.kartaOdbery() : "";
      if (kOdb) kh.odbery = kOdb;
      var akt = window.lbzAktivita && lbzAktivita.dnes();
      if (akt != null) kh.aktivita = '<section class="card akt-karta"><h3>⏱ Pracovný čas sa ráta automaticky</h3><p style="margin:0">Dnes: <b class="num">' + Math.floor(akt / 60) + " h " + (akt % 60) + " min</b></p>" +
        '<p class="muted" style="margin:0">Ráta sa, kým máš appku otvorenú a pracuješ v nej. Po 5 min nečinnosti, minimalizovaní alebo zavretí sa zastaví.</p></section>';
      var por = poradieKariet(Object.keys(kh).filter(function (k) { return kh[k]; }));
      var karty = (kh.schvalenie ? ["schvalenie"] : []).concat(por.viditelne.filter(function (k) { return k !== "schvalenie"; })).map(function (k) { return kh[k]; });
      if (kPush) karty.unshift(kPush);
      var kStart = OSTRY ? kartaStart() : ""; if (kStart) karty.unshift(kStart);

      var dnes = new Date().toLocaleDateString("sk-SK", { weekday: "long", day: "numeric", month: "numeric" });
      var meno = String(stav.pouzivatel || "").split(" ").pop();
      return hlavicka("Dobrý deň" + (meno ? ", " + meno : "") + "!", "Dnes je " + dnes, true) + '<div class="grid">' + karty.join("") + "</div>" +
        kartaPrisposobit(por) +
        kartaPripravujeme(moje.filter(function (m) { return !m.aktivny && m.kod !== "nastavenia"; }));
    }
    if (stav.modul === "nastavenia") {
      return hlavicka("Môj účet", "verzia " + VERZIA) +
        '<section class="card" style="max-width:520px"><h3>Prihlásený</h3>' +
          '<div class="rows"><div class="row"><span>Meno</span><span>' + esc(stav.pouzivatel) + '</span></div>' +
          '<div class="row"><span>E-mail</span><span>' + esc(stav.email || "") + '</span></div>' +
          '<div class="row"><span>Rola</span><span>' + esc((ROLY[r] || {}).nazov || r) + "</span></div></div></section>" +
        (OSTRY ? kartaPushUcet() : "") +
        (OSTRY ? '<form class="card" id="f-zmena-hesla" style="max-width:520px"><h3>Zmeniť heslo</h3>' +
          '<label class="field"><span class="label">Nové heslo (aspoň 6 znakov)</span><input id="in-heslo1" type="password" autocomplete="new-password" minlength="6" required></label>' +
          '<label class="field"><span class="label">Nové heslo ešte raz</span><input id="in-heslo2" type="password" autocomplete="new-password" minlength="6" required></label>' +
          spravaHtml() +
          '<button class="btn btn-primary" type="submit">Uložiť nové heslo</button></form>' : "") +
        '<section class="card" style="max-width:520px"><h3>📲 Samostatné appky</h3><p class="muted" style="margin:0">Vybaviť si môžete nainštalovať ako samostatnú malú appku – na PC ako okno, ktoré ostane otvorené, v mobile ako vlastnú ikonu.</p>' +
          '<a class="btn" href="vybavit.html?instal=1">📝 Otvoriť / nainštalovať Vybaviť</a></section>' +
        (OSTRY && spravca() ? kartaPouzivatelia() : "") +
        '<button class="btn" id="btn-odhlasit-m" style="max-width:520px">Odhlásiť sa</button>';
    }
    if (furmankyZapnute() && stav.modul === "furmanky") return '<div id="furm-root"></div>';
    if (rozpisZapnuty() && stav.modul === "rozpis") return '<div id="rozpis-root"></div>';
    if (objednavkyZapnute() && stav.modul === "objednavky") return '<div id="obj-root"></div>';
    if (balenieZapnute() && stav.modul === "balenie") return '<div id="balenie-root"></div>';
    if (trasaZapnuta() && stav.modul === "trasa") return '<div id="trasa-root"></div>';
    if (dochadzkaZapnuta() && stav.modul === "dochadzka") return '<div id="doch-root"></div>';
    if (knihaZapnuta() && stav.modul === "kniha_jazd") return '<div id="kniha-root"></div>';
    if (zamZapnute() && stav.modul === "zamestnanci") return '<div id="zam-root"></div>';
    if (cestyZapnute() && stav.modul === "cestovne") return '<div id="cp-root"></div>';
    if (chatZapnuty() && stav.modul === "chat") return '<div id="chat-root" class="chat-root"></div>';
    if (skladZapnuty() && stav.modul === "sklad") {
      return '<div id="sklad-root" data-modul="' + stav.modul + '"></div>';
    }
    var m = mojeModuly().filter(function (x) { return x.kod === stav.modul; })[0] || { nazov: stav.modul };
    return hlavicka(m.nazov, "Pripravujeme") +
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
    if (!el || el.getAttribute("data-g") || !gNonce || !window.google || !google.accounts) return;
    el.setAttribute("data-g", "1"); // každé tlačidlo vykresliť len raz
    el.innerHTML = "";
    google.accounts.id.renderButton(el, { type: "standard", theme: "outline", size: "large", text: "signin_with", shape: "rectangular", locale: "sk", logo_alignment: "center", width: Math.min(360, el.clientWidth || 320) });
  }

  // číslo na ikone appky = neprečítané správy + čo čaká na potvrdenie + moje nesplnené úlohy
  var odznakCas = 0, odznakTimer = null;
  function odznakObnov() {
    if (!OSTRY || !db || !stav.rola || !window.lbzPush) return;
    clearTimeout(odznakTimer);
    odznakTimer = setTimeout(function () {
      odznakCas = Date.now();
      db.rpc("odznak_pocet").then(function (r) { if (r.data && r.data.ok) lbzPush.odznak(r.data.spolu); }).catch(function () { /* */ });
    }, 800);
  }
  window.lbzOdznakObnov = odznakObnov;
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") odznakObnov(); });
  // otvorením modulu sa zatvoria jeho upozornenia v lište telefónu
  var ZAVRI_PRI = { rozpis: ["roz-z-"], dochadzka: ["ziadost-", "doch-"], zamestnanci: ["udaje-", "zdrav-"] };
  var poslModul = null;
  function render() {
    if (stav.rola && stav.modul !== poslModul) {
      poslModul = stav.modul;
      if (window.lbzPush && lbzPush.zavri) (ZAVRI_PRI[stav.modul] || []).forEach(function (z) { lbzPush.zavri(z); });
      if (Date.now() - odznakCas > 30000) odznakObnov();
    }
    // spodná lišta v mobile: po prekreslení ostane posunutá tam, kde bola (a ťuknutá položka ostane viditeľná)
    var lista = document.querySelector("nav.bottom"), listaX = lista ? lista.scrollLeft : 0;
    if (stav.rola) renderApp(); else { renderLogin(); vykresliGoogle(); }
    var lista2 = document.querySelector("nav.bottom");
    if (lista2) {
      lista2.scrollLeft = listaX;
      var akt = lista2.querySelector('[aria-current="page"]');
      if (akt && (akt.offsetLeft < lista2.scrollLeft || akt.offsetLeft + akt.offsetWidth > lista2.scrollLeft + lista2.clientWidth)) {
        lista2.scrollLeft = akt.offsetLeft - (lista2.clientWidth - akt.offsetWidth) / 2;
      }
    }
    var sk = document.getElementById("sklad-root");
    if (sk && SKLAD) SKLAD.mount(sk, sk.getAttribute("data-modul"));
    var fu = document.getElementById("furm-root");
    if (fu && FURM) FURM.mount(fu);
    var oo = document.getElementById("obj-root");
    if (oo && OBJ) OBJ.mount(oo);
    var ro = document.getElementById("rozpis-root");
    if (ro && ROZ) ROZ.mount(ro);
    var ba = document.getElementById("balenie-root");
    if (ba && BAL) BAL.mount(ba); else if (BAL) BAL.odchod();
    var tr = document.getElementById("trasa-root");
    if (tr && TRA) TRA.mount(tr);
    var dc = document.getElementById("doch-root");
    if (dc && DOCH) DOCH.mount(dc);
    var kn = document.getElementById("kniha-root");
    if (kn && KNIHA) KNIHA.mount(kn);
    var zr = document.getElementById("zam-root");
    if (zr && ZAM) ZAM.mount(zr);
    var cpr = document.getElementById("cp-root");
    if (cpr && CES) CES.mount(cpr);
    var ch = document.getElementById("chat-root");
    if (ch && CHAT) CHAT.mount(ch);
    if (CHAT && CHAT.odznak) CHAT.odznak();
  }

  // ---------- udalosti ----------
  root.addEventListener("click", function (e) {
    var t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.viac) { stav.viac = t.dataset.viac === "1" && !stav.viac; render(); return; }
    if (t.dataset.pouzMeno) { stav.menoUpr = t.dataset.pouzMeno; render(); var im = document.getElementById("in-p-premenuj"); if (im) im.focus(); return; }
    if (t.dataset.pouzMenoZrus) { stav.menoUpr = null; render(); return; }
    if (t.dataset.pouzMenoOk) {
      var em = t.dataset.pouzMenoOk, nm = ((document.getElementById("in-p-premenuj") || {}).value || "").trim();
      var uu = (stav.pouzivatelia || []).filter(function (x) { return x.email === em; })[0];
      if (!nm || !uu) return;
      stav.menoUpr = null; ulozPouzivatela(em, nm, uu.rola, uu.aktivny); return;
    }
    if (t.dataset.mod) stav.viac = false;
    if (t.dataset.prispHore || t.dataset.prispDole || t.dataset.prispSkry || t.dataset.prispReset) {
      var kl = [];
      root.querySelectorAll("[data-prisp-skry]").forEach(function (b) { kl.push(b.dataset.prispSkry); });
      var por = poradieKariet(kl);
      if (t.dataset.prispReset) { ulozPoradie(null); if (window.lbzPamat) lbzPamat.uloz("prehlad_karty", {}); }
      else {
        var k = t.dataset.prispHore || t.dataset.prispDole || t.dataset.prispSkry, ix = por.vsetky.indexOf(k);
        if (t.dataset.prispSkry) { var si = por.skryte.indexOf(k); if (si > -1) por.skryte.splice(si, 1); else por.skryte.push(k); }
        else { var nx = ix + (t.dataset.prispHore ? -1 : 1); if (nx >= 0 && nx < por.vsetky.length) { por.vsetky.splice(ix, 1); por.vsetky.splice(nx, 0, k); } }
        ulozPoradie(por);
      }
      stav.prisposobit = true; render(); return;
    }
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
    if (t.hasAttribute("data-start-skry")) { try { localStorage.setItem("lbz_start_skryte", "1"); } catch (x) { /* */ } render(); return; }
    if (t.hasAttribute("data-start-instal") && instalPrompt) { instalPrompt.prompt(); instalPrompt.userChoice.then(function () { instalPrompt = null; render(); }); return; }
    if (t.hasAttribute("data-push-zapni")) {
      stav.pushPrace = true; stav.pushSprava = null; render();
      lbzPush.zapni(db).then(function (txt) { stav.pushStav = "zapnute"; stav.pushSprava = txt; })
        .catch(function (e) { stav.pushSprava = (e && e.message) || "Nepodarilo sa zapnúť"; stav.pushStav = undefined; })
        .then(function () { stav.pushPrace = false; render(); });
      return;
    }
    if (t.hasAttribute("data-push-test")) {
      db.functions.invoke("upozornenia", { body: { akcia: "test" } }).then(function () { stav.pushSprava = "Odoslané – o chvíľu by malo prísť. Skús aj so zavretou appkou."; render(); });
      return;
    }
    if (t.id === "btn-odhlasit" || t.id === "btn-odhlasit-m") {
      if (window.lbzPush) lbzPush.odznak(0);
      if (window.lbzAktivita) lbzAktivita.stop();
      if (OSTRY) db.auth.signOut({ scope: "local" }); // odhlási len toto zariadenie, ostatné ostanú prihlásené
      if (window.lbzPamat) lbzPamat.zmaz();
      stav.rola = null; stav.pouzivatel = null; stav.modul = "prehlad"; stav.dbModuly = null; stav.login = "prihlasenie"; stav.sprava = null;
      if (SKLAD && SKLAD.nastavDb) SKLAD.nastavDb(null, null);
      if (FURM) FURM.nastavDb(null, null);
      if (ROZ) ROZ.nastavDb(null, null);
      if (OBJ) OBJ.nastavDb(null, null);
      if (BAL) BAL.nastavDb(null, null);
      if (TRA) TRA.nastavDb(null, null);
      if (DOCH) DOCH.nastavDb(null, null);
      if (KNIHA) KNIHA.nastavDb(null, null);
      if (VYB) VYB.nastavDb(null, null);
      if (ULO) ULO.nastavDb(null, null);
      if (ZAM) ZAM.nastavDb(null, null);
      if (CES) CES.nastavDb(null, null);
      if (CHAT) CHAT.nastavDb(null, null);
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
      if (FURM) FURM.nastavDb(null, null);
      if (ROZ) ROZ.nastavDb(null, null);
      if (OBJ) OBJ.nastavDb(null, null);
      if (BAL) BAL.nastavDb(null, null);
      if (TRA) TRA.nastavDb(null, null);
      if (DOCH) DOCH.nastavDb(null, null);
      if (KNIHA) KNIHA.nastavDb(null, null);
      if (VYB) VYB.nastavDb(null, null);
      if (ULO) ULO.nastavDb(null, null);
      if (ZAM) ZAM.nastavDb(null, null);
      if (CES) CES.nastavDb(null, null);
      if (CHAT) CHAT.nastavDb(null, null);
      render(); return;
    }
    stav.email = session.user.email; stav.uid = session.user.id;
    Promise.all([
      db.from("profily").select("meno, rola, aktivny").eq("id", session.user.id).single(),
      db.rpc("moje_moduly")
    ]).then(function (v) {
      var p = v[0].data;
      stav.nacitavam = false;
      if (!p || !p.aktivny) { stav.rola = null; stav.sprava = { typ: "chyba", text: "Účet nie je aktívny. Kontaktujte vedenie." }; db.auth.signOut({ scope: "local" }); render(); return; }
      stav.rola = p.rola; stav.pouzivatel = p.meno || session.user.email;
      stav.dbModuly = v[1].data || [];
      if (SKLAD && SKLAD.nastavDb) SKLAD.nastavDb(interny() ? db : null, stav.rola);
      if (FURM) FURM.nastavDb(interny() ? db : null, stav.rola);
      if (ROZ) ROZ.nastavDb(db, stav.rola);
      if (OBJ) OBJ.nastavDb(db, stav.rola);
      if (BAL) BAL.nastavDb(interny() ? db : null, stav.rola);
      if (TRA) TRA.nastavDb(interny() ? db : null, stav.rola);
      if (DOCH) DOCH.nastavDb(stav.rola !== "zakaznik" ? db : null, stav.rola);
      if (KNIHA) KNIHA.nastavDb(db, stav.rola);
      if (VYB) VYB.nastavDb(db, stav.rola);
      if (ULO) ULO.nastavDb(db, stav.rola);
      // skratky z ikony appky (dlhé podržanie): ?akcia=vybavit / ?akcia=uloha
      var akcia = AKCIA; AKCIA = null;
      if (akcia) {
        setTimeout(function () {
          if (akcia === "uloha" && ULO) ULO.zadaj();
          if (akcia === "vybavit") { var vt = document.getElementById("v-text"); if (vt) { vt.scrollIntoView({ block: "center" }); vt.focus(); } }
        }, 900);
      }
      if (ZAM) ZAM.nastavDb(stav.rola !== "zakaznik" ? db : null, stav.rola);
      if (CES) CES.nastavDb(stav.rola !== "zakaznik" ? db : null, stav.rola);
      if (window.lbzPush && stav.rola !== "zakaznik") lbzPush.obnov(db);
      if (window.lbzAktivita && stav.rola !== "zakaznik") lbzAktivita.start(db);
      odznakObnov();
      if (CHAT) { CHAT.nastavDb(stav.rola !== "zakaznik" ? db : null, stav.rola); if (START_K) { CHAT.otvorKonv(START_K); START_K = null; } }
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

  // moduly si dotiahli údaje pre kartu na Prehľade
  root.addEventListener("toggle", function (e) { if (e.target.classList && e.target.classList.contains("prisposobit")) stav.prisposobit = e.target.open; }, true);
  window.addEventListener("lbz-prekresli", function () { if (stav.rola && stav.modul === "prehlad") render(); });
  window.addEventListener("lbz-aktivita", function () { if (stav.rola && stav.modul === "prehlad" && !document.querySelector(".f-dialog, .lbz-dlg")) render(); });

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
