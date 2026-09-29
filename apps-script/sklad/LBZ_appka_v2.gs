// ==========================================================================
// LBZ APPKA v2 – rýchly vchod pre novú aplikáciu (app.legendarnebuchty.sk)
// --------------------------------------------------------------------------
// • Samostatný súbor v projekte SKLAD LBZ. Starý skener v Upgates sa NEMENÍ.
// • Zapisuje do tých istých hárkov a v tom istom formáte ako starý skener
//   (Sklad, Vydané, AKTUÁLNY SKLAD) → jeden zdroj pre obe appky.
// • Zdieľa zámok (LockService) so starým skenerom → zápisy sa nebijú.
// • Volá sa z doPost, keď požiadavka obsahuje "v2": true.
//
// Akcie:  PING | KATALOG | STAV | SKENY | FURMANKY_OBNOV | BALIKY (prenos skladu do novej appky)
// Obnova furmaniek každých 15 min: spúšťač sa vytvorí sám pri prvom STAV (alebo ručne v2ZapniAutomatickeFurmanky)
// ==========================================================================

var V2_TZ = "Europe/Bratislava";
var V2_CACHE_STAV = "v2_stav";
var V2_CACHE_KATALOG = "v2_katalog";

function lbzV2(params) {
  var out;
  try {
    var akcia = String(params.akcia || "");
    if (akcia === "PING") out = { ok: true, cas: v2Cas_(new Date(), "HH:mm:ss") };
    else if (akcia === "KATALOG") out = { ok: true, katalog: v2Katalog_(null, params.cerstvy === true) };
    else if (akcia === "STAV") { v2ZabezpecSpustac_(); out = v2Stav_(params.cerstvy === true); }
    else if (akcia === "SKENY") out = v2Skeny_(params.skeny || []);
    else if (akcia === "FURMANKY_OBNOV") out = v2ObnovFurmanky_();
    else if (akcia === "BALIKY") out = v2Baliky_();
    else if (akcia === "SABLONA") out = v2Sablona_();
    else if (akcia === "HISTORIA") out = v2Historia_();
    else out = { ok: false, chyba: "Neznáma akcia: " + akcia };
  } catch (err) {
    out = { ok: false, chyba: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// --------------------------------------------------------------------------
// STAV SKLADU + FURMANKY (to isté, čo vracia GET_SKLAD), krátko v cache
// --------------------------------------------------------------------------
function v2Stav_(cerstvy) {
  if (!cerstvy) {
    var ulozene = v2CacheGet_(V2_CACHE_STAV);
    if (ulozene) { var o = JSON.parse(ulozene); o.zCache = true; return o; }
  }
  var ss = SpreadsheetApp.openById(ID_HLAVNEJ_TABULKY);
  var d = dajSklad(ss);
  if (d.statusType === "error") return { ok: false, chyba: d.statusText };
  var vysledok = {
    ok: true,
    cas: v2Cas_(new Date(), "HH:mm"),
    furmankyCas: CacheService.getScriptCache().get("furmankyAktualizovane") || "",
    skladItems: d.skladItems,
    rozvozy: d.rozvozy,
    rozvozyData: d.rozvozyData
  };
  v2CachePut_(V2_CACHE_STAV, JSON.stringify(vysledok), 60);
  return vysledok;
}

function v2ObnovFurmanky_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, zaneprazdnene: true, chyba: "Sklad je práve zaneprázdnený, skúste o chvíľu." };
  try {
    var v = aktualizujRozvozyRano();
    if (v !== true) return { ok: false, chyba: "Furmanky sa neaktualizovali: " + v };
  } finally { lock.releaseLock(); }
  v2CacheZmaz_(V2_CACHE_STAV);
  return v2Stav_(true);
}

// Spustiť RAZ ručne z editora – furmanky sa budú obnovovať samé každých 15 minút (5:00 – 22:00)
function v2ZapniAutomatickeFurmanky() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "v2AutomatickeFurmanky") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("v2AutomatickeFurmanky").timeBased().everyMinutes(15).create();
  Logger.log("Automatická obnova furmaniek zapnutá (každých 15 min).");
}

// Pri prvom otvorení stavu v appke sa spúšťač vytvorí sám (ak ešte neexistuje)
function v2ZabezpecSpustac_() {
  var c = CacheService.getScriptCache();
  if (c.get("v2_spustac_ok")) return;
  try {
    var existuje = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "v2AutomatickeFurmanky"; });
    if (!existuje) ScriptApp.newTrigger("v2AutomatickeFurmanky").timeBased().everyMinutes(15).create();
    c.put("v2_spustac_ok", "1", 21600);
  } catch (e) { console.log("Spúšťač furmaniek: " + e); }
}

