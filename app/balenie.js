// LBZ aplikácia – modul Balenie
// BALIŤ pri furmanke → sken štítku objednávky → sken balíkov (výdaj zo skladu s číslom objednávky = šarža)
// → položky mimo Zoznamu produktov sa potvrdia počtom → HOTOVO alebo ODLOŽIŤ s dôvodom (vidí zákaznícky servis vo Furmankách).
// Všetko je v databáze, takže baliť môžu naraz viaceré zariadenia. Štítky celej furmanky naraz (tlač z modulu Furmanky).

(function () {
  "use strict";

  var DB = null, ROLA = null, koren = null;
  var B = { pohlad: "zoznam", zoznam: null, fId: null, fData: null, cislo: null, obj: null, sprava: null, posledny: null, nacitavam: false, dialog: null, karta: null, prace: 0 };
  var MAPA_SK = { "+": "1", "ľ": "2", "š": "3", "č": "4", "ť": "5", "ž": "6", "ý": "7", "á": "8", "í": "9", "é": "0" };
  var STAV = {
    nezabalena: { t: "nezabalená", c: "" }, rozpracovana: { t: "rozpracovaná", c: "b-st-rozp" },
    zabalena: { t: "zabalená", c: "b-st-ok" }, odlozena: { t: "odložená", c: "b-st-odl" }
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function rpc(nazov, args) { return DB.rpc(nazov, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function chybaText(e) { return (e && (e.message || e.text)) || "Bez spojenia so serverom"; }
  function datumSk(s) { if (!s) return ""; var p = String(s).slice(0, 10).split("-"); return +p[2] + ". " + +p[1] + "."; }
  function suma(n) { return Number(n || 0).toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
  function textNa(farba) {
    var h = String(farba || "#ffffff").replace("#", ""); if (h.length === 3) h = h.replace(/./g, "$&$&");
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#1b120f" : "#ffffff";
  }
  function upravKod(t) {
    t = String(t || "").replace(/[´'’\/]/g, "-").trim();
    var v = ""; for (var i = 0; i < t.length; i++) { var z = t.charAt(i); v += MAPA_SK[z] !== undefined ? MAPA_SK[z] : z; }
    return v.toUpperCase();
  }
  function zariadenie() {
    try { var z = localStorage.getItem("lbz_zariadenie"); if (!z) { z = "Z" + Math.random().toString(36).slice(2, 8); localStorage.setItem("lbz_zariadenie", z); } return z; }
    catch (e) { return "Z-bez-uloziska"; }
  }
  function scanId() { return "bal-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
  var zvuk = null;
  function pip(ok) {
    try {
      zvuk = zvuk || new (window.AudioContext || window.webkitAudioContext)();
      var o = zvuk.createOscillator(), g = zvuk.createGain();
      o.frequency.value = ok ? 1200 : 300; g.gain.value = 0.08; o.connect(g); g.connect(zvuk.destination);
      o.start(); o.stop(zvuk.currentTime + (ok ? 0.08 : 0.35));
    } catch (e) {}
    try { if (!ok && navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) {}
  }

  // ---------- načítanie ----------
  function nacitajZoznam() {
    B.nacitavam = true; prekresli();
    return rpc("balenie_zoznam").then(function (d) {
      B.nacitavam = false;
      if (!d || d.ok === false) B.sprava = { typ: "chyba", text: (d && d.text) || "Nenačítané" }; else B.zoznam = d.furmanky || [];
      prekresli();
    }).catch(function (e) { B.nacitavam = false; B.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }
  function nacitajFurmanku(tiho) {
    if (B.fId == null) return Promise.resolve();
    if (!tiho) { B.nacitavam = true; prekresli(); }
    return rpc("balenie_furmanka", { p_id: B.fId }).then(function (d) {
      B.nacitavam = false;
      if (!d || d.ok === false) B.sprava = { typ: "chyba", text: (d && d.text) || "Nenačítané" };
      else {
        B.fData = d;
        if (B.cislo) { var o = objVoFurmanke(B.cislo); if (o) B.obj = o; }
      }
      prekresli();
    }).catch(function (e) { B.nacitavam = false; if (!tiho) B.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }
  function objVoFurmanke(cislo) {
    return ((B.fData && B.fData.objednavky) || []).filter(function (o) { return String(o.cislo).toUpperCase() === String(cislo).toUpperCase(); })[0] || null;
  }
  function otvorObjednavku(cislo) {
    var o = objVoFurmanke(cislo);
    B.sprava = null; B.posledny = null; B.dialog = null;
    if (o) { B.cislo = o.cislo; B.obj = o; B.pohlad = "objednavka"; prekresli(); obal(); return; }
    rpc("balenie_objednavka", { p_cislo: cislo }).then(function (d) {
      if (!d || d.ok === false) { pip(false); B.sprava = { typ: "chyba", text: (d && d.text) || "Objednávka sa nenašla" }; prekresli(); return; }
      B.cislo = d.objednavka.cislo; B.obj = d.objednavka; B.pohlad = "objednavka";
      if (B.fData && d.objednavka.furmanka_id !== (B.fData.furmanka || {}).id) {
        B.sprava = { typ: "chyba", text: "Pozor: objednávka je vo furmanke " + (d.furmanka || "– (nezaradená)") + ", nie v tejto." };
        pip(false);
      }
      prekresli(); obal();
    }).catch(function (e) { B.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }
  function obal() { var el = koren && koren.querySelector("#b-kod"); if (el && !jeDotyk()) el.focus(); }
  function jeDotyk() { return window.matchMedia && window.matchMedia("(pointer: coarse)").matches; }
  function nastavObj(o) {
    if (!o) return;
    B.obj = o;
    var list = (B.fData && B.fData.objednavky) || [];
    for (var i = 0; i < list.length; i++) if (list[i].cislo === o.cislo) list[i] = o;
  }

  // ---------- skenovanie ----------
  var poslednyKod = "", poslednyCas = 0;
  function spracuj(surovy) {
    var text = String(surovy || "").trim(); if (!text) return;
    var kod = upravKod(text);
    var teraz = Date.now();
    if (kod === poslednyKod && teraz - poslednyCas < 2500) return;   // dvojité načítanie toho istého
    poslednyKod = kod; poslednyCas = teraz;
    if (kod.indexOf("QQQ") > -1) { pip(true); otvorObjednavku(kod.split("QQQ")[0]); return; }   // štítok objednávky
    if (B.pohlad === "furmanka" || B.pohlad === "zoznam") {
      if (kod.indexOf("-") < 0 || objVoFurmanke(kod)) { otvorObjednavku(kod); return; }       // ručne napísané číslo objednávky
      pip(false); B.sprava = { typ: "chyba", text: "Najprv naskenujte štítok objednávky, potom balíky." }; prekresli(); return;
    }
    if (B.pohlad !== "objednavka" || !B.obj) return;
    if (kod.indexOf("-") < 0 && objVoFurmanke(kod)) { otvorObjednavku(kod); return; }
    skenBalika(kod);
  }
  function skenBalika(kod) {
    var cislo = B.obj.cislo;
    B.prace++; B.posledny = { typ: "caka", text: "Zapisujem " + kod + "…" }; prekresli();
    rpc("balenie_sken", { p_scan_id: scanId(), p_cislo: cislo, p_kod: kod, p_zariadenie: zariadenie() }).then(function (r) {
      B.prace--;
      var ok = r && r.ok;
      pip(!!ok);
      B.posledny = { typ: ok ? "ok" : "chyba", text: (r && r.kod ? r.kod + " – " : kod + " – ") + ((r && r.text) || "Nezapísané") };
      if (r && r.objednavka && B.cislo === cislo) nastavObj(r.objednavka);
      if (ok && B.obj && B.obj.kompletne) B.posledny.text += " · všetko je naskenované, dajte HOTOVO";
      prekresli();
    }).catch(function (e) { B.prace--; pip(false); B.posledny = { typ: "chyba", text: kod + " – " + chybaText(e) + " (skúste znova)" }; prekresli(); });
  }

  // kamera (html5-qrcode) – beží, kým ju nevypnete; rovnaký kód sa do 2,5 s neberie dvakrát
  var kamera = null, kameraStav = "vyp";
  function zapniKameru(smer) {
    if (kameraStav !== "vyp") return;
    kameraStav = "spusta"; prekresli();
    var spusti = function () {
      var el = document.getElementById("b-kamera");
      if (!el) { kameraStav = "vyp"; prekresli(); return; }
      el.hidden = false;
      var formaty = window.Html5QrcodeSupportedFormats ? { formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE] } : undefined;
      var q = new window.Html5Qrcode("b-kamera", formaty); kamera = q;
      var strana = Math.min(260, Math.max(180, (el.clientWidth || 300) - 40));
      var nastav = { fps: 15, qrbox: { width: strana, height: strana }, aspectRatio: 1.0 };
      var hotovo = function () { kameraStav = "bezi"; prekresli(); };
      var zlyhalo = function () { kamera = null; kameraStav = "vyp"; el.hidden = true; B.sprava = { typ: "chyba", text: "Kameru sa nepodarilo zapnúť (povoľte prístup ku kamere)." }; prekresli(); };
      var ciel = smer === "user" ? { facingMode: "user" } : { facingMode: { exact: "environment" } };
      q.start(ciel, nastav, spracuj, function () {}).then(hotovo)
        .catch(function () { q.start({ facingMode: smer || "environment" }, nastav, spracuj, function () {}).then(hotovo).catch(zlyhalo); });
    };
    if (window.Html5Qrcode) return spusti();
    var sc = document.createElement("script");
    sc.src = "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js";
    sc.onload = spusti;
    sc.onerror = function () { kameraStav = "vyp"; B.sprava = { typ: "chyba", text: "Knižnica kamery sa nenačítala (bez signálu?)" }; prekresli(); };
    document.head.appendChild(sc);
  }
  function vypniKameru() {
    var q = kamera; kamera = null;
    var skry = function () { kameraStav = "vyp"; var el = document.getElementById("b-kamera"); if (el) { el.hidden = true; el.innerHTML = ""; } prekresli(); };
    if (q) { try { q.stop().then(skry, skry); } catch (e) { skry(); } } else if (kameraStav !== "vyp") skry();
  }

  // čítačka cez Bluetooth píše ako klávesnica – zachytíme rýchle písanie + Enter (mimo políčok)
  var buffer = "", bufferCas = 0;
  document.addEventListener("keydown", function (e) {
    if (!koren || !koren.isConnected || B.pohlad === "zoznam" || B.dialog) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    var teraz = Date.now();
    if (teraz - bufferCas > 120) buffer = "";
    bufferCas = teraz;
    if (e.key === "Enter") { if (buffer.length >= 3) { e.preventDefault(); spracuj(buffer); } buffer = ""; return; }
    if (e.key && e.key.length === 1) buffer += e.key;
  });

  // dve zariadenia naraz: každých 15 s obnovíme (len keď appka svieti a nič sa nezapisuje)
  setInterval(function () {
    if (!DB || !koren || !koren.isConnected || document.hidden || B.prace || B.dialog) return;
    if (B.pohlad === "furmanka" || B.pohlad === "objednavka") nacitajFurmanku(true);
    else if (B.pohlad === "zoznam") rpc("balenie_zoznam").then(function (d) { if (d && d.ok) { B.zoznam = d.furmanky || []; prekresli(); } }).catch(function () {});
  }, 15000);

  // ---------- kreslenie ----------
  function spravaHtml() {
    if (!B.sprava) return "";
    return '<p class="f-sprava f-' + (B.sprava.typ === "ok" ? "ok" : "chyba") + '" role="status">' + esc(B.sprava.text) + ' <button class="btn-link" data-b="zavri-spravu" aria-label="Zavrieť">✕</button></p>';
  }
  function stavPill(stav, dovod) {
    var s = STAV[stav] || STAV.nezabalena;
    return '<span class="b-st ' + s.c + '"' + (dovod ? ' title="' + esc(dovod) + '"' : "") + ">" + s.t + "</span>";
  }
  function skenBox(popis) {
    var kam = kameraStav === "vyp"
      ? '<button class="btn" type="button" data-b="kamera" data-smer="environment">📸 Kamera</button><button class="btn btn-ikona" type="button" data-b="kamera" data-smer="user" aria-label="Predná kamera">🤳</button>'
      : '<button class="btn" type="button" data-b="kamera-stop">' + (kameraStav === "spusta" ? "⏳ Spúšťam…" : "🛑 Vypnúť kameru") + "</button>";
    return '<form class="b-sken" id="b-sken-form"><label class="field"><span class="label">' + esc(popis) + '</span>' +
      '<input id="b-kod" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="čítačka alebo ručne"></label>' +
      '<button class="btn btn-primary" type="submit">OK</button>' + kam + "</form>";
  }

  function pohladZoznam() {
    var z = B.zoznam;
    var head = '<div class="head"><div><h2>Balenie</h2><div class="sub">Furmanky na najbližších 7 dní' + (B.nacitavam ? " · načítavam…" : "") + '</div></div>' +
      '<span class="head-tl"><button class="btn btn-ikona" data-b="obnov" aria-label="Obnoviť">↻</button></span></div>';
    if (!z) return head + spravaHtml() + '<div class="empty"><strong>' + (B.nacitavam ? "Načítavam…" : "Nenačítané") + "</strong></div>";
    if (!z.length) return head + spravaHtml() + '<div class="empty"><strong>Najbližších 7 dní nie je žiadna furmanka</strong></div>';
    return head + spravaHtml() + '<div class="b-furmanky">' + z.map(function (f) {
      var hotovo = f.pocet ? Math.round(100 * f.zabalene / f.pocet) : 0;
      return '<section class="card b-furm"><div class="b-furm-hl"><h3>' + esc(f.nazov) + "</h3>" +
        (f.stav === "full" ? '<span class="pill warn">uzavretá</span>' : "") + "</div>" +
        '<div class="b-prog" aria-label="Zabalené ' + f.zabalene + " z " + f.pocet + '"><span style="width:' + hotovo + '%"></span></div>' +
        '<div class="b-furm-cisla"><span><b class="num">' + f.zabalene + "</b> / " + f.pocet + " zabalených</span>" +
        (f.rozpracovane ? '<span class="b-st b-st-rozp">' + f.rozpracovane + " rozprac.</span>" : "") +
        (f.odlozene ? '<span class="b-st b-st-odl">' + f.odlozene + " odlož.</span>" : "") + "</div>" +
        '<button class="btn btn-primary b-balit" data-b-furmanka="' + f.id + '"' + (f.pocet ? "" : " disabled") + ">📦 BALIŤ</button></section>";
    }).join("") + "</div>";
  }

  function pohladFurmanka() {
    var d = B.fData, f = (d && d.furmanka) || {};
    var obj = (d && d.objednavky) || [];
    var zab = obj.filter(function (o) { return o.stav === "zabalena"; }).length, odl = obj.filter(function (o) { return o.stav === "odlozena"; }).length;
    var head = '<div class="head"><div><button class="btn-link spat" data-b="spat-zoznam">← Balenie</button><h2>' + esc(f.nazov || "Furmanka") + "</h2>" +
      '<div class="sub">zabalené ' + zab + " z " + obj.length + (odl ? " · odložené " + odl : "") + (B.nacitavam ? " · načítavam…" : "") + "</div></div>" +
      '<span class="head-tl"><button class="btn" data-b="stitky"' + (obj.length ? "" : " disabled") + '>🖨️ Štítky</button><button class="btn btn-ikona" data-b="obnov" aria-label="Obnoviť">↻</button></span></div>';
    if (!d) return head + spravaHtml() + '<div class="empty"><strong>Načítavam…</strong></div>';
    return head + spravaHtml() + skenBox("Naskenujte štítok objednávky") +
      '<section class="card"><div class="rows b-obj-zoznam">' + (obj.length ? obj.map(function (o, i) {
        var ks = 0, hot = 0; (o.polozky || []).forEach(function (p) { ks += p.ks; hot += Math.min(p.hotovo, p.ks); });
        return '<button class="row b-obj-riadok" data-b-obj="' + esc(o.cislo) + '"><span class="b-obj-poradie num">' + (o.poradie || i + 1) + "</span>" +
          '<span class="b-obj-kto"><b>' + esc(o.meno || o.firma || "-") + '</b><span class="muted">' + esc([o.mesto, o.cislo].filter(Boolean).join(" · ")) + "</span>" +
          (o.stav === "odlozena" && o.dovod ? '<span class="b-dovod">⚠️ ' + esc(o.dovod) + "</span>" : "") + "</span>" +
          '<span class="b-obj-stav"><span class="num muted">' + hot + "/" + ks + "</span>" + stavPill(o.stav, o.dovod) + "</span></button>";
      }).join("") : '<p class="muted" style="margin:0">Vo furmanke nie sú objednávky.</p>') + "</div></section>";
  }

  function pohladObjednavka() {
    var o = B.obj; if (!o) return "";
    var head = '<div class="head"><div><button class="btn-link spat" data-b="spat-furmanka">← ' + esc((B.fData && B.fData.furmanka && B.fData.furmanka.nazov) || "Furmanka") + "</button>" +
      "<h2>" + esc(o.meno || o.firma || "-") + "</h2>" +
      '<div class="sub">obj. ' + esc(o.cislo) + " · " + esc(o.mesto || "") + " · " + esc(o.platba || "DOBIERKA") + " " + esc(suma(o.suma)) + "</div></div>" +
      '<span class="head-tl">' + stavPill(o.stav, o.dovod) + "</span></div>";
    var info = [o.poznamka, o.upozornenie].filter(Boolean).join(" | ");
    var posl = B.posledny ? '<div class="b-posledny b-posledny-' + B.posledny.typ + '" role="status">' + esc(B.posledny.text) + "</div>" : "";
    var pol = (o.polozky || []).map(function (p) {
      var hotovo = p.hotovo >= p.ks;
      var ovl = p.sken ? '<span class="b-pol-pozn muted">skenovať</span>'
        : '<span class="b-pol-tl"><button class="btn btn-ikona" data-b-potvrd="' + esc(p.kod) + '" data-ks="' + Math.max(0, p.hotovo - 1) + '" aria-label="Menej"' + (p.hotovo > 0 ? "" : " disabled") + ">−</button>" +
          '<button class="btn btn-ikona" data-b-potvrd="' + esc(p.kod) + '" data-ks="' + Math.min(p.ks, p.hotovo + 1) + '" aria-label="Viac"' + (hotovo ? " disabled" : "") + ">+</button>" +
          (hotovo ? "" : '<button class="btn r-mini" data-b-potvrd="' + esc(p.kod) + '" data-ks="' + p.ks + '">✓ všetko</button>') + "</span>";
      return '<div class="b-pol' + (hotovo ? " b-pol-ok" : "") + '"><span class="b-pol-farba" style="background:' + esc(p.farba) + '"></span>' +
        '<span class="b-pol-nazov">' + esc(p.nazov) + "</span>" +
        '<span class="b-pol-pocet num"><b>' + p.hotovo + "</b> / " + p.ks + (hotovo ? " ✓" : "") + "</span>" + ovl + "</div>";
    }).join("");
    var baliky = (o.baliky || []).length ? '<details class="card b-baliky"><summary>Naskenované balíky (' + o.baliky.length + ")</summary><div class=\"rows\">" +
      o.baliky.map(function (b) {
        return '<div class="row"><span class="num">' + esc(b.kod) + '</span><button class="btn-link b-zrus" data-b-vrat="' + esc(b.kod) + '">zrušiť</button></div>';
      }).join("") + "</div></details>" : "";
    return head + spravaHtml() + (info ? '<p class="s-varovanie s-varovanie-info">' + esc(info) + "</p>" : "") +
      (o.stav === "odlozena" && o.dovod ? '<p class="s-varovanie">Odložená: ' + esc(o.dovod) + "</p>" : "") +
      skenBox("Naskenujte balík") + posl +
      '<section class="card b-polozky">' + (pol || '<p class="muted" style="margin:0">Objednávka nemá položky.</p>') + "</section>" + baliky +
      '<div class="b-akcie"><button class="btn b-tl-odl" data-b="odlozit">⏸️ ODLOŽIŤ</button>' +
      '<button class="btn b-tl-hotovo" data-b="hotovo"' + (o.kompletne && o.stav !== "zabalena" ? "" : " disabled") + ">✅ HOTOVO</button></div>" +
      '<p class="b-znova"><button class="btn-link" data-b="znova">Začať odznova (vráti všetky balíky na sklad)</button></p>';
  }

  function dialogHtml() {
    if (!B.dialog) return "";
    return '<div class="f-dialog-pozadie" data-b="zavri"></div><div class="f-dialog" role="dialog" aria-modal="true" aria-label="Odložiť objednávku">' +
      '<div class="f-lista"><h3>Odložiť objednávku</h3><button class="btn-link" data-b="zavri" aria-label="Zavrieť">✕</button></div>' +
      '<form class="f-form" id="b-odlozit-form"><label class="field"><span class="label">Dôvod – čo chýba (uvidí zákaznícky servis vo Furmankách)</span>' +
      '<textarea id="b-dovod" rows="3" required placeholder="napr. chýbajú 2× jahodové, dopečie sa zajtra">' + esc(B.obj && B.obj.dovod) + "</textarea></label>" +
      '<button class="btn b-tl-odl" type="submit">⏸️ Odložiť</button></form></div>';
  }

  function prekresli() {
    if (!koren || !koren.isConnected) return;
    var obsah = document.getElementById("b-obsah");
    if (!obsah) {
      koren.innerHTML = '<div id="b-obsah"></div><div id="b-kamera" hidden></div>';
      obsah = document.getElementById("b-obsah");
    }
    var aktivny = document.activeElement && document.activeElement.id === "b-kod";
    obsah.innerHTML = (B.pohlad === "objednavka" ? pohladObjednavka() : B.pohlad === "furmanka" ? pohladFurmanka() : pohladZoznam()) + dialogHtml();
    var kam = document.getElementById("b-kamera");
    if (kam) { kam.hidden = kameraStav === "vyp" || B.pohlad === "zoznam"; }
    if (aktivny) obal();
    var dv = document.getElementById("b-dovod"); if (dv && B.dialog === "novy") { B.dialog = "otvoreny"; dv.focus(); }
  }

  // ---------- akcie ----------
  function po(promise, okText) {
    B.prace++;
    return promise.then(function (r) {
      B.prace--;
      if (!r || r.ok === false) { pip(false); B.sprava = { typ: "chyba", text: (r && r.text) || "Neuložené" }; }
      else { if (r.objednavka) nastavObj(r.objednavka); B.sprava = okText ? { typ: "ok", text: typeof okText === "function" ? okText(r) : okText } : null; }
      prekresli(); return r;
    }).catch(function (e) { B.prace--; pip(false); B.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }
  function klik(e) {
    var t = e.target.closest("button, [data-b]"); if (!t || !koren.contains(t)) return;
    var d = t.dataset;
    if (d.bFurmanka) { B.fId = +d.bFurmanka; B.fData = null; B.pohlad = "furmanka"; B.sprava = null; nacitajFurmanku().then(obal); return; }
    if (d.bObj) { otvorObjednavku(d.bObj); return; }
    if (d.bPotvrd) { po(rpc("balenie_potvrd", { p_cislo: B.obj.cislo, p_kod: d.bPotvrd, p_ks: +d.ks })); return; }
    if (d.bVrat) {
      if (!window.confirm("Zrušiť sken balíka " + d.bVrat + "? Vráti sa na sklad.")) return;
      po(rpc("balenie_vrat_balik", { p_cislo: B.obj.cislo, p_kod: d.bVrat }), function (r) { return r.text; }); return;
    }
    switch (d.b) {
      case "zavri-spravu": B.sprava = null; prekresli(); break;
      case "zavri": B.dialog = null; prekresli(); break;
      case "obnov": B.sprava = null; if (B.pohlad === "zoznam") nacitajZoznam(); else nacitajFurmanku(); break;
      case "spat-zoznam": vypniKameru(); B.pohlad = "zoznam"; B.fId = null; B.fData = null; B.sprava = null; nacitajZoznam(); break;
      case "spat-furmanka": B.pohlad = "furmanka"; B.cislo = null; B.obj = null; B.sprava = null; B.posledny = null; prekresli(); nacitajFurmanku(true); obal(); break;
      case "kamera": zapniKameru(d.smer); break;
      case "kamera-stop": vypniKameru(); break;
      case "stitky":
        if (!window.LBZ_FURMANKY || !window.LBZ_FURMANKY.tlacStitkyZ) { B.sprava = { typ: "chyba", text: "Tlač štítkov nie je dostupná – obnovte appku." }; prekresli(); break; }
        window.LBZ_FURMANKY.tlacStitkyZ(B.fData.furmanka, B.fData.stitky || []).catch(function (er) { B.sprava = { typ: "chyba", text: chybaText(er) }; prekresli(); });
        break;
      case "hotovo":
        po(rpc("balenie_stav", { p_cislo: B.obj.cislo, p_stav: "zabalena" }), "Zabalené: " + (B.obj.meno || B.obj.cislo)).then(function (r) {
          if (r && r.ok) { pip(true); B.pohlad = "furmanka"; B.cislo = null; B.obj = null; B.posledny = null; prekresli(); nacitajFurmanku(true); obal(); }
        });
        break;
      case "odlozit": B.dialog = "novy"; prekresli(); break;
      case "znova":
        if (!window.confirm("Začať balenie tejto objednávky odznova? Všetky naskenované balíky sa vrátia na sklad.")) return;
        po(rpc("balenie_stav", { p_cislo: B.obj.cislo, p_stav: "znova" }), function (r) { return "Vrátené balíky: " + (r.vratene || 0) + ". Môžete baliť odznova."; });
        break;
    }
  }
  function odoslanie(e) {
    var f = e.target;
    if (f.id === "b-sken-form") {
      e.preventDefault();
      var inp = document.getElementById("b-kod"), v = inp.value; inp.value = "";
      spracuj(v); poslednyKod = ""; return;
    }
    if (f.id === "b-odlozit-form") {
      e.preventDefault();
      var dovod = document.getElementById("b-dovod").value;
      po(rpc("balenie_stav", { p_cislo: B.obj.cislo, p_stav: "odlozena", p_dovod: dovod }), "Odložené – zákaznícky servis to uvidí vo Furmankách").then(function (r) {
        if (r && r.ok) { B.dialog = null; B.pohlad = "furmanka"; B.cislo = null; B.obj = null; B.posledny = null; prekresli(); nacitajFurmanku(true); }
      });
    }
  }
  function klaves(e) { if (e.key === "Escape" && B.dialog) { B.dialog = null; prekresli(); } }

  // ---------- verejné rozhranie pre app.js ----------
  window.LBZ_BALENIE = {
    nastavDb: function (klient, rola) {
      DB = klient || null; ROLA = klient ? rola : null;
      if (!DB) { B.zoznam = null; B.fData = null; B.obj = null; B.karta = null; B.pohlad = "zoznam"; B.fId = null; }
    },
    mozem: function () { return !!DB && ["it", "ceo", "zakaznicky_servis", "prevadzka"].indexOf(ROLA) > -1; },
    mount: function (el) {
      if (kamera) vypniKameru();
      koren = el;
      el.addEventListener("click", klik);
      el.addEventListener("submit", odoslanie);
      el.addEventListener("keydown", klaves);
      prekresli();
      if (B.pohlad === "zoznam") nacitajZoznam(); else nacitajFurmanku(true);
    },
    odchod: function () { if (kamera || kameraStav !== "vyp") vypniKameru(); },
    karta: function () {
      if (!B.karta && DB) {
        B.karta = { nacitavam: true };
        rpc("balenie_zoznam").then(function (d) { B.karta = d && d.ok ? d : { chyba: true }; window.dispatchEvent(new Event("lbz-prekresli")); })
          .catch(function () { B.karta = { chyba: true }; });
      }
      var k = B.karta || {}, z = (k.furmanky || []).filter(function (f) { return f.pocet; }).slice(0, 4);
      return '<section class="card"><h3>Balenie</h3>' +
        (!k.ok ? '<p class="muted" style="margin:0">' + (k.chyba ? "Nenačítané." : "Načítavam…") + "</p>"
          : z.length ? '<div class="rows">' + z.map(function (f) {
            return '<div class="row"><span>' + esc(f.nazov) + '</span><span><span class="num">' + f.zabalene + "/" + f.pocet + "</span>" +
              (f.odlozene ? ' <span class="b-st b-st-odl">' + f.odlozene + " odlož.</span>" : "") + "</span></div>";
          }).join("") + "</div>" : '<p class="muted" style="margin:0">Nič na balenie.</p>') +
        '<button class="btn" data-mod="balenie">Otvoriť balenie</button></section>';
    }
  };
})();
