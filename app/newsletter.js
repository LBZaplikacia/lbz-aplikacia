// LBZ aplikácia – modul Newsletter (IT, CEO, zákaznícky servis)
// Zoznam automatických newsletterov (plánovač v Supabase), najbližšie odoslania podľa furmaniek, odoslané kampane a náhľad e-mailu.
(function () {
  "use strict";

  var DB = null, ROLA = null, koren = null;
  var V = { data: null, chyba: null, nahlad: null, nahladDatum: null, nahladChyba: null, nacitavaNahlad: false };
  var ROLY_OK = ["it", "ceo", "zakaznicky_servis"];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function rpc(n, a) { return DB.rpc(n, a || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function chybaText(e) { return (e && (e.message || e.text)) || "Bez spojenia so serverom"; }
  var DNI = ["ne", "po", "ut", "st", "št", "pi", "so"];
  function datum(s, sDnom) {
    if (!s) return "";
    var p = String(s).slice(0, 10).split("-");
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return (sDnom ? DNI[d.getUTCDay()] + " " : "") + +p[2] + ". " + +p[1] + ".";
  }
  function cas(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    return d.toLocaleDateString("sk-SK", { day: "numeric", month: "numeric", timeZone: "Europe/Bratislava" }) + " " +
      d.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bratislava" });
  }
  // „40 3 * * *“ (UTC) → miestny čas dnes
  function cronCas(c) {
    var m = String(c || "").split(" ");
    if (m.length < 2 || isNaN(+m[0]) || isNaN(+m[1])) return c || "";
    var d = new Date(); d.setUTCHours(+m[1], +m[0], 0, 0);
    return d.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bratislava" });
  }

  // popis automatík (časy a stav berieme zo servera)
  var AUTOMATY = [
    { kody: ["newsletter-leto", "newsletter-zima"], ikona: "📰", nazov: "Ranný newsletter furmanky", kedy: "denne o 7:42",
      popis: "Deň pred furmankou, ak je furmanka otvorená a trasa trvá menej ako 11 h. Ide segmentu danej furmanky a segmentu Maloobchod (nezaradení). Každá furmanka dostane newsletter najviac raz. Predmet sa strieda každý týždeň (8 variantov), produkty, fotka a darčekový poukaz sa vyberajú náhodne." },
    { kody: ["ecomail-triedenie"], ikona: "🗂️", nazov: "Triedenie kontaktov do furmaniek (Ecomail)",
      popis: "Zákazníkom zmeneným v Upgates doplní trasu podľa adresy doručenia (6 furmaniek, B2B, Nezaradené). Podľa nej sa skladajú segmenty newslettera." },
    { kody: ["ecomail-novi"], ikona: "➕", nazov: "Noví zákazníci z Upgates do Ecomailu",
      popis: "Pridá nových zákazníkov so súhlasom s newsletterom, ktorí v Ecomaile ešte nie sú (bez duplicít)." },
    { kody: [], ikona: "✉️", nazov: "E-mail o presune objednávky", kedy: "hneď pri presune",
      popis: "Keď sa objednávka presunie na inú furmanku, zákazník dostane e-mail s novým termínom (transakčný e-mail Ecomailu, nie newsletter)." }
  ];

  function nacitaj() {
    if (!DB) return;
    rpc("newsletter_prehlad").then(function (d) {
      if (!d || d.ok === false) { V.chyba = (d && d.text) || "Chyba"; V.data = null; }
      else { V.chyba = null; V.data = d; }
      prekresli();
    }).catch(function (e) { V.chyba = chybaText(e); prekresli(); });
  }

  function nacitajNahlad(den) {
    if (!DB || V.nacitavaNahlad) return;
    V.nacitavaNahlad = true; V.nahladDatum = den; V.nahladChyba = null; V.nahlad = null; prekresli();
    DB.functions.invoke("web", { body: { akcia: "newsletter", nahlad: true, datum: den } }).then(function (r) {
      V.nacitavaNahlad = false;
      if (r.error) throw r.error;
      var d = r.data || {};
      var f = (d.furmanky || []).filter(function (x) { return x.html; })[0];
      if (!f) {
        var dov = (d.furmanky || []).map(function (x) { return x.region + ": " + (x.dovod || x.chyba || "nič"); }).join(", ");
        V.nahladChyba = d.text || (dov ? "Na tento deň by newsletter neodišiel – " + dov : "Na tento deň nie je žiadna furmanka.");
      } else V.nahlad = f;
      prekresli();
    }).catch(function (e) { V.nacitavaNahlad = false; V.nahladChyba = chybaText(e); prekresli(); });
  }

  function kartaAutomaty() {
    var auto = (V.data && V.data.automaty) || [];
    var h = '<section class="card"><h3>⚙️ Automatické newslettre a e-maily</h3><div class="nl-auto">';
    AUTOMATY.forEach(function (a) {
      var jobs = auto.filter(function (j) { return a.kody.indexOf(j.kod) >= 0; });
      var aktivny = a.kody.length ? jobs.some(function (j) { return j.aktivny; }) : true;
      var kedy = a.kedy || (jobs[0] ? "denne o " + cronCas(jobs[0].cas) : "");
      var posl = null;
      jobs.forEach(function (j) { if (j.posledny && (!posl || j.posledny.cas > posl.cas)) posl = j.posledny; });
      h += '<div class="nl-a"><div class="nl-a-h"><b>' + a.ikona + " " + esc(a.nazov) + "</b> " +
        '<span class="pill ' + (aktivny ? "ok" : "warn") + '">' + (aktivny ? "zapnuté" : "vypnuté") + "</span></div>" +
        '<div class="muted nl-a-k">🕒 ' + esc(kedy) + (posl ? " · naposledy " + esc(cas(posl.cas)) + (posl.stav && posl.stav !== "succeeded" ? " (" + esc(posl.stav) + ")" : "") : "") + "</div>" +
        '<div class="nl-a-p">' + esc(a.popis) + "</div></div>";
    });
    return h + "</div></section>";
  }

  function kartaNajblizsie() {
    var n = (V.data && V.data.najblizsie) || [];
    var h = '<section class="card"><h3>📅 Najbližšie newslettre</h3>';
    if (!n.length) return h + '<p class="muted">V najbližších 3 týždňoch nie je žiadna furmanka.</p></section>';
    h += '<div class="rows">';
    n.forEach(function (f) {
      var dovod = f.posle ? "" : f.stav !== "otvorena" ? (f.stav === "full" ? "furmanka je plná" : "furmanka nie je otvorená") : "trasa ≥ 11 h";
      h += '<div class="row nl-r"><span><b>' + esc(datum(f.odoslanie, true)) + "</b> 7:42 → " + esc(f.region) + " " + esc(datum(f.datum)) + "</span>" +
        '<span class="nl-r-p">' + (f.posle ? '<span class="pill ok">odíde</span>' : '<span class="pill info" title="' + esc(dovod) + '">neodíde – ' + esc(dovod) + "</span>") +
        (f.posle ? ' <button class="btn nl-mini" type="button" data-nl="nahlad" data-den="' + esc(f.datum) + '">👁 Náhľad</button>' : "") + "</span></div>";
    });
    return h + "</div><p class=\"muted\" style=\"margin:0;font-size:13px\">Stav sa môže zmeniť – ak sa furmanka zaplní, newsletter neodíde.</p></section>";
  }

  function kartaNahlad() {
    var n = (V.data && V.data.najblizsie) || [];
    var prvy = n.filter(function (f) { return f.posle; })[0];
    var h = '<section class="card nl-nahlad"><h3>👁 Náhľad e-mailu</h3>';
    if (V.nacitavaNahlad) return h + '<div class="empty">Pripravujem náhľad (' + esc(datum(V.nahladDatum, true)) + ")…</div></section>";
    if (V.nahladChyba) h += '<div class="empty">' + esc(V.nahladChyba) + "</div>";
    if (!V.nahlad) {
      return h + '<p class="muted" style="margin:0">Ukážka, ako vyzerá ranný newsletter. Nič sa neodošle.</p>' +
        (prvy ? '<p><button class="btn btn-primary" type="button" data-nl="nahlad" data-den="' + esc(prvy.datum) + '">👁 Zobraziť náhľad – ' + esc(prvy.region) + " " + esc(datum(prvy.datum)) + "</button></p>" : '<p class="muted">Najbližšie dni nie je furmanka, pre ktorú by newsletter odišiel.</p>') + "</section>";
    }
    var f = V.nahlad;
    h += '<div class="rows"><div class="row"><span>Predmet</span><span><b>' + esc(f.predmet) + "</b></span></div>" +
      '<div class="row"><span>Furmanka</span><span>' + esc(f.region) + " " + esc(datum(f.datum, true)) + "</span></div>" +
      '<div class="row"><span>Komu</span><span>segment ' + esc(f.region) + " + Maloobchod</span></div></div>" +
      '<p class="muted" style="margin:0;font-size:13px">Produkty, fotka a poukaz sa pri každom odoslaní vyberajú náhodne. Oslovenie: „Ahoj [meno],“ – kto nemá v Ecomaile meno, dostane „Milý milovník buchiet,“.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" data-nl="nahlad" data-den="' + esc(f.datum) + '">🔄 Iný náhodný výber</button>' +
      '<button class="btn" type="button" data-nl="zavri">✕ Zavrieť náhľad</button></div>' +
      '<iframe class="nl-frame" title="Náhľad newslettera" sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe>';
    return h + "</section>";
  }

  function kartaOdoslane() {
    var o = (V.data && V.data.odoslane) || [];
    var h = '<section class="card"><h3>📤 Odoslané automaticky</h3>';
    if (!o.length) return h + '<p class="muted">Zatiaľ nič – prvý automatický newsletter odíde pri najbližšej otvorenej furmanke.</p></section>';
    h += '<div class="rows">' + o.map(function (l) {
      var t = String(l.text || "").replace(/^newsletter\s+/i, "");
      return '<div class="row"><span class="num">' + esc(cas(l.cas)) + "</span><span>" + esc(t) + "</span></div>";
    }).join("") + "</div>";
    return h + "</section>";
  }

  function prekresli() {
    if (!koren || !koren.isConnected) return;
    var h = '<div class="nl">';
    h += '<header class="page-head"><h2>📰 Newsletter</h2><p class="muted">Automatické newslettre cez Ecomail – čo je nastavené, kedy čo odíde a ako to vyzerá.</p></header>';
    if (V.chyba) h += '<div class="empty">' + esc(V.chyba) + "</div>";
    else if (!V.data) h += '<div class="empty">Načítavam…</div>';
    else h += '<div class="nl-grid">' + kartaAutomaty() + kartaNajblizsie() + "</div>" + kartaNahlad() + kartaOdoslane();
    koren.innerHTML = h + "</div>";
    var fr = koren.querySelector(".nl-frame");
    if (fr && V.nahlad) fr.srcdoc = String(V.nahlad.html || "").replace(/<head>/i, '<head><base target="_blank">');
  }

  function klik(e) {
    var t = e.target.closest("[data-nl]"); if (!t) return;
    var a = t.dataset.nl;
    if (a === "nahlad") { nacitajNahlad(t.dataset.den); var n = koren.querySelector(".nl-nahlad"); if (n && n.scrollIntoView) n.scrollIntoView({ behavior: "smooth", block: "start" }); }
    else if (a === "zavri") { V.nahlad = null; V.nahladChyba = null; prekresli(); }
  }

  window.LBZ_NEWSLETTER = {
    nastavDb: function (klient, rola) { DB = klient || null; ROLA = klient ? rola : null; V.data = null; V.chyba = null; V.nahlad = null; V.nahladChyba = null; },
    mozem: function () { return !!DB && ROLY_OK.indexOf(ROLA) >= 0; },
    mount: function (el) { koren = el; el.addEventListener("click", klik); prekresli(); nacitaj(); }
  };
})();
