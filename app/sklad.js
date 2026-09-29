// LBZ aplikácia – modul SKLAD a FURMANKY
// Sklad: vlastná databáza appky (Supabase) – skeny, stav, ručné úpravy, história.
// Furmanky (čo sa vezie): zatiaľ zo starej tabuľky objednávok cez Apps Script (LBZ_appka_v2.gs),
// zostatky sa prepočítajú podľa skladu v appke.
// Sken sa hneď ukáže, do databázy ide na pozadí v dávkach. Neodoslané skeny
// čakajú v zariadení (aj bez signálu) a každý má jedinečné ID, takže sa nič
// nezapíše dvakrát.
// Bez Supabase v config.js beží starý spôsob (všetko cez Apps Script).

(function () {
  "use strict";

  var cfg = window.LBZ_CONFIG || {};
  var API = cfg.skladApiUrl || "";
  var SUPA = !!(cfg.supabaseUrl && cfg.supabaseAnonKey); // sklad je v databáze appky
  var DB = null, ROLA = null;                            // nastaví app.js po prihlásení
  function spravca() { return ROLA === "it" || ROLA === "ceo"; }
  function backend() { return SUPA ? !!DB : !!API; }
  function rpc(nazov, args) {
    return DB.rpc(nazov, args).then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  var STARY_SKENER = "https://www.legendarnebuchty.sk/skener-lbz";
  var MAX_HISTORIA = 400;
  var DAVKA = 25;

  // ---------- úložisko v zariadení ----------
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  var zariadenie = LS.get("lbz2_zariadenie", "");
  if (!zariadenie) { zariadenie = Math.random().toString(36).slice(2, 8).toUpperCase(); LS.set("lbz2_zariadenie", zariadenie); }

  var S = {
    rezim: LS.get("lbz2_rezim", "Príjem"),
    skeny: LS.get("lbz2_skeny", []),          // {scanId, kod, kmen, rezim, cas, stav: caka|ok|chyba, text, pocet}
    stav: LS.get("lbz2_stav", null),          // posledný stav skladu + furmanky
    katalog: LS.get("lbz2_katalog", {}),      // kmeňový kód → { n: názov, f: farba }
    pohlad: "skener",                         // skener | stav | sprava | furmanky | furmanka
    upravaInfo: null,                         // Správa: nájdený balík / výsledok
    pohyby: null,                             // Správa: posledné pohyby
    vsetkySkeny: null,                        // dnešné skeny zo všetkých zariadení (databáza)
    furmanka: null,
    filter: "vsetko",
    hladat: "",
    nacitavam: false,
    siet: "ok",                               // ok | offline | chyba
    sprava: null,                             // { typ, text } – veľký panel posledného skenu
    kamera: null
  };

  var koren = null;

  function ulozSkeny() {
    if (S.skeny.length > MAX_HISTORIA) S.skeny = S.skeny.slice(S.skeny.length - MAX_HISTORIA);
    LS.set("lbz2_skeny", S.skeny);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function cas(d) { d = d ? new Date(d) : new Date(); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
  function dnes(t) { var a = new Date(t), b = new Date(); return a.toDateString() === b.toDateString(); }

  // ---------- spojenie s tabuľkou ----------
  function api(data, ms) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 30000);
    var telo = JSON.stringify(Object.assign({ v2: true }, data));
    return fetch(API, { method: "POST", body: telo, signal: ctrl ? ctrl.signal : undefined, redirect: "follow" })
      .then(function (r) { return r.json(); })
      .then(function (j) { clearTimeout(t); return j; }, function (e) { clearTimeout(t); throw e; });
  }

  // ---------- zvuky a vibrácia ----------
  var audio = null;
  function pip(typ) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      var tony = typ === "ok" ? [[880, 0, 0.09]] : [[240, 0, 0.18], [180, 0.22, 0.25]];
      tony.forEach(function (t) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = t[0]; o.type = typ === "ok" ? "sine" : "square";
        g.gain.value = typ === "ok" ? 0.15 : 0.08;
        o.connect(g); g.connect(audio.destination);
        o.start(audio.currentTime + t[1]); o.stop(audio.currentTime + t[1] + t[2]);
      });
    } catch (e) {}
    try { if (typ !== "ok" && navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) {}
  }

  // ---------- skenovanie ----------
  var MAPA_SK = { "+": "1", "ľ": "2", "š": "3", "č": "4", "ť": "5", "ž": "6", "ý": "7", "á": "8", "í": "9", "é": "0" };
  function upravKod(t) {
    t = String(t || "").replace(/[´'’\/]/g, "-").trim();
    var v = "";
    for (var i = 0; i < t.length; i++) { var z = t.charAt(i); v += MAPA_SK[z] !== undefined ? MAPA_SK[z] : z; }
    return v.toUpperCase();
  }
  function kmenKodu(kod) { var p = kod.lastIndexOf("-"); return p > -1 ? kod.substring(0, p) : kod; }
  function nazovProduktu(kmen) { return (S.katalog[kmen] && S.katalog[kmen].n) || kmen; }

  var poslednyKod = "", poslednyCas = 0;

  function spracujSken(surovy) {
    var kod = upravKod(surovy);
    if (!kod) return;
    var teraz = Date.now();
    if (kod === poslednyKod && teraz - poslednyCas < 2500) return; // dvojité načítanie toho istého kódu
    poslednyKod = kod; poslednyCas = teraz;
    if (S.kamera || kameraStav !== "vyp") vypniKameru(); // po načítaní kódu sa kamera vypne

    // prepínacie kódy
    if (/^(IN|ÍŇ|PRIJEM|PRÍJEM)$/.test(kod)) return nastavRezim("Príjem");
    if (/^(OUT|VYDAJ|VÝDAJ)$/.test(kod)) return nastavRezim("Výdaj");
    if (/^(KRC|KRCMICKA|PREDAJNA)$/.test(kod)) return nastavRezim("Krčmička");
    if (kod.indexOf("QQQ") > -1) {
      S.sprava = { typ: "chyba", text: "Objednávky a balenie zatiaľ skenujte v starej appke." };
      pip("chyba"); prekresli(); return;
    }
    if (!/^[A-Z0-9]+(-[A-Z0-9]+)+$/.test(kod)) {
      S.sprava = { typ: "chyba", text: "Neplatný kód: " + kod };
      pip("chyba"); prekresli(); return;
    }

    // ten istý balík v tom istom režime hneď po sebe (napr. dvakrát Príjem) – zablokujeme.
    // Iný režim medzi tým (Príjem → Výdaj → Krčmička → Výdaj) je v poriadku.
    for (var i = S.skeny.length - 1; i >= 0; i--) {
      var s = S.skeny[i];
      if (!dnes(s.cas)) break;
      if (s.kod !== kod || s.stav === "chyba") continue;
      if (s.rezim === S.rezim && teraz - s.cas < 15 * 60000) { // staršie opakovanie posúdi tabuľka (mohla to zmeniť stará appka)
        S.sprava = { typ: "chyba", text: kod + " – už naskenované (" + S.rezim + ") o " + cas(s.cas) };
        pip("chyba"); prekresli(); return;
      }
      break; // posledný sken tohto balíka bol v inom režime
    }

    var kmen = kmenKodu(kod);
    var novy = { scanId: zariadenie + "-" + teraz.toString(36) + "-" + Math.random().toString(36).slice(2, 5), kod: kod, kmen: kmen, rezim: S.rezim, cas: teraz, stav: "caka", text: "" };
    S.skeny.push(novy); ulozSkeny();
    var znamy = !Object.keys(S.katalog).length || S.katalog[kmen];
    S.sprava = { typ: znamy ? "ok" : "info", text: ikonaRezimu(S.rezim) + " " + nazovProduktu(kmen), kod: kod };
    pip(znamy ? "ok" : "chyba");
    prekresli();
    posliFrontu();
  }

  function nastavRezim(r) {
    S.rezim = r; LS.set("lbz2_rezim", r);
    S.sprava = { typ: "info", text: "Režim: " + r };
    pip("ok"); prekresli();
  }
  function ikonaRezimu(r) { return r === "Príjem" ? "📥" : r === "Výdaj" ? "📤" : "🏪"; }

  // ---------- odosielanie fronty ----------
  var posielam = false, pokus = 0, casovac = null;
  function naplanuj(ms) { clearTimeout(casovac); casovac = setTimeout(posliFrontu, ms); }

  function posliFrontu() {
    if (!backend() || posielam) return;
    var caka = S.skeny.filter(function (s) { return s.stav === "caka"; });
    if (!caka.length) return;
    if (navigator.onLine === false) { S.siet = "offline"; prekresli(); naplanuj(5000); return; }
    posielam = true;
    var davka = caka.slice(0, DAVKA);
    var poslat = davka.map(function (s) { return { scanId: s.scanId, kod: s.kod, rezim: s.rezim, zariadenie: zariadenie }; });
    var ziadost = SUPA
      ? rpc("skeny", { p_skeny: poslat }).then(function (res) {
          res.pocty = {};
          (res.vysledky || []).forEach(function (v) { if (v.pocet && v.kmen) res.pocty[v.kmen] = v.pocet; });
          return res;
        })
      : api({ akcia: "SKENY", skeny: poslat }, 60000);
    ziadost
      .then(function (res) {
        if (!res || !res.ok) throw res || {};
        pokus = 0; S.siet = "ok";
        var chyby = 0;
        (res.vysledky || []).forEach(function (v) {
          var s = najdiSken(v.scanId); if (!s) return;
          s.stav = v.ok ? "ok" : "chyba"; s.text = v.text || ""; if (v.pocet) s.pocet = v.pocet;
          if (!v.ok) chyby++;
        });
        aktualizujPocty(res.pocty || {});
        ulozSkeny();
        if (chyby) { S.sprava = { typ: "chyba", text: chyby === 1 ? "1 sken sa nezapísal – pozri zoznam" : chyby + " skeny sa nezapísali – pozri zoznam" }; pip("chyba"); }
        posielam = false; prekresli();
        if (S.skeny.some(function (s) { return s.stav === "caka"; })) posliFrontu();
        else if (SUPA) nacitajDnesne();
      })
      .catch(function (err) {
        posielam = false; pokus++;
        S.siet = navigator.onLine === false ? "offline" : "chyba";
        prekresli();
        naplanuj(err && err.zaneprazdnene ? 2000 : Math.min(30000, 3000 * pokus));
      });
  }

  function najdiSken(id) { for (var i = S.skeny.length - 1; i >= 0; i--) if (S.skeny[i].scanId === id) return S.skeny[i]; return null; }

  // zmeny počtov premietneme aj do uloženého stavu skladu
  function aktualizujPocty(pocty) {
    if (!S.stav || !S.stav.skladItems) return;
    S.stav.skladItems.forEach(function (it) {
      var p = pocty[String(it.kod).toUpperCase()];
      if (p) { it.pocetHlavny = String(p.hlavny); it.pocetKrcmicka = String(p.krcmicka); }
    });
    if (SUPA) prepocitajRozvozy(S.stav);
    LS.set("lbz2_stav", S.stav);
  }

  // ---------- načítanie stavu a katalógu ----------
  // Zostatky na furmanky – rovnaký výpočet ako v starej tabuľke (AKTUÁLNY SKLAD):
  // rozvozy idú po poradí, každý si zoberie zo zvyšku hlavného skladu, záporné = treba dorobiť.
  function prepocitajRozvozy(st) {
    if (!st || !st.rozvozy || !st.rozvozyData) return;
    var pocty = {};
    (st.skladItems || []).forEach(function (it) {
      pocty[String(it.kod).toUpperCase()] = { h: parseInt(it.pocetHlavny, 10) || 0, k: parseInt(it.pocetKrcmicka, 10) || 0 };
    });
    var zvysok = {};
    st.rozvozy.forEach(function (r) {
      (st.rozvozyData[r] || []).forEach(function (p) {
        var kod = String(p.kod || "").toUpperCase();
        var pc = pocty[kod] || { h: 0, k: 0 };
        if (zvysok[kod] === undefined) zvysok[kod] = pc.h;
        p.pocetHlavny = String(pc.h); p.pocetKrcmicka = String(pc.k);
        var m = String(p.stav).match(/\((\d+)\)/); if (!m) return;
        var obj = parseInt(m[1], 10), roz = zvysok[kod] - obj;
        p.stav = (roz >= 0 ? "0" : String(roz)) + " (" + obj + ")";
        zvysok[kod] = Math.max(0, roz);
      });
    });
  }

  // furmanky zo starej tabuľky objednávok (ak zlyhajú, sklad sa aj tak ukáže)
  function furmankyZGas(obnov) {
    if (!API) return Promise.resolve(null);
    return api({ akcia: obnov ? "FURMANKY_OBNOV" : "STAV" }, obnov ? 120000 : 60000)
      .then(function (r) { return r && r.ok ? r : null; }, function () { return null; });
  }

  function spojStav(sklad, furm) {
    var st = sklad;
    var stary = S.stav || {};
    st.rozvozy = furm ? furm.rozvozy : stary.rozvozy;
    st.rozvozyData = furm ? furm.rozvozyData : stary.rozvozyData;
    st.furmankyCas = furm ? furm.furmankyCas : stary.furmankyCas;
    st.nacitane = Date.now();
    prepocitajRozvozy(st);
    return st;
  }

  function nacitajStav(cerstvy) {
    if (!backend()) return;
    S.nacitavam = true; prekresli();
    if (SUPA) {
      var furmNa = S.pohlad === "furmanky" || S.pohlad === "furmanka" || !(S.stav && S.stav.rozvozy);
      Promise.all([rpc("stav_skladu_appka"), furmNa ? furmankyZGas(false) : Promise.resolve(null)]).then(function (v) {
        S.nacitavam = false;
        if (v[0] && v[0].ok) { S.stav = spojStav(v[0], v[1]); LS.set("lbz2_stav", S.stav); S.siet = "ok"; }
        else S.sprava = { typ: "chyba", text: (v[0] && v[0].chyba) || "Stav skladu sa nepodarilo načítať" };
        prekresli();
      }).catch(function () { S.nacitavam = false; S.siet = navigator.onLine === false ? "offline" : "chyba"; prekresli(); });
      return;
    }
    api({ akcia: "STAV", cerstvy: !!cerstvy }, 60000).then(function (res) {
      S.nacitavam = false;
      if (res && res.ok) { S.stav = res; S.stav.nacitane = Date.now(); LS.set("lbz2_stav", S.stav); S.siet = "ok"; }
      else S.sprava = { typ: "chyba", text: (res && res.chyba) || "Stav skladu sa nepodarilo načítať" };
      prekresli();
    }).catch(function () { S.nacitavam = false; S.siet = navigator.onLine === false ? "offline" : "chyba"; prekresli(); });
  }

  function obnovFurmanky() {
    if (!API || !backend() || S.nacitavam) return;
    S.nacitavam = true; S.sprava = { typ: "info", text: "Sťahujem furmanky z tabuľky objednávok…" }; prekresli();
    var hotovo = function (st, chyba) {
      S.nacitavam = false;
      if (st) { S.stav = st; S.stav.nacitane = Date.now(); LS.set("lbz2_stav", S.stav); S.sprava = { typ: "ok", text: "Furmanky aktualizované" }; }
      else S.sprava = { typ: "chyba", text: chyba || "Furmanky sa nepodarilo obnoviť" };
      prekresli();
    };
    if (SUPA) {
      Promise.all([rpc("stav_skladu_appka"), furmankyZGas(true)]).then(function (v) {
        if (!v[1]) return hotovo(null, "Furmanky sa nepodarilo obnoviť – skúste o chvíľu");
        hotovo(v[0] && v[0].ok ? spojStav(v[0], v[1]) : null);
      }).catch(function () { hotovo(null, "Bez spojenia – skúste znova"); });
      return;
    }
    api({ akcia: "FURMANKY_OBNOV" }, 120000).then(function (res) {
      hotovo(res && res.ok ? res : null, res && res.chyba);
    }).catch(function () { hotovo(null, "Bez spojenia – skúste znova"); });
  }

  function nacitajKatalog() {
    if (SUPA) {
      if (!DB) return;
      DB.from("produkty").select("kod, nazov, farba").eq("aktivny", true).then(function (r) {
        if (r.error || !r.data) return;
        var k = {}; r.data.forEach(function (p) { k[p.kod] = { n: p.nazov, f: p.farba }; });
        S.katalog = k; LS.set("lbz2_katalog", k); prekresli();
      });
      return;
    }
    if (!API) return;
    api({ akcia: "KATALOG" }).then(function (res) {
      if (res && res.ok && res.katalog) { S.katalog = res.katalog; LS.set("lbz2_katalog", S.katalog); prekresli(); }
    }).catch(function () {});
  }

  // ---------- dnešné skeny zo všetkých zariadení ----------
  var AKCIA_REZIM = { prijem: "Príjem", krcmicka: "Krčmička", vydaj: "Výdaj" };
  var nacitavamDnesne = false;
  function nacitajDnesne() {
    if (!SUPA || !DB || nacitavamDnesne) return;
    nacitavamDnesne = true;
    rpc("dnesne_skeny", { p_limit: 300 }).then(function (rows) {
      nacitavamDnesne = false;
      S.vsetkySkeny = rows || [];
      if (S.pohlad === "skener") prekresli();
    }).catch(function () { nacitavamDnesne = false; });
  }
  // kým je otvorené Skenovanie, obnovujeme zoznam každých 20 s (skeny z iných zariadení)
  setInterval(function () {
    if (SUPA && DB && koren && S.pohlad === "skener" && document.visibilityState === "visible") nacitajDnesne();
  }, 20000);

  function zoznamDnes() {
    var mistne = S.skeny.filter(function (s) { return dnes(s.cas); });
    if (!SUPA || !S.vsetkySkeny) return mistne.slice().reverse();
    var vDb = {};
    var zDb = S.vsetkySkeny.map(function (h) {
      if (h.scan_id) vDb[h.scan_id] = true;
      return {
        scanId: h.scan_id, kod: h.balik_kod || "", kmen: h.produkt_kod || "", cas: new Date(h.cas).getTime(),
        rezim: AKCIA_REZIM[h.akcia] || "", akcia: h.akcia, stav: h.ok ? "ok" : "chyba", text: h.vysledok,
        kto: h.meno || "", zariadenie: h.zariadenie || "", moje: h.zariadenie === zariadenie
      };
    });
    // skeny z tohto zariadenia, ktoré ešte nie sú v databáze (čakajú na odoslanie)
    var cakajuce = mistne.filter(function (s) { return !vDb[s.scanId] && s.stav !== "ok"; });
    return cakajuce.concat(zDb).sort(function (a, b) { return b.cas - a.cas; });
  }

  // ---------- správa skladu (len IT a CEO) ----------
  // Apps Script niekedy vráti namiesto JSON úvodnú stránku – skúsime znova
  function apiOpakuj(data, pokusy) {
    return api(data, 120000).then(function (r) {
      if (r && r.ok) return r;
      throw r || {};
    }).catch(function (e) {
      if (pokusy > 1) return new Promise(function (ok) { setTimeout(ok, 1500); }).then(function () { return apiOpakuj(data, pokusy - 1); });
      throw e;
    });
  }

  function prenesZoStareho() {
    if (!spravca() || !API) return;
    if (!window.confirm("Preniesť aktuálny sklad zo starej tabuľky?\n\nVšetky balíky v appke sa nahradia stavom zo starého skladu (história ostane). Robí sa na začiatku testu a znova pri spustení ostrej verzie.")) return;
    S.upravaInfo = { typ: "info", text: "Sťahujem zo starého skladu… (môže trvať do minúty)" }; prekresli();
    Promise.all([apiOpakuj({ akcia: "KATALOG", cerstvy: true }, 3), apiOpakuj({ akcia: "BALIKY" }, 3)]).then(function (v) {
      var produkty = Object.keys(v[0].katalog || {}).map(function (k) { return { kod: k, nazov: v[0].katalog[k].n || k, farba: v[0].katalog[k].f || "#ffffff" }; });
      S.upravaInfo = { typ: "info", text: "Zapisujem " + produkty.length + " produktov a " + (v[1].baliky || []).length + " balíkov…" }; prekresli();
      return rpc("import_zo_stareho", { p_produkty: produkty, p_baliky: v[1].baliky || [] });
    }).then(function (res) {
      S.upravaInfo = res && res.ok
        ? { typ: "ok", text: "Prenesené: " + res.produkty + " produktov, " + res.baliky + " balíkov na sklade/v Krčmičke" + (res.vyradene ? ", " + res.vyradene + " starých balíkov označených ako vydané" : "") + "." }
        : { typ: "chyba", text: (res && res.text) || "Prenos sa nepodaril" };
      S.katalog = {}; nacitajKatalog(); nacitajStav(true); nacitajPohyby();
    }).catch(function (e) {
      S.upravaInfo = { typ: "chyba", text: "Prenos sa nepodaril: " + ((e && (e.chyba || e.message)) || "starý sklad neodpovedá, skúste znova") };
      prekresli();
    });
  }

  function hodnota(id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; }

  function najdiBalik() {
    var kod = upravKod(hodnota("s-u-kod")); if (!kod) return;
    DB.from("baliky").select("kod, produkt_kod, stav, prijaty, expiracia, vydany, objednavka").eq("kod", kod).maybeSingle().then(function (r) {
      if (r.error) { S.upravaInfo = { typ: "chyba", text: "Nepodarilo sa načítať" }; }
      else if (!r.data) { S.upravaInfo = { typ: "info", text: kod + " – v appke nie je (Uložiť ho pridá)" }; }
      else {
        var b = r.data, nazvy = { sklad: "na sklade", krcmicka: "v Krčmičke", vydany: "vydaný" };
        S.upravaInfo = { typ: "ok", text: kod + " (" + nazovProduktu(b.produkt_kod) + ") – " + nazvy[b.stav] +
          (b.expiracia ? " · expirácia " + new Date(b.expiracia).toLocaleDateString("sk-SK") : "") +
          (b.vydany ? " · vydaný " + new Date(b.vydany).toLocaleString("sk-SK") : "") + (b.objednavka ? " · obj. " + b.objednavka : "") };
        S.upravaForm = { kod: kod, stav: b.stav, exp: b.expiracia ? String(b.expiracia).slice(0, 10) : "" };
      }
      prekresli();
    });
  }

  function ulozBalik() {
    var kod = upravKod(hodnota("s-u-kod")), akcia = hodnota("s-u-stav"), exp = hodnota("s-u-exp"), pozn = hodnota("s-u-pozn");
    if (!kod) { S.upravaInfo = { typ: "chyba", text: "Zadajte kód balíka" }; prekresli(); return; }
    if (akcia === "zmazat" && !window.confirm("Naozaj zmazať balík " + kod + "? (V histórii ostane záznam.)")) return;
    rpc("uprav_balik", {
      p_kod: kod, p_stav: akcia === "zmazat" || !akcia ? null : akcia,
      p_expiracia: exp ? exp + "T12:00:00+02:00" : null, p_zmazat: akcia === "zmazat", p_poznamka: pozn || null
    }).then(function (res) {
      S.upravaInfo = { typ: res && res.ok ? "ok" : "chyba", text: kod + " – " + ((res && res.text) || "chyba") };
      if (res && res.ok) { S.upravaForm = null; nacitajPohyby(); }
      prekresli();
    }).catch(function (e) { S.upravaInfo = { typ: "chyba", text: "Neuložené: " + ((e && e.message) || "bez spojenia") }; prekresli(); });
  }

  var MENA = {};
  function nacitajPohyby() {
    if (!DB) return;
    Promise.all([
      DB.from("pohyby").select("balik_kod, produkt_kod, akcia, vysledok, ok, kto, poznamka, cas").order("cas", { ascending: false }).limit(40),
      DB.from("profily").select("id, meno")
    ]).then(function (v) {
      (v[1].data || []).forEach(function (p) { MENA[p.id] = p.meno; });
      S.pohyby = v[0].data || [];
      prekresli();
    });
  }

  function exportCsv() {
    var st = S.stav; if (!st || !st.skladItems) return;
    var riadky = [["Kód", "Produkt", "Hlavný sklad", "Krčmička"]].concat(st.skladItems.map(function (it) { return [it.kod, it.nazov, it.pocetHlavny, it.pocetKrcmicka]; }));
    var csv = "\ufeff" + riadky.map(function (r) { return r.map(function (b) { return '"' + String(b == null ? "" : b).replace(/"/g, '""') + '"'; }).join(";"); }).join("\r\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "stav-skladu-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- kamera ----------
  // Tlačidlá kamery sú pripnuté dole (na dosah palca). Po každom načítanom kóde sa kamera sama vypne.
  var kameraStav = "vyp"; // vyp | spusta | bezi
  function zapniKameru(smer) {
    if (kameraStav !== "vyp") return;
    kameraStav = "spusta"; prekresliTlacidloKamery();
    var spusti = function () {
      var el = document.getElementById("s-kamera");
      if (!el) { kameraStav = "vyp"; prekresliTlacidloKamery(); return; }
      el.hidden = false;
      var formaty = window.Html5QrcodeSupportedFormats ? { formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE] } : undefined;
      var q = new window.Html5Qrcode("s-kamera", formaty);
      S.kamera = q;
      var strana = Math.min(280, Math.max(180, (el.clientWidth || 300) - 40));
      var nastav = { fps: 15, qrbox: { width: strana, height: strana }, aspectRatio: 1.0 };
      var hotovo = function () { kameraStav = "bezi"; prekresliTlacidloKamery(); try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {} };
      var zlyhalo = function () {
        S.kamera = null; kameraStav = "vyp"; el.hidden = true;
        S.sprava = { typ: "chyba", text: "Kameru sa nepodarilo zapnúť (povoľte prístup ku kamere)." }; prekresli();
      };
      var ciel = smer === "user" ? { facingMode: "user" } : { facingMode: { exact: "environment" } };
      q.start(ciel, nastav, function (text) { spracujSken(text); }, function () {})
        .then(hotovo)
        .catch(function () { q.start({ facingMode: smer || "environment" }, nastav, function (text) { spracujSken(text); }, function () {}).then(hotovo).catch(zlyhalo); });
    };
    if (window.Html5Qrcode) return spusti();
    var sc = document.createElement("script");
    sc.src = "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js";
    sc.onload = spusti;
    sc.onerror = function () { kameraStav = "vyp"; S.sprava = { typ: "chyba", text: "Knižnica kamery sa nenačítala (bez signálu?)" }; prekresli(); };
    document.head.appendChild(sc);
  }
  function vypniKameru() {
    var q = S.kamera; S.kamera = null;
    var skry = function () { kameraStav = "vyp"; var el = document.getElementById("s-kamera"); if (el) { el.hidden = true; el.innerHTML = ""; } prekresliTlacidloKamery(); };
    if (q) { try { q.stop().then(skry, skry); } catch (e) { skry(); } } else skry();
  }
  function listaKamery() {
    if (kameraStav === "vyp") {
      // predná vľavo, zadná (hlavná) vpravo – pod palcom pravej ruky
      return '<button class="s-kam s-kam-predna" data-s-akcia="kamera-predna" aria-label="Predná kamera">🤳 Predná</button>' +
        '<button class="s-kam s-kam-zadna" data-s-akcia="kamera-zadna">📸 Skenovať kamerou</button>';
    }
    return '<button class="s-kam s-kam-stop" data-s-akcia="kamera-stop">' + (kameraStav === "spusta" ? "⏳ Spúšťam kameru…" : "🛑 Vypnúť kameru") + "</button>";
  }
  function prekresliTlacidloKamery() {
    var b = document.getElementById("s-kam-lista"); if (b) b.innerHTML = listaKamery();
  }

  // čítačka cez Bluetooth píše ako klávesnica – zachytíme rýchle písanie + Enter
  var buffer = "", bufferCas = 0;
  document.addEventListener("keydown", function (e) {
    if (!koren || !document.getElementById("s-skener")) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    var teraz = Date.now();
    if (teraz - bufferCas > 120) buffer = "";
    bufferCas = teraz;
    if (e.key === "Enter") { if (buffer.length >= 3) { e.preventDefault(); spracujSken(buffer); } buffer = ""; return; }
    if (e.key && e.key.length === 1) buffer += e.key;
  });

  window.addEventListener("online", function () { S.siet = "ok"; posliFrontu(); prekresli(); });
  window.addEventListener("offline", function () { S.siet = "offline"; prekresli(); });

  // ---------- kreslenie ----------
  function prekresli() {
    if (!koren || !document.body.contains(koren)) { koren = null; return; }
    var kameraBezi = kameraStav !== "vyp";
    var html = hlavickaModulu() + (S.pohlad === "skener" ? pohladSkener() : S.pohlad === "stav" ? pohladStav() : S.pohlad === "sprava" ? pohladSprava() : S.pohlad === "furmanka" ? pohladFurmanka() : pohladFurmanky());
    if (kameraBezi && S.pohlad === "skener") {
      // kameru neprekresľujeme, aby sa nevypla – obnovíme len zvyšok
      var zvysok = koren.querySelector("[data-s-obnov]");
      if (zvysok) {
        zvysok.innerHTML = castSkenera(); prepojVstup(); obnovHlavicku();
        Array.prototype.forEach.call(koren.querySelectorAll("[data-s-rezim]"), function (b) { b.setAttribute("aria-pressed", b.dataset.sRezim === S.rezim); });
        return;
      }
    }
    if (kameraBezi && S.pohlad !== "skener") vypniKameru();
    koren.innerHTML = html;
    prepojVstup();
    var h = koren.querySelector("#s-hladat");
    if (h && S._fokusHladat) { h.focus(); h.setSelectionRange(h.value.length, h.value.length); }
    if (S.pohlad === "stav") filtrujRiadky();
  }

  function obnovHlavicku() {
    var el = koren.querySelector(".s-siet"); if (el) el.outerHTML = indikatorSiete();
  }

  function indikatorSiete() {
    var caka = S.skeny.filter(function (s) { return s.stav === "caka"; }).length;
    var t, cls;
    if (S.siet === "offline") { t = "Bez signálu" + (caka ? " · čaká " + caka : ""); cls = "warn"; }
    else if (S.siet === "chyba") { t = "Spojenie zlyhalo · skúšam znova" + (caka ? " · " + caka : ""); cls = "warn"; }
    else if (caka) { t = "Odosiela sa " + caka; cls = "info"; }
    else { t = "Všetko zapísané"; cls = "ok"; }
    return '<span class="s-siet pill ' + cls + '">' + esc(t) + "</span>";
  }

  function hlavickaModulu() {
    var sklad = S.pohlad === "skener" || S.pohlad === "stav" || S.pohlad === "sprava";
    var taby = sklad
      ? '<div class="s-taby" role="tablist"><button data-s-pohlad="skener" aria-selected="' + (S.pohlad === "skener") + '">Skenovanie</button>' +
        '<button data-s-pohlad="stav" aria-selected="' + (S.pohlad === "stav") + '">Stav skladu</button>' +
        (SUPA && spravca() ? '<button data-s-pohlad="sprava" aria-selected="' + (S.pohlad === "sprava") + '">Správa</button>' : "") + "</div>"
      : "";
    var test = SUPA && sklad ? '<p class="s-test">🧪 Testovací sklad appky – skeny sa nezapisujú do starej tabuľky. Ostrá práca zatiaľ v <a href="' + STARY_SKENER + '" target="_blank" rel="noopener">starom skeneri</a>.</p>' : "";
    return '<div class="head"><div><div class="label">' + (sklad ? "Sklad" : "Furmanky") + "</div><h2>" +
      (S.pohlad === "skener" ? "Skenovanie" : S.pohlad === "stav" ? "Stav skladu" : S.pohlad === "sprava" ? "Správa skladu" : S.pohlad === "furmanka" ? esc(S.furmanka) : "Furmanky") +
      "</h2></div>" + indikatorSiete() + "</div>" + test + taby;
  }

  function pohladSkener() {
    return '<div id="s-skener">' +
      '<div class="s-rezimy">' + ["Príjem", "Krčmička", "Výdaj"].map(function (r) {
        return '<button class="s-rezim s-' + (r === "Príjem" ? "prijem" : r === "Výdaj" ? "vydaj" : "krcmicka") + '" data-s-rezim="' + r + '" aria-pressed="' + (S.rezim === r) + '">' +
          '<span class="s-ikona">' + ikonaRezimu(r) + "</span>" + r + "</button>";
      }).join("") + "</div>" +
      '<div id="s-kamera" hidden></div>' +
      '<div data-s-obnov>' + castSkenera() + "</div>" +
      '<div class="s-kam-miesto" aria-hidden="true"></div>' +
      '<div id="s-kam-lista" class="s-kam-lista">' + listaKamery() + "</div></div>";
  }

  function castSkenera() {
    var sp = S.sprava;
    var panel = sp
      ? '<div class="s-sprava s-' + sp.typ + '" role="status">' + esc(sp.text) + (sp.kod ? '<span class="s-kod">' + esc(sp.kod) + "</span>" : "") + "</div>"
      : '<div class="s-sprava s-info" role="status"><span>Režim <strong>' + esc(S.rezim) + "</strong> – skenujte čítačkou alebo kamerou</span></div>";
    var dnesne = zoznamDnes();
    var ok = dnesne.filter(function (s) { return s.stav === "ok"; }).length;
    var vsetky = SUPA && S.vsetkySkeny;
    return panel +
      '<div class="s-ovladanie">' +
        '<form class="s-rucne" data-s-form="rucne"><input id="s-rucny" autocomplete="off" autocapitalize="characters" placeholder="Kód ručne, napr. P00017-2-15" aria-label="Kód balíka ručne">' +
        '<button class="btn btn-primary" type="submit">Zapísať</button></form>' +
      "</div>" +
      '<section class="card"><h3>' + (vsetky ? "Dnešné skeny – všetky zariadenia" : "Dnešné skeny v tomto zariadení") + ' <span class="pill ok num">' + ok + " zapísaných</span></h3>" +
        (dnesne.length ? '<div class="s-zoznam">' + dnesne.slice(0, 80).map(riadokSkenu).join("") + "</div>" : '<p class="muted" style="margin:0">Zatiaľ nič.</p>') +
        (dnesne.some(function (s) { return s.stav === "chyba" && !s.akcia; }) ? '<button class="btn" data-s-akcia="zmaz-chyby" style="margin-top:10px">Skryť nezapísané</button>' : "") +
      "</section>";
  }

  function riadokSkenu(s) {
    var farba = (S.katalog[s.kmen] && S.katalog[s.kmen].f) || "#ffffff";
    var stavT = s.stav === "caka" ? "⏳ odosiela sa" : s.stav === "ok" ? "✅ " + (s.text || "zapísané") : "❌ " + (s.text || "chyba");
    var pocet = s.pocet ? ' · sklad <span class="num">' + s.pocet.hlavny + "</span> · 🏪 <span class=\"num\">" + s.pocet.krcmicka + "</span>" : "";
    var ikona = s.rezim ? ikonaRezimu(s.rezim) : (NAZVY_AKCII[s.akcia] || "").split(" ")[0];
    var kto = s.akcia ? " · " + (s.moje ? "toto zariadenie" : (s.kto || "") + (s.zariadenie ? " (" + s.zariadenie + ")" : "")) : "";
    return '<div class="s-riadok s-' + s.stav + '" style="--pf:' + esc(farba) + '">' +
      '<span class="s-cas num">' + cas(s.cas) + "</span>" +
      '<span class="s-telo"><strong>' + ikona + " " + esc(nazovProduktu(s.kmen)) + "</strong>" +
      '<span class="muted">' + esc(s.kod) + pocet + esc(kto) + "</span></span>" +
      '<span class="s-stav">' + esc(stavT) + "</span></div>";
  }

  function prepojVstup() {
    var f = koren && koren.querySelector('[data-s-form="rucne"]');
    if (f && !f._prepojene) {
      f._prepojene = true;
      f.addEventListener("submit", function (e) { e.preventDefault(); var i = document.getElementById("s-rucny"); spracujSken(i.value); i.value = ""; i.blur(); });
    }
    var u = koren && koren.querySelector('[data-s-form="uprava"]');
    if (u && !u._prepojene) {
      u._prepojene = true;
      u.addEventListener("submit", function (e) { e.preventDefault(); ulozBalik(); });
    }
    var h = koren && koren.querySelector("#s-hladat");
    if (h && !h._prepojene) {
      h._prepojene = true;
      h.addEventListener("input", function () { S.hladat = h.value; S._fokusHladat = true; filtrujRiadky(); });
    }
  }

  // ----- stav skladu -----
  var FILTRE = [["vsetko", "Všetko"], ["5", "5 ks"], ["10", "10 ks"], ["15", "15 ks"], ["30", "30 ks"], ["mix", "Mixy"], ["exp", "Expirácie"]];
  function kategoria(nazov) {
    var n = String(nazov || "").toLowerCase();
    if (n.indexOf("mix") > -1) return "mix";
    if (/\b5\s*ks\b/.test(n)) return "5";
    if (/\b10\s*ks\b/.test(n)) return "10";
    if (/\b15\s*ks\b/.test(n)) return "15";
    if (/\b30\s*ks\b/.test(n)) return "30";
    return "ine";
  }
  function bezDiakritiky(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }

  function pohladStav() {
    var st = S.stav;
    var info = st ? '<span class="muted">Údaje z ' + esc(st.nacitane ? cas(st.nacitane) : st.cas || "") + (S.nacitavam ? " · obnovujem…" : "") + "</span>" : "";
    if (!st || !st.skladItems) {
      return '<div class="empty"><strong>' + (S.nacitavam ? "Načítavam stav skladu…" : "Stav skladu ešte nie je načítaný") + "</strong>" +
        (S.nacitavam ? "" : '<button class="btn btn-primary" data-s-akcia="obnov-stav">Načítať</button>') + "</div>";
    }
    var sucty = {};
    st.skladItems.forEach(function (it) {
      var k = kategoria(it.nazov); sucty[k] = sucty[k] || [0, 0];
      sucty[k][0] += parseInt(it.pocetHlavny, 10) || 0; sucty[k][1] += parseInt(it.pocetKrcmicka, 10) || 0;
    });
    var dlazdice = [["5", "5 ks"], ["10", "10 ks"], ["15", "15 ks"], ["30", "30 ks"], ["mix", "Mixy"]].map(function (k) {
      var s = sucty[k[0]] || [0, 0];
      return '<div class="s-dlazdica"><span class="label">' + k[1] + '</span><strong class="num">' + s[0] + '</strong><span class="muted num">🏪 ' + s[1] + "</span></div>";
    }).join("");
    return '<div class="s-lista">' + info +
        '<span class="s-lista-tl"><button class="btn" data-s-akcia="obnov-stav"' + (S.nacitavam ? " disabled" : "") + '>Obnoviť</button>' +
        '<button class="btn" data-s-akcia="tlac-stav">🖨️ Tlačiť</button>' +
        (SUPA ? '<button class="btn" data-s-akcia="export-csv" title="Súbor sa otvorí v Tabuľkách Google aj v Exceli">⬇️ Do tabuľky</button>' : "") + '</span></div>' +
      '<div class="s-dlazdice">' + dlazdice + "</div>" +
      '<div class="s-filtre">' + FILTRE.map(function (f) {
        return '<button class="chip" data-s-filter="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '">' + f[1] + "</button>";
      }).join("") + "</div>" +
      '<input id="s-hladat" class="s-hladat" type="search" placeholder="Hľadať produkt…" value="' + esc(S.hladat) + '" aria-label="Hľadať produkt">' +
      '<div class="s-tabulka" id="s-tabulka"><div class="s-thead"><span>Produkt</span><span>Sklad</span><span>🏪</span></div>' +
        st.skladItems.map(riadokProduktu).join("") + "</div>";
  }

  function riadokProduktu(it) {
    var exp = it.expiracie || [];
    return '<div class="s-produkt" data-kat="' + kategoria(it.nazov) + '" data-exp="' + (exp.length ? 1 : 0) + '" data-hladaj="' + esc(bezDiakritiky(it.nazov + " " + it.kod)) + '" style="--pf:' + esc(it.farba || "#ffffff") + '">' +
      '<div class="s-prow"><span><strong>' + esc(it.nazov) + '</strong><span class="muted s-mono">' + esc(it.kod) + "</span></span>" +
      '<span class="num s-velke">' + esc(it.pocetHlavny) + '</span><span class="num s-velke">' + esc(it.pocetKrcmicka) + "</span></div>" +
      exp.map(function (e) {
        return '<div class="s-exp' + (e.farba === "#fce8e6" ? " s-exp-zle" : "") + '"><span class="s-mono">↳ ' + esc(e.unikatnyKod) + "</span><span>" + esc(e.datum) + "</span></div>";
      }).join("") + "</div>";
  }

  function filtrujRiadky() {
    var q = bezDiakritiky(S.hladat).trim();
    var rows = koren ? koren.querySelectorAll(".s-produkt") : [];
    Array.prototype.forEach.call(rows, function (r) {
      var ok = (!q || r.getAttribute("data-hladaj").indexOf(q) > -1) &&
        (S.filter === "vsetko" || (S.filter === "exp" ? r.getAttribute("data-exp") === "1" : r.getAttribute("data-kat") === S.filter));
      r.hidden = !ok;
    });
  }

  // ----- správa skladu (IT a CEO) -----
  var NAZVY_AKCII = { prijem: "📥 Príjem", krcmicka: "🏪 Krčmička", vydaj: "📤 Výdaj", rucny_vydaj: "✋ Ručný výdaj", uprava: "✏️ Úprava", zmazanie: "🗑️ Zmazanie", "import": "⤵️ Prenos zo starého skladu" };
  function pohladSprava() {
    if (!spravca()) return '<div class="empty"><strong>Len pre IT a CEO</strong></div>';
    var f = S.upravaForm || {};
    var info = S.upravaInfo ? '<div class="s-sprava s-' + S.upravaInfo.typ + '" role="status">' + esc(S.upravaInfo.text) + "</div>" : "";
    var moznosti = [["", "— stav nemeniť —"], ["sklad", "📦 Na sklade"], ["krcmicka", "🏪 V Krčmičke"], ["vydany", "📤 Vydať ručne"], ["zmazat", "🗑️ Zmazať balík"]];
    return info +
      '<form class="card s-uprava" data-s-form="uprava"><h3>Ručná úprava balíka</h3>' +
        '<label class="field"><span class="label">Kód balíka</span><span class="s-riadok-form"><input id="s-u-kod" autocomplete="off" autocapitalize="characters" placeholder="napr. P00017-2-15" value="' + esc(f.kod || "") + '">' +
        '<button class="btn" type="button" data-s-akcia="najdi-balik">Zobraziť</button></span></label>' +
        '<label class="field"><span class="label">Nový stav</span><select id="s-u-stav">' + moznosti.map(function (m) {
          return '<option value="' + m[0] + '"' + (f.stav === m[0] ? " selected" : "") + ">" + m[1] + "</option>";
        }).join("") + "</select></label>" +
        '<label class="field"><span class="label">Expirácia (nepovinné)</span><input id="s-u-exp" type="date" value="' + esc(f.exp || "") + '"></label>' +
        '<label class="field"><span class="label">Poznámka (prečo)</span><input id="s-u-pozn" autocomplete="off" placeholder="napr. rozbitý, inventúra, predaj na mieste"></label>' +
        '<button class="btn btn-primary" type="submit">Uložiť</button>' +
        '<p class="muted s-pozn">Každá úprava sa zapíše do histórie (kto, kedy, prečo).</p></form>' +
      '<section class="card"><h3>Prenos zo starého skladu</h3>' +
        '<p class="muted" style="margin:0 0 10px">Nahradí balíky v appke aktuálnym stavom zo starej tabuľky (Sklad) a doplní Zoznam produktov. Použite teraz na test a znova v deň spustenia ostrej verzie.</p>' +
        '<button class="btn" data-s-akcia="prenos"' + (API ? "" : " disabled") + '>⤵️ Preniesť zo starého skladu</button></section>' +
      '<section class="card"><h3>Posledné pohyby <button class="btn s-mini" data-s-akcia="obnov-pohyby">Obnoviť</button></h3>' +
        (S.pohyby === null ? '<p class="muted" style="margin:0">Načítavam…</p>' : !S.pohyby.length ? '<p class="muted" style="margin:0">Zatiaľ žiadne.</p>' :
          '<div class="s-zoznam">' + S.pohyby.map(function (p) {
            return '<div class="s-riadok s-' + (p.ok ? "ok" : "chyba") + '" style="--pf:' + esc((S.katalog[p.produkt_kod] && S.katalog[p.produkt_kod].f) || "#ffffff") + '">' +
              '<span class="s-cas num">' + esc(new Date(p.cas).toLocaleString("sk-SK", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })) + "</span>" +
              '<span class="s-telo"><strong>' + esc(NAZVY_AKCII[p.akcia] || p.akcia) + " " + esc(p.balik_kod || "") + "</strong>" +
              '<span class="muted">' + esc((MENA[p.kto] || "") + (p.poznamka ? " · " + p.poznamka : "")) + "</span></span>" +
              '<span class="s-stav">' + esc(p.vysledok || "") + "</span></div>";
          }).join("") + "</div>") + "</section>";
  }

  // ----- furmanky -----
  function pohladFurmanky() {
    var st = S.stav;
    var info = '<span class="muted">' + (st && st.furmankyCas ? "Z objednávok o " + esc(st.furmankyCas) : "Obnovujú sa samé každých 15 min.") + (S.nacitavam ? " · načítavam…" : "") + "</span>";
    var lista = '<div class="s-lista">' + info + '<span class="s-lista-tl"><button class="btn" data-s-akcia="obnov-furmanky"' + (S.nacitavam ? " disabled" : "") + ">Obnoviť z objednávok</button></span></div>";
    if (!st || !st.rozvozy) {
      return lista + '<div class="empty"><strong>' + (S.nacitavam ? "Načítavam furmanky…" : "Furmanky ešte nie sú načítané") + "</strong></div>";
    }
    if (!st.rozvozy.length) return lista + '<div class="empty"><strong>Žiadne aktívne rozvozy</strong></div>';
    return lista + '<div class="s-furmanky">' + st.rozvozy.map(function (r) {
      var pol = (st.rozvozyData && st.rozvozyData[r]) || [];
      var chyba = pol.filter(function (p) { return String(p.stav).trim().charAt(0) === "-"; }).length;
      var ks = pol.reduce(function (a, p) { var m = String(p.stav).match(/\((\d+)\)/); return a + (m ? parseInt(m[1], 10) : 0); }, 0);
      return '<button class="card s-furmanka" data-s-furmanka="' + esc(r) + '"><strong>' + esc(r) + "</strong>" +
        '<span class="muted"><span class="num">' + pol.length + "</span> produktov · <span class=\"num\">" + ks + "</span> ks</span>" +
        (chyba ? '<span class="pill warn">chýba ' + chyba + "</span>" : '<span class="pill ok">sklad pokryje</span>') + "</button>";
    }).join("") + "</div>" +
    '<p class="muted s-pozn">Balenie objednávok a štítky zatiaľ v <a href="' + STARY_SKENER + '" target="_blank" rel="noopener">starej appke</a>.</p>';
  }

  function pohladFurmanka() {
    var pol = (S.stav && S.stav.rozvozyData && S.stav.rozvozyData[S.furmanka]) || [];
    return '<div class="s-lista"><button class="btn" data-s-akcia="spat">← Furmanky</button>' +
      '<span class="s-lista-tl"><button class="btn btn-primary" data-s-akcia="tlac-furmanka">🖨️ Tlačiť</button></span></div>' +
      '<div class="s-tabulka"><div class="s-thead s-4"><span>Produkt</span><span>Sklad</span><span>🏪</span><span>Rozvoz</span></div>' +
      (pol.length ? pol.map(function (p) {
        var zle = String(p.stav).trim().charAt(0) === "-";
        return '<div class="s-produkt" style="--pf:' + esc(p.farba || "#ffffff") + '"><div class="s-prow s-4"><span><strong>' + esc(p.nazov) + '</strong><span class="muted s-mono">' + esc(p.kod) + "</span></span>" +
          '<span class="num s-velke">' + esc(p.pocetHlavny) + '</span><span class="num s-velke">' + esc(p.pocetKrcmicka) + "</span>" +
          '<span class="num s-velke' + (zle ? " s-zle" : "") + '">' + esc(p.stav) + "</span></div></div>";
      }).join("") : '<div class="s-prow"><span class="muted">Tento rozvoz je prázdny.</span></div>') + "</div>" +
      '<p class="muted s-pozn">Rozvoz: <strong>zostatok (objednané)</strong>. Záporné číslo = toľko balíkov treba dorobiť.</p>';
  }

  // ---------- tlač (A4 na obyčajný papier) ----------
  function tlac(nadpis, hlavicky, riadky) {
    var d = new Date();
    var html = '<h1>' + esc(nadpis) + '</h1><p class="t-datum">Legendárne buchty · ' + d.toLocaleDateString("sk-SK") + " " + cas(d) + "</p>" +
      "<table><thead><tr>" + hlavicky.map(function (h, i) { return "<th" + (i ? ' class="t-c"' : "") + ">" + esc(h) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      riadky.map(function (r) {
        return '<tr style="background:' + esc(r.farba || "#fff") + '">' + r.bunky.map(function (b, i) {
          return "<td" + (i ? ' class="t-c' + (String(b).trim().charAt(0) === "-" ? " t-zle" : "") + '"' : "") + ">" + esc(b) + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody></table>";
    var obal = document.getElementById("tlac-oblast");
    if (!obal) { obal = document.createElement("div"); obal.id = "tlac-oblast"; document.body.appendChild(obal); }
    obal.innerHTML = html;
    document.body.classList.add("tlaci");
    var hotovo = function () { document.body.classList.remove("tlaci"); obal.innerHTML = ""; window.removeEventListener("afterprint", hotovo); };
    window.addEventListener("afterprint", hotovo);
    setTimeout(function () { window.print(); setTimeout(hotovo, 1000); }, 50);
  }

  function tlacStav() {
    var rows = koren.querySelectorAll(".s-produkt");
    var viditelne = {};
    Array.prototype.forEach.call(rows, function (r, i) { if (!r.hidden) viditelne[i] = true; });
    var polozky = (S.stav.skladItems || []).filter(function (it, i) { return viditelne[i]; });
    tlac("Stav skladu", ["Produkt", "Hlavný sklad", "Krčmička"], polozky.map(function (it) {
      return { farba: it.farba, bunky: [it.nazov, it.pocetHlavny, it.pocetKrcmicka] };
    }));
  }

  function tlacFurmanka() {
    var pol = (S.stav.rozvozyData && S.stav.rozvozyData[S.furmanka]) || [];
    tlac("Rozvoz " + S.furmanka, ["Produkt", "Sklad", "Krčmička", S.furmanka], pol.map(function (p) {
      return { farba: p.farba, bunky: [p.nazov, p.pocetHlavny, p.pocetKrcmicka, p.stav] };
    }));
  }

  // ---------- udalosti v module ----------
  function klik(e) {
    var t = e.target.closest("button"); if (!t || !koren.contains(t)) return;
    var d = t.dataset;
    if (d.sRezim) { t.blur(); nastavRezim(d.sRezim); return; }
    if (d.sPohlad) {
      S.pohlad = d.sPohlad; S.sprava = null; prekresli();
      if (S.pohlad === "stav") nacitajStav(false);
      if (S.pohlad === "sprava") nacitajPohyby();
      if (S.pohlad === "skener") nacitajDnesne();
      return;
    }
    if (d.sFilter) { S.filter = d.sFilter; Array.prototype.forEach.call(koren.querySelectorAll("[data-s-filter]"), function (b) { b.setAttribute("aria-pressed", b.dataset.sFilter === S.filter); }); filtrujRiadky(); return; }
    if (d.sFurmanka) { S.furmanka = d.sFurmanka; S.pohlad = "furmanka"; prekresli(); window.scrollTo(0, 0); return; }
    switch (d.sAkcia) {
      case "kamera-zadna": zapniKameru("environment"); break;
      case "kamera-predna": zapniKameru("user"); break;
      case "kamera-stop": vypniKameru(); break;
      case "obnov-stav": nacitajStav(true); break;
      case "obnov-furmanky": obnovFurmanky(); break;
      case "tlac-stav": tlacStav(); break;
      case "tlac-furmanka": tlacFurmanka(); break;
      case "spat": S.pohlad = "furmanky"; prekresli(); break;
      case "export-csv": exportCsv(); break;
      case "prenos": prenesZoStareho(); break;
      case "najdi-balik": najdiBalik(); break;
      case "obnov-pohyby": nacitajPohyby(); break;
      case "zmaz-chyby": S.skeny = S.skeny.filter(function (s) { return s.stav !== "chyba"; }); ulozSkeny(); S.sprava = null; prekresli(); break;
    }
  }

  // ---------- verejné rozhranie pre app.js ----------
  window.LBZ_SKLAD = {
    zapnute: function () { return backend(); },
    // app.js po prihlásení/odhlásení: klient Supabase (len interní zamestnanci) a rola
    nastavDb: function (klient, rola) {
      var novy = klient && klient !== DB;
      DB = klient || null; ROLA = klient ? rola : null;
      if (!DB) { S.pohyby = null; S.upravaInfo = null; S.vsetkySkeny = null; if (S.pohlad === "sprava") S.pohlad = "skener"; return; }
      if (novy) { nacitajKatalog(); setTimeout(posliFrontu, 300); nacitajDnesne(); }
    },
    // modul: "sklad" alebo "furmanky"
    mount: function (el, modul) {
      if (S.kamera) vypniKameru();
      koren = el;
      S._fokusHladat = false;
      if (modul === "furmanky") { if (S.pohlad !== "furmanka") S.pohlad = "furmanky"; }
      else if (S.pohlad !== "stav" && !(S.pohlad === "sprava" && spravca())) S.pohlad = "skener";
      el.addEventListener("click", klik);
      prekresli();
      if (modul === "furmanky" || S.pohlad === "stav") nacitajStav(false);
      if (!Object.keys(S.katalog).length) nacitajKatalog();
      if (S.pohlad === "sprava") nacitajPohyby();
      if (S.pohlad === "skener") nacitajDnesne();
      posliFrontu();
    },
    // malé karty na úvodnú obrazovku
    kartaSklad: function () {
      var caka = S.skeny.filter(function (s) { return s.stav === "caka"; }).length;
      var ok = S.skeny.filter(function (s) { return s.stav === "ok" && dnes(s.cas); }).length;
      return '<section class="card"><h3>Sklad ' + (caka ? '<span class="pill warn">čaká ' + caka + "</span>" : '<span class="pill ok">zapísané</span>') + "</h3>" +
        '<div class="big num">' + ok + '</div><div class="muted">dnešných skenov v tomto zariadení</div>' +
        '<button class="btn btn-primary" data-mod="sklad">Otvoriť sklad</button></section>';
    },
    kartaFurmanky: function () {
      var st = S.stav;
      var n = st && st.rozvozy ? st.rozvozy.length : 0;
      return '<section class="card"><h3>Furmanky <span class="pill ok num">' + n + "</span></h3>" +
        (st && st.rozvozy ? '<div class="rows">' + st.rozvozy.slice(0, 5).map(function (r) {
          var pol = (st.rozvozyData && st.rozvozyData[r]) || [];
          var chyba = pol.filter(function (p) { return String(p.stav).trim().charAt(0) === "-"; }).length;
          return '<div class="row"><span>' + esc(r) + '</span><span class="pill ' + (chyba ? "warn" : "ok") + '">' + (chyba ? "chýba " + chyba : "OK") + "</span></div>";
        }).join("") + "</div>" : '<p class="muted" style="margin:0">Otvorte modul Furmanky.</p>') +
        '<button class="btn" data-mod="furmanky">Otvoriť furmanky</button></section>';
    }
  };

  // neodoslané skeny z minula pošleme hneď po otvorení appky
  if (API && !SUPA) setTimeout(posliFrontu, 500);
})();
