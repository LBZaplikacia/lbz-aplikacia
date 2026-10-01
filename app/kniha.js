// LBZ aplikácia – modul Kniha jázd (IT, CEO, prevádzkár, majiteľka areálu – všetci vidia všetky jazdy)
// Zápis ako stará web appka: stav tachometra → najazdené → polovica tam, polovica späť („návrat na prevádzku“).
// Návrh miesta podľa histórie (priemerné km jednej cesty) a podľa zoznamu miest; mesiac s počiatočným stavom, súčtami, úpravou, tlačou a CSV.

(function () {
  "use strict";

  var DB = null, ROLA = null, koren = null;
  var K = { stav: null, zalozka: "nova", mesiac: null, data: null, sprava: null, dialog: null, form: { navrat: true, ucel: "" }, prace: false };
  var ZNAME = [
    ["Pohronská Polhora", 6], ["Michalová", 9], ["Tisovec", 12], ["Brezno", 16], ["Valaská", 21], ["Podbrezová", 26], ["Hnúšťa", 26],
    ["Rimavská Sobota", 50], ["Banská Bystrica", 59], ["Lučenec", 75], ["Zvolen", 78], ["Liptovský Mikuláš", 80], ["Poprad", 90],
    ["Ružomberok", 110], ["Košice", 165], ["Nitra", 170], ["Trnava", 215], ["Bratislava", 265]
  ];
  var IKONY_UCEL = { "obchodné stretnutie": "🤝", "nákup tovaru": "🛒", "rozvoz objednávky": "🚚", "údržba": "🔧", "tankovanie": "⛽", "návšteva úradu": "🏛️", "propagácia LBZ": "📣" };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function rpc(n, a) { return DB.rpc(n, a || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function chybaText(e) { return (e && (e.message || e.text)) || "Bez spojenia so serverom"; }
  function cislo(v) { var n = parseFloat(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")); return isNaN(n) ? null : n; }
  function km(n, des) { return n == null || n === "" ? "" : Number(n).toLocaleString("sk-SK", { minimumFractionDigits: des || 0, maximumFractionDigits: 1 }); }
  function eur(n) { return n == null || n === "" ? "" : Number(n).toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
  function iso(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function prvyDen(d) { return iso(new Date(d.getFullYear(), d.getMonth(), 1)); }
  function mesiacNazov(s) { var p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString("sk-SK", { month: "long", year: "numeric" }); }
  function denSk(s) { var p = String(s).slice(0, 10).split("-"); return +p[2] + ". " + +p[1] + ". " + p[0]; }
  function denKratko(s) { var p = String(s).slice(0, 10).split("-"); return new Date(+p[0], +p[1] - 1, +p[2], 12).toLocaleDateString("sk-SK", { weekday: "short", day: "numeric", month: "numeric" }); }
  function kresli() { if (koren && koren.isConnected) prekresli(); window.dispatchEvent(new Event("lbz-prekresli")); }
  function archiv(d) { return String(d || "") < "2026-09-01"; } // jazdy do augusta 2026 = archív zo starej tabuľky (len na čítanie)
function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim(); }

  // ---------- načítanie ----------
  function nacitajStav() {
    if (!DB) return Promise.resolve();
    return rpc("jazdy_stav", { p_vozidlo: K.stav && K.stav.vozidlo_id || null }).then(function (d) {
      K.stav = d && d.ok ? d : { chyba: (d && d.text) || "Nenačítané" };
      if (!K.form.vodic) { var pv = window.lbzPamat && lbzPamat.nacitaj("kniha_vodic"); if (pv && (K.stav.vodici || []).indexOf(pv.meno) >= 0) K.form.vodic = pv.meno; }
      kresli();
    }).catch(function (e) { K.stav = { chyba: chybaText(e) }; kresli(); });
  }
  function nacitajMesiac() {
    if (!DB || !K.stav || !K.stav.vozidlo_id) return Promise.resolve();
    return rpc("jazdy_mesiac", { p_vozidlo: K.stav.vozidlo_id, p_mesiac: K.mesiac }).then(function (d) {
      K.data = d && d.ok ? d : { chyba: (d && d.text) || "Nenačítané" }; kresli();
    }).catch(function (e) { K.data = { chyba: chybaText(e) }; kresli(); });
  }
  function obnov() { return nacitajStav().then(function () { if (K.zalozka === "mesiac") return nacitajMesiac(); }); }

  // ---------- návrh miesta ----------
  function navrhy(jednaCesta) {
    if (!jednaCesta) return [];
    var hist = (K.stav && K.stav.miesta || []).map(function (m) { return { n: m.miesto, km: Number(m.km), p: m.pocet }; });
    var vsetky = hist.slice();
    ZNAME.forEach(function (z) { if (!vsetky.some(function (h) { return norm(h.n) === norm(z[0]); })) vsetky.push({ n: z[0], km: z[1], p: 0 }); });
    vsetky.forEach(function (x) { x.rozdiel = Math.abs(x.km - jednaCesta); });
    vsetky.sort(function (a, b) { return a.rozdiel - b.rozdiel || b.p - a.p; });
    return vsetky.filter(function (x) { return x.rozdiel <= Math.max(4, jednaCesta * 0.15); }).slice(0, 4);
  }

  // ---------- zobrazenie ----------
  function hlava() {
    var s = K.stav || {}, voz = (s.vozidla || []).filter(function (v) { return v.id === s.vozidlo_id; })[0];
    var z = K.zalozka;
    return '<div class="head"><div><h2>Kniha jázd</h2><div class="sub">' + esc(voz ? voz.nazov + (voz.spz ? " · " + voz.spz : "") : "") +
      (s.tach != null ? ' · tachometer <b class="num">' + km(s.tach) + " km</b>" : "") + "</div></div>" +
      ((s.vozidla || []).length > 1 ? '<select id="k-voz" class="k-voz">' + s.vozidla.map(function (v) { return '<option value="' + v.id + '"' + (v.id === s.vozidlo_id ? " selected" : "") + ">" + esc(v.nazov) + "</option>"; }).join("") + "</select>" : "") +
      "</div>" +
      '<div class="f-seg k-zalozky" role="group"><button data-k-zal="nova" aria-pressed="' + (z === "nova") + '">➕ Nová jazda</button>' +
      '<button data-k-zal="mesiac" aria-pressed="' + (z === "mesiac") + '">📅 Mesiac</button></div>' +
      (K.sprava ? '<p class="f-sprava f-' + K.sprava.typ + '">' + esc(K.sprava.text) + ' <button class="btn-link" data-k="zavri-spravu">✕</button></p>' : "");
  }

  function chybaFormu() {
    var f = K.form, s = K.stav || {}, t = cislo(f.tach), ok = t != null && s.tach != null && t > s.tach;
    return !f.vodic ? "Vyber šoféra" : !ok ? "Zadaj stav tachometra" : !f.miesto ? "Vyber alebo napíš, kam si išiel/išla" : !f.ucel ? "Vyber alebo napíš účel jazdy" : "";
  }
  function tankText(x) { return x.tankovanie || x.litre ? [x.tankovanie ? eur(x.tankovanie) : "", x.litre ? km(x.litre, 1) + " l" : "", x.palivo || ""].filter(Boolean).join(" · ") : ""; }
  function pohladNova() {
    var s = K.stav;
    if (!s) return '<div class="empty"><strong>Načítavam…</strong></div>';
    if (s.chyba) return '<div class="empty"><strong>' + esc(s.chyba) + "</strong></div>";
    var f = K.form, t = cislo(f.tach), naj = t != null && s.tach != null ? Math.round((t - s.tach) * 10) / 10 : null;
    var ok = naj != null && naj > 0, jedna = ok ? (f.navrat ? Math.round(naj * 5) / 10 : naj) : null;
    var nav = ok ? navrhy(jedna) : [];
    var ucely = s.ucely || [];
    var ine = (s.ucely_ine || []).filter(function (u) { return ucely.indexOf(u) === -1; });
    var vlastny = f.ucel && ucely.indexOf(f.ucel) === -1 && ine.indexOf(f.ucel) === -1 || f.ineUcel;
    return '<form class="k-nova" id="k-form" autocomplete="off">' +
      '<section class="k-krok"><div class="k-krok-hl"><span class="k-cislo">1</span>Šofér</div><div class="k-vodici">' +
      (s.vodici || []).map(function (v) { return '<button type="button" class="k-vodic" data-k-vodic="' + esc(v) + '" aria-pressed="' + (f.vodic === v) + '"><span class="k-avatar">' + esc(v.charAt(0)) + "</span>" + esc(v) + "</button>"; }).join("") + "</div></section>" +
      '<section class="k-krok"><div class="k-krok-hl"><span class="k-cislo">2</span>Tachometer<span class="k-tach-posl">posledný <b class="num">' + km(s.tach) + ' km</b></span></div>' +
      '<label class="field"><span class="label">Stav tachometra teraz</span>' +
      '<input id="k-tach" class="k-tach" inputmode="decimal" enterkeyhint="next" placeholder="napr. ' + esc(km(Math.ceil((s.tach || 0) + 50))) + '" value="' + esc(f.tach || "") + '"></label>' +
      '<div class="k-vysledok' + (t != null && !ok ? " k-zle" : "") + '" aria-live="polite">' +
      (ok ? '<b class="num">' + km(naj, 0) + " km</b>" + (f.navrat ? ' <span class="muted">→ ' + km(jedna) + " km tam + " + km(naj - jedna) + " km späť</span>" : "") :
        t != null ? "Musí byť viac ako " + km(s.tach) + " km" : '<span class="muted">Zadaj, čo ukazuje tachometer po návrate</span>') + "</div>" +
      '<label class="k-prepinac"><input type="checkbox" id="k-navrat"' + (f.navrat ? " checked" : "") + '> <span>Cesta tam aj späť (návrat na prevádzku ' + esc(((s.vozidla || [])[0] || {}).domov || "Zbojská") + ")</span></label></section>" +
      '<section class="k-krok"><div class="k-krok-hl"><span class="k-cislo">3</span>Kam</div><div class="field">' +
      (nav.length ? '<div class="chips k-navrhy">' + nav.map(function (x) {
        return '<button type="button" class="chip' + (norm(f.miesto) === norm(x.n) ? " k-vybrane" : "") + '" data-k-miesto="' + esc(x.n) + '">' + esc(x.n) + ' <span class="muted num">~' + km(x.km) + " km</span></button>";
      }).join("") + "</div>" : "") +
      '<input id="k-miesto" list="k-miesta" placeholder="mesto / firma" value="' + esc(f.miesto || "") + '">' +
      '<datalist id="k-miesta">' + (s.miesta || []).map(function (m) { return '<option value="' + esc(m.miesto) + '">'; }).join("") + "</datalist></div></section>" +
      '<section class="k-krok"><div class="k-krok-hl"><span class="k-cislo">4</span>Účel jazdy</div><div class="chips k-ucely">' + ucely.concat(ine).map(function (u) {
        return '<button type="button" class="chip" data-k-ucel="' + esc(u) + '" aria-pressed="' + (f.ucel === u && !f.ineUcel) + '">' + (IKONY_UCEL[u] || "") + " " + esc(u) + "</button>";
      }).join("") + '<button type="button" class="chip" data-k="ine-ucel" aria-pressed="' + !!vlastny + '">✏️ Iný…</button></div>' +
      (vlastny ? '<label class="field"><span class="label">Vlastný účel</span><input id="k-ucel-text" class="k-ucel-text" placeholder="napíš účel jazdy" maxlength="120" value="' + esc(f.ucel || "") + '"></label>' : "") + "</section>" +
      '<details class="k-viac k-krok"' + (f.tank || f.litre || (f.datum && f.datum !== s.dnes) || f.pozn ? " open" : "") + '><summary>⛽ Tankovanie · dátum · poznámka</summary>' +
      '<div class="d-riadok k-riadok3"><label class="field"><span class="label">Suma €</span><input id="k-tank" inputmode="decimal" value="' + esc(f.tank || "") + '"></label>' +
      '<label class="field"><span class="label">Litre</span><input id="k-litre" inputmode="decimal" value="' + esc(f.litre || "") + '"></label>' +
      '<label class="field"><span class="label">Palivo</span><select id="k-palivo"><option value=""></option>' + (s.paliva || []).map(function (p) { return "<option" + ((f.palivo || (f.tank || f.litre ? "Nafta" : "")) === p ? " selected" : "") + ">" + esc(p) + "</option>"; }).join("") + "</select></label></div>" +
      '<div class="d-riadok"><label class="field"><span class="label">Dátum</span><input id="k-datum" type="date" value="' + esc(f.datum || s.dnes || "") + '"></label>' +
      '<label class="field"><span class="label">Poznámka</span><input id="k-pozn" value="' + esc(f.pozn || "") + '"></label></div></details>' +
      '<button class="btn btn-primary k-ulozit" type="submit"' + (ok && f.vodic && f.miesto && f.ucel && !K.prace ? "" : " disabled") + ">" + (K.prace ? "Ukladám…" : "💾 Zapísať jazdu") + "</button>" +
      '<p class="muted k-chyba"' + (chybaFormu() ? "" : " hidden") + ">" + esc(chybaFormu()) + "</p>" +
      "</form>" +
      '<p class="muted k-mes">Tento mesiac zatiaľ <b class="num">' + km(s.km_mesiac) + " km</b>.</p>";
  }

  function riadkyMesiaca() {
    var d = K.data, r = (d.riadky || []).slice();
    if (!r.length || r[0].miesto !== "Počiatočný stav") {
      if (d.pociatok != null) r.unshift({ virt: true, datum: d.od, miesto: "Počiatočný stav", tach: d.pociatok });
    }
    // kontrola: najazdené = rozdiel tachometrov
    var pred = null;
    r.forEach(function (x) {
      if (pred != null && x.km != null && x.miesto !== "Počiatočný stav") x.nesedi = Math.abs(Number(x.tach) - pred - Number(x.km)) > 0.5 ? Math.round((Number(x.tach) - pred) * 10) / 10 : null;
      pred = Number(x.tach);
    });
    return r;
  }
  function pohladMesiac() {
    var d = K.data;
    if (!d) return '<div class="empty"><strong>Načítavam…</strong></div>';
    if (d.chyba) return '<div class="empty"><strong>' + esc(d.chyba) + "</strong></div>";
    var r = riadkyMesiaca(), spolu = 0, tank = 0, cesty = 0, podla = {}, chyby = 0;
    r.forEach(function (x) {
      if (x.miesto === "Počiatočný stav") return;
      spolu += Number(x.km || 0); tank += Number(x.tankovanie || 0);
      if (!x.navrat) { cesty++; var u = x.ucel || "iné"; podla[u] = (podla[u] || 0) + Number(x.km || 0) + Number((r.filter(function (y) { return y.id === x.par_id; })[0] || {}).km || 0); }
      if (x.nesedi != null) chyby++;
    });
    var max = Math.max.apply(null, Object.keys(podla).map(function (k) { return podla[k]; }).concat([1]));
    return '<div class="k-mes-hl"><button class="btn btn-ikona" data-k="mes-" aria-label="Predošlý mesiac">◀</button><b>' + esc(mesiacNazov(K.mesiac)) + '</b><button class="btn btn-ikona" data-k="mes+" aria-label="Ďalší mesiac">▶</button>' +
      '<span class="k-mes-tl"><button class="btn" data-k="tlac">🖨️ Tlač / PDF</button><button class="btn" data-k="csv">⬇ CSV</button></span></div>' +
      '<div class="k-suhrn"><div><span class="label">Najazdené</span><b class="num">' + km(spolu) + ' km</b></div><div><span class="label">Jázd</span><b class="num">' + cesty + '</b></div>' +
      '<div><span class="label">Tankovanie</span><b class="num">' + (tank ? eur(tank) : "–") + "</b></div>" +
      (chyby ? '<div class="k-suhrn-zle"><span class="label">Na kontrolu</span><b class="num">⚠ ' + chyby + "</b></div>" : "") + "</div>" +
      (Object.keys(podla).length ? '<div class="k-ucely-graf">' + Object.keys(podla).sort(function (a, b) { return podla[b] - podla[a]; }).map(function (u) {
        return '<div class="k-graf-r"><span>' + (IKONY_UCEL[u] || "•") + " " + esc(u) + '</span><span class="k-bar"><i style="width:' + Math.round(podla[u] / max * 100) + '%"></i></span><b class="num">' + km(podla[u]) + " km</b></div>";
      }).join("") + "</div>" : "") +
      (archiv(K.mesiac) ? '<p class="muted k-pozn">🔒 Archív zo starej tabuľky – len na čítanie.</p>' : "") +
(r.length ? zoznamMobil(r) : "") +
      (r.length ? '<div class="tbl-wrap k-len-pc"><table class="d-tab k-tab"><thead><tr><th>Dátum</th><th>Miesto</th><th class="t-r">Tachometer</th><th class="t-r">Najazdené</th><th>Vodič</th><th>Účel</th><th class="t-r">Tank.</th><th></th></tr></thead><tbody>' +
        r.map(function (x) {
          var poc = x.miesto === "Počiatočný stav";
          return '<tr class="' + (poc ? "k-poc" : x.navrat ? "k-navrat" : "") + '"><td>' + esc(denKratko(x.datum)) + "</td><td>" + esc(x.miesto) + (x.poznamka ? ' <span class="muted">· ' + esc(x.poznamka) + "</span>" : "") + "</td>" +
            '<td class="t-r num">' + km(x.tach, 0) + '</td><td class="t-r num">' + km(x.km) + (x.nesedi != null ? ' <span class="k-nesedi" title="Podľa tachometra ' + km(x.nesedi) + ' km">⚠</span>' : "") + "</td>" +
            "<td>" + esc(x.vodic || "") + "</td><td>" + esc(x.ucel || "") + '</td><td class="t-r num">' + esc(tankText(x)) + "</td>" +
            "<td>" + (x.virt ? "" : archiv(x.datum) ? '<span class="muted" title="Archív – len na čítanie">🔒</span>' : '<button class="btn-link" data-k-upr="' + x.id + '">Upraviť</button>') + "</td></tr>";
        }).join("") + "</tbody></table></div>" : '<div class="empty"><strong>V tomto mesiaci nie sú jazdy</strong></div>') +
      (chyby ? '<p class="muted k-pozn">⚠ = najazdené km nesedia s rozdielom tachometrov (napr. prehodené riadky alebo chýbajúci zápis). ' + (archiv(K.mesiac) ? "Staré záznamy sa ponechávajú tak, ako boli." : "Oprav cez „Upraviť“.") + '</p>' : "");
  }

  // mobil: cesta tam + návrat ako jedna karta
  function zoznamMobil(r) {
    var byId = {}; r.forEach(function (x) { if (x.id) byId[x.id] = x; });
    return '<div class="k-len-mob k-zoznam">' + r.filter(function (x) { return !x.navrat || !x.par_id || !byId[x.par_id]; }).map(function (x) {
      if (x.miesto === "Počiatočný stav") return '<div class="k-pol k-pol-poc"><span>' + esc(denKratko(x.datum)) + ' · Počiatočný stav</span><b class="num">' + km(x.tach, 0) + " km</b></div>";
      var sp = x.par_id && byId[x.par_id], spolu = Number(x.km || 0) + Number(sp ? sp.km || 0 : 0);
      var zle = x.nesedi != null || (sp && sp.nesedi != null);
      return '<div class="k-pol' + (zle ? " k-pol-zle" : "") + '"><div class="k-pol-hl"><b>' + esc(x.miesto) + '</b><b class="num">' + km(spolu) + " km</b></div>" +
        '<div class="k-pol-det muted">' + esc(denKratko(x.datum)) + " · " + (IKONY_UCEL[x.ucel] || "") + " " + esc(x.navrat ? "návrat" : x.ucel || "") +
        (sp ? " · tam " + km(x.km) + " / späť " + km(sp.km) : "") + " · tach. " + km(sp ? sp.tach : x.tach, 0) + (tankText(x) ? " · ⛽ " + esc(tankText(x)) : "") + (zle ? ' · <span class="k-nesedi">⚠ km nesedia</span>' : "") + "</div>" +
        (archiv(x.datum) ? '<div class="k-pol-tl muted">🔒 archív – len na čítanie</div></div>' : '<div class="k-pol-tl"><button class="btn-link" data-k-upr="' + x.id + '">Upraviť' + (sp ? " tam" : "") + "</button>" + (sp ? '<button class="btn-link" data-k-upr="' + sp.id + '">Upraviť späť</button>' : "") + "</div></div>");
    }).join("") + "</div>";
  }

  function dialogHtml() {
    var x = K.dialog; if (!x) return "";
    var ucely = (K.stav && K.stav.ucely || []).concat(["návrat na prevádzku"]);
    (K.stav && K.stav.ucely_ine || []).forEach(function (u) { if (ucely.indexOf(u) === -1) ucely.push(u); });
    if (x.ucel && ucely.indexOf(x.ucel) === -1) ucely.push(x.ucel);
    return '<div class="f-dialog-pozadie" data-k="zavri"></div><div class="f-dialog" role="dialog" aria-modal="true"><form class="f-form" id="k-upr-form"><h3>Upraviť jazdu</h3>' +
      '<div class="d-riadok"><label class="field"><span class="label">Dátum</span><input type="date" id="k-u-dat" value="' + esc(x.datum) + '" required></label>' +
      '<label class="field"><span class="label">Miesto</span><input id="k-u-miesto" value="' + esc(x.miesto) + '" required></label></div>' +
      '<div class="d-riadok"><label class="field"><span class="label">Tachometer</span><input id="k-u-tach" inputmode="decimal" value="' + esc(x.tach) + '" required></label>' +
      '<label class="field"><span class="label">Najazdené km</span><input id="k-u-km" inputmode="decimal" value="' + esc(x.km == null ? "" : x.km) + '"></label></div>' +
      '<div class="d-riadok"><label class="field"><span class="label">Účel</span><select id="k-u-ucel"><option value=""></option>' + ucely.map(function (u) { return "<option" + (x.ucel === u ? " selected" : "") + ">" + esc(u) + "</option>"; }).join("") + "</select></label>" +
      '<label class="field"><span class="label">Šofér</span><select id="k-u-vodic"><option value=""></option>' + (function () { var v = (K.stav && K.stav.vodici || []).slice(); if (x.vodic && v.indexOf(x.vodic) === -1) v.push(x.vodic); return v; })().map(function (v) { return "<option" + (x.vodic === v ? " selected" : "") + ">" + esc(v) + "</option>"; }).join("") + "</select></label></div>" +
      '<div class="d-riadok k-riadok3"><label class="field"><span class="label">Tankovanie €</span><input id="k-u-tank" inputmode="decimal" value="' + esc(x.tankovanie == null ? "" : x.tankovanie) + '"></label>' +
      '<label class="field"><span class="label">Litre</span><input id="k-u-litre" inputmode="decimal" value="' + esc(x.litre == null ? "" : x.litre) + '"></label>' +
      '<label class="field"><span class="label">Palivo</span><select id="k-u-palivo"><option value=""></option>' + (K.stav && K.stav.paliva || []).map(function (p) { return "<option" + (x.palivo === p ? " selected" : "") + ">" + esc(p) + "</option>"; }).join("") + "</select></label></div>" +
      '<div class="d-riadok">' +
      '<label class="field"><span class="label">Poznámka</span><input id="k-u-pozn" value="' + esc(x.poznamka || "") + '"></label></div>' +
      '<div class="f-akcie"><button class="btn btn-primary" type="submit">Uložiť</button><button class="btn" type="button" data-k="zavri">Zrušiť</button>' +
      '<button class="btn k-zmaz" type="button" data-k="zmaz">🗑 Zmazať riadok</button></div></form></div>';
  }

  function prekresli() {
    if (!koren) return;
    var fokus = document.activeElement && document.activeElement.id, poz = fokus && document.activeElement.selectionStart;
    koren.innerHTML = '<div class="k-modul">' + hlava() + (K.zalozka === "mesiac" ? pohladMesiac() : pohladNova()) + "</div>" + dialogHtml();
    if (fokus) { var e = document.getElementById(fokus); if (e) { e.focus(); try { if (poz != null && e.setSelectionRange) e.setSelectionRange(poz, poz); } catch (x) { /* */ } } }
  }

  // ---------- tlač a CSV ----------
  function tlac() {
    var d = K.data, r = riadkyMesiaca(), voz = d.vozidlo || {};
    var spolu = 0, tank = 0;
    r.forEach(function (x) { if (x.miesto !== "Počiatočný stav") { spolu += Number(x.km || 0); tank += Number(x.tankovanie || 0); } });
    var html = '<div class="k-tlac"><h2>Kniha jázd – ' + esc(voz.nazov || "") + (voz.spz ? " (" + esc(voz.spz) + ")" : "") + "</h2><p>" + esc(mesiacNazov(K.mesiac)) + "</p>" +
      '<table><thead><tr><th>DÁTUM</th><th>MIESTO</th><th>STAV TACHOMETRA</th><th>NAJAZDENÉ</th><th>MENO</th><th>ÚČEL JAZDY</th><th>Tankovanie €</th><th>Litre</th></tr></thead><tbody>' +
      r.map(function (x) {
        return "<tr><td>" + esc(denSk(x.datum)) + "</td><td>" + esc(x.miesto) + '</td><td class="t-r">' + km(x.tach, 0) + '</td><td class="t-r">' + km(x.km) + "</td><td>" + esc(x.vodic || "") + "</td><td>" + esc(x.ucel || "") + '</td><td class="t-r">' + (x.tankovanie ? km(x.tankovanie, 2) : "") + '</td><td class="t-r">' + (x.litre ? km(x.litre, 1) + (x.palivo ? " " + esc(x.palivo) : "") : "") + "</td></tr>";
      }).join("") + '</tbody><tfoot><tr><td colspan="3">Spolu</td><td class="t-r">' + km(spolu) + ' km</td><td colspan="2"></td><td class="t-r">' + (tank ? km(tank, 2) : "") + "</td><td></td></tr></tfoot></table></div>";
    var obal = document.getElementById("tlac-oblast");
    if (!obal) { obal = document.createElement("div"); obal.id = "tlac-oblast"; document.body.appendChild(obal); }
    obal.innerHTML = html; document.body.classList.add("tlaci");
    var hotovo = function () { document.body.classList.remove("tlaci"); obal.innerHTML = ""; window.removeEventListener("afterprint", hotovo); };
    window.addEventListener("afterprint", hotovo);
    setTimeout(function () { window.print(); setTimeout(hotovo, 1500); }, 80);
  }
  function csv() {
    var r = riadkyMesiaca(), q = function (s) { return '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"'; };
    var t = "﻿" + ["Dátum", "Miesto", "Stav tachometra", "Najazdené", "Meno", "Účel jazdy", "Tankovanie €", "Litre", "Palivo"].map(q).join(";") + "\n" +
      r.map(function (x) { return [denSk(x.datum), x.miesto, String(x.tach).replace(".", ","), x.km == null ? "" : String(x.km).replace(".", ","), x.vodic, x.ucel, x.tankovanie == null ? "" : String(x.tankovanie).replace(".", ","), x.litre == null ? "" : String(x.litre).replace(".", ","), x.palivo || ""].map(q).join(";"); }).join("\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([t], { type: "text/csv;charset=utf-8" }));
    a.download = "Kniha_jazd_" + String(K.mesiac).slice(0, 7) + ".csv";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- udalosti ----------
  function citajForm() {
    var g = function (id) { var e = document.getElementById(id); return e ? e.value : undefined; };
    var f = K.form;
    ["tach", "miesto", "tank", "litre", "palivo", "datum", "pozn"].forEach(function (k) { var v = g("k-" + k); if (v !== undefined) f[k] = v; });
    var ut = g("k-ucel-text"); if (ut !== undefined) f.ucel = ut.trim();
    var n = document.getElementById("k-navrat"); if (n) f.navrat = n.checked;
  }
  function klik(e) {
    var t = e.target.closest("button, [data-k]"); if (!t || !koren.contains(t)) return;
    if (t.dataset.kZal) { K.zalozka = t.dataset.kZal; if (window.lbzPamat) lbzPamat.uloz("kniha", { zalozka: K.zalozka }); K.sprava = null; if (K.zalozka === "mesiac") { K.data = null; nacitajMesiac(); } prekresli(); return; }
    if (t.dataset.kMiesto) { citajForm(); K.form.miesto = t.dataset.kMiesto; prekresli(); return; }
    if (t.dataset.kUcel) { citajForm(); K.form.ineUcel = false; K.form.ucel = K.form.ucel === t.dataset.kUcel ? "" : t.dataset.kUcel; prekresli(); return; }
    if (t.dataset.kVodic) { citajForm(); K.form.vodic = t.dataset.kVodic; if (window.lbzPamat) lbzPamat.uloz("kniha_vodic", { meno: K.form.vodic }); prekresli(); return; }
    if (t.dataset.kUpr) { var x = (K.data.riadky || []).filter(function (y) { return String(y.id) === t.dataset.kUpr; })[0]; if (x) { K.dialog = Object.assign({}, x); prekresli(); } return; }
    var a = t.dataset.k;
    if (a === "zavri-spravu") { K.sprava = null; prekresli(); }
    else if (a === "zavri") { K.dialog = null; prekresli(); }
    else if (a === "ine-ucel") { citajForm(); K.form.ineUcel = true; K.form.ucel = ""; prekresli(); var ie = document.getElementById("k-ucel-text"); if (ie) ie.focus(); }
    else if (a === "mes-" || a === "mes+") { var p = K.mesiac.split("-"); K.mesiac = prvyDen(new Date(+p[0], +p[1] - 1 + (a === "mes+" ? 1 : -1), 1)); K.data = null; prekresli(); nacitajMesiac(); }
    else if (a === "tlac") tlac();
    else if (a === "csv") csv();
    else if (a === "zmaz") {
      if (!lbzPotvrd("Naozaj zmazať tento riadok z knihy jázd? (Pri ceste tam/späť sa zmaže len tento riadok.)")) return;
      rpc("jazdy_uprav", { p: { id: K.dialog.id, zmaz: true } }).then(function (r) { K.dialog = null; K.sprava = { typ: r.ok ? "ok" : "chyba", text: r.text }; obnov(); })
        .catch(function (x) { lbzInfo(chybaText(x)); });
    }
  }
  function stavTlacidla() {
    var b = koren.querySelector(".k-ulozit"), f = K.form, s = K.stav, t = cislo(f.tach), ok = t != null && s && s.tach != null && t > s.tach;
    if (b) b.disabled = !(ok && f.vodic && f.miesto && f.ucel && !K.prace);
    var h = koren.querySelector(".k-chyba");
    var txt = chybaFormu();
    if (h) { h.textContent = txt; h.hidden = !txt; }
    koren.querySelectorAll("[data-k-miesto]").forEach(function (c) { c.classList.toggle("k-vybrane", norm(c.dataset.kMiesto) === norm(f.miesto)); });
  }
  function vstup(e) {
    var id = e.target.id;
    if (id === "k-tach") { citajForm(); prekresli(); }
    else if (id === "k-miesto" || id === "k-ucel-text") { citajForm(); stavTlacidla(); }
  }
  function zmena(e) {
    if (e.target.id === "k-voz") { K.stav.vozidlo_id = +e.target.value; K.form = { navrat: true, ucel: "" }; obnov(); }
    else if (e.target.id === "k-navrat") { citajForm(); prekresli(); }
  }
  function odoslanie(e) {
    if (e.target.id === "k-form") {
      e.preventDefault(); citajForm();
      var f = K.form; if (K.prace) return;
      K.prace = true; prekresli();
      rpc("jazdy_zapis", { p: { vozidlo_id: K.stav.vozidlo_id, tach: cislo(f.tach), miesto: f.miesto, ucel: f.ucel, navrat: f.navrat, tankovanie: cislo(f.tank), litre: cislo(f.litre), palivo: (f.tank || f.litre) ? f.palivo || null : null, datum: f.datum || null, vodic: f.vodic || null, poznamka: f.pozn || null } })
        .then(function (r) {
          K.prace = false;
          if (r && r.ok) { K.sprava = { typ: "ok", text: "✅ " + r.text }; var vod = f.vodic; K.form = { navrat: true, ucel: "", vodic: vod }; }
          else K.sprava = { typ: "chyba", text: (r && r.text) || "Nepodarilo sa uložiť" };
          obnov();
        }).catch(function (x) { K.prace = false; K.sprava = { typ: "chyba", text: chybaText(x) }; prekresli(); });
    } else if (e.target.id === "k-upr-form") {
      e.preventDefault();
      var g = function (id) { return document.getElementById(id).value; };
      rpc("jazdy_uprav", { p: { id: K.dialog.id, datum: g("k-u-dat"), miesto: g("k-u-miesto"), tach: cislo(g("k-u-tach")), km: cislo(g("k-u-km")), ucel: g("k-u-ucel"), tankovanie: cislo(g("k-u-tank")), litre: cislo(g("k-u-litre")), palivo: g("k-u-palivo"), vodic: g("k-u-vodic"), poznamka: g("k-u-pozn") } })
        .then(function (r) { if (r && r.ok) K.dialog = null; K.sprava = { typ: r && r.ok ? "ok" : "chyba", text: (r && r.text) || "Chyba" }; obnov(); })
        .catch(function (x) { lbzInfo(chybaText(x)); });
    }
  }

  // karta na Prehľade
  function kartaHtml() {
    var s = K.stav;
    if (!s || s.chyba) return "";
    return '<section class="card k-karta"><h3>🚗 Kniha jázd <span class="pill info num">' + km(s.km_mesiac) + ' km tento mesiac</span></h3>' +
      '<div class="muted">Tachometer <b class="num">' + km(s.tach) + ' km</b></div>' +
      '<button class="btn btn-primary" data-mod="kniha_jazd">➕ Zapísať jazdu</button></section>';
  }

  window.LBZ_KNIHA = {
    nastavDb: function (klient, rola) { DB = klient || null; ROLA = klient ? rola : null; K.stav = null; K.data = null; if (DB && this.mozem()) nacitajStav(); },
    mozem: function () { return !!DB && ["it", "ceo", "prevadzkar", "majitelka_arealu"].indexOf(ROLA) >= 0; },
    mount: function (el) {
      koren = el;
      el.addEventListener("click", klik); el.addEventListener("input", vstup); el.addEventListener("change", zmena); el.addEventListener("submit", odoslanie);
      if (!K.mesiac) K.mesiac = prvyDen(new Date());
      var pam = window.lbzPamat && lbzPamat.nacitaj("kniha"); if (pam && pam.zalozka) K.zalozka = pam.zalozka;
      prekresli(); obnov();
    },
    karta: function () { return kartaHtml(); },
    zalozka: function () { return K.zalozka; }
  };
})();
