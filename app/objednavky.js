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
    var pf = Object.assign({}, O.filter, { limit: O.limit || 300 });
    rpc("obj_zoznam", { p: pf }).then(function (d) {
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
  var TYP_DOKLADU = { invoice: "Faktúra", creditNote: "Dobropis", receipt: "Účtenka", proforma: "Zálohová faktúra" };
  function datum(s) { if (!s) return ""; var d = new Date(String(s).length === 10 ? s + "T12:00:00" : s); return isNaN(d) ? String(s) : d.toLocaleDateString("sk-SK"); }
  // PDF faktúry / dobropisu z Upgates – zobrazí sa priamo v appke
  function otvorPdf(cislo, tl) {
    var cfg = window.LBZ_CONFIG || {};
    var data = DB.auth.getSession().then(function (r) {
      var tok = r && r.data && r.data.session && r.data.session.access_token;
      return fetch(cfg.supabaseUrl + "/functions/v1/upgates-sync", { method: "POST",
        headers: { "Content-Type": "application/json", apikey: cfg.supabaseAnonKey, Authorization: "Bearer " + (tok || cfg.supabaseAnonKey) },
        body: JSON.stringify({ akcia: "pdf", cislo: cislo }) });
    }).then(function (odp) {
      if (!odp.ok || (odp.headers.get("Content-Type") || "").indexOf("pdf") < 0) throw new Error("PDF " + cislo + " sa nepodarilo načítať z Upgates");
      return odp.blob();
    });
    if (window.lbzPdf) { window.lbzPdf(cislo, data); return; }
    data.then(function (b) { var u = URL.createObjectURL(b); var a = document.createElement("a"); a.href = u; a.download = cislo + ".pdf"; document.body.appendChild(a); a.click(); a.remove(); })
      .catch(function (e) { sprava("chyba", chyba(e)); });
  }
  function zoznamHtml() {
    var Z = O.zoznam || {}, obj = Z.objednavky || [];
    var stavy = (Z.stavy || []).slice().sort();
    function vyber(meno, prazdne, zoz) { return '<select name="' + meno + '" class="r-select"><option value="">' + prazdne + "</option>" + (zoz || []).slice().sort().map(function (s) { return '<option' + (s === O.filter[meno] ? " selected" : "") + ">" + esc(s) + "</option>"; }).join("") + "</select>"; }
    var h = '<div class="head"><div><h2>Objednávky</h2><div class="sub">' + (Z.ok ? rezimPill(Z.ostry) : "") + (O.prace ? " · načítavam…" : "") + "</div></div>" +
      '<span class="head-tl"><button class="btn btn-primary" data-o="nova">+ Nová objednávka</button></span></div>' + spravaHtml();
    var pocty = Z.pocty || {}, farby = Z.farby || {};
    var poradie = Object.keys(pocty).sort(function (a, b) { return (pocty[b] - pocty[a]) || a.localeCompare(b, "sk"); });
    h += '<div class="o-taby" role="tablist"><button class="o-tab' + (!O.filter.stav ? " on" : "") + '" data-o-stav="">Všetko <span class="o-bub">' + (Z.spolu || 0) + "</span></button>" +
      poradie.map(function (s) {
        return '<button class="o-tab' + (s === O.filter.stav ? " on" : "") + '" data-o-stav="' + esc(s) + '" style="--st:' + esc(farbaStavu(s, farby)) + '">' + esc(s) + ' <span class="o-bub">' + pocty[s] + "</span></button>";
      }).join("") + "</div>";
    var F = O.filter, aktivne = !!(F.doprava || F.platba || F.osobny || F.doklad || F.zaplatene || F.od || F.do || F.suma_od || F.suma_do || F.produkt || F.miesto || F.zdroj);
    function vol(meno, moznosti) { return '<select name="' + meno + '" class="r-select">' + moznosti.map(function (m) { return '<option value="' + esc(m[0]) + '"' + ((F[meno] || "") === m[0] ? " selected" : "") + ">" + esc(m[1]) + "</option>"; }).join("") + "</select>"; }
    function pole(meno, typ, ph) { return '<label class="o-pole"><span>' + esc(ph) + '</span><input name="' + meno + '" type="' + typ + '"' + (typ === "number" ? ' step="0.01" inputmode="decimal"' : "") + ' value="' + esc(F[meno] || "") + '"></label>'; }
    h += '<section class="card o-filtre"><form id="o-hladaj"><div class="o-hl"><input name="hladaj" type="search" placeholder="Hľadať: meno, telefón, e-mail, číslo" value="' + esc(O.filter.hladaj) + '">' +
      '<button class="btn" type="submit">Hľadať</button></div>' +
      '<input type="hidden" name="stav" value="' + esc(O.filter.stav) + '">' +
      '<details class="o-viac"' + (aktivne || O.viac ? " open" : "") + '><summary>Filtre' + (aktivne ? " (zapnuté)" : "") + " a akcie</summary>" +
      '<div class="o-riadok">' + vyber("doprava", "Všetky dopravy", Z.dopravy) + vyber("platba", "Všetky platby", Z.platby) +
      vol("doklad", [["", "Všetky doklady"], ["faktura", "S faktúrou"], ["bez_faktury", "Bez faktúry"], ["dobropis", "S dobropisom"]]) +
      vol("zaplatene", [["", "Zaplatené aj nezaplatené"], ["ano", "Zaplatené"], ["nie", "Nezaplatené"]]) +
      vol("zdroj", [["", "Všetky zdroje"], ["upgates", "E-shop / Upgates"], ["appka", "Založené v appke"]]) +
      '<label class="f-check"><input type="checkbox" name="osobny"' + (O.filter.osobny ? " checked" : "") + "> len osobný odber</label></div>" +
      '<div class="o-riadok o-polia">' + pole("od", "date", "Vytvorené od") + pole("do", "date", "do") + pole("suma_od", "number", "Cena od €") + pole("suma_do", "number", "do €") +
      pole("produkt", "search", "Produkt (názov/kód)") + pole("miesto", "search", "Mesto alebo PSČ") + "</div>" +
      '<div class="o-riadok"><button class="btn btn-primary r-mini" type="submit">Použiť filtre</button>' + (aktivne ? '<button class="btn r-mini" type="button" data-o="zrus-filtre">✕ Zrušiť filtre</button>' : "") + "</div>" +
      '<div class="o-riadok o-akcie"><button class="btn r-mini" type="button" data-o="obnovit">🔄 Stiahnuť z Upgates</button>' +
      (Z.caka ? '<button class="btn r-mini" type="button" data-o="odoslat">⬆️ Odoslať zmeny do Upgates (' + Z.caka + ")</button>" : "") +
      '<button class="btn r-mini" type="button" data-o="ciselniky">Načítať stavy, dopravy a platby</button>' +
      (vedenie() && Z.ok ? '<button class="btn r-mini" type="button" data-o="rezim">' + (Z.ostry ? "Prepnúť na TEST" : "Zapnúť ostrý zápis") + "</button>" : "") + "</div></details></form></section>";
    if (!Z.ok) return h + '<div class="empty"><strong>' + esc(Z.text || "Načítavam…") + "</strong></div>";
    if (!obj.length) return h + '<div class="empty"><strong>Žiadne objednávky</strong></div>';
    h += '<section class="card o-tab-karta"><div class="o-tabulka-obal"><table class="o-tabulka"><thead><tr><th>Číslo obj.</th><th>Stav objednávky</th><th>Doprava, platba</th><th>Zákazník / e-mail</th><th>Vytvorená</th><th class="num">Cena</th><th>Faktúra</th></tr></thead><tbody>' +
      obj.map(function (o) {
        var stitky = (o.osobny ? '<span class="pill">osobný odber</span> ' : "") + (o.caka ? '<span class="pill warn">čaká na Upgates</span> ' : "") + (o.furmanka ? '<span class="pill">' + esc(o.furmanka) + "</span>" : "");
        return '<tr data-o-cislo="' + esc(o.cislo) + '" tabindex="0"' + (OTVORENE.test(o.status || "") ? ' class="o-nova"' : "") + ">" +
          '<td class="o-c"><span class="o-cislo">' + esc(o.cislo) + '</span> <span class="o-bub">' + (o.poloziek || 0) + "</span>" + (o.poznamka ? '<span class="o-bodka" title="Poznámka zákazníka"></span>' : "") + (o.zdroj === "appka" ? '<div class="o-zdroj">z appky</div>' : "") + "</td>" +
          '<td class="o-st" style="--st:' + esc(farbaStavu(o.status, farby)) + '">' + esc(o.status || "–") + "</td>" +
          '<td class="o-dop">' + dopravaPill(o.doprava) + (o.platba_nazov || o.platba ? '<div class="o-plat">' + esc(o.platba_nazov || o.platba) + "</div>" : "") + "</td>" +
          '<td class="o-zak"><span class="o-link">' + esc(o.meno || "") + "</span>" + (o.email ? ' <span class="muted">' + esc(o.email) + "</span>" : "") +
            (o.poznamka ? '<div class="o-pozn">' + esc(o.poznamka) + "</div>" : "") + (stitky ? '<div class="o-stitky">' + stitky + "</div>" : "") + "</td>" +
          '<td class="o-dat">' + esc(dat(o.vytvorena)) + "</td>" +
          '<td class="num o-suma">' + esc(eur(o.suma)) + "</td>" +
          '<td class="o-dok">' + (o.faktura ? '<span class="o-fa">' + esc(o.faktura) + "</span>" + (o.zaplatena ? ' <span class="o-zapl" title="Zaplatená">✓</span>' : "") : '<span class="muted">–</span>') +
            (o.dobropis ? '<div class="o-db">↩ ' + esc(o.dobropis) + "</div>" : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
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
    var dok = (D.doklady || []).filter(function (d) { return d.typ === "invoice" || d.typ === "creditNote"; });
    h += '<section class="card"><h3>Doklady</h3>' + (dok.length ? '<div class="rows">' + dok.map(function (d) {
      var info = [datum(d.vystavena)];
      if (d.typ === "invoice") info.push(d.zaplatene ? "zaplatená " + datum(d.zaplatena) : "nezaplatená" + (d.splatnost ? " (splatná " + datum(d.splatnost) + ")" : ""));
      else if (d.suvisiaci) info.push("k faktúre " + d.suvisiaci);
      return '<div class="row o-dok-r"><span><b>' + esc(TYP_DOKLADU[d.typ] || d.typ) + "</b> " + esc(d.cislo) + '<span class="muted"> · ' + esc(info.filter(Boolean).join(" · ")) + "</span></span>" +
        '<span class="num">' + esc(eur(d.suma)) + ' <button class="btn r-mini" type="button" data-o-pdf="' + esc(d.cislo) + '">PDF</button>' + "</span></div>";
    }).join("") + "</div>" : '<p class="muted" style="margin:0">' + (o.faktura ? "Faktúra " + esc(o.faktura) + " – detail sa načíta pri ďalšom stiahnutí z Upgates." : "Zatiaľ bez faktúry.") + "</p>")  + "</section>";
    if (!storno) {
      h += '<section class="card"><h3>Stav objednávky</h3>' + ((D.stavy || []).length ?
        '<form id="o-stav" class="o-riadok"><select name="stav">' + D.stavy.map(function (s) { return '<option value="' + esc(s.kod) + '"' + (s.nazov === o.status ? " selected" : "") + ">" + esc(s.nazov) + "</option>"; }).join("") +
        '</select><button class="btn btn-primary" type="submit">Zmeniť stav</button></form>' +
        '<p class="muted r-mala">Pri zmene stavu Upgates pošle zákazníkovi e-mail, ak ho má stav nastavený. Pri <b>Storno</b> appka najprv ponúkne vystaviť dobropis v Upgates.</p>'
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
    if (d.oPdf) { otvorPdf(d.oPdf, t); return; }
    if (d.oStav !== undefined) { O.filter.stav = d.oStav; O.limit = 300; nacitaj(); return; }
    if (d.oCislo) { otvor(d.oCislo); return; }
    if (d.oZmaz != null) { var fz = koren.querySelector("#o-form"); citajFormular(fz); formular().polozky.splice(+d.oZmaz, 1); kresli(); return; }
    switch (d.o) {
      case "zrus-filtre": O.filter = { hladaj: O.filter.hladaj, stav: O.filter.stav, doprava: "", platba: "", osobny: false }; O.limit = 300; nacitaj(); return;
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
      ["doklad", "zaplatene", "od", "do", "suma_od", "suma_do", "produkt", "miesto", "zdroj"].forEach(function (k) { if (f.elements[k]) O.filter[k] = String(f.elements[k].value || "").trim(); });
      nacitaj(); return;
    }
    if (f.id === "o-stav") {
      e.preventDefault();
      var kod = f.elements.stav.value, nazov = f.elements.stav.selectedOptions[0].textContent, cis = O.cislo;
      var ob = (O.detail && O.detail.objednavka) || {}, maDob = !!ob.dobropis || (O.detail.doklady || []).some(function (d) { return d.typ === "creditNote"; });
      var zmen = function () {
        return rpc("obj_stav", { p_cislo: cis, p_kod: kod }).then(function (r) {
          if (!r || r.ok === false) { sprava("chyba", (r && r.text) || "Nezmenené"); return; }
          sprava("ok", r.text); odoslatZmeny(true);
        });
      };
      if (/storn/i.test(nazov) && ob.faktura && !maDob && ob.zdroj !== "appka") {
        if (!lbzPotvrd("K objednávke " + cis + " je faktúra " + ob.faktura + ".\n\nPred Storno treba vystaviť dobropis. Vystaviť dobropis v Upgates teraz a potom dať Storno?\n\n(Upgates potom zákazníkovi pošle e-mail so storno a dobropisom.)")) return;
        sprava("ok", "Vystavujem dobropis v Upgates…");
        fn("vystav_dobropis", { cislo: cis }).then(function (r) {
          if (!r || !r.ok) { sprava("chyba", (r && r.text) || "Dobropis sa nevystavil – Storno som nedal"); otvor(cis); return; }
          sprava("ok", r.text + " – dávam Storno…");
          return zmen();
        }).catch(function (x) { sprava("chyba", chyba(x)); });
        return;
      }
      if (!lbzPotvrd("Zmeniť stav objednávky " + cis + " na „" + nazov + "“?")) return;
      zmen().catch(function (x) { sprava("chyba", chyba(x)); });
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

  // ---------- karta Denný prehľad a štatistiky (Prehľad – CEO, IT, zákaznícky servis) ----------
  function percento(a, b) {
    if (!b) return a ? '<span class="st-perc st-hore">nové</span>' : "";
    var p = Math.round((a - b) / b * 100);
    return '<span class="st-perc ' + (p >= 0 ? "st-hore" : "st-dole") + '">' + (p >= 0 ? "▲ " : "▼ ") + Math.abs(p) + " %</span>";
  }
  function kartaStat() {
    if (!DB || ["it", "ceo", "zakaznicky_servis"].indexOf(ROLA) === -1) return "";
    if (!O.stat || (O.stat.cas && Date.now() - O.stat.cas > 300000 && !O.stat.nacitava)) {
      O.stat = { cas: Date.now(), nacitava: true, d: O.stat && O.stat.d };
      rpc("obj_statistiky").then(function (d) { O.stat = { cas: Date.now(), d: d && d.ok ? d : null }; window.dispatchEvent(new Event("lbz-prekresli")); })
        .catch(function () { O.stat = { cas: Date.now(), d: null }; });
    }
    var d = O.stat.d;
    if (!d) return '<section class="card st-karta"><h3>📊 Denný prehľad</h3><p class="muted" style="margin:0">' + (O.stat.nacitava ? "Načítavam…" : "Nenačítané") + "</p></section>";
    var ob = d.obdobia || {}, dnes = ob["1"] || {}, t = d.tyzden_spat || {};
    var dni = d.dni || [], max = Math.max.apply(null, dni.map(function (x) { return Number(x.trzba) || 0; }).concat([1]));
    var graf = '<div class="st-graf" role="img" aria-label="Tržby za 14 dní">' + dni.map(function (x) {
      var h = Math.round((Number(x.trzba) || 0) / max * 100), dt = new Date(x.d + "T12:00:00");
      return '<span class="st-stlpec" title="' + esc(dt.toLocaleDateString("sk-SK") + ": " + x.pocet + " obj. · " + eur(x.trzba)) + '"><i style="height:' + Math.max(h, 2) + '%"></i><small>' + dt.getDate() + "</small></span>";
    }).join("") + "</div>";
    var obd = function (k, nazov) {
      var x = ob[k] || {};
      return '<div class="st-obd"><span class="muted">' + nazov + '</span><b class="num">' + esc(eur(x.trzba || 0)) + "</b>" +
        '<span class="num muted">' + (x.pocet || 0) + " obj." + (x.pocet ? " · ⌀ " + esc(eur((x.trzba || 0) / x.pocet)) : "") + "</span>" + (k !== "365" ? percento(Number(x.trzba) || 0, Number(x.trzba_pred) || 0) : "") + "</div>";
    };
    var tab = function (nadpis, zoz, ks) {
      if (!zoz || !zoz.length) return "";
      return "<h4>" + nadpis + '</h4><div class="rows">' + zoz.slice(0, 12).map(function (x) {
        return '<div class="row"><span>' + esc(x.nazov) + '</span><span class="num">' + (ks ? cisloSk(x.ks) + " ks" : x.pocet + " obj.") + " · " + esc(eur(x.trzba)) + "</span></div>";
      }).join("") + "</div>";
    };
    var viac = d.produkty ? '<details class="st-viac"><summary>📈 Štatistiky (30 dní)</summary>' +
      tab("Najpredávanejšie produkty", d.produkty, true) + tab("Doprava", d.doprava) + tab("Platba", d.platba) + tab("Rozvozy (regióny)", d.regiony) +
      (d.mesiace && d.mesiace.length ? '<h4>Po mesiacoch</h4><div class="rows">' + d.mesiace.slice().reverse().map(function (m) {
        return '<div class="row"><span>' + esc(m.m.slice(5) + "/" + m.m.slice(0, 4)) + '</span><span class="num">' + m.pocet + " obj. · " + esc(eur(m.trzba)) + "</span></div>";
      }).join("") + "</div>" : "") + "</details>" : "";
    return '<section class="card st-karta"><h3>📊 Denný prehľad</h3>' +
      '<div class="st-dnes"><div><span class="muted">Dnes objednávky</span><b class="num">' + (dnes.pocet || 0) + "</b>" + percento(dnes.pocet || 0, t.pocet || 0) + "</div>" +
      '<div><span class="muted">Dnes tržba</span><b class="num">' + esc(eur(dnes.trzba || 0)) + "</b>" + percento(Number(dnes.trzba) || 0, Number(t.trzba) || 0) + "</div></div>" +
      '<p class="muted st-pozn">% oproti rovnakému dňu minulý týždeň · bez storien</p>' + graf +
      '<div class="st-obdobia">' + obd("7", "7 dní") + obd("30", "30 dní") + obd("365", "365 dní") + "</div>" + viac +
      '<button class="btn" data-mod="objednavky">Otvoriť objednávky</button></section>';
  }
  function cisloSk(x) { return Number(x || 0).toLocaleString("sk-SK", { maximumFractionDigits: 1 }); }

  window.LBZ_OBJEDNAVKY = {
    nastavDb: function (klient, rola) { DB = klient || null; ROLA = klient ? rola : null; O.zoznam = null; O.detail = null; O.cislo = null; O.odbery = null; O.produkty = null; O.cis = null; O.stat = null; },
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
    kartaStat: kartaStat,
    obnovOdbery: function () { O.odbery = null; }
  };
})();
