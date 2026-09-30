// LBZ aplikácia – modul Objednávky (v0.27)
// Správa objednávok z Upgates v appke: zoznam, detail, úpravy, zmena stavu, nová objednávka.
// Upgates ostáva miestom účtovných dokladov (faktúry, dobropisy, platby). Zmeny idú do Upgates cez frontu
// (Edge Function upgates-sync, akcia „zapis“). Kým nie je zapnutý ostrý režim, do Upgates sa nič nezapíše.
// Storno až po dobropise vystavenom v Upgates (appka si ho overí).
// Vidia: e-shop (zákaznícky servis), CEO, IT. Prevádzka má len kartu „Osobné odbery“ na Prehľade.

(function () {
  "use strict";
  var DB = null, ROLA = null, koren = null;
  var O = { zoznam: null, filter: { hladaj: "", stav: "", doprava: "", platba: "", osobny: false }, detail: null, cislo: null, uprava: null, sprava: null, prace: false, produkty: null, nova: null, odbery: null };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function rpc(n, a) { return DB.rpc(n, a || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function fn(akcia, extra) {
    return DB.functions.invoke("upgates-sync", { body: Object.assign({ akcia: akcia }, extra || {}) }).then(function (r) {
      if (r.error) { return r.error.context && r.error.context.json ? r.error.context.json() : { ok: false, text: r.error.message }; }
      return r.data;
    });
  }
  function eur(x) { return x == null || x === "" ? "" : Number(x).toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
  function dat(s) { if (!s) return ""; var d = new Date(s); return d.toLocaleString("sk-SK", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }); }
  function chyba(e) { return (e && (e.message || e.text)) || "Bez spojenia so serverom"; }
  function sprava(typ, text) { O.sprava = { typ: typ, text: text }; kresli(); }
  function spravaHtml() { return O.sprava ? '<p class="f-sprava f-' + O.sprava.typ + '" role="status">' + esc(O.sprava.text) + ' <button class="btn-link" data-o="zavri-spravu" aria-label="Zavrieť">✕</button></p>' : ""; }
  function vedenie() { return ROLA === "it" || ROLA === "ceo"; }

  // ---------- načítanie ----------
  function nacitaj() {
    if (!DB) return;
    O.prace = true; kresli();
    rpc("obj_zoznam", { p: { hladaj: O.filter.hladaj, stav: O.filter.stav, doprava: O.filter.doprava, platba: O.filter.platba, osobny: O.filter.osobny, limit: O.limit || 300 } }).then(function (d) {
      O.prace = false; O.zoznam = d && d.ok ? d : { ok: false, text: (d && d.text) || "Nenačítané" }; kresli();
    }).catch(function (e) { O.prace = false; O.zoznam = { ok: false, text: chyba(e) }; kresli(); });
  }
  function otvor(cislo) {
    O.cislo = cislo; O.detail = null; O.uprava = null; O.sprava = null; kresli(); window.scrollTo(0, 0);
    rpc("obj_detail", { p_cislo: cislo }).then(function (d) { O.detail = d; kresli(); }).catch(function (e) { O.detail = { ok: false, text: chyba(e) }; kresli(); });
  }
  function produkty() {
    if (O.produkty) return Promise.resolve(O.produkty);
    return rpc("obj_produkty").then(function (d) { O.produkty = d || []; return O.produkty; });
  }
  function odoslatZmeny(tiche) {
    return fn("zapis").then(function (r) {
      if (!tiche || (r && r.ok === false)) sprava(r && r.ok ? "ok" : "chyba", (r && r.text) || "Neodoslané");
      if (O.cislo) otvor(O.cislo); else nacitaj();
    }).catch(function (e) { sprava("chyba", chyba(e)); });
  }

  // ---------- zobrazenie ----------
  function kresli() {
    if (!koren || !koren.isConnected) return;
    koren.innerHTML = O.nova ? formularHtml(O.nova, true) : O.cislo ? detailHtml() : zoznamHtml();
  }
  function rezimPill(ostry) {
    return ostry ? '<span class="pill ok">OSTRÝ zápis do Upgates</span>' : '<span class="pill warn">TEST – do Upgates sa nezapisuje</span>';
  }
  // farby stavov ako v Upgates (keď Upgates farbu nevráti)
  var FARBY = { "Prijatá": "#17a2b8", "Platba úspešná": "#6bb568", "Platba zlyhala": "#969696", "Platba zrušena": "#969696", "Nedoriešená": "#ffc107",
    "Storno": "#dc3545", "Spracované Nerozvezené": "#a3e7ff", "Naplanovane": "#02d9d6", "Rozvezene": "#ffa6f6" };
  function farbaStavu(s, farby) { var f = (farby && farby[s]) || FARBY[s] || "#7154bc"; return /^#?[0-9a-f]{3,8}$/i.test(f) ? (f[0] === "#" ? f : "#" + f) : "#7154bc"; }
  var OTVORENE = /^(Prijatá|Platba úspešná|Platba prebieha|Nedoriešená|Doriešiť)/i;   // ako „nevybavené“ riadky v Upgates
  // typ dopravy – farebne zvýraznený
  function dopravaTyp(d) {
    d = String(d || "");
    var m = d.match(/(?:furmank[ay]|rozvoz)\s+([^\s(,]+)/i);
    if (m) return { t: "furmanka", n: "🚐 Furmanka " + m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() };
    if (/osobn|vyzdvihnut|odber/i.test(d)) return { t: "osobny", n: "🏠 Osobný odber" };
    if (/veľko|velko|b2b/i.test(d)) return { t: "vo", n: "🏪 Veľkoobchod" };
    if (/kuri|packet|zásiel|zasiel|balík|balik|sps|gls|dpd|pošt|post/i.test(d)) return { t: "kurier", n: "📦 " + d.split(/[(,]/)[0].trim() };
    return { t: "ina", n: d.split("(")[0].trim() || "–" };
  }
  function dopravaPill(d) { var x = dopravaTyp(d); return '<span class="o-dp o-dp-' + x.t + '" title="' + esc(d || "") + '">' + esc(x.n) + "</span>"; }
  function zoznamHtml() {
    var Z = O.zoznam || {}, obj = Z.objednavky || [];
    var stavy = (Z.stavy || []).slice().sort();
    function vyber(meno, prazdne, zoz) { return '<select name="' + meno + '" class="r-select"><option value="">' + prazdne + "</option>" + (zoz || []).slice().sort().map(function (s) { return '<option' + (s === O.filter[meno] ? " selected" : "") + ">" + esc(s) + "</option>"; }).join("") + "</select>"; }
    var h = '<div class="head"><div><h2>Objednávky</h2><div class="sub">' + (Z.ok ? rezimPill(Z.ostry) : "") + (O.prace ? " · načítavam…" : "") + "</div></div>" +
      '<span class="head-tl"><button class="btn btn-primary" data-o="nova">+ Nová objednávka</button></span></div>' + spravaHtml();
    h += '<section class="card o-filtre"><form id="o-hladaj" class="o-riadok"><input name="hladaj" type="search" placeholder="Hľadať: meno, telefón, e-mail, číslo" value="' + esc(O.filter.hladaj) + '">' +
      '<select name="stav" class="r-select"><option value="">Všetky stavy</option>' + stavy.map(function (s) { return '<option' + (s === O.filter.stav ? " selected" : "") + ">" + esc(s) + "</option>"; }).join("") + "</select>" +
      vyber("doprava", "Všetky dopravy", Z.dopravy) + vyber("platba", "Všetky platby", Z.platby) +
      '<label class="f-check"><input type="checkbox" name="osobny"' + (O.filter.osobny ? " checked" : "") + "> len osobný odber</label>" +
      '<button class="btn" type="submit">Hľadať</button></form>' +
      '<div class="o-riadok o-akcie"><button class="btn r-mini" data-o="obnovit">🔄 Stiahnuť z Upgates</button>' +
      (Z.caka ? '<button class="btn r-mini" data-o="odoslat">⬆️ Odoslať zmeny do Upgates (' + Z.caka + ")</button>" : "") +
      '<button class="btn r-mini" data-o="ciselniky">Načítať stavy, dopravy a platby</button>' +
      (vedenie() && Z.ok ? '<button class="btn r-mini" data-o="rezim">' + (Z.ostry ? "Prepnúť na TEST" : "Zapnúť ostrý zápis") + "</button>" : "") + "</div></section>";
    if (!Z.ok) return h + '<div class="empty"><strong>' + esc(Z.text || "Načítavam…") + "</strong></div>";
    if (!obj.length) return h + '<div class="empty"><strong>Žiadne objednávky</strong></div>';
    h += '<section class="card"><div class="o-zoznam">' + obj.map(function (o) {
      return '<button class="o-pol" data-o-cislo="' + esc(o.cislo) + '"><span class="o-pol-h"><b>' + esc(o.cislo) + "</b> " + esc(o.meno || "") + " " + dopravaPill(o.doprava) +
        (o.caka ? ' <span class="pill warn">čaká na Upgates</span>' : "") + "</span>" +
        '<span class="o-pol-d muted">' + esc([o.status, o.platba_nazov || o.platba, o.furmanka, dat(o.vytvorena)].filter(Boolean).join(" · ")) + "</span>" +
        '<span class="o-pol-s num">' + esc(eur(o.suma)) + "</span></button>";
    }).join("") + "</div>" +
      (Z.najdenych > obj.length ? '<div class="o-dalsie"><span class="muted">Zobrazených ' + obj.length + " z " + Z.najdenych + '</span> <button class="btn r-mini" data-o="dalsie">Načítať ďalšie</button></div>' : (Z.najdenych ? '<div class="o-dalsie muted">Spolu ' + Z.najdenych + "</div>" : "")) +
      "</section>";
    return h;
  }
  function detailHtml() {
    var D = O.detail;
    var h = '<div class="head"><div><button class="btn-link spat" data-o="spat">← Objednávky</button><h2>' + esc(O.cislo) + "</h2>";
    if (!D) return h + '</div></div><div class="empty"><strong>Načítavam…</strong></div>';
    if (!D.ok) return h + "</div></div>" + spravaHtml() + '<div class="empty"><strong>' + esc(D.text) + "</strong></div>";
    var o = D.objednavka;
    h += '<div class="sub">' + esc(o.status || "") + " · " + rezimPill(D.ostry) + "</div></div></div>" + spravaHtml();
    if (O.uprava) return h + formularHtml(O.uprava, false);
    var storno = /storn/i.test(o.status || "");
    h += '<section class="card"><div class="rows">' +
      riadok("Zákazník", [o.meno, o.firma].filter(Boolean).join(" · ")) + riadok("Telefón", o.telefon ? '<a href="tel:' + esc(o.telefon) + '">' + esc(o.telefon) + "</a>" : "", true) +
      riadok("E-mail", o.email ? '<a href="mailto:' + esc(o.email) + '">' + esc(o.email) + "</a>" : "", true) +
      riadok("Adresa", [o.ulica, o.psc, o.mesto].filter(Boolean).join(", ")) + riadok("Doprava", o.doprava) + riadok("Platba", [o.platba_nazov, o.platba].filter(Boolean).join(" · ")) +
      riadok("Suma", eur(o.suma)) + riadok("Faktúra", o.faktura) + riadok("Dobropis", o.dobropis) + riadok("Poznámka", o.poznamka) + riadok("Vytvorená", dat(o.vytvorena)) + "</div>" +
      (storno ? "" : '<div class="f-akcie"><button class="btn" data-o="upravit">✏️ Upraviť</button></div>') + "</section>";
    h += '<section class="card"><h3>Položky</h3><div class="rows">' + (D.polozky || []).map(function (p) {
      return '<div class="row"><span>' + esc(p.nazov || p.kod) + ' <span class="muted">' + esc(p.kod) + '</span></span><span class="num">' + esc(p.mnozstvo) + " ks" + (p.cena != null ? " · " + esc(eur(p.cena)) : "") + "</span></div>";
    }).join("") + "</div></section>";
    if (!storno) {
      h += '<section class="card"><h3>Stav objednávky</h3>' + ((D.stavy || []).length ?
        '<form id="o-stav" class="o-riadok"><select name="stav">' + D.stavy.map(function (s) { return '<option value="' + esc(s.kod) + '"' + (s.nazov === o.status ? " selected" : "") + ">" + esc(s.nazov) + "</option>"; }).join("") +
        '</select><button class="btn btn-primary" type="submit">Zmeniť stav</button></form>' +
        '<p class="muted r-mala">Pri zmene stavu Upgates pošle zákazníkovi e-mail, ak ho má stav nastavený. <b>Storno</b> sa dá až po vystavení dobropisu v Upgates.</p>'
        : '<p class="muted" style="margin:0">Stavy z Upgates ešte nie sú načítané – v zozname objednávok ťuknite „Načítať stavy, dopravy a platby“.</p>') +
        (o.faktura && !o.dobropis ? '<div class="f-akcie"><button class="btn" data-o="dobropis">🔎 Skontrolovať dobropis v Upgates</button></div>' : "") + "</section>";
    }
    var fr = (D.fronta || []).filter(function (f) { return f.stav !== "odoslane"; });
    if (fr.length) h += '<section class="card"><h3>Zmeny pre Upgates</h3><div class="rows">' + fr.map(function (f) {
      return '<div class="row"><span>' + esc({ uprava: "úprava", stav: "stav", nova: "nová objednávka" }[f.typ] || f.typ) + (f.data && f.data.status ? " → " + esc(f.data.status) : "") +
        (f.chyba ? '<br><span class="zm-chyba-pol">' + esc(f.chyba) + "</span>" : "") + '</span><span class="muted">' + esc({ caka: "čaká", test: "test – nezapísané", chyba: "chyba" }[f.stav] || f.stav) + "</span></div>";
    }).join("") + '</div><div class="f-akcie"><button class="btn" data-o="odoslat">⬆️ Odoslať do Upgates</button></div></section>';
    h += '<details class="card"><summary>História</summary><div class="rows">' + (D.log || []).map(function (l) {
      return '<div class="row"><span>' + esc(l.text) + '</span><span class="muted">' + esc(dat(l.cas)) + "<br>" + esc(l.ucet || "") + "</span></div>";
    }).join("") + "</div></details>";
    return h;
  }
  function riadok(n, v, html) { return v ? '<div class="row"><span class="muted">' + esc(n) + "</span><span>" + (html ? v : esc(v)) + "</span></div>" : ""; }

  // formulár pre úpravu aj novú objednávku; F = {meno, firma, telefon, email, ulica, psc, mesto, poznamka, doprava_kod, platba_kod, polozky:[]}
  function formularHtml(F, nova) {
    var D = (!nova && O.detail) || {}, dop = D.dopravy || (O.cis && O.cis.dopravy) || [], plat = D.platby || (O.cis && O.cis.platby) || [];
    var pole = function (k, n, typ) { return '<label class="field"><span class="label">' + esc(n) + '</span><input name="' + k + '" type="' + (typ || "text") + '" value="' + esc(F[k] || "") + '"></label>'; };
    var sel = function (k, n, zoz) {
      return '<label class="field"><span class="label">' + esc(n) + '</span><select name="' + k + '"><option value="">' + (nova ? "– vyberte –" : "bez zmeny") + "</option>" +
        zoz.map(function (x) { return '<option value="' + esc(x.kod) + '"' + (F[k] === x.kod ? " selected" : "") + ">" + esc(x.nazov) + "</option>"; }).join("") + "</select></label>";
    };
    var prod = O.produkty || [];
    return (nova ? '<div class="head"><div><button class="btn-link spat" data-o="zrus-novu">← Objednávky</button><h2>Nová objednávka</h2><div class="sub">z telefónu alebo e-mailu – vytvorí sa aj v Upgates</div></div></div>' + spravaHtml() : "") +
      '<form id="o-form" class="card f-form" data-nova="' + (nova ? 1 : 0) + '"><h3>Zákazník</h3><div class="f-2">' + pole("meno", "Meno a priezvisko") + pole("firma", "Firma") + "</div>" +
      '<div class="f-2">' + pole("telefon", "Telefón", "tel") + pole("email", "E-mail", "email") + "</div>" +
      pole("ulica", "Ulica a číslo") + '<div class="f-2">' + pole("psc", "PSČ") + pole("mesto", "Mesto") + "</div>" +
      '<div class="f-2">' + sel("doprava_kod", "Doprava", dop) + sel("platba_kod", "Platba", plat) + "</div>" +
      '<label class="field"><span class="label">Poznámka</span><textarea name="poznamka" rows="2">' + esc(F.poznamka || "") + "</textarea></label>" +
      '<h3>Položky</h3><div class="o-polozky">' + (F.polozky || []).map(function (p, i) {
        return '<div class="o-riadok o-pol-riadok"><span class="o-pol-n">' + esc(p.nazov || p.kod) + ' <span class="muted">' + esc(p.kod) + "</span></span>" +
          '<input type="number" min="0" step="1" data-o-ks="' + i + '" value="' + esc(p.mnozstvo) + '" aria-label="Kusy"><input type="number" min="0" step="0.01" data-o-cena="' + i + '" value="' + esc(p.cena == null ? "" : p.cena) + '" placeholder="cena/ks" aria-label="Cena za kus">' +
          '<button class="btn-link" type="button" data-o-zmaz="' + i + '" aria-label="Odstrániť">✕</button></div>';
      }).join("") + "</div>" +
      '<div class="o-riadok"><select id="o-pridaj"><option value="">+ pridať produkt…</option>' + prod.map(function (p) { return '<option value="' + esc(p.kod) + '">' + esc(p.nazov) + (p.cena != null ? " (" + eur(p.cena) + ")" : "") + "</option>"; }).join("") + "</select></div>" +
      '<div class="f-akcie"><button class="btn btn-primary" type="submit"' + (O.prace ? " disabled" : "") + ">" + (nova ? "Založiť objednávku" : "Uložiť zmeny") + "</button>" +
      '<button class="btn" type="button" data-o="' + (nova ? "zrus-novu" : "zrus-upravu") + '">Zrušiť</button></div>' +
      '<p class="muted r-mala">' + (nova ? "Objednávka dostane číslo z Upgates po odoslaní. Faktúru a platbu rieši Upgates." : "Zmeny sa zapíšu aj do Upgates. Zaplatenie a faktúry appka nemení.") + "</p></form>";
  }
  function formular() { return O.nova || O.uprava; }
  function citajFormular(f) {
    var F = formular(); if (!F) return;
    ["meno", "firma", "telefon", "email", "ulica", "psc", "mesto", "poznamka", "doprava_kod", "platba_kod"].forEach(function (k) { if (f.elements[k]) F[k] = f.elements[k].value; });
    f.querySelectorAll("[data-o-ks]").forEach(function (i) { F.polozky[+i.dataset.oKs].mnozstvo = i.value; });
    f.querySelectorAll("[data-o-cena]").forEach(function (i) { F.polozky[+i.dataset.oCena].cena = i.value; });
  }

  // ---------- udalosti ----------
  function klik(e) {
    var t = e.target.closest("button, [data-o], tr[data-o-cislo]"); if (!t) return;
    var d = t.dataset;
    if (d.oStav !== undefined) { O.filter.stav = d.oStav; nacitaj(); return; }
    if (d.oCislo) { otvor(d.oCislo); return; }
    if (d.oZmaz != null) { var fz = koren.querySelector("#o-form"); citajFormular(fz); formular().polozky.splice(+d.oZmaz, 1); kresli(); return; }
    switch (d.o) {
      case "dalsie": O.limit = (O.limit || 300) + 300; nacitaj(); return;
      case "zavri-spravu": O.sprava = null; kresli(); return;
      case "spat": O.cislo = null; O.detail = null; O.uprava = null; nacitaj(); return;
      case "nova":
        O.sprava = null;
        Promise.all([produkty(), ciselnikyDetail()]).then(function () {
          O.nova = { polozky: [] }; kresli();
        });
        return;
      case "zrus-novu": O.nova = null; kresli(); return;
      case "upravit": produkty().then(function () {
          var o = O.detail.objednavka;
          O.uprava = { meno: o.meno, firma: o.firma, telefon: o.telefon, email: o.email, ulica: o.ulica, psc: o.psc, mesto: o.mesto, poznamka: o.poznamka, doprava_kod: "", platba_kod: "",
            polozky: (O.detail.polozky || []).map(function (p) { return { kod: p.kod, nazov: p.nazov, mnozstvo: p.mnozstvo, cena: p.cena }; }) };
          kresli();
        }); return;
      case "zrus-upravu": O.uprava = null; kresli(); return;
      case "obnovit":
        t.disabled = true;
        fn("sync").then(function (r) { sprava(r && r.ok ? "ok" : "chyba", (r && r.text) || "Nestiahnuté"); nacitaj(); }).catch(function (x) { sprava("chyba", chyba(x)); });
        return;
      case "ciselniky":
        t.disabled = true;
        fn("ciselniky").then(function (r) { sprava(r && r.ok ? "ok" : "chyba", (r && r.text) || "Nenačítané"); O.cis = null; }).catch(function (x) { sprava("chyba", chyba(x)); });
        return;
      case "odoslat": t.disabled = true; odoslatZmeny(false); return;
      case "dobropis":
        t.disabled = true;
        fn("dobropis", { cislo: O.cislo }).then(function (r) { sprava(r && r.dobropis ? "ok" : "chyba", (r && r.text) || "Nepodarilo sa overiť"); otvor(O.cislo); }).catch(function (x) { sprava("chyba", chyba(x)); });
        return;
      case "rezim":
        var ostry = !(O.zoznam && O.zoznam.ostry);
        if (ostry && !lbzPotvrd("Zapnúť OSTRÝ zápis do Upgates? Zmeny objednávok a nové objednávky sa odteraz naozaj zapíšu do Upgates.")) return;
        rpc("obj_ostry_nastav", { p_ostry: ostry }).then(function (r) { sprava(r && r.ok ? "ok" : "chyba", (r && r.text) || ""); nacitaj(); });
        return;
    }
  }
  function ciselnikyDetail() {
    if (O.cis) return Promise.resolve(O.cis);
    return rpc("obj_ciselniky").then(function (d) { O.cis = { dopravy: (d && d.dopravy) || [], platby: (d && d.platby) || [] }; return O.cis; });
  }
  function zmena(e) {
    var fh = e.target.form;
    if (fh && fh.id === "o-hladaj" && (e.target.tagName === "SELECT" || e.target.type === "checkbox")) { odoslanie({ target: fh, preventDefault: function () {} }); return; }
    if (e.target.id === "o-pridaj" && e.target.value) {
      var p = (O.produkty || []).filter(function (x) { return x.kod === e.target.value; })[0];
      var f = koren.querySelector("#o-form"); citajFormular(f);
      var F = formular(); var uz = F.polozky.filter(function (x) { return x.kod === p.kod; })[0];
      if (uz) uz.mnozstvo = (+uz.mnozstvo || 0) + 1; else F.polozky.push({ kod: p.kod, nazov: p.nazov, mnozstvo: 1, cena: p.cena });
      kresli();
    }
  }
  function odoslanie(e) {
    var f = e.target;
    if (f.id === "o-hladaj") {
      e.preventDefault();
      O.limit = 300;
      O.filter = { hladaj: f.elements.hladaj.value.trim(), stav: f.elements.stav.value, doprava: f.elements.doprava.value, platba: f.elements.platba.value, osobny: f.elements.osobny.checked };
      nacitaj(); return;
    }
    if (f.id === "o-stav") {
      e.preventDefault();
      var kod = f.elements.stav.value, nazov = f.elements.stav.selectedOptions[0].textContent;
      if (!lbzPotvrd("Zmeniť stav objednávky " + O.cislo + " na „" + nazov + "“?")) return;
      rpc("obj_stav", { p_cislo: O.cislo, p_kod: kod }).then(function (r) {
        if (!r || r.ok === false) { sprava("chyba", (r && r.text) || "Nezmenené"); return; }
        sprava("ok", r.text); odoslatZmeny(true);
      }).catch(function (x) { sprava("chyba", chyba(x)); });
      return;
    }
    if (f.id === "o-form") {
      e.preventDefault(); citajFormular(f);
      var F = formular(), nova = f.dataset.nova === "1";
      var p = { meno: F.meno, firma: F.firma, telefon: F.telefon, email: F.email, ulica: F.ulica, psc: F.psc, mesto: F.mesto, poznamka: F.poznamka,
        doprava_kod: F.doprava_kod, platba_kod: F.platba_kod,
        polozky: F.polozky.map(function (x) { return { kod: x.kod, nazov: x.nazov, mnozstvo: +x.mnozstvo || 0, cena: x.cena === "" || x.cena == null ? null : +x.cena }; }) };
      O.prace = true; kresli();
      (nova ? rpc("obj_nova", { p: p }) : rpc("obj_uprav", { p_cislo: O.cislo, p: p })).then(function (r) {
        O.prace = false;
        if (!r || r.ok === false) { sprava("chyba", (r && r.text) || "Neuložené"); return; }
        O.sprava = { typ: "ok", text: r.text };
        if (nova) { O.nova = null; O.cislo = r.cislo; } else O.uprava = null;
        odoslatZmeny(true);
      }).catch(function (x) { O.prace = false; sprava("chyba", chyba(x)); });
    }
  }

  // ---------- karta Osobné odbery (Prehľad) ----------
  function kartaOdbery() {
    if (!DB) return "";
    if (O.odbery === null) {
      O.odbery = false;
      rpc("osobne_odbery").then(function (d) { O.odbery = d && d.ok ? d.odbery : []; window.dispatchEvent(new Event("lbz-prekresli")); }).catch(function () { O.odbery = []; });
    }
    var z = O.odbery || []; if (!z.length) return "";
    return '<section class="card o-odbery"><h3>🛍️ Osobné odbery <span class="pill num">' + z.length + "</span></h3><div class=\"rows\">" + z.map(function (o) {
      return '<div class="row o-odber"><span><b>' + esc(o.meno || "") + "</b> · " + esc(o.cislo) + "<br>" +
        '<span class="muted">' + esc((o.polozky || []).map(function (p) { return p.ks + "× " + p.nazov; }).join(", ")) + "</span>" +
        (o.poznamka ? '<br><span class="muted">„' + esc(o.poznamka) + "“</span>" : "") + "</span>" +
        '<span class="num">' + esc(eur(o.suma)) + "<br>" + esc(o.platba || "") + (o.telefon ? '<br><a href="tel:' + esc(o.telefon) + '">📞</a>' : "") + "</span></div>";
    }).join("") + "</div></section>";
  }

  window.LBZ_OBJEDNAVKY = {
    nastavDb: function (klient, rola) { DB = klient || null; ROLA = klient ? rola : null; O.zoznam = null; O.detail = null; O.cislo = null; O.odbery = null; O.produkty = null; O.cis = null; },
    mozem: function () { return !!DB && ["it", "ceo", "zakaznicky_servis"].indexOf(ROLA) > -1; },
    mozemOdbery: function () { return !!DB && ROLA !== "zakaznik"; },
    mount: function (el) {
      koren = el;
      el.addEventListener("click", klik); el.addEventListener("submit", odoslanie); el.addEventListener("change", zmena);
      el.addEventListener("toggle", function (e) { if (e.target.classList && e.target.classList.contains("o-viac")) O.viac = e.target.open; }, true);
      el.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.matches && e.target.matches("tr[data-o-cislo]")) otvor(e.target.dataset.oCislo); });
      if (!O.zoznam) nacitaj(); else kresli();
    },
    kartaOdbery: kartaOdbery,
    obnovOdbery: function () { O.odbery = null; }
  };
})();
