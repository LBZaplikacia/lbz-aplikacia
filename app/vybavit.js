// LBZ aplikácia – karta „Vybaviť“ na Prehľade (pod rozpisom): osobný zoznam úloh a poznámok, každý vidí len svoje.
// Ťuknutím na krúžok sa úloha odškrtne (hotové sa po 7 dňoch skryjú), ✕ zmaže, nová sa pridá do poľa dole.

(function () {
  "use strict";
  var DB = null, ROLA = null, V = { zoznam: null, chyba: null, otvorene: false };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function prekresli() { window.dispatchEvent(new Event("lbz-prekresli")); }
  function nacitaj() {
    if (!DB) return;
    DB.rpc("vybavit_zoznam").then(function (r) { if (r.error) throw r.error; V.zoznam = r.data || []; V.chyba = null; prekresli(); })
      .catch(function (e) { V.chyba = (e && e.message) || "Nenačítané"; prekresli(); });
  }
  function uloz(p) {
    return DB.rpc("vybavit_uloz", { p: p }).then(function (r) {
      if (r.error) throw r.error;
      if (r.data && r.data.ok) V.zoznam = r.data.zoznam || []; else lbzInfo((r.data && r.data.text) || "Nepodarilo sa uložiť");
      prekresli();
    }).catch(function (e) { lbzInfo((e && e.message) || "Bez spojenia"); });
  }

  function karta() {
    if (!DB) return "";
    var z = V.zoznam;
    var otvorene = (z || []).filter(function (x) { return !x.hotovo; }), hotove = (z || []).filter(function (x) { return x.hotovo; });
    var polozka = function (x) {
      return '<li class="v-pol' + (x.hotovo ? " v-hotovo" : "") + '"><button class="v-krug" data-v-hotovo="' + x.id + '" data-v-stav="' + (x.hotovo ? "0" : "1") + '" aria-label="' + (x.hotovo ? "Vrátiť" : "Hotovo") + '">' + (x.hotovo ? "✓" : "") + "</button>" +
        '<span class="v-text">' + esc(x.text) + '</span><button class="v-zmaz" data-v-zmaz="' + x.id + '" aria-label="Zmazať">✕</button></li>';
    };
    return '<section class="card v-karta"><h3>📝 Vybaviť' + (otvorene.length ? ' <span class="pill info num">' + otvorene.length + "</span>" : "") + "</h3>" +
      (V.chyba ? '<p class="muted">' + esc(V.chyba) + "</p>" : z == null ? '<p class="muted">Načítavam…</p>' :
        '<ul class="v-zoznam">' + otvorene.map(polozka).join("") + "</ul>" +
        (!otvorene.length ? '<p class="muted v-prazdne">Nič nečaká. 🎉</p>' : "") +
        (hotove.length ? '<details class="v-hotove"><summary>Hotové (' + hotove.length + ")</summary><ul class=\"v-zoznam\">" + hotove.map(polozka).join("") + "</ul></details>" : "")) +
      '<form class="v-nova" id="v-nova"><input id="v-text" maxlength="500" placeholder="Pridať úlohu alebo poznámku…" autocomplete="off" enterkeyhint="done"><button class="btn btn-primary" type="submit" aria-label="Pridať">＋</button></form></section>';
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-v-hotovo], [data-v-zmaz]"); if (!t || !DB) return;
    if (t.dataset.vHotovo) uloz({ id: +t.dataset.vHotovo, hotovo: t.dataset.vStav === "1" });
    else if (t.dataset.vZmaz) { if (!lbzPotvrd("Zmazať túto položku?")) return; uloz({ id: +t.dataset.vZmaz, zmaz: true }); }
  });
  document.addEventListener("submit", function (e) {
    if (e.target.id !== "v-nova" || !DB) return;
    e.preventDefault();
    var i = document.getElementById("v-text"), text = i.value.trim(); if (!text) return;
    i.value = ""; uloz({ text: text }).then(function () { var n = document.getElementById("v-text"); if (n) n.focus(); });
  });

  window.LBZ_VYBAVIT = {
    nastavDb: function (klient, rola) { DB = klient && rola !== "zakaznik" ? klient : null; ROLA = rola; V.zoznam = null; if (DB) nacitaj(); },
    karta: karta
  };
})();
