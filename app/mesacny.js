// LBZ aplikácia – ✍️ Na podpis: mesačný list za uplynulý mesiac (s68)
// Jeden dokument = jeden podpis za mesiac: dochádzka, vyúčtovanie stravného (záloha vs. skutočnosť), záloha stravného
// na ďalší mesiac podľa rozpisu (dĺžka smeny − 30 min prestávka × sadzba miesta), k vyplateniu s výplatou, ostatné dokumenty.
// Podpisuje sa do 15. dňa nasledujúceho mesiaca. Zamestnávateľ (CEO/IT) podpisuje hromadne jedným podpisom.
(function () {
  "use strict";

  var DB = null, ROLA = null;
  var S = { el: null, citatel: false, pohlad: null, mesiac: null, osoba: null, moja: undefined, list: null, prehlad: null,
            nacitavam: false, sprava: null, vyber: {}, bezi: null, detail: false, karta: null };
  var MESIACE = ["január", "február", "marec", "apríl", "máj", "jún", "júl", "august", "september", "október", "november", "december"];
  var MIESTO_NAZOV = { "ZBOJSKÁ": "Zbojská", "ROZVOZ": "Rozvoz", "OBCHOD": "Služobka", "SLUŽOBKA": "Služobka", "BUCHTOMOBIL": "Buchťáč", "ADMINISTRATÍVA": "Administratíva" };
  var TYP_DOK = { cp: "Cestovný príkaz", dochadzka: "Výkaz dochádzky", absencia: "Dovolenkový lístok / žiadosť", hotovost: "Prevzatie hotovosti" };
  var ZAMESTNAVATEL = "V sedle u Falťanov s.r.o., Mládežnícka 3427/9, 974 04 Banská Bystrica, IČO 47206934";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function prvy(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function predosly() { var d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
  function aktualny() { return ymd(prvy(new Date())); }
  function koniecRoka() { var d = new Date(); return d.getMonth() === 11 || (d.getMonth() === 10 && d.getDate() >= 15); }
  function posun(m, o) { var p = String(m).split("-"); return ymd(new Date(+p[0], +p[1] - 1 + o, 1)); }
  function mNazov(m) { var p = String(m || "").split("-"); return p.length > 1 ? MESIACE[+p[1] - 1] + " " + p[0] : ""; }
  function datum(s) { if (!s) return ""; var p = String(s).slice(0, 10).split("-"); return +p[2] + ". " + +p[1] + ". " + p[0]; }
  function datumK(s) { var p = String(s).slice(0, 10).split("-"); return +p[2] + ". " + +p[1] + "."; }
  function den(s) { var d = new Date(String(s).slice(0, 10) + "T12:00:00"); return ["ne", "po", "ut", "st", "št", "pi", "so"][d.getDay()]; }
  function cas(s) { if (!s) return ""; var d = new Date(s); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function kedy(s) { if (!s) return ""; var d = new Date(s); return d.getDate() + ". " + (d.getMonth() + 1) + ". " + cas(s); }
  function eur(x) { var n = Math.round(Number(x || 0) * 100) / 100; return n.toFixed(2).replace(".", ",") + " €"; }
  function eurZ(x) { var n = Number(x || 0); return (n > 0 ? "+" : n < 0 ? "−" : "") + eur(Math.abs(n)); }
  function hod(min) { var m = Math.round(Number(min || 0)), z = m < 0 ? "−" : ""; m = Math.abs(m); return z + Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : ""); }
  function hodZ(min) { var n = Math.round(Number(min || 0)); return (n > 0 ? "+" : "") + hod(n); }
  function chyba(e) { return (e && (e.message || e.text || e.error_description)) || String(e || "Chyba"); }
  function rpc(f, a) { return DB.rpc(f, a || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function spravca() { return ROLA === "ceo" || ROLA === "it"; }
  function prekresliPrehlad() { try { window.dispatchEvent(new Event("lbz-prekresli")); } catch (x) { /* */ } }

  function mojaOsoba() {
    if (S.moja !== undefined) return Promise.resolve(S.moja);
    return rpc("rozpis_moja_osoba").then(function (o) { S.moja = o || null; return S.moja; }).catch(function () { S.moja = null; return null; });
  }

  // ---------- načítanie ----------
  function nacitaj() {
    if (!DB || !S.el) return;
    S.nacitavam = true; kresli();
    var m = S.mesiac;
    mojaOsoba().then(function (moja) {
      if (!S.pohlad) S.pohlad = moja ? "moj" : (S.citatel ? "tim" : "moj");
      if (S.pohlad === "tim") return rpc("mesacny_prehlad", { p_mesiac: m }).then(function (d) { if (m === S.mesiac) { S.prehlad = d; S.list = null; } });
      var os = S.pohlad === "osoba" ? S.osoba : moja;
      if (!os) { S.list = { ok: false, text: "Tvoj účet nie je prepojený so zamestnancom v rozpise." }; return; }
      return rpc("mesacny_list", { p_osoba: os, p_mesiac: m }).then(function (d) { if (m === S.mesiac) S.list = d; });
    }).catch(function (e) { S.sprava = { typ: "chyba", text: chyba(e) }; })
      .then(function () { S.nacitavam = false; kresli(); });
  }

  // ---------- vykreslenie ----------
  function kresli() {
    if (!S.el || !S.el.isConnected) return;
    var m = S.mesiac, akt = aktualny();
    var h = '<div class="pm">' +
      '<div class="pm-hlava"><button class="btn btn-ikona" data-pm="mes-" aria-label="Predošlý mesiac">◀</button>' +
      '<div class="pm-mes"><b>' + esc(mNazov(m)) + "</b>" + (m >= akt ? '<span class="muted"> · prebieha</span>' : "") + (S.nacitavam ? '<span class="muted"> · načítavam…</span>' : "") + "</div>" +
      '<button class="btn btn-ikona" data-pm="mes+" aria-label="Ďalší mesiac"' + (m >= akt ? " disabled" : "") + ">▶</button></div>";
    if (S.citatel && S.moja !== undefined) {
      h += '<div class="f-seg pm-seg" role="group">' +
        (S.moja ? '<button data-pm-poh="moj" aria-pressed="' + (S.pohlad === "moj") + '">Môj list</button>' : "") +
        '<button data-pm-poh="tim" aria-pressed="' + (S.pohlad === "tim" || S.pohlad === "osoba") + '">Všetci zamestnanci</button></div>';
    }
    if (S.sprava) h += '<p class="f-sprava f-' + esc(S.sprava.typ) + '">' + esc(S.sprava.text) + ' <button class="btn-link" data-pm="zavri">✕</button></p>';
    if (S.bezi) h += '<p class="f-sprava f-info">⏳ ' + esc(S.bezi) + "</p>";
    if (S.pohlad === "tim") h += pohladTim();
    else if (S.list) h += (S.pohlad === "osoba" ? '<p><button class="btn-link" data-pm-poh="tim">← Späť na všetkých</button></p>' : "") + pohladList(S.list);
    h += "</div>";
    S.el.innerHTML = h;
  }

  function stavText(l) {
    switch (l.stav) {
      case "prebieha": return ["info", "Mesiac ešte prebieha – toto je len náhľad. Podpisuje sa po skončení mesiaca, do " + datum(l.termin) + "."];
      case "pred_startom": return ["info", "Mesačné listy sa podpisujú od " + mNazov(l.od) + "."];
      case "caka_zamestnanec": return [new Date() > new Date(l.termin + "T23:59:59") ? "chyba" : "varovanie", "✍️ Čaká na podpis zamestnanca – termín do " + datum(l.termin) + "."];
      case "caka_zamestnavatel": return ["info", "Zamestnanec podpísal " + kedy(l.podpisy.zamestnanec) + ". Čaká na podpis zamestnávateľa."];
      case "podpisane": return ["ok", "✅ Podpísané zamestnancom aj zamestnávateľom."];
      case "nic": return ["info", "Za tento mesiac nie je nič na podpis (žiadna dochádzka ani smeny)."];
    }
    return ["info", ""];
  }

  function pohladList(l) {
    if (!l.ok) return '<div class="empty"><span class="muted">' + esc(l.text || "Mesačný list sa nedá načítať.") + "</span></div>";
    var d = l.dochadzka || {}, b = l.bilancia || null, s = l.stravne || {}, st = stavText(l), pl = s.plan_dalsi || {}, m1 = posun(l.mesiac, 1);
    var h = '<section class="card pm-karta"><h3>Mesačný list – ' + esc(l.meno || "") + "</h3>" +
      '<p class="pm-stav pm-' + st[0] + '">' + esc(st[1]) + "</p>";
    // 1. dochádzka
    h += '<h4>1. Dochádzka za ' + esc(mNazov(l.mesiac)) + "</h4><dl class=\"pm-dl\">" +
      "<dt>Odpracované</dt><dd><b>" + hod(d.min_prace) + "</b> (" + (d.dni_prace || 0) + " dní)</dd>" +
      (d.dni_dovolenka ? "<dt>Dovolenka</dt><dd>" + d.dni_dovolenka + " dní</dd>" : "") +
      (d.dni_pn ? "<dt>PN / OČR</dt><dd>" + d.dni_pn + " dní</dd>" : "") +
      (d.dni_lekar ? "<dt>Lekár</dt><dd>" + d.dni_lekar + " dní</dd>" : "") +
      (d.dni_nv ? "<dt>Náhradné voľno</dt><dd>" + d.dni_nv + " dní</dd>" : "") +
      (d.min_absencie ? "<dt>Absencie spolu</dt><dd>" + hod(d.min_absencie) + "</dd>" : "") +
      (b && b.tpp ? "<dt>Fond (" + b.prac_dni + " prac. dní)</dt><dd>" + hod(b.fond_min) + "</dd>" +
           "<dt>Rozdiel v mesiaci</dt><dd>" + hodZ(b.rozdiel_min) + "</dd>" +
           "<dt>Prenos z minulého mesiaca</dt><dd>" + hodZ(b.prenos_z_min) + "</dd>" +
           "<dt>Prenos do ďalšieho mesiaca</dt><dd><b>" + hodZ(b.zostatok_min) + "</b> " + (b.zostatok_min > 0 ? '<span class="muted">nadčas</span>' : b.zostatok_min < 0 ? '<span class="muted">chýba</span>' : "") + "</dd>" : "") +
      "</dl>" + (d.otvorene ? '<p class="pm-stav pm-chyba">⚠️ ' + d.otvorene + " záznam(y) bez odchodu – treba doplniť pred podpisom.</p>" : "");
    // 2. vyúčtovanie stravného
    h += "<h4>2. Vyúčtovanie stravného za " + esc(mNazov(l.mesiac)) + '</h4><dl class="pm-dl">' +
      "<dt>Skutočné stravné podľa dochádzky</dt><dd>" + eur(s.skutocne) + "</dd>" +
      "<dt>Záloha podpísaná vopred</dt><dd>" + (s.zaloha_bola ? eur(s.zaloha) : '<span class="muted">nebola (prvý mesiac)</span>') + "</dd>" +
      "<dt>Rozdiel</dt><dd><b>" + eurZ(s.rozdiel) + "</b> " + (Number(s.rozdiel) > 0 ? '<span class="muted">doplatok</span>' : Number(s.rozdiel) < 0 ? '<span class="muted">odpočet</span>' : "") + "</dd></dl>";
    // 3. záloha na ďalší mesiac
    var smeny = pl.smeny || [];
    h += "<h4>3. Záloha stravného na " + esc(mNazov(m1)) + "</h4>" +
      '<dl class="pm-dl"><dt>Plánované smeny v rozpise</dt><dd>' + smeny.length + " smien" + (s.zaloha_dalsi_ulozena ? ' <span class="muted">(stav pri podpise)</span>' : "") + "</dd>" +
      "<dt>Záloha</dt><dd><b>" + eur(s.zaloha_dalsi) + "</b></dd></dl>" +
      (smeny.length ? '<button class="btn-link" data-pm="detail">' + (S.detail ? "Skryť smeny" : "Zobraziť smeny") + "</button>" +
        (S.detail ? '<table class="pm-tab"><thead><tr><th>Deň</th><th>Miesto</th><th>Čas</th><th>Stravné</th></tr></thead><tbody>' +
          smeny.map(function (x) { return "<tr><td>" + den(x.datum) + " " + datumK(x.datum) + "</td><td>" + esc(MIESTO_NAZOV[x.miesto] || x.pozicia || "") + "</td><td>" + hod(x.min) + "</td><td>" + eur(x.suma) + "</td></tr>"; }).join("") +
          "</tbody></table>" : "") : '<p class="muted">Na ' + esc(mNazov(m1)) + " zatiaľ nie sú v rozpise smeny.</p>");
    // 4. k vyplateniu
    h += '<div class="pm-spolu"><span>4. Stravné k vyplateniu s výplatou za ' + esc(mNazov(l.mesiac)) + '</span><b>' + eur(s.k_vyplate) + "</b>" +
      '<small class="muted">záloha ' + eur(s.zaloha_dalsi) + " " + (Number(s.rozdiel) < 0 ? "−" : "+") + " rozdiel " + eur(Math.abs(Number(s.rozdiel || 0))) + "</small></div>";
    // 5. ostatné dokumenty
    var docs = l.dokumenty || [];
    h += "<h4>5. Ďalšie dokumenty za " + esc(mNazov(l.mesiac)) + "</h4>" + (docs.length ? '<ul class="pm-docs">' + docs.map(function (x) {
      var t = x.zamestnanec && x.zamestnavatel ? "✅ podpísané" : x.zamestnanec ? "čaká na zamestnávateľa" : "⏳ čaká na zamestnanca";
      return "<li>" + esc(TYP_DOK[x.typ] || x.typ) + ' <span class="muted">– ' + t + "</span></li>";
    }).join("") + "</ul>" : '<p class="muted">Žiadne.</p>');
    // tlačidlá
    var tl = "";
    if (l.ja && l.stav === "caka_zamestnanec") tl += '<button class="btn btn-primary" data-pm="podpis"' + (d.otvorene ? " disabled" : "") + ">✍️ Podpísať mesačný list</button>";
    if (l.smiem_zamestnavatel && l.stav === "caka_zamestnavatel") tl += '<button class="btn btn-primary" data-pm="podpis-v">✍️ Podpísať za zamestnávateľa</button>';
    if (l.pdf) tl += '<button class="btn" data-pm="pdf">📄 Podpísané PDF</button>';
    if (tl) h += '<div class="pm-tl">' + tl + "</div>";
    return h + "</section>";
  }

  function pohladTim() {
    var p = S.prehlad;
    if (!p) return "";
    if (!p.ok) return '<div class="empty"><span class="muted">' + esc(p.text || "Prehľad sa nedá načítať.") + "</span></div>";
    var ludia = p.ludia || [], m = p.mesiac, prebieha = m >= aktualny();
    var cakaZ = ludia.filter(function (x) { return x.stav === "caka_zamestnanec"; }).length;
    var cakaD = ludia.filter(function (x) { return x.doch === "nie"; }).length; // dochádzku podpisuje len ten, kto v mesiaci pracoval (s103)
    var hot = ludia.reduce(function (a, x) { return a + Number(x.hotovost || 0); }, 0);
    var cakaV = ludia.filter(function (x) { return x.stav === "caka_zamestnavatel"; });
    var vyb = cakaV.filter(function (x) { return S.vyber[x.osoba_id]; }).length;
    var sum = ludia.reduce(function (a, x) { return a + Number(x.k_vyplate || 0); }, 0);
    var h = '<section class="card pm-karta"><h3>Mesačné listy – ' + esc(mNazov(m)) + "</h3>" +
      (prebieha ? '<p class="pm-stav pm-info">Mesiac ešte prebieha – len náhľad.</p>' :
        '<p class="pm-stav pm-info">Termín podpisu: do ' + datum(p.termin) + ". Nepodpísali dochádzku: <b>" + cakaD + "</b> · stravné: <b>" + cakaZ + "</b> · čaká na zamestnávateľa: <b>" + cakaV.length + "</b></p>" +
        (p.vsetko_podpisane ? '<p class="pm-stav pm-ok">✅ Všetko za mesiac je podpísané – môžeš vyplatiť stravné v hotovosti.</p>' : "")) +
      '<div class="pm-tab-obal"><table class="pm-tab pm-tim"><thead><tr>' + (p.smiem_zamestnavatel && !prebieha ? "<th></th>" : "") +
      "<th>Zamestnanec</th><th>Dochádzka</th><th>Stravné – podpis</th><th>Hodiny</th><th>Stravné</th><th>Rozdiel</th><th>Záloha ďalší</th><th>K výplate</th><th>Z cesťáku</th><th>V hotovosti</th></tr></thead><tbody>" +
      ludia.map(function (x) {
        var pod = x.stav === "podpisane" ? "✅ obaja" : x.stav === "caka_zamestnavatel" ? "✍️ zamestnanec" : x.stav === "caka_zamestnanec" ? "⏳ nie" : "–";
        var dch = x.doch === "obaja" ? "✅ obaja" : x.doch === "zamestnanec" ? "✍️ zamestnanec" : x.doch === "nie" ? "⏳ nie" : "– nepracoval/a";
        var chk = x.stav === "caka_zamestnavatel" ? '<input type="checkbox" data-pm-vyb="' + x.osoba_id + '"' + (S.vyber[x.osoba_id] ? " checked" : "") + ">" : "";
        return "<tr>" + (p.smiem_zamestnavatel && !prebieha ? "<td>" + chk + "</td>" : "") +
          '<td><button class="btn-link" data-pm-osoba="' + x.osoba_id + '">' + esc(x.meno) + "</button></td><td>" + dch + "</td><td>" + pod + "</td><td>" + hod(x.min_prace) + "</td><td>" + eur(x.skutocne) +
          "</td><td>" + eurZ(x.rozdiel) + "</td><td>" + eur(x.zaloha_dalsi) + "</td><td><b>" + eur(x.k_vyplate) + "</b></td><td>" + (Number(x.cp_stravne) ? eur(x.cp_stravne) : "–") + "</td><td><b>" + eur(x.hotovost) + "</b></td></tr>";
      }).join("") +
      '</tbody><tfoot><tr><td colspan="' + (p.smiem_zamestnavatel && !prebieha ? 8 : 7) + '">Spolu k výplate</td><td><b>' + eur(sum) + "</b></td><td></td><td><b>" + eur(hot) + "</b></td></tr></tfoot></table></div>";
    var tl = "";
    if (p.smiem_zamestnavatel && !prebieha && cakaV.length) {
      tl += '<button class="btn" data-pm="vyber-vsetko">' + (vyb === cakaV.length ? "Zrušiť výber" : "Vybrať všetkých (" + cakaV.length + ")") + "</button>" +
        '<button class="btn btn-primary" data-pm="podpis-hrom"' + (vyb ? "" : " disabled") + ">✍️ Podpísať za zamestnávateľa (" + vyb + ")</button>";
    }
    if (!prebieha) tl += '<button class="btn' + (p.vsetko_podpisane ? " btn-primary" : "") + '" data-pm="hotovost"' + (p.vsetko_podpisane ? "" : ' disabled title="Ešte nie je všetko podpísané"') + ">💶 Výplata stravného v hotovosti</button>";
    tl += '<button class="btn" data-pm="csv">⬇️ Stravné pre mzdárku (CSV)</button>';
    return h + '<div class="pm-tl">' + tl + "</div></section>";
  }

  // ---------- dokument (PDF) ----------
  function obsahListu(l) {
    var s = l.stravne || {};
    return JSON.stringify([l.dokument, l.dochadzka, l.bilancia && l.bilancia.zostatok_min, s.skutocne, s.zaloha, s.rozdiel, s.zaloha_dalsi, s.k_vyplate,
      ((s.plan_dalsi || {}).smeny || []).map(function (x) { return [x.datum, x.miesto, x.suma]; })]);
  }
  function listHtml(l, riadky, pod) {
    var P = window.lbzPodpis, d = l.dochadzka || {}, b = l.bilancia, s = l.stravne || {}, m1 = posun(l.mesiac, 1), smeny = (s.plan_dalsi || {}).smeny || [];
    var sl = function (rola, popis) { return P ? P.slot(pod, rola, popis) : "<span>.............................................<br>" + popis + "</span>"; };
    return "<h1>Mesačný list – " + esc(mNazov(l.mesiac)) + "</h1>" +
      "<p>Zamestnanec: <b>" + esc(l.meno || "") + "</b><br>Zamestnávateľ: " + esc(ZAMESTNAVATEL) + "</p>" +
      "<h2>1. Dochádzka</h2><p>Odpracované: <b>" + hod(d.min_prace) + "</b> (" + (d.dni_prace || 0) + " dní)" +
      (d.dni_dovolenka ? " · dovolenka " + d.dni_dovolenka + " dní" : "") + (d.dni_pn ? " · PN/OČR " + d.dni_pn + " dní" : "") + (d.dni_lekar ? " · lekár " + d.dni_lekar + " dní" : "") +
      (b && b.tpp ? "<br>Fond: " + hod(b.fond_min) + " (" + b.prac_dni + " prac. dní) · rozdiel v mesiaci " + hodZ(b.rozdiel_min) + " · prenos z minulého mesiaca " + hodZ(b.prenos_z_min) + " · <b>prenos do ďalšieho mesiaca " + hodZ(b.zostatok_min) + "</b> (+ nadčas, − chýba)" : "") + "</p>" +
      "<table><thead><tr><th>Deň</th><th>Miesto / druh</th><th>Príchod</th><th>Odchod</th><th>Prestávka</th><th>Hodiny</th><th>Stravné</th></tr></thead><tbody>" +
      (riadky || []).map(function (x) {
        return "<tr><td>" + den(x.datum) + " " + datumK(x.datum) + "</td><td>" + esc(x.typ === "praca" ? (x.miesto || "") : x.typ) + "</td><td>" + cas(x.prichod) + "</td><td>" + cas(x.odchod) +
          "</td><td>" + (x.prestavka_min ? x.prestavka_min + " min" : "") + "</td><td>" + hod(x.odpracovane_min) + "</td><td>" + (Number(x.stravne) ? eur(x.stravne) : "") + "</td></tr>";
      }).join("") + "</tbody></table>" +
      "<h2>2. Vyúčtovanie stravného za " + esc(mNazov(l.mesiac)) + "</h2><p>Skutočné stravné podľa dochádzky: <b>" + eur(s.skutocne) + "</b><br>Záloha podpísaná vopred: " +
      (s.zaloha_bola ? eur(s.zaloha) : "nebola (prvý mesiac)") + "<br>Rozdiel: <b>" + eurZ(s.rozdiel) + "</b></p>" +
      "<h2>3. Záloha stravného na " + esc(mNazov(m1)) + "</h2><p>Podľa rozpisu práce: " + smeny.length + " smien, záloha <b>" + eur(s.zaloha_dalsi) + "</b>. Ak sa skutočnosť bude líšiť, rozdiel sa dorovná v ďalšom mesačnom liste.</p>" +
      (smeny.length ? "<table><thead><tr><th>Deň</th><th>Miesto</th><th>Čas (bez prestávky)</th><th>Stravné</th></tr></thead><tbody>" +
        smeny.map(function (x) { return "<tr><td>" + den(x.datum) + " " + datumK(x.datum) + "</td><td>" + esc(MIESTO_NAZOV[x.miesto] || x.pozicia || "") + "</td><td>" + hod(x.min) + "</td><td>" + eur(x.suma) + "</td></tr>"; }).join("") +
        "</tbody></table>" : "") +
      "<h2>4. Stravné k vyplateniu s výplatou za " + esc(mNazov(l.mesiac)) + ": " + eur(s.k_vyplate) + "</h2>" +
      "<p>Svojím podpisom potvrdzujem správnosť dochádzky a vyúčtovania stravného za " + esc(mNazov(l.mesiac)) + " a zálohu stravného na " + esc(mNazov(m1)) + ".</p>" +
      '<table style="border:0;margin-top:24px"><tr><td style="border:0;width:50%">' + sl("zamestnanec", "Zamestnanec") + '</td><td style="border:0">' + sl("zamestnavatel", "Za zamestnávateľa") + "</td></tr></table>";
  }

  function nacitajRiadky(osoba, mesiac) {
    return rpc("dochadzka_mesiac", { p_osoba: osoba, p_mesiac: mesiac }).then(function (d) { return (d && d.riadky) || []; }).catch(function () { return []; });
  }

  // podpis zamestnanca (cez štandardné okno podpisu)
  function podpisZamestnanec() {
    var l = S.list, P = window.lbzPodpis;
    if (!l || !P) { S.sprava = { typ: "chyba", text: "Podpis nie je dostupný – obnovte appku." }; kresli(); return; }
    nacitajRiadky(l.osoba_id, l.mesiac).then(function (riadky) {
      return P.podpisat({
        db: DB, typ: "mesiac", rola: "zamestnanec", osoba: l.osoba_id, dokument: l.dokument,
        nazov: "Mesačný list " + mNazov(l.mesiac) + " – " + (l.meno || ""), subor: "mesacny_list_" + String(l.mesiac).slice(0, 7),
        titul: "Podpis mesačného listu",
        vyhlasenie: "Potvrdzujem dochádzku a vyúčtovanie stravného za " + mNazov(l.mesiac) + " a zálohu stravného na " + mNazov(posun(l.mesiac, 1)) + " (" + eur((l.stravne || {}).zaloha_dalsi) + ").",
        obsah: obsahListu(l),
        html: function (pod) { return listHtml(l, riadky, pod); }
      });
    }).then(function (r) {
      if (!r || r.zrusene) return;
      S.sprava = r.ok ? { typ: "ok", text: "Mesačný list je podpísaný. Ďakujeme!" } : { typ: "chyba", text: r.text || "Podpis sa nepodaril." };
      S.karta = null; prekresliPrehlad(); nacitaj();
    });
  }

  // podpis za zamestnávateľa – jeden podpis pre všetkých vybraných
  function podpisZamestnavatel(ids) {
    var P = window.lbzPodpis, m = S.mesiac;
    if (!P || !ids.length) return;
    P.dialog({ titul: "Podpis za zamestnávateľa", vyhlasenie: "Potvrdzujem mesačné listy za " + mNazov(m) + " (" + ids.length + (ids.length === 1 ? " zamestnanec" : ids.length < 5 ? " zamestnanci" : " zamestnancov") + ")." })
      .then(function (obrazok) {
        var ok = 0, zle = [];
        var krok = function (i) {
          if (i >= ids.length) return Promise.resolve();
          S.bezi = "Podpisujem " + (i + 1) + " / " + ids.length + "…"; kresli();
          var l, h, pod;
          return rpc("mesacny_list", { p_osoba: ids[i], p_mesiac: m }).then(function (x) {
            l = x; if (!l.ok) throw new Error(l.text);
            if (l.stav !== "caka_zamestnavatel") throw new Error("nečaká na zamestnávateľa");
            return P.sha256(obsahListu(l));
          }).then(function (hash) {
            h = hash;
            return rpc("podpis_pridaj", { p: { dokument: l.dokument, typ: "mesiac", rola: "zamestnavatel", obrazok: obrazok, obsah_hash: h, zariadenie: navigator.userAgent.slice(0, 180) } });
          }).then(function (r) {
            if (!r || !r.ok) throw new Error((r && r.text) || "Podpis sa neuložil");
            pod = r.podpisy || [];
            return nacitajRiadky(l.osoba_id, l.mesiac);
          }).then(function (riadky) {
            return P.pdf(listHtml(l, riadky, pod) + P.pata(pod, h));
          }).then(function (blob) {
            return P.sha256(blob).then(function (sh) {
              var cesta = l.osoba_id + "/podpisane/mesacny_list_" + String(l.mesiac).slice(0, 7) + "_" + new Date().toISOString().replace(/[:.]/g, "-") + ".pdf";
              return DB.storage.from("zamestnanci").upload(cesta, blob, { contentType: "application/pdf", upsert: false }).then(function (u) {
                if (u.error) throw u.error;
                return rpc("podpis_pdf", { p: { dokument: l.dokument, nazov: "Mesačný list " + mNazov(l.mesiac) + " – " + (l.meno || ""), cesta: cesta, sha256: sh } });
              });
            });
          }).then(function () { ok++; }, function (e) { zle.push(((l && l.meno) || ("#" + ids[i])) + ": " + chyba(e)); })
            .then(function () { return krok(i + 1); });
        };
        return krok(0).then(function () {
          S.bezi = null; S.vyber = {};
          S.sprava = zle.length ? { typ: "chyba", text: "Podpísané: " + ok + ". Nepodarilo sa: " + zle.join("; ") } : { typ: "ok", text: "Podpísané za zamestnávateľa: " + ok + "." };
          S.karta = null; prekresliPrehlad(); nacitaj();
        });
      })
      .catch(function (e) {
        S.bezi = null;
        if (!(e && e.message === "zrusene")) { S.sprava = { typ: "chyba", text: chyba(e) }; }
        kresli();
      });
  }

  // výplata stravného v hotovosti – meno a suma (mesačný list + stravné z cesťáku), Terézia 2. 10. 2026
  function hotovostTlac() {
    var p = S.prehlad; if (!p || !p.ok) return;
    var ludia = (p.ludia || []).filter(function (x) { return Number(x.hotovost || 0) > 0; });
    var spolu = ludia.reduce(function (a, x) { return a + Number(x.hotovost || 0); }, 0);
    var h = '<div style="font-family:Arial,sans-serif;font-size:11pt;color:#000"><h2 style="margin:0 0 4px">Výplata stravného v hotovosti – ' + esc(mNazov(p.mesiac)) + "</h2>" +
      '<p style="margin:0 0 10px">V sedle u Falťanov s. r. o. · vyhotovené ' + esc(new Date().toLocaleDateString("sk-SK")) + "</p>" +
      '<table style="border-collapse:collapse;width:100%"><thead><tr>' + ["Meno", "Suma", "Prevzal/a (podpis)"].map(function (c, i) { return '<th style="border:1px solid #000;padding:4px 6px;text-align:' + (i === 1 ? "right" : "left") + '">' + c + "</th>"; }).join("") + "</tr></thead><tbody>" +
      ludia.map(function (x) { return '<tr><td style="border:1px solid #000;padding:6px">' + esc(x.meno) + '</td><td style="border:1px solid #000;padding:6px;text-align:right">' + eur(x.hotovost) + '</td><td style="border:1px solid #000;padding:6px;width:40%"></td></tr>'; }).join("") +
      '</tbody><tfoot><tr><th style="border:1px solid #000;padding:6px;text-align:left">Spolu</th><th style="border:1px solid #000;padding:6px;text-align:right">' + eur(spolu) + '</th><td style="border:1px solid #000"></td></tr></tfoot></table>' +
      '<p style="margin:24px 0 0">Vyplatil/a: ______________________________</p></div>';
    var obal = document.getElementById("tlac-oblast");
    if (!obal) { obal = document.createElement("div"); obal.id = "tlac-oblast"; document.body.appendChild(obal); }
    obal.className = ""; obal.innerHTML = h; document.body.classList.add("tlaci");
    var hotovo = function () { document.body.classList.remove("tlaci"); obal.innerHTML = ""; window.removeEventListener("afterprint", hotovo); };
    window.addEventListener("afterprint", hotovo);
    setTimeout(function () { window.print(); setTimeout(hotovo, 1500); }, 80);
  }
  function csv() {
    var p = S.prehlad; if (!p || !p.ok) return;
    var r = [["Meno", "Mesiac", "Dni práce", "Hodiny", "Stravné skutočné", "Záloha (podpísaná)", "Rozdiel", "Záloha na ďalší mesiac", "Stravné k výplate", "Podpis zamestnanca", "Podpis zamestnávateľa"]];
    var n = function (x) { return (Math.round(Number(x || 0) * 100) / 100).toFixed(2).replace(".", ","); };
    (p.ludia || []).forEach(function (x) {
      r.push([x.meno, mNazov(p.mesiac), x.dni_prace || 0, n(Number(x.min_prace || 0) / 60), n(x.skutocne), n(x.zaloha), n(x.rozdiel), n(x.zaloha_dalsi), n(x.k_vyplate),
        x.zamestnanec ? kedy(x.zamestnanec) : "", x.zamestnavatel ? kedy(x.zamestnavatel) : ""]);
    });
    var t = "\ufeff" + r.map(function (a) { return a.map(function (v) { v = String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(";"); }).join("\r\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([t], { type: "text/csv;charset=utf-8" }));
    a.download = "stravne_" + String(p.mesiac).slice(0, 7) + ".csv";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- udalosti ----------
  function klik(e) {
    var t = e.target.closest("[data-pm],[data-pm-poh],[data-pm-osoba]"); if (!t || !S.el.contains(t)) return;
    e.stopPropagation();
    var d = t.dataset;
    if (d.pmPoh) { S.pohlad = d.pmPoh; S.list = null; S.prehlad = null; S.sprava = null; nacitaj(); return; }
    if (d.pmOsoba) { S.pohlad = "osoba"; S.osoba = +d.pmOsoba; S.list = null; S.sprava = null; nacitaj(); window.scrollTo(0, 0); return; }
    switch (d.pm) {
      case "mes-": S.mesiac = posun(S.mesiac, -1); S.list = null; S.prehlad = null; S.vyber = {}; S.sprava = null; nacitaj(); return;
      case "mes+": if (S.mesiac < aktualny()) { S.mesiac = posun(S.mesiac, 1); S.list = null; S.prehlad = null; S.vyber = {}; S.sprava = null; nacitaj(); } return;
      case "zavri": S.sprava = null; kresli(); return;
      case "detail": S.detail = !S.detail; kresli(); return;
      case "podpis": podpisZamestnanec(); return;
      case "podpis-v": if (S.list) podpisZamestnavatel([S.list.osoba_id]); return;
      case "pdf": if (S.list && S.list.pdf && window.lbzPodpis) lbzPodpis.otvor(DB, S.list.pdf.cesta, S.list.pdf.nazov || "Mesačný list"); return;
      case "vyber-vsetko": {
        var cv = ((S.prehlad && S.prehlad.ludia) || []).filter(function (x) { return x.stav === "caka_zamestnavatel"; });
        var vsetci = cv.every(function (x) { return S.vyber[x.osoba_id]; });
        S.vyber = {}; if (!vsetci) cv.forEach(function (x) { S.vyber[x.osoba_id] = true; });
        kresli(); return;
      }
      case "podpis-hrom": podpisZamestnavatel(Object.keys(S.vyber).filter(function (k) { return S.vyber[k]; }).map(Number)); return;
      case "csv": csv(); return;
      case "hotovost": hotovostTlac(); return;
    }
  }
  function zmena(e) {
    var t = e.target; if (!t || !t.dataset || !t.dataset.pmVyb) return;
    e.stopPropagation();
    S.vyber[+t.dataset.pmVyb] = t.checked; kresli();
  }

  // ---------- karta na Prehľade ----------
  function karta() {
    if (!DB) return "";
    if (!S.karta || Date.now() - S.karta.cas > 300000) {
      var bolo = S.karta; S.karta = { cas: Date.now(), d: bolo ? bolo.d : null };
      var m = predosly();
      mojaOsoba().then(function (moja) {
        return Promise.all([
          moja ? rpc("mesacny_list", { p_osoba: moja, p_mesiac: m }).catch(function () { return null; }) : null,
          spravca() ? rpc("mesacny_prehlad", { p_mesiac: m }).catch(function () { return null; }) : null,
          spravca() && koniecRoka() ? rpc("dochadzka_bilancia", { p_mesiac: aktualny() }).catch(function () { return null; }) : null
        ]);
      }).then(function (x) {
        var st = JSON.stringify(S.karta.d), l = x[0], p = x[1];
        S.karta.d = {
          mesiac: m,
          moj: l && l.ok && l.stav === "caka_zamestnanec" ? { termin: l.termin, k_vyplate: l.stravne && l.stravne.k_vyplate } : null,
          zamestnavatel: p && p.ok ? p.ludia.filter(function (y) { return y.stav === "caka_zamestnavatel"; }).length : 0,
          nepodpisali: p && p.ok ? p.ludia.filter(function (y) { return y.stav === "caka_zamestnanec" || y.doch === "nie"; }).length : 0,
          nep_doch: p && p.ok ? p.ludia.filter(function (y) { return y.doch === "nie"; }).length : 0,
          nep_strav: p && p.ok ? p.ludia.filter(function (y) { return y.stav === "caka_zamestnanec"; }).length : 0,
          termin: p && p.ok ? p.termin : null,
          vyr: x[2] && x[2].ok ? x[2].ludia.filter(function (y) { return y.tpp && Math.abs(y.zostatok_min || 0) >= 60; }).map(function (y) { return { meno: y.meno, min: y.zostatok_min }; }) : []
        };
        if (JSON.stringify(S.karta.d) !== st) prekresliPrehlad();
      }).catch(function () { /* */ });
    }
    var d = S.karta.d;
    var vyr = d && d.vyr && d.vyr.length ? d.vyr : null, pod = !window.LBZ_NAPODPIS && d && (d.moj || d.zamestnavatel || d.nepodpisali); // s kartou „Máš podpísať“ ostáva tu len vyrovnanie hodín (Terézia 2. 10.)
    if (!d || (!pod && !vyr)) return "";
    var h = '<section class="card"><h3>' + (pod ? "✍️ Na podpis" : "⚖️ Hodiny do konca roka") + "</h3>";
    if (d.moj) h += '<p style="margin:0 0 8px">Podpíš <b>mesačný list za ' + esc(mNazov(d.mesiac)) + "</b> – dochádzka a stravné (do " + datum(d.moj.termin) + ").</p>";
    if (d.zamestnavatel) h += '<p style="margin:0 0 8px">Za zamestnávateľa čaká: <b>' + d.zamestnavatel + "</b></p>";
    if (vyr) h += '<p style="margin:0 0 8px">⚖️ <b>Vyrovnanie hodín TPP do 31. 12.</b> – ' + vyr.map(function (y) { return esc(y.meno) + " " + (y.min > 0 ? "nadčas " : "chýba ") + hod(Math.abs(y.min)); }).join(", ") + ". Naplánuj podľa toho rozpis na december (Rozpis → 📊 Bilancia).</p>";
    if (d.nepodpisali) h += '<p class="muted" style="margin:0 0 8px">Ešte nepodpísali: ' + d.nepodpisali + (d.termin ? " (termín " + datum(d.termin) + ")" : "") + "</p>";
    return h + (pod ? '<button class="btn btn-primary" data-mod="dochadzka" data-pm-otvor="1">✍️ Otvoriť Na podpis</button>' : "") + (vyr ? ' <button class="btn" data-mod="rozpis">📅 Rozpis</button>' : "") + "</section>";
  }

  // klik na kartu Prehľadu: pred otvorením Dochádzky prepni na záložku Na podpis
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest("[data-pm-otvor]");
    if (!t) return;
    if (window.LBZ_DOCHADZKA && LBZ_DOCHADZKA.zalozka) LBZ_DOCHADZKA.zalozka("podpis");
    S.mesiac = predosly(); S.pohlad = null; S.list = null; S.prehlad = null;
  }, true);

  var st = document.createElement("style");
  st.textContent =
    ".pm-zal .head-tl,.pm-zal .head .sub{display:none}" +
    ".pm-hlava{display:flex;align-items:center;gap:8px;margin:4px 0 10px}.pm-mes{flex:1;text-align:center;font-size:1.05em;text-transform:capitalize}" +
    ".pm-seg{margin-bottom:10px}.pm-karta h4{margin:16px 0 6px;font-size:1em}" +
    ".pm-dl{display:grid;grid-template-columns:1fr auto;gap:4px 12px;margin:0}.pm-dl dt{color:var(--muted,#666)}.pm-dl dd{margin:0;text-align:right}" +
    ".pm-stav{margin:4px 0 8px;padding:8px 10px;border-radius:10px;background:rgba(0,0,0,.04)}.pm-ok{background:rgba(46,160,67,.12)}.pm-varovanie{background:rgba(203,167,91,.22)}.pm-chyba{background:rgba(220,53,69,.14)}" +
    ".pm-spolu{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;margin:16px 0 4px;padding:12px;border-radius:12px;background:rgba(203,167,91,.18)}.pm-spolu span{flex:1}.pm-spolu b{font-size:1.35em}.pm-spolu small{width:100%}" +
    ".pm-docs{margin:0;padding-left:18px}.pm-tl{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}" +
    ".pm-tab-obal{overflow-x:auto;margin:0 -4px}.pm-tab{width:100%;border-collapse:collapse;font-size:.92em;margin-top:6px}.pm-tab th,.pm-tab td{padding:6px 6px;border-bottom:1px solid rgba(0,0,0,.08);text-align:left;white-space:nowrap}" +
    ".pm-tim td:nth-child(n+4),.pm-tim th:nth-child(n+4){text-align:right}.pm-tab tfoot td{font-weight:600;border-bottom:0}";
  document.head.appendChild(st);

  window.LBZ_MESACNY = {
    nepodpisali: function () { var d = S.karta && S.karta.d; return d && d.nepodpisali ? { n: d.nepodpisali, doch: d.nep_doch, strav: d.nep_strav, termin: d.termin, mesiac: d.mesiac } : null; },
    nastavDb: function (klient, rola) { DB = klient || null; ROLA = klient ? rola : null; S.moja = undefined; S.list = null; S.prehlad = null; S.karta = null; S.pohlad = null; },
    mount: function (el, o) {
      if (S.el !== el) {
        S.el = el; el.addEventListener("click", klik); el.addEventListener("change", zmena);
      }
      S.citatel = !!(o && o.citatel);
      if (!S.mesiac) S.mesiac = predosly();
      if (S.list || S.prehlad) kresli(); else nacitaj();
    },
    karta: karta
  };
})();
