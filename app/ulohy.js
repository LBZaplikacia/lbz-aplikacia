// LBZ aplikácia – karta „Úlohy“ na Prehľade.
// Vedenie (IT, CEO, prevádzkár) zadáva úlohy konkrétnym ľuďom alebo „na deň“ = všetkým, kto má v ten deň smenu (okrem rozvozu).
// Každý vidí svoje úlohy na dnes + nesplnené staršie, odškrtne splnené; zamestnanec si môže pridať vlastnú úlohu.

(function () {
  "use strict";
  var DB = null, ROLA = null;
  var U = { moje: null, chyba: null, prehlad: null, dialog: null, prace: false };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function prekresli() { window.dispatchEvent(new Event("lbz-prekresli")); }
  function rpc(n, a) { return DB.rpc(n, a || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function zadavatel() { return ["it", "ceo", "prevadzkar"].indexOf(ROLA) > -1; }
  function iso(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function dnes() { return iso(new Date()); }
  function kratko(s) { var p = String(s).slice(0, 10).split("-"); return +p[2] + ". " + +p[1] + "."; }
  function den(s) { var p = String(s).slice(0, 10).split("-"); return new Date(+p[0], +p[1] - 1, +p[2], 12).toLocaleDateString("sk-SK", { weekday: "short", day: "numeric", month: "numeric" }); }

  function nacitaj() {
    if (!DB) return;
    rpc("ulohy_moje").then(function (d) { U.moje = d || []; U.chyba = null; prekresli(); })
      .catch(function (e) { U.chyba = (e && e.message) || "Nenačítané"; prekresli(); });
    if (zadavatel()) nacitajPrehlad();
  }
  function nacitajPrehlad() {
    return rpc("ulohy_prehlad").then(function (d) { U.prehlad = d && d.ok ? d : null; prekresli(); kresliDialog(); }).catch(function () { /* */ });
  }

  function termin(x) {
    if (!x.termin) return "";
    var po = !x.splnene && x.termin < dnes();
    return '<span class="u-termin' + (po ? " u-po" : "") + '">' + (po ? "⚠ mal byť do " : "do ") + esc(kratko(x.termin)) + "</span>";
  }

  function karta() {
    if (!DB || ROLA === "zakaznik") return "";
    var z = U.moje || [], otv = z.filter(function (x) { return !x.splnene; }), hot = z.filter(function (x) { return x.splnene; });
    if (!zadavatel() && U.moje && !z.length && ROLA !== "zamestnanec" && ROLA !== "prevadzka") return "";
    var pol = function (x) {
      return '<li class="v-pol' + (x.splnene ? " v-hotovo" : "") + '"><button class="v-krug" data-u-splnit="' + x.id + '" data-u-stav="' + (x.splnene ? "0" : "1") + '" aria-label="' + (x.splnene ? "Vrátiť" : "Splnené") + '">' + (x.splnene ? "✓" : "") + "</button>" +
        '<span class="v-text">' + esc(x.text) + '<span class="u-meta">' + (x.na_den ? '<span class="u-stitok">celá smena</span>' : "") + termin(x) +
        (x.splnene && x.splnil ? '<span class="muted">splnil/a ' + esc(x.splnil) + "</span>" : "") + (x.datum < dnes() && !x.splnene ? '<span class="muted">od ' + esc(kratko(x.datum)) + "</span>" : "") + "</span></span></li>";
    };
    var p = U.prehlad, zadane = p ? p.ulohy || [] : [];
    return '<section class="card v-karta u-karta"><h3>✅ Úlohy na dnes' + (otv.length ? ' <span class="pill warn num">' + otv.length + "</span>" : "") +
      (zadavatel() ? '<button class="btn btn-primary u-zadaj" data-u="zadaj">＋ Zadať</button>' : "") + "</h3>" +
      (U.chyba ? '<p class="muted">' + esc(U.chyba) + "</p>" : U.moje == null ? '<p class="muted">Načítavam…</p>' :
        (otv.length ? '<ul class="v-zoznam">' + otv.map(pol).join("") + "</ul>" : '<p class="muted v-prazdne">Na dnes nič. 🎉</p>') +
        (hot.length ? '<details class="v-hotove"><summary>Splnené (' + hot.length + ")</summary><ul class=\"v-zoznam\">" + hot.map(pol).join("") + "</ul></details>" : "")) +
      (!zadavatel() && ROLA !== "prevadzka" ? '<form class="v-nova" id="u-nova"><input id="u-text" maxlength="500" placeholder="Pridať vlastnú úlohu…" autocomplete="off" enterkeyhint="done"><button class="btn btn-primary" type="submit" aria-label="Pridať">＋</button></form>' : "") +
      (zadavatel() && zadane.length ? '<details class="v-hotove u-zadane"><summary>Zadané úlohy (' + zadane.length + ")</summary><ul class=\"u-zoz\">" + zadane.map(function (x) {
        var komu = x.na_den ? (x.komu || []) : (x.komu || []).map(function (k) { return k.meno + (k.splnene ? " ✓" : ""); });
        var hotovo = x.na_den ? !!x.splnene : (x.komu || []).length && (x.komu || []).every(function (k) { return k.splnene; });
        return '<li class="u-z' + (hotovo ? " u-z-hot" : "") + '"><div><b>' + (hotovo ? "✓ " : "") + esc(x.text) + '</b><div class="muted">' + esc(den(x.datum)) + (x.termin ? " · do " + esc(kratko(x.termin)) : "") + " · " +
          (x.na_den ? "celá smena: " : "") + esc(komu.join(", ") || "nikto nemá smenu") + (x.na_den && x.splnene ? " · splnil/a " + esc(x.splnil || "") : "") + "</div></div>" +
          '<button class="v-zmaz" data-u-zmaz="' + x.id + '" aria-label="Zmazať úlohu">✕</button></li>';
      }).join("") + "</ul></details>" : "") +
      "</section>";
  }

  // ---------- dialóg zadania ----------
  function kresliDialog() {
    var obal = document.getElementById("u-dialog");
    if (!U.dialog) { if (obal) obal.remove(); return; }
    if (!obal) { obal = document.createElement("div"); obal.id = "u-dialog"; document.body.appendChild(obal); }
    var d = U.dialog, osoby = (U.prehlad && U.prehlad.osoby) || [];
    obal.innerHTML = '<div class="f-dialog-pozadie" data-u="zavri"></div><div class="f-dialog" role="dialog" aria-modal="true"><form class="f-form" id="u-form"><h3>Zadať úlohu</h3>' +
      '<label class="field"><span class="label">Úloha</span><textarea id="u-f-text" rows="3" maxlength="1000" required placeholder="Čo treba urobiť">' + esc(d.text || "") + "</textarea></label>" +
      '<div class="d-riadok"><label class="field"><span class="label">Kedy (deň)</span><input type="date" id="u-f-datum" value="' + esc(d.datum || dnes()) + '"></label>' +
      '<label class="field"><span class="label">Do kedy (nepovinné)</span><input type="date" id="u-f-termin" value="' + esc(d.termin || "") + '"></label></div>' +
      '<div class="field"><span class="label">Komu</span><div class="f-seg" role="group"><button type="button" data-u-komu="den" aria-pressed="' + (d.komu !== "ludia") + '">👥 Všetci na smene</button>' +
      '<button type="button" data-u-komu="ludia" aria-pressed="' + (d.komu === "ludia") + '">👤 Vybraní ľudia</button></div>' +
      (d.komu === "ludia" ? '<div class="chips u-osoby">' + osoby.map(function (o) {
        return '<button type="button" class="chip" data-u-osoba="' + o.id + '" aria-pressed="' + (d.osoby.indexOf(o.id) > -1) + '">' + esc(o.meno) + "</button>";
      }).join("") + "</div>" : '<p class="muted u-pozn">Uvidí ju každý, kto má v ten deň smenu v rozpise (pečenie, obchod, bar…) aj spoločný účet prevádzky. Rozvoz, e-shop a účtovníčka nie. Stačí, keď ju splní jeden.</p>') + "</div>" +
      '<div class="f-akcie"><button class="btn btn-primary" type="submit"' + (U.prace ? " disabled" : "") + ">" + (U.prace ? "Ukladám…" : "Zadať úlohu") + '</button><button class="btn" type="button" data-u="zavri">Zrušiť</button></div></form></div>';
  }
  function citajDialog() {
    var g = function (id) { var e = document.getElementById(id); return e ? e.value : ""; };
    if (!U.dialog) return;
    U.dialog.text = g("u-f-text"); U.dialog.datum = g("u-f-datum"); U.dialog.termin = g("u-f-termin");
  }

  document.addEventListener("click", function (e) {
    if (!DB) return;
    var t = e.target.closest("[data-u-splnit], [data-u-zmaz], [data-u], [data-u-komu], [data-u-osoba]"); if (!t) return;
    if (t.dataset.uSplnit) {
      rpc("ulohy_splnit", { p_id: +t.dataset.uSplnit, p_hotovo: t.dataset.uStav === "1" }).then(function (r) { if (r && !r.ok) lbzInfo(r.text); nacitaj(); }).catch(function (x) { lbzInfo((x && x.message) || "Bez spojenia"); });
    } else if (t.dataset.uZmaz) {
      if (!lbzPotvrd("Zmazať túto úlohu pre všetkých?")) return;
      rpc("ulohy_zmaz", { p_id: +t.dataset.uZmaz }).then(nacitaj).catch(function (x) { lbzInfo((x && x.message) || "Bez spojenia"); });
    } else if (t.dataset.uKomu) { citajDialog(); U.dialog.komu = t.dataset.uKomu; kresliDialog(); }
    else if (t.dataset.uOsoba) {
      citajDialog(); var id = +t.dataset.uOsoba, i = U.dialog.osoby.indexOf(id);
      if (i > -1) U.dialog.osoby.splice(i, 1); else U.dialog.osoby.push(id);
      kresliDialog();
    } else if (t.dataset.u === "zadaj") {
      U.dialog = { komu: "den", osoby: [], datum: dnes() }; kresliDialog();
      if (!U.prehlad) nacitajPrehlad();
      var f = document.getElementById("u-f-text"); if (f) f.focus();
    } else if (t.dataset.u === "zavri") { U.dialog = null; kresliDialog(); }
  });
  document.addEventListener("submit", function (e) {
    if (!DB) return;
    if (e.target.id === "u-nova") {
      e.preventDefault();
      var i = document.getElementById("u-text"), text = i.value.trim(); if (!text) return;
      i.value = "";
      rpc("ulohy_zadaj", { p: { text: text } }).then(function (r) { if (r && !r.ok) lbzInfo(r.text); nacitaj(); }).catch(function (x) { lbzInfo((x && x.message) || "Bez spojenia"); });
    } else if (e.target.id === "u-form") {
      e.preventDefault(); citajDialog();
      var d = U.dialog;
      if (!d.text.trim()) return;
      if (d.komu === "ludia" && !d.osoby.length) { lbzInfo("Vyber aspoň jedného človeka."); return; }
      if (d.termin && d.termin < d.datum) { lbzInfo("Termín „do kedy“ je skôr ako deň úlohy."); return; }
      U.prace = true; kresliDialog();
      rpc("ulohy_zadaj", { p: { text: d.text, datum: d.datum, termin: d.termin || null, osoby: d.komu === "ludia" ? d.osoby : [] } }).then(function (r) {
        U.prace = false;
        if (r && r.ok) { U.dialog = null; kresliDialog(); nacitaj(); } else { lbzInfo((r && r.text) || "Nepodarilo sa uložiť"); kresliDialog(); }
      }).catch(function (x) { U.prace = false; kresliDialog(); lbzInfo((x && x.message) || "Bez spojenia"); });
    }
  });

  window.LBZ_ULOHY = {
    nastavDb: function (klient, rola) {
      var zmena = ROLA !== rola || !klient; DB = klient && rola && rola !== "zakaznik" ? klient : null; ROLA = rola;
      if (zmena) { U.moje = null; U.prehlad = null; U.dialog = null; kresliDialog(); }
      if (DB) nacitaj();
    },
    obnov: function () { if (DB) nacitaj(); },
    zadaj: function () { if (DB && zadavatel()) { U.dialog = { komu: "den", osoby: [], datum: dnes() }; kresliDialog(); if (!U.prehlad) nacitajPrehlad(); } },
    karta: karta
  };
})();
