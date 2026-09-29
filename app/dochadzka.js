// LBZ aplikácia – modul Dochádzka
// Zamestnanec (osobný účet): na Prehľade veľká karta PRÍCHOD / ODCHOD (miesto ponúkne podľa smeny v rozpise, GPS pri príchode a odchode),
// mesiac s hodinami, žiadosť o dovolenku / PN / OČR / lekára. IT a CEO: kto je v práci, kto neprišiel, schvaľovanie žiadostí, úpravy.
// Mzdy sa nepočítajú. Prestávka 30 min pri šichte ≥ 6 h, stravné podľa miesta (ako stará web appka).

(function () {
  "use strict";

  var DB = null, ROLA = null, koren = null;
  var D = { moja: null, nacitavam: false, sprava: null, zalozka: "mesiac", mesiac: null, data: null, prehlad: null, osoba: null, dialog: null, miesto: null, prace: 0 };
  var MIESTA = ["ZBOJSKÁ", "ROZVOZ", "OBCHOD", "BUCHTOMOBIL", "ADMINISTRATÍVA", "DOMA"];
  var POZ_MIESTO = { pecenie: "ZBOJSKÁ", bar: "ZBOJSKÁ", rozvoz: "ROZVOZ", buchtac: "BUCHTOMOBIL", obchod: "OBCHOD" };
  var TYPY = { praca: "Odpracované", dovolenka: "Dovolenka", pn: "PN", ocr: "OČR", lekar: "Lekár", oprava: "Oprava záznamu" };
  var SUHLAS_TEXT = "Potvrdzujem, že som bol(a) oboznámený(á), že pri zápise príchodu a odchodu v aplikácii sa zaznamenáva poloha zariadenia " +
    "(len v okamihu zápisu, nie počas práce). Údaj slúži na overenie miesta výkonu práce, vidí ho len vedenie (IT a CEO) a uchováva sa po dobu " +
    "potrebnú na evidenciu pracovného času. Prevádzkovateľ: V sedle u Falťanov s.r.o.";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function rpc(n, a) { return DB.rpc(n, a || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function chybaText(e) { return (e && (e.message || e.text)) || "Bez spojenia so serverom"; }
  function cas(t) { return t ? new Date(t).toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" }) : ""; }
  function hm(min) { min = Math.round(Number(min || 0)); return Math.floor(min / 60) + " h " + ("0" + (min % 60)).slice(-2) + " min"; }
  function hodiny(min) { min = Math.round(Number(min || 0)); return Math.floor(min / 60) + ":" + ("0" + (min % 60)).slice(-2); }
  function eur(n) { return Number(n || 0).toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
  function iso(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function prvyDen(d) { return iso(new Date(d.getFullYear(), d.getMonth(), 1)); }
  function mesiacNazov(s) { var p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString("sk-SK", { month: "long", year: "numeric" }); }
  function denSk(s) { var p = String(s).slice(0, 10).split("-"); return new Date(+p[0], +p[1] - 1, +p[2], 12).toLocaleDateString("sk-SK", { weekday: "short", day: "numeric", month: "numeric" }); }
  function vikend(s) { var p = String(s).split("-"); var w = new Date(+p[0], +p[1] - 1, +p[2], 12).getDay(); return w === 0 || w === 6; }
  function spravca() { return ROLA === "it" || ROLA === "ceo"; }
  function citatel() { return spravca() || ROLA === "uctovnicka"; }
  function kresli() { if (koren && koren.isConnected) prekresli(); window.dispatchEvent(new Event("lbz-prekresli")); }
  function poloha() {
    return new Promise(function (ok) {
      if (!navigator.geolocation) return ok({ chyba: "bez GPS" });
      navigator.geolocation.getCurrentPosition(function (p) {
          var g = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), presnost: Math.round(p.coords.accuracy) };
          adresaZGps(g).then(function (a) { if (a) g.adresa = a; ok(g); });
        },
        function (e) { ok({ chyba: e && e.code === 1 ? "poloha zamietnutá" : "poloha nedostupná" }); }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
    });
  }

  // ---------- načítanie ----------
  var nacitavamMoju = false;
  function nacitajMoju() {
    if (!DB || nacitavamMoju) return Promise.resolve();
    nacitavamMoju = true;
    return rpc("dochadzka_moja").then(function (d) { nacitavamMoju = false; D.moja = d && d.ok ? d : { chyba: (d && d.text) || "Nenačítané" }; kresli(); })
      .catch(function (e) { nacitavamMoju = false; D.moja = { chyba: chybaText(e) }; kresli(); });
  }
  function nacitajMesiac() {
    D.nacitavam = true; prekresli();
    return rpc("dochadzka_mesiac", { p_osoba: D.osoba, p_mesiac: D.mesiac }).then(function (d) {
      D.nacitavam = false; if (!d || d.ok === false) D.sprava = { typ: "chyba", text: (d && d.text) || "Nenačítané" }; else D.data = d; prekresli();
    }).catch(function (e) { D.nacitavam = false; D.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }
  function nacitajPrehlad() {
    D.nacitavam = true; prekresli();
    return rpc("dochadzka_prehlad", { p_mesiac: D.mesiac }).then(function (d) {
      D.nacitavam = false; if (!d || d.ok === false) D.sprava = { typ: "chyba", text: (d && d.text) || "Nenačítané" }; else D.prehlad = d; prekresli();
    }).catch(function (e) { D.nacitavam = false; D.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }
  function po(prom, hotovo) {
    D.prace++; kresli();
    return prom.then(function (r) {
      D.prace--;
      D.sprava = { typ: r && r.ok ? "ok" : "chyba", text: (r && r.text) || (r && r.ok ? "Hotovo" : "Neuložené") };
      if (r && r.ok && hotovo) hotovo(r);
      nacitajMoju(); kresli(); return r;
    }).catch(function (e) { D.prace--; D.sprava = { typ: "chyba", text: chybaText(e) }; kresli(); });
  }

  // ---------- karta na Prehľade ----------
  function smenaText(s) { return s.map(function (x) { return x.nazov + (x.cas_od ? " od " + String(x.cas_od).slice(0, 5) : "") + (x.cas_do ? " do " + String(x.cas_do).slice(0, 5) : ""); }).join(", "); }
  function navrhMiesta(m) {
    if (D.miesto) return D.miesto;
    var s = (m.smeny || [])[0];
    return s ? (POZ_MIESTO[s.pozicia] || "ZBOJSKÁ") : "ZBOJSKÁ";
  }
  function kartaHtml() {
    var m = D.moja;
    if (!m) { if (DB) nacitajMoju(); return '<section class="card d-karta"><h3>🕒 Dochádzka</h3><p class="muted">Načítavam…</p></section>'; }
    if (m.chyba) return '<section class="card d-karta"><h3>🕒 Dochádzka</h3><p class="f-sprava f-chyba">' + esc(m.chyba) + "</p></section>";
    if (!m.osoba) return "";   // spoločné účty (tablet, furman) – dochádzku si zapisuje každý zo svojho účtu
    var spr = D.sprava && !koren ? '<p class="f-sprava f-' + D.sprava.typ + '">' + esc(D.sprava.text) + "</p>" : "";
    var mes = m.mesiac || {};
    var suhrn = '<p class="d-suhrn">Tento mesiac: <b class="num">' + hodiny(mes.min) + " h</b> · " + (mes.dni || 0) + " dní" +
      (Number(mes.stravne) ? " · stravné " + eur(mes.stravne) : "") + (m.ziadosti ? ' · <span class="pill">' + m.ziadosti + " žiadosť čaká</span>" : "") + "</p>";
    if (!m.suhlas) {
      return '<section class="card d-karta d-suhlas"><h3>🕒 Dochádzka – potvrdenie o oboznámení</h3><p>' + esc(SUHLAS_TEXT) + "</p>" +
        '<button class="btn btn-primary d-velke" data-d="suhlas"' + (D.prace ? " disabled" : "") + ">✅ Beriem na vedomie</button></section>";
    }
    if (m.otvorena) {
      var o = m.otvorena, min = Math.max(0, Math.round((Date.now() - new Date(o.prichod).getTime()) / 60000));
      return '<section class="card d-karta d-v-praci">' + spr + '<div class="d-stav">🟢 V práci od <b class="num">' + esc(cas(o.prichod)) + "</b> · " + esc(o.miesto || "") + "</div>" +
        '<div class="d-bezi num" data-d-od="' + esc(o.prichod) + '">' + hm(min) + "</div>" +
        (min >= 840 ? '<p class="f-sprava f-chyba">⚠️ Si v práci už viac ako 14 hodín – nezabudol si zapísať odchod? Ak si už odišiel, zapíš ODCHOD a pošli žiadosť o opravu času.</p>' : "") +
        '<button class="btn d-velke d-tl-odchod" data-d="odchod"' + (D.prace ? " disabled" : "") + ">🔴 ODCHOD</button>" +
        (min >= 360 ? '<p class="muted d-pozn">Prestávka 30 min sa odpočíta automaticky.</p>' : "") + suhrn + pushHtml() + "</section>";
    }
    var navrh = navrhMiesta(m);
    return '<section class="card d-karta">' + spr +
      (m.smeny && m.smeny.length ? '<div class="d-stav">📅 Dnes máš smenu: <b>' + esc(smenaText(m.smeny)) + "</b></div>" : '<div class="d-stav muted">Dnes nemáš v rozpise smenu.</div>') +
      '<div class="d-miesta" role="group" aria-label="Miesto">' + MIESTA.map(function (x) {
        return '<button class="d-miesto" data-d-miesto="' + x + '" aria-pressed="' + (x === navrh) + '">' + esc(x.charAt(0) + x.slice(1).toLowerCase()) + "</button>";
      }).join("") + "</div>" +
      '<button class="btn btn-primary d-velke d-tl-prichod" data-d="prichod"' + (D.prace ? " disabled" : "") + ">🟢 PRÍCHOD</button>" +
      (m.zajtra && m.zajtra.length ? '<p class="muted d-pozn">Zajtra: ' + esc(smenaText(m.zajtra)) + "</p>" : "") + suhrn + pushHtml() + "</section>";
  }

  // ---------- modul ----------
  function hlava() {
    var z = D.zalozka;
    return '<div class="head"><div><h2>Dochádzka</h2><div class="sub">' + esc(mesiacNazov(D.mesiac)) + (D.nacitavam ? " · načítavam…" : "") + "</div></div>" +
      '<span class="head-tl"><button class="btn btn-ikona" data-d="mes-" aria-label="Predošlý mesiac">◀</button><button class="btn btn-ikona" data-d="mes+" aria-label="Ďalší mesiac">▶</button></span></div>' +
      '<div class="f-seg d-zalozky" role="group">' +
      (D.moja && D.moja.osoba ? '<button data-d-zal="mesiac" aria-pressed="' + (z === "mesiac") + '">Môj mesiac</button><button data-d-zal="ziadost" aria-pressed="' + (z === "ziadost") + '">Dovolenka / PN</button>' : "") +
      (citatel() ? '<button data-d-zal="tim" aria-pressed="' + (z === "tim" || z === "osoba") + '">Tím</button>' : "") + "</div>" +
      (D.sprava ? '<p class="f-sprava f-' + D.sprava.typ + '">' + esc(D.sprava.text) + ' <button class="btn-link" data-d="zavri-spravu">✕</button></p>' : "");
  }
  function tabulkaMesiaca(d, uprava) {
    var r = d.riadky || [], sum = 0, str = 0, dni = {};
    r.forEach(function (x) { sum += Number(x.odpracovane_min || 0); str += Number(x.stravne || 0); if (x.typ === "praca") dni[x.datum] = 1; });
    var riadky = r.map(function (x) {
      var otv = x.typ === "praca" && x.prichod && !x.odchod;
      return '<tr class="' + (vikend(x.datum) ? "d-vikend " : "") + (x.typ !== "praca" ? "d-abs" : "") + '">' +
        '<td class="c-den">' + esc(denSk(x.datum)) + '</td><td class="c-miesto">' + esc(x.typ === "praca" ? (x.miesto || "") : TYPY[x.typ]) + "</td>" +
        '<td class="num c-cas">' + esc(cas(x.prichod)) + (x.prichod || x.odchod ? "–" : "") + esc(otv ? "…" : cas(x.odchod)) + "</td>" +
        '<td class="num c-prest">' + (x.prestavka_min ? '<span class="c-mob">prestávka </span>' + hodiny(x.prestavka_min) : "") + '</td><td class="num c-hod"><b>' + (x.odpracovane_min != null ? hodiny(x.odpracovane_min) + '<span class="c-mob"> h</span>' : "") + "</b></td>" +
        '<td class="num c-str">' + (Number(x.stravne) ? '<span class="c-mob">stravné </span>' + eur(x.stravne) : "") + "</td>" +
        '<td class="c-pozn">' + (x.poznamka ? '<span class="muted">' + esc(x.poznamka) + "</span>" : "") +
        (uprava && !x.len_citanie ? ' <button class="btn-link" data-d-upr="' + x.id + '">Upraviť</button>' : "") +
        (x.len_citanie ? ' <span class="muted" title="Prenesené zo starej dochádzky">🔒</span>' : "") +
        (!uprava && D.zalozka === "mesiac" && !x.len_citanie && x.typ === "praca" ? ' <button class="btn-link" data-d-opr="' + x.id + '">Oprava</button>' : "") +
        (uprava && x.gps && (x.gps.prichod || x.gps.odchod) ? gpsOdkazy(x.gps) : "") + "</td></tr>";
    }).join("");
    return '<div class="d-sumar"><span>Odpracované + neprítomnosť <b class="num">' + hodiny(sum) + " h</b></span><span>Dní v práci <b class=\"num\">" + Object.keys(dni).length +
      '</b></span><span>Stravné <b class="num">' + eur(str) + "</b></span></div>" +
      (r.length ? '<div class="tbl-wrap"><table class="d-tab d-tab-mes"><thead><tr><th>Deň</th><th>Miesto / druh</th><th>Príchod–odchod</th><th>Prest.</th><th>Hodiny</th><th>Stravné</th><th></th></tr></thead><tbody>' +
        riadky + "</tbody></table></div>" : '<div class="empty"><strong>V tomto mesiaci nie sú záznamy</strong></div>');
  }
  // poloha ako text (bez mapy): známe miesto, inak adresa z GPS
  var ZNAME = [{ n: "Zbojská", lat: 48.7449218, lng: 19.8550656 }];
  var ADR_CACHE = {}, adrFronta = Promise.resolve();
  function vzdialM(a, b) {
    var r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r;
    return Math.sqrt(x * x + y * y) * 6371000;
  }
  function adresaZGps(g) {
    var k = g.lat.toFixed(4) + "," + g.lng.toFixed(4);
    if (ADR_CACHE[k] !== undefined) return Promise.resolve(ADR_CACHE[k]);
    // Nominatim: max 1 dopyt/s → fronta
    var pr = adrFronta.then(function () {
      var c = new AbortController(); setTimeout(function () { c.abort(); }, 5000);
      return fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=sk&lat=" + g.lat + "&lon=" + g.lng, { signal: c.signal })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var a = j && j.address; if (!a) return "";
          var ul = [a.road || a.pedestrian || a.square || a.hamlet || "", a.house_number || ""].join(" ").trim();
          var obec = a.village || a.town || a.city || a.municipality || "";
          return [ul, obec].filter(Boolean).join(", ");
        })
        .catch(function () { return ""; })
        .then(function (a) { ADR_CACHE[k] = a; return new Promise(function (ok) { setTimeout(function () { ok(a); }, 1100); }); });
    });
    adrFronta = pr.catch(function () {});
    return pr;
  }
  function miestoText(p) {
    if (!p) return "";
    if (!p.lat) return p.chyba || "";
    for (var i = 0; i < ZNAME.length; i++) if (vzdialM(p, ZNAME[i]) <= 150) return ZNAME[i].n;
    if (p.adresa) return p.adresa;
    var k = p.lat.toFixed(4) + "," + p.lng.toFixed(4);
    if (ADR_CACHE[k]) return ADR_CACHE[k];
    if (ADR_CACHE[k] === "") return "adresa sa nenašla";
    if (ADR_CACHE[k] === undefined) adresaZGps(p).then(function (a) { if (a && D.zalozka === "osoba") kresli(); });
    return "zisťujem miesto…";
  }
  function gpsOdkazy(g) {
    var f = function (p, t) { var m = miestoText(p); return m ? '<div class="d-gps">📍 ' + t + ": " + esc(m) + "</div>" : ""; };
    return f(g.prichod, "príchod") + f(g.odchod, "odchod");
  }
  function pohladMesiac() {
    var d = D.data;
    if (!d) return '<div class="empty"><strong>Načítavam…</strong></div>';
    return (D.zalozka === "osoba" ? '<div class="d-osoba-hl"><button class="btn-link" data-d-zal="tim">← Tím</button> <b>' + esc(d.osoba && d.osoba.meno) + "</b>" +
      (d.uprava ? ' <button class="btn" data-d="pridat">➕ Pridať záznam</button>' +
        '<form class="d-norma" id="d-norma-form"><label>Denná norma <input id="d-norma" type="number" step="0.25" min="1" max="24" value="' + esc(d.osoba && d.osoba.norma_h) + '"> h</label>' +
        '<button class="btn" type="submit">Uložiť</button></form>' : "") + "</div>" : "") +
      tabulkaMesiaca(d, d.uprava && D.zalozka === "osoba") +
      (D.zalozka === "mesiac" && (d.absencie || []).length ? "<h3>Moje žiadosti</h3>" + ziadostiZoznam(d.absencie) : "");
  }
  function ziadostiZoznam(a) {
    var st = { ziadost: '<span class="pill">čaká</span>', schvalena: '<span class="pill ok">schválená</span>', zamietnuta: '<span class="pill bad">zamietnutá</span>' };
    return '<div class="rows">' + a.map(function (x) {
      return '<div class="row"><span>' + esc(TYPY[x.typ]) + " · " + esc(denSk(x.od)) + (x.do !== x.od ? " – " + esc(denSk(x.do)) : "") +
        (x.cas_od ? " " + String(x.cas_od).slice(0, 5) + "–" + String(x.cas_do || "").slice(0, 5) : "") + (x.dovod ? ' <span class="muted">(' + esc(x.dovod) + ")</span>" : "") + "</span>" + (st[x.stav] || "") + "</div>";
    }).join("") + "</div>";
  }
  function pohladZiadost() {
    var dnes = iso(new Date()), o = D.oprava || null;
    return '<form class="card f-form d-ziadost" id="d-ziadost-form"><h3>Žiadosť – neprítomnosť alebo oprava</h3>' +
      (o ? '<p class="f-sprava">Oprava záznamu ' + esc(denSk(o.datum)) + " (" + esc(cas(o.prichod)) + "–" + esc(cas(o.odchod)) + ') – zadaj správne časy. <button type="button" class="btn-link" data-d="opr-zrus">zrušiť</button></p>' : "") +
      '<label class="field"><span class="label">Druh</span><select id="d-z-typ"><option value="dovolenka">Dovolenka</option><option value="pn">PN (práceneschopnosť)</option>' +
      '<option value="ocr">OČR (ošetrovanie člena rodiny)</option><option value="lekar">Návšteva lekára</option><option value="oprava">Oprava záznamu (zabudnutý príchod / odchod)</option></select></label>' +
      '<div class="d-riadok"><label class="field"><span class="label">Od</span><input type="date" id="d-z-od" value="' + dnes + '" required></label>' +
      '<label class="field"><span class="label">Do</span><input type="date" id="d-z-do" value="' + dnes + '"></label></div>' +
      '<div class="d-riadok d-z-casy" hidden><p class="muted d-cela">Ak čas nezadáš, započíta sa celá denná norma.</p><label class="field"><span class="label">Čas od</span><input type="time" id="d-z-cod"></label>' +
      '<label class="field"><span class="label">Čas do</span><input type="time" id="d-z-cdo"></label></div>' +
      '<label class="field d-z-miesto" hidden><span class="label">Miesto</span><select id="d-z-miesto">' + MIESTA.map(function (m) { return "<option" + (o && o.miesto === m ? " selected" : "") + ">" + m + "</option>"; }).join("") + "</select></label>" +
      '<label class="field"><span class="label">Poznámka / dôvod</span><input id="d-z-pozn" maxlength="200"></label>' +
      '<p class="muted">Po schválení vedením sa dni zapíšu do dochádzky v rozsahu tvojej dennej normy (lekár podľa času) a započítajú sa do fondu.</p>' +
      '<button class="btn btn-primary" type="submit"' + (D.prace ? " disabled" : "") + ">Odoslať žiadosť</button></form>" +
      (D.data && (D.data.absencie || []).length ? "<h3>Moje žiadosti</h3>" + ziadostiZoznam(D.data.absencie) : "");
  }
  function pohladTim() {
    var p = D.prehlad;
    if (!p) return '<div class="empty"><strong>Načítavam…</strong></div>';
    var ph = pushHtml(); if (ph) ph = '<div class="d-push-obal">' + ph + "</div>";
    var zoz = function (a, f) { return a.length ? '<div class="rows">' + a.map(f).join("") + "</div>" : '<p class="muted">Nikto</p>'; };
    return ph + '<div class="grid">' +
      '<section class="card"><h3>🟢 Teraz v práci <span class="pill ok num">' + p.v_praci.length + "</span></h3>" +
      zoz(p.v_praci, function (x) { return '<div class="row' + (x.min >= 840 ? " d-dlho" : "") + '"><span>' + esc(x.osoba) + ' <span class="muted">' + esc(x.miesto || "") + '</span></span><span class="num">od ' + esc(cas(x.prichod)) +
        (x.min >= 840 ? " · ⚠️ " + hodiny(x.min) + " h" : "") + "</span></div>"; }) + "</section>" +
      '<section class="card"><h3>⚠️ Má smenu, neprišiel <span class="pill num">' + p.neprisli.length + "</span></h3>" +
      zoz(p.neprisli, function (x) { return '<div class="row"><span>' + esc(x.osoba) + ' <span class="muted">' + esc(x.pozicia) + '</span></span><span class="num">' + (x.cas_od ? String(x.cas_od).slice(0, 5) : "") + "</span></div>"; }) + "</section>" +
      '<section class="card"><h3>📝 Žiadosti <span class="pill num">' + p.ziadosti.length + "</span></h3>" +
      zoz(p.ziadosti, function (x) {
        return '<div class="row d-ziad"><span><b>' + esc(x.osoba) + "</b> · " + esc(TYPY[x.typ]) + (x.typ === "oprava" ? (x.oprava_zaznamu ? " (zmena záznamu)" : " (chýbajúci deň)") + (x.miesto ? " " + esc(x.miesto) : "") : "") + " " + esc(denSk(x.od)) + (x.do !== x.od ? " – " + esc(denSk(x.do)) : "") +
          (x.cas_od ? " " + String(x.cas_od).slice(0, 5) + "–" + String(x.cas_do || "").slice(0, 5) : "") + (x.poznamka ? ' <span class="muted">' + esc(x.poznamka) + "</span>" : "") + "</span>" +
          (p.uprava ? '<span class="d-ziad-tl"><button class="btn btn-primary" data-d-schval="' + x.id + '">Schváliť</button><button class="btn" data-d-zamietni="' + x.id + '">Zamietnuť</button></span>' : "") + "</div>";
      }) + "</section></div>" +
      "<h3>Mesiac – " + esc(mesiacNazov(D.mesiac)) + "</h3>" +
      '<div class="tbl-wrap"><table class="d-tab d-tab-tim"><thead><tr><th>Zamestnanec</th><th>Norma/deň</th><th>Hodiny</th><th>Dni</th><th>Stravné</th><th></th></tr></thead><tbody>' +
      p.ludia.map(function (x) {
        return '<tr><td class="c-meno">' + esc(x.meno) + (x.ucet ? "" : ' <span class="muted" title="Nemá prepojený účet v appke">(bez účtu)</span>') + '</td><td class="num c-norma"><span class="c-mob">norma </span>' + String(x.norma_h || 8).replace(".", ",") + ' h</td><td class="num c-hod"><b>' + hodiny(x.min) +
          '<span class="c-mob"> h</span></b></td><td class="num c-dni">' + x.dni + '<span class="c-mob"> dní</span></td><td class="num c-str"><span class="c-mob">stravné </span>' + eur(x.stravne) + '</td><td class="c-det"><button class="btn-link" data-d-osoba="' + x.id + '">Detail</button></td></tr>';
      }).join("") + "</tbody></table></div>";
  }
  function dialogHtml() {
    var x = D.dialog; if (!x) return "";
    var r = x.riadok || {}, dat = r.datum || iso(new Date());
    return '<div class="f-dialog-pozadie" data-d="zavri"></div><div class="f-dialog" role="dialog" aria-modal="true"><form class="f-form" id="d-upr-form"><h3>' + (r.id ? "Upraviť záznam" : "Nový záznam") + "</h3>" +
      '<div class="d-riadok"><label class="field"><span class="label">Dátum</span><input type="date" id="d-u-dat" value="' + esc(dat) + '" required></label>' +
      '<label class="field"><span class="label">Druh</span><select id="d-u-typ">' + Object.keys(TYPY).map(function (k) { return '<option value="' + k + '"' + ((r.typ || "praca") === k ? " selected" : "") + ">" + TYPY[k] + "</option>"; }).join("") + "</select></label></div>" +
      '<label class="field"><span class="label">Miesto</span><select id="d-u-miesto"><option value=""></option>' + MIESTA.map(function (m) { return '<option' + (r.miesto === m ? " selected" : "") + ">" + m + "</option>"; }).join("") + "</select></label>" +
      '<div class="d-riadok"><label class="field"><span class="label">Príchod</span><input type="time" id="d-u-pr" value="' + esc(r.prichod ? cas(r.prichod) : "") + '"></label>' +
      '<label class="field"><span class="label">Odchod</span><input type="time" id="d-u-od" value="' + esc(r.odchod ? cas(r.odchod) : "") + '"></label></div>' +
      '<label class="field"><span class="label">Poznámka</span><input id="d-u-pozn" value="' + esc(r.poznamka || "") + '"></label>' +
      '<p class="muted">Prestávka, hodiny a stravné sa prepočítajú samé.</p>' +
      '<div class="f-akcie"><button class="btn btn-primary" type="submit">Uložiť</button>' + (r.id ? '<button class="btn" type="button" data-d="zmazat">🗑️ Zmazať</button>' : "") +
      '<button class="btn" type="button" data-d="zavri">Zrušiť</button></div></form></div>';
  }
  function prekresli() {
    if (!koren || !koren.isConnected) return;
    var z = D.zalozka, obsah = z === "tim" ? pohladTim() : z === "ziadost" ? pohladZiadost() : pohladMesiac();
    koren.innerHTML = '<div class="d-modul">' + (D.moja && D.moja.osoba && z !== "tim" && z !== "osoba" ? '<div class="grid d-grid-karta">' + kartaHtml() + "</div>" : "") + hlava() + obsah + "</div>" + dialogHtml();
    var typ = document.getElementById("d-z-typ");
    if (typ) { if (D.oprava && !D.opravaVypl) { D.opravaVypl = true; typ.value = "oprava"; document.getElementById("d-z-od").value = D.oprava.datum; document.getElementById("d-z-cod").value = cas(D.oprava.prichod); document.getElementById("d-z-cdo").value = cas(D.oprava.odchod); } polia(typ.value); }
    if (window.lbzPamat) lbzPamat.uloz("dochadzka", { zalozka: D.zalozka, osoba: D.osoba, mesiac: D.mesiac });
  }
  function obnov() {
    if (D.zalozka === "tim") nacitajPrehlad(); else if (D.zalozka === "osoba" || D.zalozka === "mesiac" || D.zalozka === "ziadost") nacitajMesiac();
  }

  // ---------- akcie (klik na karte Prehľadu aj v module) ----------
  function klik(e) {
    var t = e.target.closest("[data-d],[data-d-miesto],[data-d-zal],[data-d-osoba],[data-d-schval],[data-d-zamietni],[data-d-upr],[data-d-opr]"); if (!t) return;
    var d = t.dataset;
    if (d.dMiesto) { D.miesto = d.dMiesto; Array.prototype.forEach.call(document.querySelectorAll("[data-d-miesto]"), function (b) { b.setAttribute("aria-pressed", String(b.dataset.dMiesto === D.miesto)); }); return; }
    if (d.dZal) { D.zalozka = d.dZal; D.sprava = null; if (d.dZal !== "osoba") D.osoba = null; D.data = d.dZal === "tim" ? D.data : null; prekresli(); obnov(); return; }
    if (d.dOsoba) { D.zalozka = "osoba"; D.osoba = +d.dOsoba; D.data = null; prekresli(); nacitajMesiac(); window.scrollTo(0, 0); return; }
    if (d.dSchval || d.dZamietni) {
      var id = +(d.dSchval || d.dZamietni), ano = !!d.dSchval, dovod = null;
      if (!lbzPotvrd(ano ? "Schváliť žiadosť? Dni sa zapíšu do dochádzky." : "Zamietnuť žiadosť?")) return;
      po(rpc("dochadzka_rozhodni", { p_id: id, p_schval: ano, p_dovod: dovod }), function () { nacitajPrehlad(); });
      return;
    }
    if (d.dOpr) { D.opravaVypl = false; D.oprava = ((D.data && D.data.riadky) || []).filter(function (x) { return String(x.id) === d.dOpr; })[0] || null; D.zalozka = "ziadost"; prekresli(); window.scrollTo(0, 0); return; }
    if (d.dUpr) { var r = ((D.data && D.data.riadky) || []).filter(function (x) { return String(x.id) === d.dUpr; })[0]; D.dialog = { riadok: r }; prekresli(); return; }
    switch (d.d) {
      case "suhlas": po(rpc("dochadzka_suhlas", { p_text: SUHLAS_TEXT })); break;
      case "push": zapniPush(); break;
      case "prichod":
        var m = D.moja, miesto = navrhMiesta(m || {});
        D.prace++; kresli();
        poloha().then(function (g) { D.prace--; D.miesto = null; po(rpc("dochadzka_prichod", { p_miesto: miesto, p_gps: g }), function () { if (koren) obnov(); }); });
        break;
      case "odchod":
        if (!lbzPotvrd("Zapísať ODCHOD z práce?")) return;
        D.prace++; kresli();
        poloha().then(function (g) { D.prace--; po(rpc("dochadzka_odchod", { p_gps: g, p_poznamka: null }), function () { if (koren) obnov(); }); });
        break;
      case "mes-": case "mes+":
        var p = D.mesiac.split("-"), nd = new Date(+p[0], +p[1] - 1 + (d.d === "mes+" ? 1 : -1), 1); D.mesiac = iso(nd); D.data = null; D.prehlad = null; prekresli(); obnov(); break;
      case "zavri-spravu": D.sprava = null; kresli(); break;
      case "zavri": D.dialog = null; prekresli(); break;
      case "opr-zrus": D.oprava = null; prekresli(); break;
      case "pridat": D.dialog = { riadok: null }; prekresli(); break;
      case "zmazat":
        if (!lbzPotvrd("Zmazať tento záznam dochádzky?")) return;
        var zid = D.dialog && D.dialog.riadok && D.dialog.riadok.id; D.dialog = null;
        po(rpc("dochadzka_uprav", { p: { id: zid, zmazat: true } }), function () { nacitajMesiac(); }); break;
    }
  }
  function polia(typ) {
    if (!koren) return;
    var c = koren.querySelector(".d-z-casy"), m = koren.querySelector(".d-z-miesto"), doEl = document.getElementById("d-z-do"), cela = koren.querySelector(".d-cela");
    if (c) c.hidden = typ !== "lekar" && typ !== "oprava";
    if (m) m.hidden = typ !== "oprava";
    if (doEl) doEl.closest(".field").hidden = typ === "oprava" || typ === "lekar";
    if (cela) cela.hidden = typ === "oprava";
    var l1 = koren.querySelector("#d-z-cod"), l2 = koren.querySelector("#d-z-cdo");
    if (l1) l1.previousElementSibling.textContent = typ === "oprava" ? "Správny príchod" : "Čas od";
    if (l2) l2.previousElementSibling.textContent = typ === "oprava" ? "Správny odchod" : "Čas do";
  }
  function zmena(e) { if (e.target.id === "d-z-typ") polia(e.target.value); }
  function hodnota(id) { var el = document.getElementById(id); return el ? el.value : ""; }
  function odoslanie(e) {
    if (e.target.id === "d-ziadost-form") {
      e.preventDefault();
      po(rpc("dochadzka_ziadost", { p: { typ: hodnota("d-z-typ"), od: hodnota("d-z-od"), do: hodnota("d-z-do") || hodnota("d-z-od"), cas_od: hodnota("d-z-cod"), cas_do: hodnota("d-z-cdo"), poznamka: hodnota("d-z-pozn"),
        miesto: hodnota("d-z-typ") === "oprava" ? hodnota("d-z-miesto") : "", dochadzka_id: hodnota("d-z-typ") === "oprava" && D.oprava ? D.oprava.id : null } }),
        function () { D.zalozka = "mesiac"; D.oprava = null; nacitajMesiac(); try { DB.functions.invoke("upozornenia", { body: { akcia: "ziadost" } }); } catch (x) {} });
    }
    if (e.target.id === "d-norma-form") {
      e.preventDefault();
      po(rpc("dochadzka_norma", { p_osoba: D.osoba, p_h: Number(String(hodnota("d-norma")).replace(",", ".")) }), function () { nacitajMesiac(); });
    }
    if (e.target.id === "d-upr-form") {
      e.preventDefault();
      var r = D.dialog && D.dialog.riadok;
      var p = { id: r ? r.id : null, osoba_id: D.osoba, datum: hodnota("d-u-dat"), typ: hodnota("d-u-typ"), miesto: hodnota("d-u-miesto"), prichod: hodnota("d-u-pr"), odchod: hodnota("d-u-od"), poznamka: hodnota("d-u-pozn") };
      D.dialog = null;
      po(rpc("dochadzka_uprav", { p: p }), function () { nacitajMesiac(); });
    }
  }

  // bežiaci čas „v práci“ (každých 30 s bez prekresľovania)
  setInterval(function () {
    Array.prototype.forEach.call(document.querySelectorAll("[data-d-od]"), function (el) {
      el.textContent = hm(Math.max(0, Math.round((Date.now() - new Date(el.getAttribute("data-d-od")).getTime()) / 60000)));
    });
  }, 30000);
  // karta na Prehľade je mimo modulu → kliky zachytiť na dokumente
  document.addEventListener("click", function (e) { if (!koren || !koren.contains(e.target)) { if (e.target.closest(".d-karta")) klik(e); } });
  // po návrate do appky obnoviť stav (príchod mohol byť zapísaný na inom zariadení)
  document.addEventListener("visibilitychange", function () { if (!document.hidden && DB) nacitajMoju(); });

  (function () {
    var p = window.lbzPamat && lbzPamat.nacitaj("dochadzka"); if (p) { D.zalozka = p.zalozka || "mesiac"; D.osoba = p.osoba || null; D.mesiac = p.mesiac || null; }
    var q = new URLSearchParams(location.search);
    if (q.get("m") === "dochadzka" && q.get("z")) { D.zalozka = q.get("z"); D.osoba = null; D.mesiac = null; }
    if (q.get("m")) try { history.replaceState(null, "", location.pathname); } catch (e) {}
  })();

  // ---------- upozornenia do mobilu ----------
  function pushMoze() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
  function b64u(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; var r = atob(s), a = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; }
  function pushStav() {
    if (!pushMoze()) return Promise.resolve("nepodporuje");
    if (Notification.permission === "denied") return Promise.resolve("zakazane");
    return navigator.serviceWorker.ready.then(function (r) { return r.pushManager.getSubscription(); }).then(function (s) { return s ? "zapnute" : "vypnute"; }).catch(function () { return "vypnute"; });
  }
  function zapniPush() {
    D.prace++; kresli();
    var koniec = function (typ, text) { D.prace--; D.sprava = { typ: typ, text: text }; D.push = typ === "ok" ? "zapnute" : D.push; kresli(); };
    Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") return koniec("chyba", "Upozornenia nie sú povolené – povoľ ich v nastaveniach prehliadača pre túto appku.");
      return DB.functions.invoke("upozornenia", { body: { akcia: "kluc" } }).then(function (k) {
        var kl = k && k.data && k.data.kluc; if (!kl) throw new Error("Upozornenia ešte nie sú nastavené na serveri");
        return navigator.serviceWorker.ready.then(function (r) { return r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(kl) }); });
      }).then(function (sub) {
        var j = sub.toJSON(); j.zariadenie = navigator.userAgent;
        return rpc("push_uloz", { p: j });
      }).then(function () {
        DB.functions.invoke("upozornenia", { body: { akcia: "test" } });
        koniec("ok", "🔔 Upozornenia sú zapnuté – o chvíľu príde skúšobné.");
      });
    }).catch(function (e) { koniec("chyba", chybaText(e)); });
  }
  function pushHtml() {
    if (D.push === undefined) { D.push = null; pushStav().then(function (s) { D.push = s; kresli(); }); }
    if (!D.push || D.push === "zapnute" || D.push === "nepodporuje") {
      if (D.push === "nepodporuje" && /iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone) return '<p class="muted d-pozn">🔔 Upozornenia na iPhone fungujú, keď appku pridáš na plochu (Zdieľať → Pridať na plochu).</p>';
      return "";
    }
    if (D.push === "zakazane") return '<p class="muted d-pozn">🔕 Upozornenia sú v prehliadači zakázané – povoľ ich v nastaveniach stránky.</p>';
    return '<button class="btn d-push" data-d="push"' + (D.prace ? " disabled" : "") + '>🔔 Zapnúť upozornenia do mobilu</button>';
  }

  window.LBZ_DOCHADZKA = {
    nastavDb: function (klient, rola) { DB = klient || null; ROLA = klient ? rola : null; D.moja = null; D.data = null; D.prehlad = null; if (DB) nacitajMoju(); },
    mozem: function () { return !!DB && ["prevadzka", "furman", "zakaznicky_servis", "zakaznik"].indexOf(ROLA) === -1; },   // spoločné účty si dochádzku nezapisujú
    mount: function (el) {
      koren = el;
      el.addEventListener("click", klik); el.addEventListener("change", zmena); el.addEventListener("submit", odoslanie);
      if (!D.mesiac) D.mesiac = prvyDen(new Date());
      if (D.moja && !D.moja.osoba && D.zalozka !== "tim" && D.zalozka !== "osoba") D.zalozka = citatel() ? "tim" : "mesiac";
      if (!D.moja && citatel() && D.zalozka === "mesiac") D.zalozka = "mesiac";
      prekresli(); obnov();
    },
    karta: function () { return kartaHtml(); },
    maKartu: function () { return !D.moja || !!(D.moja && (D.moja.osoba || D.moja.chyba)); }
  };
})();