function v2AutomatickeFurmanky() {
  var hodina = Number(v2Cas_(new Date(), "H"));
  if (hodina < 5 || hodina >= 22) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var v = aktualizujRozvozyRano();
    if (v !== true) console.log("Automatické furmanky: " + v);
  } finally { lock.releaseLock(); }
  v2CacheZmaz_(V2_CACHE_STAV);
}

// --------------------------------------------------------------------------
// SKENY – dávka skenov z jedného zariadenia (príjem / Krčmička / výdaj)
// Každý sken má jedinečné scanId → opakované odoslanie sa nezapíše dvakrát.
// --------------------------------------------------------------------------
function v2Skeny_(skeny) {
  if (!skeny || !skeny.length) return { ok: true, vysledky: [], pocty: {} };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, zaneprazdnene: true, chyba: "Sklad je práve zaneprázdnený, skúsim znova." };

  try {
    var ss = SpreadsheetApp.openById(ID_HLAVNEJ_TABULKY);
    var skladSh = ss.getSheetByName("Sklad");
    var vydaneSh = ss.getSheetByName("Vydané") || ss.insertSheet("Vydané");
    var katalog = v2Katalog_(ss, false);
    var katalogCerstvy = false;
    var teraz = new Date();

    // Hárok Sklad načítame RAZ pre celú dávku
    var posledny = skladSh.getLastRow();
    var data = posledny > 1 ? skladSh.getRange(2, 1, posledny - 1, 8).getValues() : [];
    var riadky = data.map(function (r, i) { return { v: r, riadok: i + 2, nove: false, zmena: false, zmaz: false }; });
    var index = {}; // kód balíka → riadok (len balíky Na sklade / v Krčmičke)
    riadky.forEach(function (o) {
      var k = v2Kod_(o.v[0]); var st = String(o.v[5]).trim();
      if (k && (st === "Na sklade" || st === "Krčmička") && !index[k]) index[k] = o;
    });

    // Skeny, ktoré už boli spracované (zariadenie neprijalo odpoveď a posiela znova)
    var cache = CacheService.getScriptCache();
    var spracovane = {};
    try { spracovane = cache.getAll(skeny.map(function (s) { return "v2_sid_" + s.scanId; })) || {}; } catch (e) {}

    var noveVydane = [];
    var vydaneVDavke = {};
    var dotknute = {};
    var vysledky = [];

    skeny.forEach(function (s) {
      var scanId = String(s.scanId || "");
      var rezim = String(s.rezim || "");
      var kod = v2Kod_(prelozSlovenskuKlavesnicu(String(s.kod || "").replace(/[´'’\/]/g, "-")));
      var poz = kod.lastIndexOf("-");
      var kmen = poz > -1 ? kod.substring(0, poz) : kod;
      var hotovo = function (ok, text, extra) {
        var r = { scanId: scanId, ok: ok, text: text, kod: kod, kmen: kmen };
        if (extra) for (var x in extra) r[x] = extra[x];
        vysledky.push(r);
      };

      var uz = scanId ? spracovane["v2_sid_" + scanId] : null;
      if (uz) { var p = JSON.parse(uz); p.duplicitne = true; vysledky.push(p); return; }
      if (!kod) { hotovo(false, "Prázdny kód"); return; }
      if (!katalog[kmen] && !katalogCerstvy) { katalog = v2Katalog_(ss, true); katalogCerstvy = true; }
      if (!katalog[kmen]) { hotovo(false, "Kód " + kod + " nie je v Zozname produktov"); return; }
      var o = index[kod];

      if (rezim === "Príjem" || rezim === "Krčmička") {
        if (o) {
          var st = String(o.v[5]).trim();
          if (scanId && String(o.v[7]).trim() === scanId) { hotovo(true, "Už zapísané", { duplicitne: true }); return; }
          if (rezim === "Príjem") {
            hotovo(false, st === "Krčmička" ? "Balík je v Krčmičke" : "Už je na sklade (prijatý " + v2Kratko_(o.v[2]) + ")");
            return;
          }
          if (st === "Krčmička") { hotovo(false, "Už je v Krčmičke (od " + v2Kratko_(o.v[2]) + ")"); return; }
          o.v[5] = "Krčmička"; o.v[7] = scanId; o.zmena = true;
          dotknute[kmen] = true; hotovo(true, "Presunuté do Krčmičky");
          return;
        }
        if (vydaneVDavke[kod]) { hotovo(false, "Balík bol v tejto dávke práve vydaný"); return; }
        var exp = v2PovodnaExpiracia_(vydaneSh, kod);
        if (!exp) { exp = new Date(teraz.getTime()); exp.setMonth(exp.getMonth() + 3); }
        var cielovy = rezim === "Príjem" ? "Na sklade" : "Krčmička";
        var novy = { v: [kod, kmen, teraz, exp, "", cielovy, "", scanId], riadok: 0, nove: true, zmena: false, zmaz: false };
        riadky.push(novy); index[kod] = novy;
        dotknute[kmen] = true;
        hotovo(true, rezim === "Príjem" ? "Prijaté" : "Priamo do Krčmičky", { expiracia: v2Cas_(exp, "d.M.yyyy") });
        return;
      }

      if (rezim === "Výdaj") {
        if (o) {
          noveVydane.push([o.v[0], o.v[1], o.v[2], o.v[3], teraz, "Vydané", "", scanId, s.objednavka || "", s.rozvoz || ""]);
          o.zmaz = true; delete index[kod]; vydaneVDavke[kod] = true;
          dotknute[kmen] = true; hotovo(true, "Vydané");
          return;
        }
        if (vydaneVDavke[kod]) { hotovo(false, "Balík už bol vydaný (v tejto dávke)"); return; }
        var rV = v2PoslednyRiadok_(vydaneSh, kod);
        if (rV) {
          var info = vydaneSh.getRange(rV, 5, 1, 5).getValues()[0]; // E čas, F, G, H scanId, I objednávka
          var ulozenyScan = String(info[3]).trim();
          var ulozenaObj = String(info[4]).trim().toUpperCase();
          if ((scanId && ulozenyScan === scanId) || (s.objednavka && ulozenaObj === String(s.objednavka).trim().toUpperCase())) {
            hotovo(true, "Už vydané", { duplicitne: true }); return;
          }
          hotovo(false, "Balík už bol vydaný (" + v2Kratko_(info[0]) + ")");
          return;
        }
        hotovo(false, "Balík nie je na sklade ani v Krčmičke");
        return;
      }

      hotovo(false, "Neznámy režim: " + rezim);
    });

    // ---- zápis naraz (poradie je dôležité: zmeny → nové → Vydané → mazanie) ----
    riadky.forEach(function (o) {
      if (o.zmena && !o.nove && !o.zmaz) {
        skladSh.getRange(o.riadok, 6).setValue(o.v[5]);
        skladSh.getRange(o.riadok, 8).setValue(o.v[7]);
      }
    });
    var nove = riadky.filter(function (o) { return o.nove && !o.zmaz; }).map(function (o) { return o.v; });
    if (nove.length) skladSh.getRange(skladSh.getLastRow() + 1, 1, nove.length, 8).setValues(nove);
    if (noveVydane.length) {
      vydaneSh.getRange(vydaneSh.getLastRow() + 1, 1, noveVydane.length, 10).setValues(noveVydane).setFontLine("line-through");
    }
    var naZmazanie = riadky.filter(function (o) { return o.zmaz && !o.nove; }).map(function (o) { return o.riadok; });
    if (naZmazanie.length) zmazRiadkyBlokovo(skladSh, naZmazanie);
    SpreadsheetApp.flush();

    var pocty = v2PrepocitajAktualny_(ss, riadky, Object.keys(dotknute));
    vysledky.forEach(function (r) { if (pocty[r.kmen]) r.pocet = pocty[r.kmen]; });
    var naZapamatanie = {};
    vysledky.forEach(function (r) { if (r.ok && r.scanId && !r.duplicitne) naZapamatanie["v2_sid_" + r.scanId] = JSON.stringify({ scanId: r.scanId, ok: true, text: r.text, kod: r.kod, kmen: r.kmen }); });
    try { if (Object.keys(naZapamatanie).length) cache.putAll(naZapamatanie, 21600); } catch (e) {}
    v2CacheZmaz_(V2_CACHE_STAV);
    return { ok: true, vysledky: vysledky, pocty: pocty, cas: v2Cas_(new Date(), "HH:mm:ss") };
  } finally {
    lock.releaseLock();
  }
}

// Prepočíta D, E a stĺpce rozvozov v AKTUÁLNY SKLAD len pre dotknuté produkty (rovnaká logika ako prepocitajAktualnySklad)
function v2PrepocitajAktualny_(ss, riadky, kmene) {
  var pocty = {};
  if (!kmene.length) return pocty;
  kmene.forEach(function (k) { pocty[k] = { hlavny: 0, krcmicka: 0 }; });
  riadky.forEach(function (o) {
    if (o.zmaz) return;
    var p = pocty[String(o.v[1]).trim().toUpperCase()]; if (!p) return;
    var st = String(o.v[5]).trim();
    if (st === "Na sklade") p.hlavny++; else if (st === "Krčmička") p.krcmicka++;
  });
  var akt = ss.getSheetByName("AKTUÁLNY SKLAD"); if (!akt) return pocty;
  var data = akt.getDataRange().getValues();
  var hotove = {};
  for (var r = 1; r < data.length; r++) {
    var k = String(data[r][0]).trim().toUpperCase();
    var p = pocty[k]; if (!p || hotove[k]) continue;
    hotove[k] = true;
    akt.getRange(r + 1, 4, 1, 2).setValues([[p.hlavny, p.krcmicka]]);
    var zvysok = p.hlavny, hodnoty = [], farby = [], zmena = false;
    for (var c = 5; c < data[r].length; c++) {
      var m = String(data[r][c]).trim().match(/^(-?\d+)\s*\(\s*(\d+)\s*\)/);
      if (m) {
        var obj = parseInt(m[2], 10); var roz = zvysok - obj;
        hodnoty.push((roz >= 0 ? "0" : roz) + " (" + obj + ")"); farby.push(roz >= 0 ? "black" : "red");
        zvysok = Math.max(0, roz); zmena = true;
      } else { hodnoty.push(data[r][c]); farby.push("black"); }
    }
    if (zmena && hodnoty.length) akt.getRange(r + 1, 6, 1, hodnoty.length).setValues([hodnoty]).setFontColors([farby]);
  }
  return pocty;
}

// --------------------------------------------------------------------------
// BALIKY – všetky balíky Na sklade / v Krčmičke (len čítanie) na prenos do novej appky
// --------------------------------------------------------------------------
function v2Baliky_() {
  var sh = SpreadsheetApp.openById(ID_HLAVNEJ_TABULKY).getSheetByName("Sklad");
  var posl = sh.getLastRow();
  var data = posl > 1 ? sh.getRange(2, 1, posl - 1, 6).getValues() : [];
  var iso = function (d) { return d instanceof Date && !isNaN(d) ? d.toISOString() : ""; };
  var baliky = [];
  data.forEach(function (r) {
    var kod = v2Kod_(r[0]); var st = String(r[5]).trim();
    if (!kod || (st !== "Na sklade" && st !== "Krčmička")) return;
    baliky.push({ kod: kod, kmen: v2Kod_(r[1]), stav: st === "Krčmička" ? "krcmicka" : "sklad", prijaty: iso(r[2]), expiracia: iso(r[3]) });
  });
  return { ok: true, pocet: baliky.length, baliky: baliky, cas: v2Cas_(new Date(), "HH:mm:ss") };
}

// --------------------------------------------------------------------------
// KATALÓG (Zoznam produktov: A kód, C názov, farba pozadia)
// --------------------------------------------------------------------------
function v2Katalog_(ss, cerstvy) {
  var cache = CacheService.getScriptCache();
  if (!cerstvy) { var t = cache.get(V2_CACHE_KATALOG); if (t) return JSON.parse(t); }
  var sh = (ss || SpreadsheetApp.openById(ID_HLAVNEJ_TABULKY)).getSheetByName("Zoznam produktov");
  var posl = sh.getLastRow(); var m = {};
  if (posl > 1) {
    var hodnoty = sh.getRange(2, 1, posl - 1, 3).getValues();
    var pozadia = sh.getRange(2, 1, posl - 1, 1).getBackgrounds();
    hodnoty.forEach(function (r, i) {
      var k = String(r[0]).trim().toUpperCase();
      if (k) m[k] = { n: String(r[2]).trim(), f: pozadia[i][0] || "#ffffff" };
    });
  }
  try { cache.put(V2_CACHE_KATALOG, JSON.stringify(m), 300); } catch (e) {}
  return m;
}

// --------------------------------------------------------------------------
// POMOCNÉ
// --------------------------------------------------------------------------
function v2Kod_(x) { return String(x || "").trim().toUpperCase(); }

function v2Cas_(d, format) { return Utilities.formatDate(d, V2_TZ, format); }

function v2Kratko_(d) {
  try { return d ? v2Cas_(new Date(d), "d.M. HH:mm") : "neznámy čas"; } catch (e) { return "neznámy čas"; }
}

// Pôvodná expirácia balíka, ktorý sa vracia na sklad (najstarší záznam v hárku Vydané)
function v2PovodnaExpiracia_(sh, kod) {
  var posl = sh.getLastRow(); if (posl < 2) return null;
  var najdene = sh.getRange(2, 1, posl - 1, 1).createTextFinder(kod).matchEntireCell(true).findAll();
  for (var i = 0; i < najdene.length && i < 5; i++) {
    var d = sh.getRange(najdene[i].getRow(), 4).getValue();
    if (d instanceof Date && !isNaN(d.getTime())) return d;
  }
  return null;
}

// Posledný riadok v hárku Vydané s daným kódom balíka (alebo 0)
function v2PoslednyRiadok_(sh, kod) {
  var posl = sh.getLastRow(); if (posl < 2) return 0;
  var najdene = sh.getRange(2, 1, posl - 1, 1).createTextFinder(kod).matchEntireCell(true).findAll();
  return najdene.length ? najdene[najdene.length - 1].getRow() : 0;
}

// Cache po kúskoch (jedna položka v CacheService môže mať max. 100 kB)
function v2CachePut_(kluc, text, sekundy) {
  var KUS = 40000, n = Math.ceil(text.length / KUS), obj = {};
  obj[kluc + "_n"] = String(n);
  for (var i = 0; i < n; i++) obj[kluc + "_" + i] = text.substr(i * KUS, KUS);
  try { CacheService.getScriptCache().putAll(obj, sekundy); } catch (e) {}
}

function v2CacheGet_(kluc) {
  var c = CacheService.getScriptCache();
  var n = parseInt(c.get(kluc + "_n"), 10); if (!n) return null;
  var kluce = []; for (var i = 0; i < n; i++) kluce.push(kluc + "_" + i);
  var m = c.getAll(kluce), s = "";
  for (var j = 0; j < n; j++) { if (m[kluce[j]] == null) return null; s += m[kluce[j]]; }
  return s;
}

function v2CacheZmaz_(kluc) { try { CacheService.getScriptCache().remove(kluc + "_n"); } catch (e) {} }

// Test z editora: vypíše začiatok odpovede STAV
function v2Test() {
  var out = lbzV2({ v2: true, akcia: "STAV", cerstvy: true });
  Logger.log(out.getContent().substring(0, 300));
}

// ---------------------------------------------------------------------------
// Šablóna furmanky (hárok Default zo Správy objednávok) – na jednorazový prenos do appky
// ---------------------------------------------------------------------------
function v2Sablona_() {
  var sh = SpreadsheetApp.openById("1vVafbxeiL9HhoBDOep8wmdj64-C4H6cRfr_eFmOhXpA").getSheetByName("Default");
  var n = sh.getLastRow();
  var r = sh.getRange(1, 1, n, 8);
  return { ok: true, hodnoty: r.getDisplayValues(), vzorce: r.getFormulasR1C1(), farby: sh.getRange(1, 1, n, 3).getBackgrounds(),
    produkty: (function () { var p = sh.getParent().getSheetByName("Produkty"); return p ? p.getRange(1, 1, p.getLastRow(), Math.min(6, p.getLastColumn())).getDisplayValues() : []; })() };
}

// Uzavreté (FULL) hárky Správy objednávok: názov + čísla objednávok (riadok 5 od stĺpca I) – na prenos histórie do appky
function v2Historia_() {
  var ss = SpreadsheetApp.openById("1vVafbxeiL9HhoBDOep8wmdj64-C4H6cRfr_eFmOhXpA");
  var out = [];
  ss.getSheets().forEach(function (sh) {
    var n = sh.getName();
    var c1 = String(sh.getRange("C1").getValue()).trim().toUpperCase();
    var last = sh.getLastColumn();
    var cisla = last >= 9 ? sh.getRange(5, 9, 1, last - 8).getDisplayValues()[0].map(function (x) { return String(x).trim(); }).filter(String) : [];
    out.push({ nazov: n, full: c1 === "FULL" || /\[FULL\]/i.test(n), cisla: cisla });
  });
  return { ok: true, harky: out };
}
