// LBZ aplikácia – modul Trasa (pre furmana, spoločný účet furman@)
// Trasu vytvorí zákaznícky servis vo Furmankách (čas odchodu → poradie a časy príchodov cez Google Mapy).
// Furman: navigácia (po 9 zastávkach), volanie, QR pre kasu pri dobierke, Doručené / Nedoručené, poznámka, fotka,
// Ukončiť rozvoz → furmanka ide do Archívu, nedoručené do zvolenej furmanky alebo do najbližšej otvorenej furmanky regiónu.
// Sledovanie: furman (po písomnom súhlase v appke) posiela v deň rozvozu polohu každých ~30 s – zákazník ju vidí na sledovanie.html,
// zákaznícky servis / IT / CEO v režime 🗺️ Mapa (celá trasa, auto, cesta k ďalšej zastávke, meškanie).

(function () {
  "use strict";

  var DB = null, ROLA = null, EMAIL = "", koren = null;
// rozvoz (GPS, vybavovanie zastávok) len na služobnom účte furman@; súkromný účet furmana vidí len plán trasy na Prehľade
function sluzobny() { return ROLA !== "furman" || String(EMAIL || "").toLowerCase() === "furman@legendarnebuchty.sk"; }
  var T = { id: null, zoznam: null, data: null, sprava: null, nacitavam: false, dialog: null, fotky: {}, prace: 0 };
  (function () { var p = window.lbzPamat && lbzPamat.nacitaj("trasa"); if (p && p.id != null) { T.id = p.id; T.rezim = p.rezim || "jazda"; T.akt = p.akt || null; } })();
  var START = "Sedlo Zbojská, 976 56 Pohronská Polhora";
  var NA_MIESTE_M = 50;   // do koľkých metrov od zastávky sa ukáže „na mieste“ (Zaplatiť / Doručené)

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function rpc(nazov, args) { return DB.rpc(nazov, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function chybaText(e) { return (e && (e.message || e.text)) || "Bez spojenia so serverom"; }
  function cas(t) { return t ? new Date(t).toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" }) : ""; }
  function datumSk(s) { if (!s) return ""; var p = String(s).slice(0, 10).split("-"); var d = new Date(+p[0], +p[1] - 1, +p[2], 12); return d.toLocaleDateString("sk-SK", { weekday: "short", day: "numeric", month: "numeric" }); }
  function eur(n) { return Number(n || 0).toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
  function dobierka(z) { return z.platba !== "ZAPLATENÉ" && z.platba !== "NA FAKTÚRU"; }
  function mapa(adresa) { return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(adresa); }
  function tel(t) { return "tel:" + String(t || "").replace(/[^\d+]/g, ""); }
  // odpovede zákazníka na SMS (GoSMS → webhook → appka)
  function odpovedeHtml(z) {
    var o = z.odpovede || [];
    var sms = z.sms_cestou ? "📱 SMS „na ceste“ " + cas(z.sms_cestou) : z.sms_den ? "📱 SMS deň vopred odoslaná" : "";
    if (!o.length) return sms ? '<p class="muted t-sms-info">' + esc(sms) + "</p>" : "";
    return '<div class="t-sms-odp"><b>💬 Zákazník odpísal na SMS:</b>' + o.map(function (x) {
      return '<p><span class="num muted">' + esc(new Date(x.prijata).toLocaleString("sk-SK", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })) + "</span> " + esc(x.text) + "</p>";
    }).join("") + (sms ? '<span class="muted">' + esc(sms) + "</span>" : "") + "</div>";
  }

  // ---------- načítanie ----------
  function nacitajZoznam() {
    T.nacitavam = true; prekresli();
    return rpc("trasa_zoznam").then(function (d) {
      T.nacitavam = false;
      if (!d || d.ok === false) T.sprava = { typ: "chyba", text: (d && d.text) || "Nenačítané" }; else T.zoznam = d.trasy || [];
      prekresli();
    }).catch(function (e) { T.nacitavam = false; T.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }
  function nacitajTrasu(tiho) {
    if (T.id == null) return Promise.resolve();
    if (!tiho) { T.nacitavam = true; prekresli(); }
    return rpc("trasa_data", { p_id: T.id }).then(function (d) {
      T.nacitavam = false;
      if (!d || d.ok === false || !d.trasa) T.sprava = { typ: "chyba", text: (d && d.text) || "Trasa sa nenačítala" }; else T.data = d;
      prekresli();
    }).catch(function (e) { T.nacitavam = false; if (!tiho) T.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }

  // ---------- kreslenie ----------
  function spravaHtml() {
    if (!T.sprava) return "";
    return '<p class="f-sprava f-' + (T.sprava.typ === "ok" ? "ok" : "chyba") + '" role="status">' + esc(T.sprava.text) + ' <button class="btn-link" data-t="zavri-spravu" aria-label="Zavrieť">✕</button></p>';
  }
  var STAV = { naplanovana: ["naplánovaná", ""], na_ceste: ["na ceste", "b-st-rozp"], ukoncena: ["ukončená", "b-st-ok"] };
  function stavPill(s) { var x = STAV[s] || STAV.naplanovana; return '<span class="b-st ' + x[1] + '">' + x[0] + "</span>"; }

  function pohladZoznam() {
    var head = '<div class="head"><div><h2>Trasa</h2><div class="sub">Rozvozy pripravené zákazníckym servisom' + (T.nacitavam ? " · načítavam…" : "") + '</div></div>' +
      '<span class="head-tl"><button class="btn btn-ikona" data-t="obnov" aria-label="Obnoviť">↻</button></span></div>';
    var z = T.zoznam;
    if (!z) return head + spravaHtml() + '<div class="empty"><strong>' + (T.nacitavam ? "Načítavam…" : "Nenačítané") + "</strong></div>";
    if (!z.length) return head + spravaHtml() + '<div class="empty"><strong>Zatiaľ nie je naplánovaná žiadna trasa</strong><span class="muted">Trasu vytvára zákaznícky servis vo Furmankách.</span></div>';
    var karta = function (t) {
      return '<button class="card t-karta t-karta-' + esc(t.stav) + '" data-t-otvor="' + t.id + '"><span class="t-k-hore"><b>' + esc(datumSk(t.datum)) + "</b>" + stavPill(t.stav) + "</span>" +
        '<span class="t-k-nazov">' + esc(t.nazov) + "</span>" +
        '<span class="muted">odchod <b class="num">' + esc(cas(t.odchod)) + '</b> · návrat ~<span class="num">' + esc(cas(t.navrat)) + "</span></span>" +
        '<span class="muted"><span class="num">' + t.hotovo + " / " + t.pocet + "</span> zastávok vybavených</span></button>";
    };
    var aktivne = z.filter(function (t) { return t.stav !== "ukoncena"; }), ukoncene = z.filter(function (t) { return t.stav === "ukoncena"; });
    return head + spravaHtml() +
      (aktivne.length ? '<div class="b-furmanky">' + aktivne.map(karta).join("") + "</div>" : '<div class="empty"><strong>Žiadny rozvoz na ceste ani naplánovaný</strong></div>') +
      (ukoncene.length ? '<details class="t-ukoncene"><summary>✅ Ukončené rozvozy (' + ukoncene.length + ')</summary><div class="b-furmanky">' + ukoncene.map(karta).join("") + "</div></details>" : "");
  }

  // odkazy na Google Mapy po 9 zastávkach (ako starý skript): /maps/dir/<odkiaľ>/<zastávka>/…; prázdny začiatok = moja poloha
  function navOdkazy(zast, odStartu) {
    // bod = súradnice (ak sú), inak adresa bez „/“ (Google Mapy „/“ v adrese rozdelia na dve zastávky)
    function bod(z) { return z.lat != null && z.lng != null ? z.lat + "," + z.lng : String(z.adresa).replace(/\//g, " "); }
    var body = zast.filter(function (z) { return (z.lat != null && z.lng != null) || (!z.bez_gps && z.adresa); });
    var out = [], N = 9;
    for (var i = 0; i < body.length; i += N) {
      var kus = body.slice(i, i + N), posl = i + N >= body.length;
      var zac = i === 0 ? (odStartu ? START : "") : bod(body[i - 1]);
      var body2 = kus.map(bod); if (posl && body2.length < N) body2.push(START);
      out.push({ od: kus[0].poradie || i + 1, po: kus[kus.length - 1].poradie || Math.min(i + N, body.length), url: "https://www.google.com/maps/dir/" + [zac].concat(body2).map(function (a) { return encodeURIComponent(a).replace(/%20/g, "+").replace(/%2C/g, ","); }).join("/") });
    }
    return out;
  }
  function navigacia(zast, mala) {
    var caka = zast.filter(function (z) { return z.stav === "caka"; });
    var odk = navOdkazy(caka, false); if (!odk.length) return "";
    return '<div class="t-navlista' + (mala ? " t-navlista-mala" : "") + '">' + odk.map(function (x) {
      return '<a class="btn t-nav" href="' + x.url + '" target="_blank" rel="noopener">🧭 Navigovať ' + (odk.length > 1 ? "zastávky " + x.od + "–" + x.po : "celú trasu") + "</a>";
    }).join("") + "</div>";
  }

  // poznámka k objednávke: ťuknutím sa otvorí na úpravu (prázdna = ťuknutím sa doplní); navrch položky okrem mrazených buchiet
function poznObjHtml(z, trieda, ikona) {
var smie = T.data && T.data.trasa && T.data.trasa.stav !== "ukoncena";
var ine = z.ine ? '<p class="s-varovanie t-z-ine">🎁 Okrem buchiet: <b>' + esc(z.ine) + "</b></p>" : "";
var attr = smie ? ' data-t-akcia="pozn_obj" data-c="' + esc(z.cislo) + '" role="button" tabindex="0" title="Ťuknite pre úpravu" style="cursor:pointer"' : "";
if (z.pozn_obj) return ine + '<p class="' + trieda + '"' + attr + ">" + ikona + esc(z.pozn_obj) + (smie ? ' <span class="muted">✏️</span>' : "") + "</p>";
return ine + (smie ? '<p class="muted"' + attr.replace('style="cursor:pointer"', 'style="cursor:pointer;border:1px dashed currentColor;border-radius:8px;padding:6px 10px;margin:6px 0"') + ">➕ Doplniť poznámku k objednávke</p>" : "");
}
function zastavkaHtml(z, i) {
    var dob = dobierka(z), vybav = z.stav !== "caka";
    var qr = dob && z.faktura && window.LBZ_QR ? '<details class="t-qr"><summary>QR pre kasu (' + esc(eur(z.suma)) + ")</summary>" +
      window.LBZ_QR.svg(z.faktura + ";" + Math.round(Number(z.suma || 0) * 100), 160) + "</details>" : "";
    var foto = z.foto ? (T.fotky[z.foto] ? '<img class="t-foto" src="' + esc(T.fotky[z.foto]) + '" alt="Fotka zo zastávky">' : '<span class="muted">📷 fotka uložená</span>') : "";
    if (z.foto && !T.fotky[z.foto]) nacitajFotku(z.foto);
    return '<section class="card t-zast t-' + z.stav + '" id="t-z-' + esc(z.cislo) + '">' +
      (z.stav === "caka" && T.data.trasa.stav !== "ukoncena" ? '<button class="btn t-vybrat" data-t-vyber="' + esc(z.cislo) + '">🚚 Ísť sem</button>' : "") +
      '<div class="t-z-hore"><span class="t-z-cislo num">' + (z.poradie || i + 1) + "</span>" +
        '<span class="t-z-cas num">' + (z.eta ? esc(cas(z.eta)) : "—") + "</span>" +
        (z.stav === "dorucene" ? '<span class="b-st b-st-ok">✓ doručené ' + esc(cas(z.cas)) + "</span>" : z.stav === "nedorucene" ? '<span class="b-st b-st-odl">✗ nedoručené</span>' : "") +
        (z.bez_gps ? '<span class="b-st b-st-odl">adresa nenájdená</span>' : "") + "</div>" +
      '<h3 class="t-z-meno">' + esc(z.meno || z.firma || "-") + "</h3>" +
      '<a class="t-z-adresa" href="' + mapa(z.adresa) + '" target="_blank" rel="noopener">📍 ' + esc(z.adresa || "-") + "</a>" +
      (z.telefon ? '<a class="t-z-tel" href="' + tel(z.telefon) + '">📞 ' + esc(z.telefon) + "</a>" : "") +
      '<div class="t-z-platba ' + (dob ? "t-dob" : "") + '">' + (dob ? "💶 DOBIERKA " + esc(eur(z.suma)) : z.platba === "NA FAKTÚRU" ? "🧾 NA FAKTÚRU" : "✅ ZAPLATENÉ") +
        '<span class="muted"> · ' + esc(z.kusy) + " ks" + (z.faktura ? " · fa " + esc(z.faktura) : "") + " · obj. " + esc(z.cislo) + "</span></div>" +
      poznObjHtml(z, "s-varovanie s-varovanie-info t-z-pozn", "") +
      odpovedeHtml(z) +
      (z.poznamka ? '<p class="t-z-moja">📝 ' + esc(z.poznamka) + (z.presun_nazov ? " · presun: " + esc(z.presun_nazov) : z.presun_datum ? " · nový termín " + esc(datumSk(z.presun_datum)) : "") + "</p>" : "") +
      foto + qr +
      (T.data.trasa.stav === "ukoncena" ? "" : '<div class="t-z-tl">' +
        (vybav ? '<button class="btn" data-t-akcia="spat" data-c="' + esc(z.cislo) + '">↩️ Späť</button>'
          : '<button class="btn t-tl-ok" data-t-akcia="dorucene" data-c="' + esc(z.cislo) + '">✅ Doručené</button>' +
            '<button class="btn t-tl-nie" data-t-akcia="nedorucene" data-c="' + esc(z.cislo) + '">❌ Nedoručené</button>') +
        '<button class="btn" data-t-akcia="poznamka" data-c="' + esc(z.cislo) + '">📝</button>' +
        '<label class="btn t-foto-tl" title="Fotka">📷<input type="file" accept="image/*" capture="environment" data-t-foto="' + esc(z.cislo) + '" hidden></label></div>') +
      "</section>";
  }

  // ---------- režim JAZDA: jedna zastávka naraz ----------
  function zastavky() { return (T.data && T.data.zastavky) || []; }
  function najdi(c) { return zastavky().filter(function (x) { return x.cislo === c; })[0] || null; }
  function dalsiaCaka(poCisle) {
    var z = zastavky(), i0 = -1;
    if (poCisle) z.forEach(function (x, i) { if (x.cislo === poCisle) i0 = i; });
    for (var i = i0 + 1; i < z.length; i++) if (z[i].stav === "caka") return z[i];
    for (var k = 0; k <= i0 && k < z.length; k++) if (z[k].stav === "caka") return z[k];
    return null;
  }
  function aktualna() {
    var a = T.akt && najdi(T.akt);
    if (!a || (a.stav !== "caka" && !T.drzAkt)) { a = dalsiaCaka(null); T.akt = a ? a.cislo : null; }
    return a;
  }
  function vzdialenost(z) {
    if (!T.gps || z.lat == null || z.lng == null) return null;
    var r = 6371000, f1 = T.gps.lat * Math.PI / 180, f2 = z.lat * Math.PI / 180, df = (z.lat - T.gps.lat) * Math.PI / 180, dl = (z.lng - T.gps.lng) * Math.PI / 180;
    var a = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function navUrl(z) {
    var ciel = z.lat != null && z.lng != null ? z.lat + "," + z.lng : z.adresa;
    return "https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=" + encodeURIComponent(ciel);
  }
  // listovanie v Jazde: predchádzajúca / nasledujúca zastávka (aj vybavené a preskočené)
function listovanieHtml(z, a) {
var i = z.indexOf(a);
return '<div class="t-listovanie" style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin:0 0 8px">' +
'<button class="btn" data-t-list="-1"' + (i <= 0 ? " disabled" : "") + ">◀ Predchádzajúca</button>" +
'<span class="muted num">' + (i + 1) + " / " + z.length + "</span>" +
'<button class="btn" data-t-list="1"' + (i >= z.length - 1 ? " disabled" : "") + ">Nasledujúca ▶</button></div>";
}
function jazdaHtml(t) {
    var z = zastavky(), a = aktualna();
    var hotovo = z.filter(function (x) { return x.stav !== "caka"; }).length;
    if (a && a.stav !== "caka" && !dalsiaCaka(null) && !T.prezera) a = null;   // posledná zastávka vybavená → rovno koniec rozvozu
    if (!a) {
      var nDor = z.filter(function (x) { return x.stav === "dorucene"; }).length, nNie = z.filter(function (x) { return x.stav === "nedorucene"; }).length;
      return '<section class="card t-hotovo"><div class="t-velke">🎉</div><h3>Všetky zastávky sú vybavené</h3>' +
        '<p class="t-hotovo-suhrn"><span class="b-st b-st-ok">✓ doručené ' + nDor + "</span>" + (nNie ? ' <span class="b-st b-st-odl">✗ nedoručené ' + nNie + "</span>" : "") + "</p>" +
        (t.stav === "ukoncena" ? '<p class="muted">Rozvoz ukončený ' + esc(cas(t.ukoncena)) + ".</p>" : '<button class="btn btn-primary t-velke-tl t-koniec" data-t="ukoncit">🏁 UKONČIŤ ROZVOZ</button>') +
(z.length ? '<button class="btn" data-t-list="koniec" style="margin-top:8px">◀ Prezrieť zastávky</button>' : "") + "</section>";
    }
    var poradie = z.indexOf(a) + 1, dob = dobierka(a), vzd = vzdialenost(a), naMieste = T.naMieste === a.cislo || (vzd != null && vzd < NA_MIESTE_M);
    var vybav = a.stav !== "caka";
    return listovanieHtml(z, a) + '<section class="card t-akt' + (naMieste ? " t-akt-miesto" : "") + '">' +
      '<div class="t-akt-hore"><span class="t-z-cislo num">' + poradie + '</span><span class="muted">zastávka ' + poradie + " z " + z.length + (a.eta ? ' · príchod <b class="num">' + esc(cas(a.eta)) + "</b>" : "") + "</span>" +
        (vzd != null ? '<span class="t-vzd num">' + (vzd < 1000 ? Math.round(vzd) + " m" : (vzd / 1000).toFixed(1).replace(".", ",") + " km") + "</span>" : "") + "</div>" +
      '<h2 class="t-akt-meno">' + esc(a.meno || a.firma || "-") + "</h2>" +
      (a.adresa || (a.lat != null && a.lng != null) ? '<a class="t-akt-adresa t-akt-adresa-nav" href="' + navUrl(a) + '" target="_blank" rel="noopener" data-t-nav="' + esc(a.cislo) + '">📍 ' + esc(a.adresa || "-") + "</a>" +
          (a.lat != null && a.lng != null && !vybav ? '<div class="t-gmapa-obal"><div id="t-gmapa-miesto" class="t-gmapa-miesto"></div>' +
            '<a class="btn t-gmapa-nav" href="' + navUrl(a) + '" target="_blank" rel="noopener" data-t-nav="' + esc(a.cislo) + '">🧭 Navigovať</a></div>' : "")
        : '<div class="t-akt-adresa">📍 -</div>') +
      '<div class="t-akt-platba ' + (dob ? "t-dob" : a.platba === "NA FAKTÚRU" ? "t-fa" : "t-ok") + '">' + (dob ? "💶 DOBIERKA " + esc(eur(a.suma)) : a.platba === "NA FAKTÚRU" ? "🧾 NA FAKTÚRU" : "✅ ZAPLATENÉ") +
        '<span> · ' + esc(a.kusy) + " ks</span></div>" +
      poznObjHtml(a, "s-varovanie t-akt-pozn", "⚠️ ") +
      odpovedeHtml(a) +
      (a.poznamka ? '<p class="t-z-moja">📝 ' + esc(a.poznamka) + "</p>" : "") +
      (vybav ? '<p class="f-sprava f-ok">' + (a.stav === "dorucene" ? "✓ Doručené " + esc(cas(a.cas)) : "✗ Nedoručené") + "</p>" : "") +
      (t.stav === "ukoncena" ? "" : !naMieste && !vybav ?
        '<div class="t-akt-tl">' +
        (a.telefon ? '<a class="btn t-velke-tl t-tl-tel" href="' + tel(a.telefon) + '">📞 ZAVOLAŤ</a>' : "") +
        '<button class="btn t-velke-tl t-tl-miesto" data-t-miesto="' + esc(a.cislo) + '">📍 SOM NA MIESTE</button></div>'
        : !vybav ?
        '<div class="t-akt-tl">' + (dob ? '<button class="btn t-velke-tl t-tl-plat" data-t-akcia="platba" data-c="' + esc(a.cislo) + '">💳 ZAPLATIŤ ' + esc(eur(a.suma)) + "</button>" : "") +
        '<button class="btn t-velke-tl t-tl-ok" data-t-akcia="dorucene" data-c="' + esc(a.cislo) + '">✅ DORUČENÉ</button>' +
        '<button class="btn t-velke-tl t-tl-nie" data-t-akcia="nedorucene" data-c="' + esc(a.cislo) + '">❌ NEDORUČENÉ</button>' +
        (a.telefon ? '<a class="btn t-tl-tel2" href="' + tel(a.telefon) + '">📞 Zavolať</a>' : "") + "</div>"
        : '<div class="t-akt-tl"><button class="btn t-velke-tl btn-primary" data-t="dalsia">➡️ ĎALŠIA ZASTÁVKA</button></div>') +
      (t.stav === "ukoncena" ? "" : '<div class="t-akt-male"><button class="btn" data-t-akcia="poznamka" data-c="' + esc(a.cislo) + '">📝 Poznámka</button>' +
        '<label class="btn t-foto-tl">📷 Fotka<input type="file" accept="image/*" capture="environment" data-t-foto="' + esc(a.cislo) + '" hidden></label>' +
        (!vybav ? '<button class="btn" data-t="preskocit">⏭️ Preskočiť</button>' : '<button class="btn" data-t-akcia="spat" data-c="' + esc(a.cislo) + '">↩️ Späť</button>') + "</div>") +
      "</section>" +
      '<p class="muted t-akt-stav">Vybavené ' + hotovo + " z " + z.length + (T.gpsChyba ? " · GPS vypnuté – „Som na mieste“ stlačte ručne" : "") + (rozvozBezi() ? " · 📱 nechaj obrazovku zapnutú" : "") + "</p>";
  }
  function pohladTrasa() {
    var d = T.data, t = d && d.trasa;
    var head = '<div class="head"><div><button class="btn-link spat" data-t="spat">← Trasy</button><h2>' + esc(t ? t.nazov : "Trasa") + "</h2>" +
      (t ? '<div class="sub">odchod <b class="num">' + esc(cas(t.odchod)) + '</b> · návrat ~<span class="num">' + esc(cas(t.navrat)) + "</span>" + (t.hodiny ? " · " + String(t.hodiny).replace(".", ",") + " h" : "") + (T.nacitavam ? " · načítavam…" : "") + "</div>" : "") +
      "</div>" + (t ? '<span class="head-tl">' + stavPill(t.stav) + '<button class="btn btn-ikona" data-t="tlac" aria-label="Tlačiť">🖨️</button><button class="btn btn-ikona" data-t="obnov" aria-label="Obnoviť">↻</button></span>' : "") + "</div>";
    if (!d) return head + spravaHtml() + '<div class="empty"><strong>Načítavam…</strong></div>';
    var z = d.zastavky || [];
    var caka = z.filter(function (x) { return x.stav === "caka"; }).length, hotovo = z.length - caka;
    var rez = T.rezim || "jazda"; if (rez === "mapa" && ROLA === "furman") rez = "jazda";
    var prep = '<div class="f-seg t-rezim" role="group">' + (ROLA !== "furman" ? '<button data-t-rezim="mapa" aria-pressed="' + (rez === "mapa") + '">🗺️ Mapa</button>' : "") + '<button data-t-rezim="jazda" aria-pressed="' + (rez === "jazda") + '">🚚 Jazda</button>' +
      '<button data-t-rezim="zoznam" aria-pressed="' + (rez === "zoznam") + '">📋 Zoznam (' + hotovo + "/" + z.length + ")</button></div>";
    var prog = '<div class="b-prog" aria-label="Vybavené ' + hotovo + " z " + z.length + '"><span style="width:' + (z.length ? Math.round(100 * hotovo / z.length) : 0) + '%"></span></div>';
    if (rez === "mapa") return head + spravaHtml() + prog + prep + mapaZsHtml(t);
if (rez === "jazda") return head + spravaHtml() + prog + prep + jazdaHtml(t) + (t.stav !== "ukoncena" ? navigacia(z, true) : "");
    return head + spravaHtml() + prog + prep +
      (t.stav !== "ukoncena" ? navigacia(z) : "") +
      '<p class="muted t-dalsia">Ťuknite na zastávku, ktorou chcete pokračovať.</p>' +
      z.map(zastavkaHtml).join("") +
      (t.stav === "ukoncena" ? '<p class="f-sprava f-ok">Rozvoz ukončený ' + esc(cas(t.ukoncena)) + ".</p>"
        : '<button class="btn btn-primary t-koniec" data-t="ukoncit"' + (caka ? " disabled" : "") + ">🏁 Ukončiť rozvoz" + (caka ? " (zostáva " + caka + ")" : "") + "</button>");
  }

  function dialogHtml() {
    var D = T.dialog; if (!D) return "";
    var z = ((T.data && T.data.zastavky) || []).filter(function (x) { return x.cislo === D.cislo; })[0] || {};
    if (D.typ === "platba") {
      var kod = (z.faktura || z.cislo) + ";" + Math.round(Number(z.suma || 0) * 100);
      return '<div class="t-plat" role="dialog" aria-modal="true" aria-label="Platba">' +
        '<div class="t-plat-suma num">' + esc(eur(z.suma)) + '</div><div class="t-plat-kto">' + esc(z.meno || z.firma || "") + (z.faktura ? " · faktúra " + esc(z.faktura) : "") + "</div>" +
        '<div class="t-plat-qr">' + (window.LBZ_QR ? window.LBZ_QR.svg(kod, 300) : esc(kod)) + '</div><div class="muted">Naskenujte QR v kase – načíta sa faktúra a suma</div>' +
        '<div class="t-plat-tl"><button class="btn t-velke-tl t-tl-ok" data-t-akcia="zaplatene" data-c="' + esc(z.cislo) + '">✅ ZAPLATENÉ – DORUČENÉ</button>' +
        '<button class="btn t-velke-tl" data-t="zavri">Späť</button></div></div>';
    }
    var nedor = D.typ === "nedorucene";
    return '<div class="f-dialog-pozadie" data-t="zavri"></div><div class="f-dialog" role="dialog" aria-modal="true">' +
      '<div class="f-lista"><h3>' + (nedor ? "❌ Nedoručené – " : D.typ === "pozn_obj" ? "✏️ Poznámka k objednávke – " : "📝 Poznámka – ") + esc(z.meno || z.firma || D.cislo) + '</h3><button class="btn-link" data-t="zavri" aria-label="Zavrieť">✕</button></div>' +
      '<form class="f-form" id="t-dialog-form"><label class="field"><span class="label">' + (nedor ? "Prečo (napr. nikto doma, nedvíha)" : D.typ === "pozn_obj" ? "Poznámka k objednávke – uloží sa do objednávky (vidí ju zákaznícky servis) a zapíše sa aj do Upgates" : "Poznámka (napr. nechané u suseda)") + "</span>" +
      '<textarea id="t-pozn" rows="3"' + (nedor ? " required" : "") + ">" + esc((D.typ === "pozn_obj" ? z.pozn_o : z.poznamka) || "") + "</textarea></label>" +
      (nedor ? '<label class="field"><span class="label">Presunúť do furmanky</span><select id="t-furm"><option value="">Najbližšia otvorená furmanka regiónu (automaticky)</option>' +
      (T.presunFurm || []).map(function (f) { return '<option value="' + f.id + '"' + (String(z.presun_furmanka || "") === String(f.id) ? " selected" : "") + ">" + esc(f.nazov) + (f.stav === "full" ? " (uzavretá)" : "") + "</option>"; }).join("") +
      "</select></label>" + (T.presunFurm == null ? '<p class="muted">Načítavam furmanky…</p>' : "") : "") +
      '<button class="btn ' + (nedor ? "t-tl-nie" : "btn-primary") + '" type="submit">' + (nedor ? "Označiť ako nedoručené" : D.typ === "pozn_obj" ? "Uložiť do objednávky" : "Uložiť poznámku") + "</button></form></div>";
  }

  // ---------- MAPA Google v karte zastávky (bez kľúča, embed). Iframe sa pri prekreslení nevytvára znova – len sa presunie. ----------
  var GM = { el: null, cislo: null };
  function mapaUkaz(miesto) {
    var a = aktualna(); if (!a || a.lat == null || a.lng == null) return;
    if (!GM.el) { GM.el = document.createElement("iframe"); GM.el.className = "t-gmapa"; GM.el.setAttribute("loading", "lazy"); GM.el.setAttribute("referrerpolicy", "no-referrer-when-downgrade"); GM.el.title = "Mapa k zastávke"; }
    // nová zastávka, prvá poloha, alebo sa furman od začiatku trasy na mape posunul o viac ako 1,5 km (najviac raz za 90 s) → trasa z aktuálnej polohy
    var posun = T.gps && GM.s ? vzdialenost({ lat: GM.s.lat, lng: GM.s.lng }) : 0;
    if (GM.cislo !== a.cislo || (!GM.sGps && T.gps) || (posun > 1500 && Date.now() - GM.t > 90000)) {
      GM.cislo = a.cislo; GM.sGps = !!T.gps; GM.s = T.gps ? { lat: T.gps.lat, lng: T.gps.lng } : null; GM.t = Date.now();
      var ciel = a.lat + "," + a.lng;
      GM.el.src = T.gps ? "https://maps.google.com/maps?saddr=" + T.gps.lat + "," + T.gps.lng + "&daddr=" + ciel + "&hl=sk&output=embed"
        : "https://maps.google.com/maps?q=" + ciel + "&z=15&hl=sk&output=embed";
    }
    if (GM.el.parentNode !== miesto) miesto.appendChild(GM.el);
  }

  function prekresli() {
    if (!koren || !koren.isConnected) return;
    var y = window.scrollY;
    koren.innerHTML = suhlasHtml() + (T.id == null ? pohladZoznam() : pohladTrasa()) + dialogHtml();
    if (window.lbzPamat) lbzPamat.uloz("trasa", { id: T.id, rezim: T.rezim, akt: T.akt });
    window.scrollTo(0, y);
    var miesto = document.getElementById("t-gmapa-miesto"); if (miesto) mapaUkaz(miesto);
var zm = document.getElementById("t-zs-miesto"); if (zm) { mapaZsUkaz(zm); if (Date.now() - ZM.cas > 25000) nacitajLive(); }
    var ta = document.getElementById("t-pozn"); if (ta && T.dialog && T.dialog.fokus) { T.dialog.fokus = false; ta.focus(); }
  }

  // ---------- fotky ----------
  function nacitajFotku(cesta) {
    if (T.fotky[cesta] !== undefined) return;
    T.fotky[cesta] = "";
    DB.storage.from("trasa").createSignedUrl(cesta, 3600).then(function (r) { if (r.data && r.data.signedUrl) { T.fotky[cesta] = r.data.signedUrl; prekresli(); } });
  }
  function zmensi(subor) {
    return new Promise(function (ok, zle) {
      var img = new Image(), url = URL.createObjectURL(subor);
      img.onload = function () {
        var m = 1280, k = Math.min(1, m / Math.max(img.width, img.height));
        var c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? ok(b) : zle(new Error("Fotku sa nepodarilo spracovať")); }, "image/jpeg", 0.8);
      };
      img.onerror = function () { zle(new Error("Fotku sa nepodarilo načítať")); };
      img.src = url;
    });
  }
  function nahrajFotku(cislo, subor) {
    T.prace++; T.sprava = { typ: "ok", text: "Nahrávam fotku…" }; prekresli();
    var cesta = T.id + "/" + cislo.replace(/[^\w-]/g, "_") + "-" + Date.now() + ".jpg";
    zmensi(subor).then(function (blob) {
      return DB.storage.from("trasa").upload(cesta, blob, { contentType: "image/jpeg" });
    }).then(function (r) {
      if (r.error) throw r.error;
      return rpc("trasa_zastavka", { p_id: T.id, p_cislo: cislo, p_foto: cesta });
    }).then(function (r) {
      T.prace--;
      T.sprava = r && r.ok ? { typ: "ok", text: "Fotka uložená" } : { typ: "chyba", text: (r && r.text) || "Fotka sa neuložila" };
      nacitajTrasu(true);
    }).catch(function (e) { T.prace--; T.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }

  // ---------- akcie ----------
  function zastavka(args, okText) {
    T.prace++;
    return rpc("trasa_zastavka", Object.assign({ p_id: T.id }, args)).then(function (r) {
      T.prace--;
      if (!r || r.ok === false) { T.sprava = { typ: "chyba", text: (r && r.text) || "Neuložené" }; prekresli(); return r; }
      T.sprava = okText ? { typ: "ok", text: okText } : null; T.dialog = null;
      if (args.p_stav === "dorucene" || args.p_stav === "nedorucene") smsDalsiemu(args.p_cislo);
      return nacitajTrasu(true).then(function () { return r; });
    }).catch(function (e) { T.prace--; T.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }
  // nedoručená: zoznam furmaniek, kam ju presunúť (rovnaký región prvý)
  function nacitajPresun() {
    if (T.presunFurm && T.presunId === T.id) return;
    T.presunFurm = null; T.presunId = T.id;
    rpc("trasa_furmanky_presun", { p_id: T.id }).then(function (v) {
      T.presunFurm = v || [];
      if (T.dialog && T.dialog.typ === "nedorucene") { var p = document.getElementById("t-pozn"), txt = p ? p.value : null; prekresli(); var p2 = document.getElementById("t-pozn"); if (p2 && txt != null) p2.value = txt; }
    }).catch(function () { T.presunFurm = []; });
  }
  // ---------- sledovanie rozvozu: poloha furmana pre zákazníkov (len furman, len so súhlasom, len v deň rozvozu) ----------
  var SUHLAS_TEXT = "Beriem na vedomie a súhlasím, že počas rozvozu (od otvorenia trasy v deň rozvozu do jej ukončenia) aplikácia zaznamenáva polohu môjho zariadenia približne každých 30 sekúnd. " +
    "Poloha slúži na riadenie rozvozu: počas rozvozu ju v aplikácii na mape s trasou vidí zákaznícky servis a vedenie firmy, aby vedeli zákazníkom povedať, kedy furman príde, a pomôcť pri problémoch na ceste. " +
"Zároveň ju vidí zákazník, ktorému sa objednávka v daný deň doručuje – na mape vidí, kde sa nachádza auto s jeho objednávkou a kedy približne príde. " +
    "Zákazník vidí polohu len v deň rozvozu a len kým jeho objednávka nie je doručená. Ukladá sa len posledná poloha (nie história jazdy) a po ukončení rozvozu sa zmaže, najneskôr do nasledujúceho dňa. " +
    "Mimo rozvozu sa poloha cez aplikáciu nesleduje. Som oboznámený(á) aj s tým, že firemné vozidlo je vybavené GPS sledovaním. Prevádzkovateľ: V sedle u Falťanov s.r.o.";
  var POLOHA = { posledna: 0 };
  function dnesIso() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function posliPolohu(p) {
    if (ROLA !== "furman" || T.suhlas !== true || T.id == null || !T.data || !T.data.trasa) return;
    var tr = T.data.trasa; if (tr.stav === "ukoncena" || String(tr.datum).slice(0, 10) !== dnesIso()) return;
    var teraz = Date.now(); if (teraz - POLOHA.posledna < (blizkoZakaznika(p) ? 3000 : 30000)) return; POLOHA.posledna = teraz;
    rpc("trasa_poloha", { p_id: T.id, p_lat: p.coords.latitude, p_lng: p.coords.longitude, p_presnost: p.coords.accuracy || null }).catch(function () { POLOHA.posledna = 0; });
  }
  // do ~8 km (≈ 10 min jazdy) od ďalšieho zákazníka sa poloha posiela každé 3 s (zákazník vidí auto plynulo), inak každých 30 s
function blizkoZakaznika(p) {
var a = T.akt && najdi(T.akt); if (!a || a.stav !== "caka") a = dalsiaCaka(null);
if (!a || a.lat == null || a.lng == null) return false;
var r = 6371000, f1 = p.coords.latitude * Math.PI / 180, f2 = a.lat * Math.PI / 180, df = (a.lat - p.coords.latitude) * Math.PI / 180, dl = (a.lng - p.coords.longitude) * Math.PI / 180;
var x = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
return 2 * r * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) < 8000;
}
function suhlasHtml() {
    if (ROLA !== "furman" || T.suhlas !== false) return "";
    return '<section class="card t-suhlas"><h3>📍 Sledovanie polohy počas rozvozu</h3><p>' + esc(SUHLAS_TEXT) + "</p>" +
      '<button class="btn btn-primary" data-t="suhlas">✅ Beriem na vedomie a súhlasím</button></section>';
  }
  // po vybavení zastávky: SMS ďalšiemu zákazníkovi „furman je na ceste“ s presnejším časom (Edge Function gosms)
  function smsDalsiemu(poCisle) {
    var id = T.id;
    if (!DB || !DB.functions || id == null) return;
    // ďalšia nevybavená zastávka v poradí (bez tej, ktorú furman práve vybavil); čas príchodu sa vypočíta z GPS polohy
    var z = zastavky(), i0 = -1, dal = null;
    z.forEach(function (x, i) { if (x.cislo === poCisle) i0 = i; });
    for (var k = 1; k <= z.length && !dal; k++) { var x = z[(i0 + k + z.length) % z.length]; if (x && x.stav === "caka" && x.cislo !== poCisle) dal = x; }
    var telo = { akcia: "cestou", furmanka_id: id };
    if (dal) telo.cislo = dal.cislo;
    if (T.gps) { telo.lat = T.gps.lat; telo.lng = T.gps.lng; }
    DB.functions.invoke("gosms", { body: telo }).then(function (res) {
      var d = res && res.data;
      if (d && d.ok && /odoslan/i.test(d.text || "") && T.id === id) {
        T.sprava = { typ: "ok", text: (T.sprava && T.sprava.text ? T.sprava.text + " · " : "") + "📱 " + d.text };
        nacitajTrasu(true);
      }
    }).catch(function () {});
  }
  // karta na Prehľade: odpovede zákazníkov na SMS k dnešným rozvozom
  var SMS = { d: null, cas: 0 };
  function kartaSms() {
    if (!DB || ["it", "ceo", "zakaznicky_servis", "furman"].indexOf(ROLA) === -1) return "";
    if (!SMS.cas || (Date.now() - SMS.cas > 60000 && !SMS.nacitava)) {
      SMS.cas = Date.now(); SMS.nacitava = true;
      rpc("sms_odpovede_dnes").then(function (d) { SMS.nacitava = false; SMS.d = d && d.ok ? d.odpovede || [] : []; window.dispatchEvent(new Event("lbz-prekresli")); })
        .catch(function () { SMS.nacitava = false; });
    }
    var o = SMS.d || [];
    var dnes = new Date(), d0 = dnes.getFullYear() + "-" + String(dnes.getMonth() + 1).padStart(2, "0") + "-" + String(dnes.getDate()).padStart(2, "0");
    var dnesTrasa = (T.zoznam || []).some(function (t) { return String(t.datum).slice(0, 10) === d0; });
    if (!o.length && !dnesTrasa) return "";
    return '<section class="card t-sms-karta"><h3>💬 SMS odpovede – dnešný rozvoz' + (o.length ? ' <span class="pill num">' + o.length + "</span>" : "") + "</h3>" +
      (o.length ? '<div class="rows">' + o.map(function (x) {
        return '<div class="row t-sms-row"><span><b>' + esc(x.meno || x.cislo) + '</b> <span class="muted">· ' + esc(x.cislo) + " · " + esc(x.furmanka || "") + "</span><br>" + esc(x.text) + "</span>" +
          '<span class="num muted">' + esc(cas(x.prijata)) + (x.zastavka === "dorucene" ? "<br>✅" : x.zastavka === "nedorucene" ? "<br>❌" : "") + "</span></div>";
      }).join("") + "</div>" : '<p class="muted" style="margin:0">Zatiaľ žiadne odpovede zákazníkov.</p>') +
      '<button class="btn" data-mod="trasa">Otvoriť trasu</button></section>';
  }

  // tlač ako starý skript (hárok trasy): Č. | Meno/Firma | Telefón | Č. faktúry | Suma | Adresa | Čas (+ prestávky) | Platba a poznámka | QR pre kasu
  function tlacTrasu(dd, lenUkaz) {
    var d = dd || T.data, t = d.trasa, z = d.zastavky || [];
    var n = z.filter(function (x) { return !x.bez_gps; }).length, i1 = 2, i2 = n - 2, spolu = i1 >= i2, stred = Math.floor(n / 2);
    var qr = function (text, px) { return window.LBZ_QR ? window.LBZ_QR.svg(text, px) : ""; };
    var riadky = [], k = 0;
    z.forEach(function (x, i) {
      if (!x.bez_gps) {
        var pauza = spolu ? (k === stred && n >= 3 ? 30 : 0) : (k === i1 || k === i2 ? 15 : 0);
        if (pauza) riadky.push('<tr class="t-p-pauza"><td></td><td colspan="8">☕ Prestávka ' + pauza + " min</td></tr>");
        k++;
      }
      var dob = dobierka(x);
      riadky.push("<tr><td class=\"t-p-c\">" + (x.poradie || i + 1) + "</td><td><b>" + esc(x.meno || x.firma || "") + "</b></td><td>" + esc(x.telefon || "") + "</td><td>" + esc(x.faktura || "") +
        "</td><td class=\"t-p-suma\">" + esc(eur(x.suma)) + '</td><td><a href="' + mapa(x.adresa) + '">' + esc(x.adresa || "") + "</a>" + (x.bez_gps ? " <b>(adresa nenájdená)</b>" : "") +
        '</td><td class="t-p-cas">' + esc(cas(x.eta)) + '</td><td class="' + (dob ? "t-p-dob" : "") + '">' + (dob ? "DOBIERKA" : esc(x.platba)) + (x.ine ? "<br><b>+ " + esc(x.ine) + "</b>" : "") + (x.pozn_obj ? "<br>" + esc(x.pozn_obj) : "") +
        '</td><td class="t-p-qr">' + (dob && x.faktura ? qr(x.faktura + ";" + Math.round(Number(x.suma || 0) * 100), 70) : "") + "</td></tr>");
    });
    var nav = navOdkazy(z, true);
    var html = '<div class="t-tlac"><h1>Trasa ' + esc(t.nazov) + '</h1><p class="t-datum">Odchod ' + esc(cas(t.odchod)) + " · návrat ~" + esc(cas(t.navrat)) + (t.hodiny ? " · " + String(t.hodiny).replace(".", ",") + " h" : "") + " · štart a cieľ: " + esc(START) + "</p>" +
      '<table class="t-p-tab"><thead><tr><th>Č.</th><th>Meno/Firma</th><th>Telefón</th><th>Č. faktúry</th><th>Suma</th><th>Adresa</th><th>Čas</th><th>Platba a poznámka</th><th>QR</th></tr></thead><tbody>' +
      riadky.join("") + '<tr class="t-p-pauza"><td></td><td colspan="8">🏠 Návrat ' + esc(cas(t.navrat)) + "</td></tr></tbody></table>" +
      '<div class="t-p-nav">' + nav.map(function (x) { return '<div class="t-p-navbox">' + qr(x.url, 110) + "<div>Navigácia " + x.od + "–" + x.po + "</div></div>"; }).join("") + "</div></div>";
    // len zobraziť na obrazovke (súkromný účet furmana): presne ako tlač (A4, rovnaké štýly), adresy a navigačné QR klikateľné, tlačidlo Tlačiť
if (lenUkaz) {
var ov = document.getElementById("t-nahlad-tlac");
if (!ov) { ov = document.createElement("div"); ov.id = "t-nahlad-tlac"; document.body.appendChild(ov); }
ov.style.cssText = "position:fixed;inset:0;z-index:9999;background:#e9e6df;overflow:auto";
var N = "#t-nahlad-tlac ";
var css = N + ".t-tlac-strana{background:#fff;color:#000;width:194mm;margin:0 auto 24px;padding:8mm;box-shadow:0 1px 6px rgba(0,0,0,.2);font:9pt/1.3 Montserrat,Arial,sans-serif}" +
N + "h1{font-size:16pt;margin:0 0 2mm}" + N + ".t-datum{margin:0 0 4mm;font-size:9pt}" +
N + "table{width:100%;border-collapse:collapse;font-size:9pt}" + N + "th," + N + "td{border:1px solid #999;padding:1.5mm 2mm;vertical-align:middle}" +
N + "th{background:#f1e4c6;font-size:10pt}" + N + "th:first-child{text-align:left}" +
N + ".t-p-c{font-weight:800;text-align:center}" + N + ".t-p-suma," + N + ".t-p-cas{white-space:nowrap;text-align:right;font-weight:700}" +
N + ".t-p-dob{color:#b3261e;font-weight:700}" + N + ".t-p-pauza td{background:#f1e4c6;font-weight:700}" +
N + ".t-p-qr svg{width:18mm;height:18mm}" + N + ".t-p-nav{display:flex;gap:6mm;flex-wrap:wrap;margin-top:5mm}" +
N + ".t-p-navbox{text-align:center;font-size:8pt;color:inherit;text-decoration:none}" + N + ".t-p-navbox svg{width:28mm;height:28mm}" +
N + "td a{color:inherit;text-decoration:underline dotted;text-underline-offset:2px}" +
N + ".t-nahlad-lista{position:sticky;top:0;left:0;z-index:2;display:flex;justify-content:flex-end;gap:8px;padding:8px 12px;background:#e9e6df}";
var iNav = html.indexOf('<div class="t-p-nav">');
var obsah = (iNav > -1 ? html.slice(0, iNav) : html).replace(/<a href="/g, '<a target="_blank" rel="noopener" href="') +
'<div class="t-p-nav">' + nav.map(function (x) { return '<a class="t-p-navbox" target="_blank" rel="noopener" href="' + x.url + '">' + qr(x.url, 110) + "<div>Navigácia " + x.od + "–" + x.po + "</div></a>"; }).join("") + "</div></div>";
ov.innerHTML = "<style>" + css + '</style><div class="t-nahlad-lista"><button class="btn" type="button" id="t-zoom-minus" aria-label="Oddialiť">−</button><button class="btn" type="button" id="t-zoom-plus" aria-label="Priblížiť">+</button><button class="btn" type="button" id="t-nahlad-tlac-tl">🖨️ Tlačiť</button><button class="btn" type="button" id="t-nahlad-zavri">✕ Zavrieť</button></div><div class="t-tlac-strana">' + obsah + "</div>";
document.getElementById("t-nahlad-zavri").onclick = function () { ov.remove(); };
document.getElementById("t-nahlad-tlac-tl").onclick = function () { ov.remove(); tlacTrasu(d); };
// priblíženie / oddialenie prstami (appka má v meta viewport maximum-scale=1, preto vlastné) a tlačidlami − +
var strana = ov.querySelector(".t-tlac-strana"), Z = 1, pinch = null;
var nastavZoom = function (z, mx, my) {
z = Math.max(0.3, Math.min(3, z));
var px = (ov.scrollLeft + (mx || 0)) / Z, py = (ov.scrollTop + (my || 0)) / Z;
Z = z; strana.style.zoom = z;
if (mx != null) { ov.scrollLeft = px * z - mx; ov.scrollTop = py * z - my; }
};
nastavZoom(Math.min(1, (ov.clientWidth - 16) / (strana.offsetWidth || 794)));
ov.style.touchAction = "pan-x pan-y";
ov.addEventListener("touchstart", function (e) { if (e.touches.length === 2) { var a = e.touches[0], b = e.touches[1]; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, z: Z }; } }, { passive: true });
ov.addEventListener("touchmove", function (e) {
if (!pinch || e.touches.length !== 2) return;
e.preventDefault();
var a = e.touches[0], b = e.touches[1];
nastavZoom(pinch.z * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
}, { passive: false });
ov.addEventListener("touchend", function (e) { if (e.touches.length < 2) pinch = null; }, { passive: true });
document.getElementById("t-zoom-plus").onclick = function () { nastavZoom(Z * 1.25, ov.clientWidth / 2, ov.clientHeight / 2); };
document.getElementById("t-zoom-minus").onclick = function () { nastavZoom(Z / 1.25, ov.clientWidth / 2, ov.clientHeight / 2); };
return;
}
var obal = document.getElementById("tlac-oblast");
    if (!obal) { obal = document.createElement("div"); obal.id = "tlac-oblast"; document.body.appendChild(obal); }
    obal.className = "t-tlac-obal"; obal.innerHTML = html; document.body.classList.add("tlaci");
    var hotovo = function () { document.body.classList.remove("tlaci"); obal.innerHTML = ""; obal.className = ""; window.removeEventListener("afterprint", hotovo); };
    window.addEventListener("afterprint", hotovo);
    setTimeout(function () { window.print(); setTimeout(hotovo, 1500); }, 80);
  }
  // ---------- GPS (príchod na miesto), obrazovka nezhasne, vibrácia ----------
  var gpsId = null, zamok = null;
  function vibruj() { try { if (navigator.vibrate) navigator.vibrate(80); } catch (e) {} }
  function zapniJazdu() {
    if (navigator.geolocation && gpsId == null) {
      gpsId = navigator.geolocation.watchPosition(function (p) {
        var bol = T.gps && T.akt ? vzdialenost(najdi(T.akt) || {}) : null;
        T.gps = { lat: p.coords.latitude, lng: p.coords.longitude }; T.gpsChyba = false; posliPolohu(p);
        var a = T.akt && najdi(T.akt), teraz = a ? vzdialenost(a) : null;
        if (teraz != null && teraz < NA_MIESTE_M && (bol == null || bol >= NA_MIESTE_M)) { try { navigator.vibrate && navigator.vibrate([150, 80, 150]); } catch (e) {} }
        if (T.id != null && (T.rezim || "jazda") === "jazda" && !T.dialog) {
          // len vzdialenosť → prepísať text (mapa sa neobnovuje); prekresliť až keď sa zmení „na mieste“ alebo chýba údaj
          var el = koren && koren.querySelector(".t-vzd"), zmena = (bol == null) !== (teraz == null) || (bol != null && teraz != null && (bol < NA_MIESTE_M) !== (teraz < NA_MIESTE_M));
          if (el && teraz != null && !zmena) {
            el.textContent = teraz < 1000 ? Math.round(teraz) + " m" : (teraz / 1000).toFixed(1).replace(".", ",") + " km";
            var mm = document.getElementById("t-gmapa-miesto"); if (mm) mapaUkaz(mm);
          } else prekresli();
        }
      }, function () { T.gpsChyba = true; }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
    }
    try { if (navigator.wakeLock && !zamok) navigator.wakeLock.request("screen").then(function (z) { zamok = z; z.addEventListener("release", function () { zamok = null; }); }).catch(function () {}); } catch (e) {}
  }
  function vypniJazdu() {
    if (gpsId != null && navigator.geolocation) navigator.geolocation.clearWatch(gpsId);
    gpsId = null; T.gps = null;
    try { if (zamok) zamok.release(); } catch (e) {} zamok = null;
  }
  // po návrate do appky (zapnutá obrazovka) znova zapnúť GPS a zámok obrazovky – bez hlášky (rozhodnutie Terézie 2. 10.)
function rozvozBezi() {
var tr = T.data && T.data.trasa;
return ROLA === "furman" && sluzobny() && T.id != null && tr && tr.stav !== "ukoncena" && String(tr.datum).slice(0, 10) === dnesIso() && zastavky().some(function (x) { return x.stav === "caka"; });
}
document.addEventListener("visibilitychange", function () {
if (document.hidden) return;
if (T.id != null && koren && koren.isConnected) zapniJazdu();
});
  function klik(e) {
    var t = e.target.closest("button, a, [data-t], [data-t-akcia]"); if (!t || !koren.contains(t)) return; if (t.tagName === "A") return;
    var d = t.dataset;
    if (d.tOtvor) { T.id = +d.tOtvor; T.data = null; T.sprava = null; T.akt = null; T.rezim = ROLA === "furman" ? "jazda" : "mapa"; prekresli(); window.scrollTo(0, 0); nacitajTrasu(); zapniJazdu(); return; }
    if (d.tRezim) { T.rezim = d.tRezim; prekresli(); window.scrollTo(0, 0); return; }
    if (d.tList) {
var zz = zastavky(), cur = aktualna(), n = d.tList === "koniec" ? zz.length - 1 : (cur ? zz.indexOf(cur) : 0) + Number(d.tList);
if (zz[n]) { T.akt = zz[n].cislo; T.drzAkt = true; T.prezera = true; T.naMieste = null; T.sprava = null; prekresli(); window.scrollTo(0, 0); }
return;
}
if (d.tVyber) { T.akt = d.tVyber; T.drzAkt = false; T.naMieste = null; T.rezim = "jazda"; prekresli(); window.scrollTo(0, 0); return; }
    if (d.tMiesto) { T.naMieste = d.tMiesto; prekresli(); return; }
    if (d.tAkcia) {
      var c = d.c;
      if (d.tAkcia === "platba") { T.dialog = { typ: "platba", cislo: c }; prekresli(); return; }
      if (d.tAkcia === "dorucene" || d.tAkcia === "zaplatene") {
        var zd = najdi(c) || {};
        if (d.tAkcia === "dorucene" && !lbzPotvrd("Označiť ako DORUČENÉ?\n\n" + (zd.meno || zd.firma || c) + (dobierka(zd) ? "\nDobierka " + eur(zd.suma) + " – je zaplatená?" : ""))) return;
        T.dialog = null; T.drzAkt = true;
        zastavka({ p_cislo: c, p_stav: "dorucene" }, "✓ Doručené: " + (zd.meno || zd.firma || c)); vibruj(); return;
      }
      if (d.tAkcia === "spat") { if (!lbzPotvrd("Vrátiť zastávku medzi nevybavené?")) return; T.akt = c; T.drzAkt = false; T.naMieste = null; zastavka({ p_cislo: c, p_stav: "caka" }); return; }
      if (d.tAkcia === "nedorucene" || d.tAkcia === "poznamka" || d.tAkcia === "pozn_obj") { T.dialog = { typ: d.tAkcia, cislo: c, fokus: true }; prekresli(); if (d.tAkcia === "nedorucene") nacitajPresun(); return; }
    }
    switch (d.t) {
      case "zavri-spravu": T.sprava = null; prekresli(); break;
      case "suhlas":
        rpc("trasa_suhlas_daj", { p_text: SUHLAS_TEXT }).then(function (r) {
          if (r && r.ok) { T.suhlas = true; T.sprava = { typ: "ok", text: "Ďakujeme – súhlas je uložený." }; } else T.sprava = { typ: "chyba", text: "Súhlas sa neuložil" };
          prekresli();
        }).catch(function (er) { T.sprava = { typ: "chyba", text: chybaText(er) }; prekresli(); });
        break;
      case "zavri": T.dialog = null; prekresli(); break;
      case "obnov": T.sprava = null; if (T.id == null) nacitajZoznam(); else nacitajTrasu(); break;
      case "spat": T.id = null; T.data = null; T.sprava = null; vypniJazdu(); nacitajZoznam(); break;
      case "tlac": if (T.data) tlacTrasu(); break;
      case "dalsia": case "preskocit":
        var dal = dalsiaCaka(T.akt);
        if (d.t === "preskocit" && !lbzPotvrd("Preskočiť túto zastávku? Vrátite sa k nej neskôr zo Zoznamu.")) return;
        T.akt = dal ? dal.cislo : null; T.drzAkt = false; T.prezera = false; T.naMieste = null; T.sprava = null; prekresli(); window.scrollTo(0, 0); break;
      case "ukoncit":
        if (!lbzPotvrd("Ukončiť rozvoz? Furmanka sa presunie do Archívu a nedoručené objednávky do ďalšej furmanky.")) return;
        T.prace++;
        rpc("trasa_ukoncit", { p_id: T.id }).then(function (r) {
          T.prace--;
          T.sprava = { typ: r && r.ok ? "ok" : "chyba", text: (r && r.text) || "Neuložené" };
          nacitajTrasu(true);
        }).catch(function (er) { T.prace--; T.sprava = { typ: "chyba", text: chybaText(er) }; prekresli(); });
        break;
    }
  }
  function zmena(e) {
    var f = e.target;
    if (f.dataset && f.dataset.tFoto && f.files && f.files[0]) nahrajFotku(f.dataset.tFoto, f.files[0]);
  }
  function odoslanie(e) {
    if (e.target.id !== "t-dialog-form") return;
    e.preventDefault();
    var D = T.dialog, pozn = document.getElementById("t-pozn").value;
    if (D.typ === "nedorucene") {
      var fs = document.getElementById("t-furm"), fid = fs && fs.value ? Number(fs.value) : null;
      T.drzAkt = true;
      zastavka({ p_cislo: D.cislo, p_stav: "nedorucene", p_poznamka: pozn, p_presun_furmanka: fid }, "✗ Nedoručené – po ukončení rozvozu ide do " + (fid ? "zvolenej furmanky" : "najbližšej otvorenej furmanky"));
    } else if (D.typ === "pozn_obj") {
T.prace++;
rpc("trasa_poznamka_obj", { p_id: T.id, p_cislo: D.cislo, p_text: pozn }).then(function (r) {
T.prace--;
T.sprava = { typ: r && r.ok ? "ok" : "chyba", text: (r && r.text) || "Neuložené" };
if (r && r.ok) T.dialog = null;
nacitajTrasu(true);
}).catch(function (er) { T.prace--; T.sprava = { typ: "chyba", text: chybaText(er) }; prekresli(); });
} else zastavka({ p_cislo: D.cislo, p_poznamka: pozn }, "Poznámka uložená");
  }
  function klaves(e) { if (e.key === "Escape" && T.dialog) { T.dialog = null; prekresli(); } }

  // obnova každú minútu (zákaznícky servis môže sledovať, kde furman je)
  setInterval(function () {
    if (!DB || !koren || !koren.isConnected || document.hidden || T.prace || T.dialog) return;
    if (T.id != null) nacitajTrasu(true); else nacitajZoznam();
  }, 60000);

  // ---------- MAPA pre zákaznícky servis: kde je furman počas celej trasy (Edge Function sledovanie, { zs: id }) ----------
var ZM = { el: null, mapa: null, vrstva: null, live: null, liveId: null, cas: 0, nacitava: false, fitId: null, libP: null };
var FIAT = "https://buchty.s26.cdn-upgates.com/1/169c501e8598cd-fiat-s-buchtou.png";
function leaflet() {
if (window.L) return Promise.resolve();
if (ZM.libP) return ZM.libP;
ZM.libP = new Promise(function (ok, zle) {
var c = document.createElement("link"); c.rel = "stylesheet"; c.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"; document.head.appendChild(c);
var s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
s.onload = function () { ok(); }; s.onerror = function () { ZM.libP = null; zle(new Error("Mapa sa nenačítala (bez signálu?)")); };
document.head.appendChild(s);
});
return ZM.libP;
}
function dekoduj(s) {
var i = 0, lat = 0, lng = 0, out = [];
while (i < s.length) {
var b, sh = 0, r = 0;
do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
lat += r & 1 ? ~(r >> 1) : r >> 1; sh = 0; r = 0;
do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
lng += r & 1 ? ~(r >> 1) : r >> 1;
out.push([lat / 1e5, lng / 1e5]);
}
return out;
}
function nacitajLive() {
if (!DB || !DB.functions || T.id == null || ZM.nacitava) return;
ZM.nacitava = true; var id = T.id;
DB.functions.invoke("sledovanie", { body: { zs: id } }).then(function (res) {
ZM.nacitava = false; ZM.cas = Date.now();
if (T.id !== id) return;
var d = res && res.data;
ZM.live = d && d.ok ? d : { ok: false, text: (d && d.text) || "Poloha furmana sa nenačítala" }; ZM.liveId = id;
prekresli();
}).catch(function () { ZM.nacitava = false; ZM.cas = Date.now(); });
}
function mapaZsHtml(t) {
var z = zastavky(), live = ZM.liveId === T.id ? ZM.live : null, a = live && live.auto, info;
if (t.stav === "ukoncena") info = '<p class="f-sprava f-ok">Rozvoz ukončený ' + esc(cas(t.ukoncena)) + ".</p>";
else if (live && live.ok === false) info = '<p class="f-sprava f-chyba">' + esc(live.text) + "</p>";
else if (!a) info = '<p class="muted">📍 Poloha furmana zatiaľ nie je. Zobrazí sa, keď furman v deň rozvozu otvorí trasu v appke (po potvrdení súhlasu).' + (live ? "" : " Načítavam…") + "</p>";
else {
var vek = Math.round((Date.now() - new Date(a.kedy).getTime()) / 60000);
info = '<p>📍 Poloha auta z <b class="num">' + esc(cas(a.kedy)) + "</b>" + (a.zdroj === "gps_auta" ? ' <span class="b-st">📡 z GPS v aute – telefón furmana teraz polohu neposiela</span>' : "") + (vek >= 5 ? ' <span class="b-st b-st-odl">⚠️ pred ' + vek + " min – furman možno nemá otvorenú appku alebo je bez signálu</span>" : ' <span class="muted">· obnovuje sa každých 30 s</span>') + "</p>";
}
var m = live && live.meskanie_s != null ? Math.round(live.meskanie_s / 60) : null, posun = m ? m * 60000 : 0;
var dal = live && live.dalsia ? najdi(live.dalsia) : null;
if (dal && live.eta_dalsia && t.stav !== "ukoncena") info += "<p>➡️ Ďalšia zastávka: <b>" + esc(dal.meno || dal.firma || dal.cislo) + '</b> · podľa navigácie o <b class="num">' + esc(cas(live.eta_dalsia)) + "</b> " +
(m == null ? "" : m >= 3 ? '<span class="b-st b-st-odl">meškanie ~' + m + " min</span>" : m <= -3 ? '<span class="b-st b-st-ok">náskok ~' + (-m) + " min</span>" : '<span class="b-st b-st-ok">podľa plánu</span>') + "</p>";
var riadky = z.map(function (x, i) {
var st = x.stav === "dorucene" ? "✅ " + cas(x.cas) : x.stav === "nedorucene" ? "❌ nedoručené" : x.eta ? (posun ? "~" + cas(new Date(x.eta).getTime() + posun) + " (plán " + cas(x.eta) + ")" : cas(x.eta)) : "—";
return '<div class="row"><span><b class="num">' + (x.poradie || i + 1) + ".</b> " + esc(x.meno || x.firma || x.cislo) + ' <span class="muted">· ' + esc(String(x.adresa || "").split(", ").pop()) + '</span></span><span class="num">' + esc(st) + "</span></div>";
}).join("");
return '<section class="card">' + info + '<div id="t-zs-miesto"></div>' +
(t.stav !== "ukoncena" ? '<p class="muted" style="margin:4px 0 0">Zlatá čiara = cesta auta k ďalšej zastávke, prerušovaná = poradie zvyšných zastávok. Časy zvyšných zastávok sú posunuté o aktuálne meškanie alebo náskok.</p>' : "") + "</section>" +
'<section class="card"><h3>Zastávky</h3><div class="rows">' + riadky + "</div></section>";
}
function mapaZsUkaz(miesto) {
if (!ZM.el) { ZM.el = document.createElement("div"); ZM.el.className = "t-zs-mapa"; ZM.el.style.cssText = "height:55vh;min-height:300px;border-radius:12px;overflow:hidden;margin:8px 0"; }
var novy = ZM.el.parentNode !== miesto;
if (novy) miesto.appendChild(ZM.el);
leaflet().then(function () {
if (!ZM.mapa) {
ZM.mapa = L.map(ZM.el, { zoomControl: true });
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(ZM.mapa);
ZM.mapa.setView([48.7, 19.7], 8, { animate: false });
ZM.vrstva = L.layerGroup().addTo(ZM.mapa);
}
if (novy) ZM.mapa.invalidateSize(false);
vykresliZs();
}).catch(function (e) { if (!ZM.mapa) ZM.el.innerHTML = '<p class="muted" style="padding:12px">' + esc(chybaText(e)) + "</p>"; });
}
function vykresliZs() {
if (!ZM.mapa || !ZM.vrstva) return;
var z = zastavky(), live = ZM.liveId === T.id ? ZM.live : null, a = live && live.auto;
ZM.vrstva.clearLayers();
var body = [], caka = [];
z.forEach(function (x, i) {
if (x.lat == null || x.lng == null) return;
var p = [x.lat, x.lng]; body.push(p); if (x.stav === "caka") caka.push(p);
var farba = x.stav === "dorucene" ? "#2f7d4f" : x.stav === "nedorucene" ? "#a63d32" : "#d1a73a";
L.marker(p, { icon: L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13],
html: '<span style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:' + farba + ';color:#fff;font:700 12px Montserrat,sans-serif;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">' + (x.poradie || i + 1) + "</span>" }) })
.bindTooltip(esc((x.poradie || i + 1) + ". " + (x.meno || x.firma || x.cislo)) + " · " + esc(x.stav === "dorucene" ? "✓ " + cas(x.cas) : x.stav === "nedorucene" ? "✗ nedoručené" : cas(x.eta)))
.addTo(ZM.vrstva);
});
if (caka.length > 1) L.polyline(caka, { color: "#583934", weight: 2, opacity: 0.5, dashArray: "6 6" }).addTo(ZM.vrstva);
if (live && live.cesta) { var c = dekoduj(live.cesta); L.polyline(c, { color: "#583934", weight: 8, opacity: 0.3 }).addTo(ZM.vrstva); L.polyline(c, { color: "#d1a73a", weight: 5, opacity: 0.95 }).addTo(ZM.vrstva); }
if (a) { var pa = [a.lat, a.lng]; body.push(pa); L.marker(pa, { icon: L.icon({ iconUrl: FIAT, iconSize: [72, 68], iconAnchor: [36, 60] }), zIndexOffset: 1000 }).bindTooltip("Furman · poloha z " + esc(cas(a.kedy)) + (a.zdroj === "gps_auta" ? " (GPS v aute)" : "")).addTo(ZM.vrstva); }
var kluc = T.id + (a ? "a" : "");
if (ZM.fitId !== kluc && body.length) { ZM.fitId = kluc; if (body.length === 1) ZM.mapa.setView(body[0], 13, { animate: false }); else ZM.mapa.fitBounds(body, { padding: [30, 30], maxZoom: 15, animate: false }); }
}
// mapa pre zákaznícky servis: poloha každých 30 s
setInterval(function () {
if (koren && koren.isConnected && !document.hidden && T.id != null && T.rezim === "mapa" && ROLA !== "furman") nacitajLive();
}, 30000);

// ---------- súkromný účet furmana: len náhľad naplánovanej trasy (dnes a ďalšie dni) ----------
function kartaNahlad() {
if (DB && (!T._kartaCas || Date.now() - T._kartaCas > 600000) && !T._kartaNac) {
T._kartaNac = true;
rpc("trasa_zoznam").then(function (d) { T._kartaNac = false; T._kartaCas = Date.now(); T.nahlad = {}; if (d && d.ok) T.zoznam = d.trasy || []; window.dispatchEvent(new Event("lbz-prekresli")); })
.catch(function () { T._kartaNac = false; T._kartaCas = Date.now(); });
}
var dnes = dnesIso();
var z = (T.zoznam || []).filter(function (t) { return t.stav !== "ukoncena" && String(t.datum).slice(0, 10) >= dnes; }).slice(0, 2);
T.nahlad = T.nahlad || {};
z.forEach(function (t) {
if (T.nahlad[t.id] !== undefined) return;
T.nahlad[t.id] = null;
rpc("trasa_data", { p_id: t.id }).then(function (d) { T.nahlad[t.id] = d && d.ok ? d.zastavky || [] : []; window.dispatchEvent(new Event("lbz-prekresli")); })
.catch(function () { T.nahlad[t.id] = []; });
});
return '<section class="card"><h3>🗺️ Moja trasa</h3>' + (z.length ? z.map(function (t) {
var zs = T.nahlad[t.id];
return '<p style="margin:8px 0 4px"><b>' + esc(datumSk(t.datum)) + " · " + esc(t.nazov) + '</b><br><span class="muted">odchod <b class="num">' + esc(cas(t.odchod)) + '</b> · návrat ~<span class="num">' + esc(cas(t.navrat)) + "</span>" +
(t.hodiny ? " · " + String(t.hodiny).replace(".", ",") + " h" : "") + " · " + t.pocet + " zastávok</span></p>" +
'<button class="btn" type="button" data-t-nahlad="' + t.id + '" style="margin:0 6px 6px 0">📄 Zobraziť trasu</button>' +
'<button class="btn" type="button" data-t-nahlad="' + t.id + '" data-tlac="1" style="margin:0 0 6px">🖨️ Tlačiť</button>' +
(zs == null ? '<p class="muted">Načítavam zastávky…</p>' : '<div class="rows">' + zs.map(function (x, i) {
return '<div class="row"><span><b class="num">' + (x.poradie || i + 1) + ".</b> " + esc(x.meno || x.firma || x.cislo) +
(x.adresa ? '<br><a href="' + mapa(x.adresa) + '" target="_blank" rel="noopener">📍 ' + esc(x.adresa) + "</a>" : "") +
'</span><span class="num">' + esc(cas(x.eta)) + "</span></div>";
}).join("") + "</div>");
}).join("") + '<p class="muted" style="margin:8px 0 0">Len náhľad plánu – rozvoz sa robí na služobnom telefóne (účet furman@).</p>'
: '<p class="muted" style="margin:0">Žiadna naplánovaná trasa.</p>') + "</section>";
}

// tlačidlo „📄 Zobraziť trasu“ v karte Moja trasa (karta je na Prehľade, mimo modulu)
document.addEventListener("click", function (e) {
var b = e.target.closest && e.target.closest("[data-t-nahlad]"); if (!b || !DB) return;
e.preventDefault(); b.disabled = true;
rpc("trasa_data", { p_id: +b.getAttribute("data-t-nahlad") }).then(function (d) { b.disabled = false; if (d && d.ok && d.trasa) tlacTrasu(d, !b.getAttribute("data-tlac")); })
.catch(function () { b.disabled = false; });
});

// ---------- verejné rozhranie pre app.js ----------
  window.LBZ_TRASA = {
    nastavDb: function (klient, rola, email) { DB = klient || null; ROLA = klient ? rola : null; EMAIL = klient ? email || "" : ""; if (!DB) { T.zoznam = null; T.data = null; T.id = null; } },
    mozem: function () { return !!DB && ["it", "ceo", "zakaznicky_servis", "furman"].indexOf(ROLA) > -1 && sluzobny(); },
lenNahlad: function () { return !!DB && ROLA === "furman" && !sluzobny(); },
    mount: function (el) {
      koren = el;
      el.addEventListener("click", klik);
      el.addEventListener("change", zmena);
      el.addEventListener("submit", odoslanie);
      el.addEventListener("keydown", klaves);
      prekresli();
      if (ROLA === "furman" && T.suhlas == null) rpc("trasa_suhlas_stav").then(function (v) { T.suhlas = !!v; prekresli(); }).catch(function () {});
      if (T.id == null) nacitajZoznam(); else { nacitajTrasu(true); zapniJazdu(); }
    },
    otvor: function (id) { T.id = id; T.data = null; },
    tlacPre: function (id) {
      if (!DB) return Promise.reject(new Error("Nie ste prihlásený"));
      return rpc("trasa_data", { p_id: id }).then(function (d) {
        if (!d || d.ok === false) throw new Error((d && d.text) || "Trasa sa nedá načítať");
        if (!d.trasa) throw new Error("Trasa ešte nie je vytvorená – vytvorí ju zákaznícky servis vo Furmankách.");
        tlacTrasu(d);
      });
    },
    kartaSms: kartaSms,
    karta: function () {
      if (ROLA === "furman" && !sluzobny()) return kartaNahlad();
      if (!T.zoznam && DB && !T._karta) { T._karta = true; rpc("trasa_zoznam").then(function (d) { if (d && d.ok) { T.zoznam = d.trasy || []; window.dispatchEvent(new Event("lbz-prekresli")); } }).catch(function () {}); }
      var z = (T.zoznam || []).filter(function (t) { return t.stav !== "ukoncena"; }).slice(0, 3);
      return '<section class="card"><h3>Trasa</h3>' + (z.length ? '<div class="rows">' + z.map(function (t) {
        return '<div class="row"><span>' + esc(t.nazov) + '</span><span class="num">' + esc(cas(t.odchod)) + " · " + t.hotovo + "/" + t.pocet + "</span></div>";
      }).join("") + "</div>" : '<p class="muted" style="margin:0">Žiadna naplánovaná trasa.</p>') +
        '<button class="btn" data-mod="trasa">Otvoriť trasu</button></section>';
    }
  };
})();
