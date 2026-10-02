// LBZ – „✍️ Máš podpísať“ (2. 10. 2026): každý dokument zvlášť s termínom; klik → celý dokument → ✏️ Navrhnúť úpravu / ✍️ Podpísať.
// Dokumenty: dochádzka za mesiac, stravné (vyúčtovanie + záloha), cestovný príkaz, prevzatie stravného v hotovosti,
// dovolenkový lístok / neprítomnosť, zmluva / dohoda / GDPR (PDF poslané vedením).
// Úprava dochádzky = žiadosť o opravu času (schvaľuje CEO); pri ostatných dokumentoch pripomienka → CEO.
// Karta zamestnanca: 📎 dokumenty nahraté zamestnancom (škola, súhlas zákonného zástupcu…) a ✍️ poslanie dokumentu na podpis.
// DB: s85 (na_podpis_moje, podpis_pripomienka, dokument_na_podpis, dokument_nahraj, oznamy_fronta).
(function () {
  "use strict";
  var DB = null, ROLA = null;
  var S = { karta: null, o: null, sek: {} };
  var MES = ["január", "február", "marec", "apríl", "máj", "jún", "júl", "august", "september", "október", "november", "december"];
  var MIESTA = { "ZBOJSKÁ": "Zbojská", "ROZVOZ": "Rozvoz", "SLUŽOBKA": "Služobka", "OBCHOD": "Služobka", "BUCHTOMOBIL": "Buchťáč", "ADMINISTRATÍVA": "Administratíva" };
  var TYPY = { praca: "Odpracované", dovolenka: "Dovolenka", pn: "PN", ocr: "OČR", lekar: "Lekár", nv: "Náhradné voľno" };
  var IKONA = { dochadzka: "🕒", stravne: "🍽️", cp: "🧾", hotovost: "💶", absencia: "🏖️", dokument: "📄" };
  var DRUH_PODPIS = [["zmluva", "Pracovná zmluva"], ["dohoda", "Dohoda"], ["dodatok", "Dodatok"], ["gdpr", "GDPR / súhlas"], ["oboznamenie", "Oboznámenie (predpis, pravidlá)"], ["ine", "Iný dokument"]];
  var DRUH_NAHRAJ = ["Potvrdenie o návšteve školy", "Súhlas zákonného zástupcu", "Priepustka od lekára", "Potvrdenie o zdravotnej spôsobilosti / zdravotný preukaz",
    "Potvrdenie z úradu práce / Sociálnej poisťovne", "Vyhlásenie na zdaňovanie (NČZD)"];
  var ZAMESTNAVATEL = "V sedle u Falťanov s.r.o., IČO 47206934";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function rpc(n, a) { return DB.rpc(n, a || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function chyba(e) { return (e && (e.message || e.text || e.error_description)) || "Bez spojenia so serverom"; }
  function pad(n) { return ("0" + n).slice(-2); }
  function cas(t) { if (!t) return ""; var d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function hodiny(min) { min = Math.round(Number(min || 0)); return Math.floor(min / 60) + ":" + pad(min % 60); }
  function eur(x) { var n = Math.round(Number(x || 0) * 100) / 100; return n.toFixed(2).replace(".", ",") + " €"; }
  function eurZ(x) { var n = Number(x || 0); return (n > 0 ? "+" : n < 0 ? "−" : "") + eur(Math.abs(n)); }
  function datumK(s) { if (!s) return ""; var p = String(s).slice(0, 10).split("-"); return +p[2] + ". " + +p[1] + "."; }
  function datumD(s) { if (!s) return ""; var p = String(s).slice(0, 10).split("-"); return +p[2] + ". " + +p[1] + ". " + p[0]; }
  function denSk(s) { var p = String(s).slice(0, 10).split("-"); return new Date(+p[0], +p[1] - 1, +p[2], 12).toLocaleDateString("sk-SK", { weekday: "short", day: "numeric", month: "numeric" }); }
  function mesNazov(s) { var p = String(s || "").slice(0, 7).split("-"); return p.length < 2 ? "" : MES[+p[1] - 1] + " " + p[0]; }
  function posun(s, k) { var p = String(s).slice(0, 7).split("-"), d = new Date(+p[0], +p[1] - 1 + k, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-01"; }
  function dnesIso() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function bezDiak(t) { return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").slice(0, 70); }
  function prekresliPrehlad() { window.dispatchEvent(new Event("lbz-prekresli")); }
  function fronta() { try { DB.functions.invoke("upozornenia", { body: { akcia: "fronta" } }); } catch (x) { /* */ } }
  function hodnota(id) { var el = document.getElementById(id); return el ? String(el.value || "").trim() : ""; }
  function slot(pod, rola, popis) { return window.lbzPodpis ? lbzPodpis.slot(pod, rola, popis) : '<span class="pdp-slot">.............................................<br>' + esc(popis) + "</span>"; }

  // ---------- karta na Prehľade ----------
  // zmluva, dohoda, dodatok: zamestnanec v appke len potvrdí prečítanie, originál podpisuje na papieri (Terézia 2. 10. 2026)
  var PAPIER = ["zmluva", "dohoda", "dodatok"];
  function papier(x) { return x && x.typ === "dokument" && PAPIER.indexOf(x.druh) > -1; }
  // oboznámenie (GPS, pracovný poriadok, HACCP…): prečítať a potvrdiť podpisom prstom, 15 dní (Terézia 2. 10. 2026)
  function oboz(x) { return x && x.typ === "dokument" && x.druh === "oboznamenie"; }
  function nazov(x) {
    if (x.typ === "absencia") return x.nazov + " " + datumK(x.od) + (x.do !== x.od ? " – " + datumK(x.do) : "");
    if (x.typ === "dokument") return x.nazov;
    return x.nazov + " – " + mesNazov(x.mesiac);
  }
  function obnovKartu() { if (S.karta) S.karta.cas = 0; prekresliPrehlad(); }
  function karta() {
    if (!DB || ROLA === "zakaznik") return "";
    if (!S.karta || Date.now() - S.karta.cas > 60000) {
      var bolo = S.karta; S.karta = { cas: Date.now(), d: bolo ? bolo.d : null };
      rpc("na_podpis_moje").then(function (d) {
        var st = JSON.stringify(S.karta.d); S.karta.d = d && d.ok ? d : null;
        if (JSON.stringify(S.karta.d) !== st) prekresliPrehlad();
      }).catch(function () { /* bez signálu */ });
    }
    var d = S.karta.d; if (!d) return "";
    var pol = d.polozky || [], pr = d.pripomienky || [], nh = d.nahrane || [], zv = d.za_zamestnavatela || [];
    if (!pol.length && !pr.length && !nh.length && !zv.length) return "";
    var h = '<section class="card np-karta">';
    if (pol.length) {
      h += '<h3>✍️ Máš podpísať <span class="pill warn num">' + pol.length + "</span></h3>" +
        '<p class="muted np-pozn">Ťukni na dokument – prečítaj si ho, a ak je v poriadku, podpíš ho prstom. Ak niečo nesedí, navrhni úpravu.</p><div class="np-zoz">' +
        pol.map(function (x, i) {
          var info = x.cakajuce_upravy ? "⏳ úprava čaká na schválenie" : x.pripomienka ? "✏️ pripomienka odoslaná" : (x.po_termine ? "⚠️ termín bol " : papier(x) ? "prečítať do " : oboz(x) ? "prečítať a podpísať do " : "podpísať do ") + datumK(x.termin) + (papier(x) ? " · podpis na papieri" : "");
          return '<button type="button" class="np-pol' + (x.po_termine ? " np-po" : "") + '" data-np-otvor="' + i + '"><span class="np-ik" aria-hidden="true">' + (IKONA[x.typ] || "📄") + "</span>" +
            '<span class="np-t"><b>' + esc(nazov(x)) + "</b><small>" + esc(info) + '</small></span><span class="np-sip">›</span></button>';
        }).join("") + "</div>";
    }
    // CEO/IT: dokumenty, ktoré zamestnanec podpísal a čakajú na podpis zamestnávateľa (Terézia 2. 10. 2026)
    if (zv.length) {
      h += (pol.length ? '<h4 class="np-h4">' : "<h3>") + '🏢 Podpísať za zamestnávateľa <span class="pill warn num">' + zv.length + "</span>" + (pol.length ? "</h4>" : "</h3>") +
        '<p class="muted np-pozn">Zamestnanec už podpísal. Otvor dokument, skontroluj ho, ak treba ✏️ uprav a potom podpíš prstom.</p><div class="np-zoz">' +
        zv.map(function (x, i) {
          return '<button type="button" class="np-pol" data-np-otvorv="' + i + '"><span class="np-ik" aria-hidden="true">' + (IKONA[x.typ] || "📄") + "</span>" +
            '<span class="np-t"><b>' + esc(x.meno || "") + " · " + esc(nazov(x)) + "</b><small>" + esc(x.typ === "hotovost" ? "potvrď vyplatenie" : "zamestnanec podpísal " + (x.podpisal ? new Date(x.podpisal).toLocaleDateString("sk-SK") : "")) +
            '</small></span><span class="np-sip">›</span></button>';
        }).join("") + "</div>";
    }
    if (pr.length) {
      h += '<h4 class="np-h4">✏️ Pripomienky k dokumentom <span class="pill warn num">' + pr.length + "</span></h4>" + pr.map(function (x) {
        return '<div class="np-pr"><div><b>' + esc(x.meno) + "</b> · " + esc(x.nazov || x.dokument) + '<br><span class="np-pr-t">„' + esc(x.text) + '“</span> <small class="muted">' +
          esc(new Date(x.cas).toLocaleString("sk-SK", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })) + "</small></div>" +
          '<button type="button" class="btn" data-np-vybav="' + x.id + '">✅ Vybavené</button></div>';
      }).join("");
    }
    if (nh.length) {
      h += '<h4 class="np-h4">📎 Nahraté dokumenty (7 dní)</h4><div class="np-zoz">' + nh.map(function (x) {
        return '<button type="button" class="np-pol" data-np-sub="' + esc(x.cesta) + '" data-nazov="' + esc(x.nazov) + '"><span class="np-ik">📎</span><span class="np-t"><b>' + esc(x.nazov) + "</b><small>" +
          esc(x.meno) + " · " + esc(new Date(x.cas).toLocaleDateString("sk-SK")) + '</small></span><span class="np-sip">›</span></button>';
      }).join("") + "</div>";
    }
    return h + "</section>";
  }

  // ---------- dokumenty (HTML na obrazovku aj do PDF) ----------
  function meno() { return S.o && S.o.v ? S.o.x.meno || "" : (S.karta && S.karta.d && S.karta.d.meno) || ""; }
  function osM() { return S.o && S.o.v ? S.o.x.osoba_id : S.karta.d.osoba_id; }
  function dochHtml(x, riadky, pod, obrazovka) {
    var sum = 0, str = 0, dni = {};
    riadky.forEach(function (r) { sum += Number(r.odpracovane_min || 0); str += Number(r.stravne || 0); if (r.typ === "praca") dni[r.datum] = 1; });
    return "<h1>Dochádzka – " + esc(mesNazov(x.mesiac)) + "</h1>" +
      "<p>Zamestnanec: <b>" + esc(meno()) + "</b> · Zamestnávateľ: " + esc(ZAMESTNAVATEL) + "</p>" +
      '<div class="np-tab"><table><thead><tr><th>Deň</th><th>Miesto / druh</th><th>Príchod</th><th>Odchod</th><th>Prest.</th><th>Hodiny</th><th>Stravné</th><th>Poznámka</th>' + (obrazovka ? "<th></th>" : "") + "</tr></thead><tbody>" +
      riadky.map(function (r, i) {
        var sv = window.lbzSviatok ? window.lbzSviatok(r.datum) : "";
        return "<tr><td>" + esc(denSk(r.datum)) + (sv ? "<br><small>" + esc(sv) + "</small>" : "") + "</td><td>" + esc(r.typ === "praca" ? (MIESTA[r.miesto] || r.miesto || "") : TYPY[r.typ] || r.typ) +
          "</td><td>" + esc(cas(r.prichod)) + "</td><td>" + (r.typ === "praca" && !r.odchod ? "<b>chýba</b>" : esc(cas(r.odchod))) + '</td><td class="t-r">' + (r.prestavka_min ? hodiny(r.prestavka_min) : "") +
          '</td><td class="t-r">' + (r.odpracovane_min != null ? hodiny(r.odpracovane_min) : "") + '</td><td class="t-r">' + (Number(r.stravne) ? eur(r.stravne) : "") + "</td><td>" + esc(r.poznamka || "") + "</td>" +
          (obrazovka ? "<td>" + (r.typ === "praca" && !r.len_citanie ? '<button type="button" class="np-opr" data-np-opr="' + i + '" title="Navrhnúť opravu">✏️</button>' : "") + "</td>" : "") + "</tr>";
      }).join("") + "</tbody></table></div>" +
      '<table><tr><th>Spolu hodín</th><td class="t-r"><b>' + hodiny(sum) + ' h</b></td><th>Dní v práci</th><td class="t-r">' + Object.keys(dni).length + '</td><th>Stravné</th><td class="t-r">' + eur(str) + "</td></tr></table>" +
      "<p>Svojím podpisom potvrdzujem, že výkaz dochádzky za " + esc(mesNazov(x.mesiac)) + " je správny.</p>" +
      '<div class="pdp-riadok">' + slot(pod, "zamestnanec", "podpis zamestnanca") + slot(pod, "zamestnavatel", "za zamestnávateľa") + "</div>";
  }
  function stravHtml(l, pod) {
    var s = l.stravne || {}, pl = s.plan_dalsi || {}, sm = pl.smeny || [], m1 = posun(l.mesiac, 1), dch = l.dochadzka || {};
    return "<h1>Stravné – " + esc(mesNazov(l.mesiac)) + "</h1>" +
      "<p>Zamestnanec: <b>" + esc(l.meno || meno()) + "</b> · Zamestnávateľ: " + esc(ZAMESTNAVATEL) + "</p>" +
      "<table>" +
      '<tr><th>Stravné podľa dochádzky za ' + esc(mesNazov(l.mesiac)) + " (" + (+dch.dni_prace || 0) + ' dní v práci)</th><td class="t-r">' + eur(s.skutocne) + "</td></tr>" +
      "<tr><th>Záloha vyplatená vopred" + (s.zaloha_bola ? "" : " (nebola)") + '</th><td class="t-r">' + eur(s.zaloha) + "</td></tr>" +
      '<tr><th>Doplatok (+) / vrátenie (−)</th><td class="t-r">' + eurZ(s.rozdiel) + "</td></tr>" +
      "<tr><th>Záloha na " + esc(mesNazov(m1)) + " podľa rozpisu (" + sm.length + ' smien)</th><td class="t-r">' + eur(s.zaloha_dalsi) + "</td></tr>" +
      "<tr><th><b>K výplate spolu s výplatou za " + esc(mesNazov(l.mesiac)) + '</b></th><td class="t-r"><b>' + eur(s.k_vyplate) + "</b></td></tr></table>" +
      (sm.length ? "<h3>Plánované smeny – " + esc(mesNazov(m1)) + '</h3><div class="np-tab"><table><thead><tr><th>Deň</th><th>Miesto</th><th>Čas (bez prestávky)</th><th>Stravné</th></tr></thead><tbody>' +
        sm.map(function (r) { return "<tr><td>" + esc(denSk(r.datum)) + "</td><td>" + esc(MIESTA[r.miesto] || r.pozicia || "") + '</td><td class="t-r">' + hodiny(r.min) + '</td><td class="t-r">' + eur(r.suma) + "</td></tr>"; }).join("") +
        "</tbody></table></div>" : "") +
      "<p>Svojím podpisom potvrdzujem vyúčtovanie stravného za " + esc(mesNazov(l.mesiac)) + " a prevzatie zálohy stravného na " + esc(mesNazov(m1)) + ".</p>" +
      '<div class="pdp-riadok">' + slot(pod, "zamestnanec", "podpis zamestnanca") + slot(pod, "zamestnavatel", "za zamestnávateľa") + "</div>";
  }
  function dokHtml(x, hash, pod) {
    if (papier(x)) return "<h1>Potvrdenie o prečítaní dokumentu</h1><table>" +
      '<tr><th style="width:38%">Dokument</th><td><b>' + esc(x.nazov) + "</b></td></tr>" +
      "<tr><th>Zamestnanec</th><td>" + esc(meno()) + "</td></tr><tr><th>Zamestnávateľ</th><td>" + esc(ZAMESTNAVATEL) + "</td></tr>" +
      "<tr><th>Odtlačok SHA-256 dokumentu</th><td style=\"word-break:break-all\">" + esc(hash || "") + "</td></tr></table>" +
      "<p>Potvrdzujem, že som si dokument „" + esc(x.nazov) + "“ prečítal(a). Originál dokumentu podpíšem vlastnoručne na papieri.</p>" +
      '<div class="pdp-riadok">' + slot(pod, "zamestnanec", "zamestnanec – potvrdenie o prečítaní") + "</div>";
    if (oboz(x)) return "<h1>Potvrdenie o oboznámení</h1><table>" +
      '<tr><th style="width:38%">Dokument</th><td><b>' + esc(x.nazov) + "</b></td></tr>" +
      "<tr><th>Zamestnanec</th><td>" + esc(meno()) + "</td></tr><tr><th>Zamestnávateľ</th><td>" + esc(ZAMESTNAVATEL) + "</td></tr>" +
      "<tr><th>Odtlačok SHA-256 dokumentu</th><td style=\"word-break:break-all\">" + esc(hash || "") + "</td></tr></table>" +
      "<p>Svojím podpisom potvrdzujem, že som bol(a) oboznámený(á) s dokumentom „" + esc(x.nazov) + "“, jeho obsahu som porozumel(a) a budem ho dodržiavať. " +
      "Tento podpisový list patrí k dokumentu s uvedeným odtlačkom.</p>" +
      '<div class="pdp-riadok">' + slot(pod, "zamestnanec", "podpis zamestnanca") + "</div>";
    return "<h1>Podpis dokumentu</h1><table>" +
      '<tr><th style="width:38%">Dokument</th><td><b>' + esc(x.nazov) + "</b></td></tr>" +
      "<tr><th>Druh</th><td>" + esc((DRUH_PODPIS.filter(function (d) { return d[0] === x.druh; })[0] || ["", x.druh])[1]) + "</td></tr>" +
      "<tr><th>Zamestnanec</th><td>" + esc(meno()) + "</td></tr><tr><th>Zamestnávateľ</th><td>" + esc(ZAMESTNAVATEL) + "</td></tr>" +
      "<tr><th>Odtlačok SHA-256 podpisovaného PDF</th><td style=\"word-break:break-all\">" + esc(hash || "") + "</td></tr></table>" +
      "<p>Svojím podpisom potvrdzujem, že som si dokument „" + esc(x.nazov) + "“ prečítal(a), porozumel(a) jeho obsahu a podpisujem ho. " +
      "Tento podpisový list patrí k dokumentu s uvedeným odtlačkom.</p>" +
      '<div class="pdp-riadok">' + slot(pod, "zamestnanec", "podpis zamestnanca") + "</div>";
  }

  // ---------- okno dokumentu ----------
  function otvor(i, v) {
    var d = S.karta && S.karta.d, x = d && (v ? d.za_zamestnavatela || [] : d.polozky || [])[i]; if (!x) return;
    S.o = { x: x, v: !!v, nac: true, data: null, upr: null, sprava: null, hotovo: false, prace: false };
    var w = document.getElementById("np-okno");
    if (!w) {
      w = document.createElement("div"); w.id = "np-okno"; w.className = "np-okno"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true");
      document.body.appendChild(w);
      try { history.pushState({ npOkno: 1 }, ""); } catch (e) { /* */ }
    }
    document.body.classList.add("np-otvorene");
    w.innerHTML = '<div class="np-hl"><button type="button" class="btn" data-np="zavri">← Späť</button><b>' + (IKONA[x.typ] || "📄") + " " + esc(nazov(x)) + "</b>" + (v ? " <small>· " + esc(x.meno || "") + "</small>" : "") + "</div>" +
      '<div class="np-telo"><div class="np-dok" id="np-dok"><p class="muted">Načítavam…</p></div><div id="np-msg"></div><div id="np-upr"></div></div><div class="np-paticka" id="np-pat"></div>';
    w.scrollTop = 0; casti(); nacitajDok();
  }
  function zavri(spat) {
    var w = document.getElementById("np-okno"); if (w) w.remove();
    document.body.classList.remove("np-otvorene"); S.o = null;
    if (!spat) { try { if (history.state && history.state.npOkno) history.back(); } catch (e) { /* */ } }
  }
  window.addEventListener("popstate", function () { if (document.getElementById("np-okno")) zavri(true); });

  function nacitajDok() {
    var o = S.o, x = o.x, os = osM(), p;
    if (x.typ === "dochadzka") p = rpc("dochadzka_mesiac", { p_osoba: os, p_mesiac: x.mesiac }).then(function (d) { if (!d || d.ok === false) throw new Error((d && d.text) || "Nenačítané"); return d; });
    else if (x.typ === "stravne") p = rpc("mesacny_list", { p_osoba: os, p_mesiac: x.mesiac }).then(function (l) { if (!l || !l.ok) throw new Error((l && l.text) || "Nenačítané"); return l; });
    else if (x.typ === "cp" || x.typ === "hotovost") p = window.LBZ_CESTY && LBZ_CESTY.dokument ? LBZ_CESTY.dokument(os, x.mesiac, x.typ, o.v ? "zamestnavatel" : "zamestnanec") : Promise.reject(new Error("Obnov appku"));
    else if (x.typ === "absencia") p = Promise.resolve({ a: { id: x.id, typ: x.druh, od: x.od, do: x.do, cas_od: x.cas_od, cas_do: x.cas_do, poznamka: x.poznamka, stav: x.stav } });
    else if (x.typ === "dokument") p = DB.storage.from("zamestnanci").download(x.cesta).then(function (r) {
      if (r.error || !r.data) throw r.error || new Error("Súbor sa nenašiel");
      return lbzPodpis.sha256(r.data).then(function (h) { return { blob: r.data, hash: h }; });
    });
    else p = Promise.reject(new Error("Neznámy dokument"));
    p.then(function (d) {
      if (S.o !== o) return; o.data = d; o.nac = false; teloKresli();
      if (x.typ === "dokument") pdfStrany(d.blob);
    }).catch(function (e) { if (S.o !== o) return; o.nac = false; o.sprava = { typ: "chyba", text: chyba(e) }; teloKresli(); });
  }
  function teloKresli() {
    var o = S.o, x = o.x, d = o.data, el = document.getElementById("np-dok"); if (!el) return;
    var h = "";
    if (d) {
      if (x.typ === "dochadzka") h = dochHtml(x, d.riadky || [], null, !o.hotovo && !o.v);
      else if (x.typ === "stravne") h = stravHtml(d, null);
      else if (x.typ === "cp" || x.typ === "hotovost") h = d.html(null);
      else if (x.typ === "absencia") h = window.LBZ_DOCHADZKA && LBZ_DOCHADZKA.listokHtml ? LBZ_DOCHADZKA.listokHtml(d.a, meno(), null) : "";
      else if (x.typ === "dokument") h = '<div class="np-pdf" id="np-pdf"><p class="muted">Načítavam dokument…</p></div>' +
        (papier(x) ? '<p class="np-papier">📄 Tento dokument si len prečítaj a potvrď. <b>Originál podpíšeš vlastnoručne na papieri</b> – pripraví ti ho vedenie.</p>' : "") +
        (oboz(x) ? '<p class="np-papier">📘 Prečítaj si dokument celý. Podpisom potvrdíš, že si sa s ním oboznámil(a) a budeš ho dodržiavať. Ak niečomu nerozumieš, ťukni na ✏️ a opýtaj sa.</p>' : "") +
        (x.poznamka ? '<p class="muted">Poznámka: ' + esc(x.poznamka) + "</p>" : "");
    }
    el.innerHTML = h || (o.nac ? '<p class="muted">Načítavam…</p>' : "");
    casti();
  }
  function blok() {
    var o = S.o, x = o.x;
    if (o.nac || !o.data) return "Načítavam…";
    if (o.v) return "";
    if (x.typ === "dochadzka") {
      if (x.cakajuce_upravy) return "⏳ Úprava dochádzky čaká na schválenie CEO – podpísať budeš môcť po rozhodnutí.";
      if ((o.data.riadky || []).some(function (r) { return r.typ === "praca" && !r.odchod; })) return "Niektorý deň nemá odchod – navrhni úpravu (zabudnutý odchod).";
    }
    if (x.typ === "stravne" && !x.dochadzka_podpisana) return "Najprv podpíš dochádzku za " + mesNazov(x.mesiac) + " – stravné sa ráta z nej.";
    return "";
  }
  function casti() {
    var o = S.o; if (!o) return;
    var m = document.getElementById("np-msg"), u = document.getElementById("np-upr"), p = document.getElementById("np-pat");
    if (m) m.innerHTML = o.sprava ? '<p class="f-sprava f-' + o.sprava.typ + '">' + esc(o.sprava.text) + "</p>" : "";
    if (u) u.innerHTML = uprHtml();
    if (!p) return;
    if (o.hotovo) { p.innerHTML = '<button type="button" class="btn btn-primary" data-np="zavri">Zavrieť</button>'; return; }
    var b = blok();
    if (o.v) {
      p.innerHTML = (b && !o.nac ? '<p class="np-blok">' + esc(b) + "</p>" : "") +
        '<div class="np-tl"><button type="button" class="btn" data-np="v-upr"' + (o.nac || o.prace || o.x.typ === "absencia" ? " disabled" : "") + ">✏️ Upraviť</button>" +
        '<button type="button" class="btn btn-primary" data-np="podpis"' + (b || o.prace ? " disabled" : "") + ">" + (o.prace ? "Pracujem…" : o.x.typ === "hotovost" ? "✍️ Vyplatil(a) – podpísať" : "✍️ Podpísať za zamestnávateľa") + "</button></div>";
      return;
    }
    p.innerHTML = (b && !o.nac ? '<p class="np-blok">' + esc(b) + "</p>" : "") +
      '<div class="np-tl"><button type="button" class="btn" data-np="upr"' + (o.nac || o.prace ? " disabled" : "") + ">✏️ Navrhnúť úpravu</button>" +
      '<button type="button" class="btn btn-primary" data-np="podpis"' + (b || o.prace ? " disabled" : "") + ">" + (o.prace ? "Pracujem…" : papier(o.x) ? "✅ Prečítal(a) som" : oboz(o.x) ? "✍️ Prešiel/a som si – podpísať" : "✍️ Podpísať") + "</button></div>";
  }
  function uprHtml() {
    var o = S.o, x = o.x, u = o.upr; if (!u) return "";
    var zrus = '<button type="button" class="btn" data-np="upr-zrus">Zrušiť</button>';
    if (x.typ === "dochadzka") {
      if (u.navod) return '<section class="np-upr"><h3>✏️ Navrhnúť úpravu dochádzky</h3><p>Ťukni na <b>✏️</b> pri dni, ktorý nesedí (zabudnutý príchod alebo odchod, zlý čas), alebo pridaj deň, ktorý v dochádzke chýba. ' +
        "Úpravu schvaľuje CEO – kým ju neschváli, nepočíta sa.</p>" +
        '<div class="np-tl"><button type="button" class="btn" data-np="upr-den">➕ Chýba mi deň</button>' + zrus + "</div></section>";
      var r = u.r, mo = x.mesiac.slice(0, 7);
      return '<section class="np-upr"><h3>✏️ ' + (r ? "Oprava – " + esc(denSk(r.datum)) : "Chýbajúci deň") + "</h3>" +
        (r ? '<p class="muted">Teraz: ' + esc(MIESTA[r.miesto] || r.miesto || "") + " · " + esc(cas(r.prichod) || "–") + " – " + esc(cas(r.odchod) || "chýba") + "</p>" :
          '<label class="field"><span class="label">Deň</span><input type="date" id="np-u-dat" min="' + mo + '-01" max="' + posun(x.mesiac, 1).slice(0, 8) + '01"></label>' +
          '<label class="field"><span class="label">Miesto</span><select id="np-u-mie">' + ["ZBOJSKÁ", "ROZVOZ", "SLUŽOBKA", "BUCHTOMOBIL", "ADMINISTRATÍVA"].map(function (k) { return '<option value="' + k + '">' + MIESTA[k] + "</option>"; }).join("") + "</select></label>") +
        '<div class="np-2"><label class="field"><span class="label">Správny príchod</span><input type="time" id="np-u-pr" value="' + esc(r ? cas(r.prichod) : "") + '"></label>' +
        '<label class="field"><span class="label">Správny odchod</span><input type="time" id="np-u-od" value="' + esc(r ? cas(r.odchod) : "") + '"></label></div>' +
        '<label class="field"><span class="label">Dôvod (napr. zabudla som pípnuť odchod)</span><input type="text" id="np-u-poz" maxlength="300"></label>' +
        '<div class="np-tl"><button type="button" class="btn btn-primary" data-np="opr-ok"' + (o.prace ? " disabled" : "") + ">Poslať CEO na schválenie</button>" + zrus + "</div></section>";
    }
    return '<section class="np-upr"><h3>✏️ Navrhnúť úpravu</h3>' +
      (x.typ === "stravne" ? '<p class="muted">Stravné sa ráta z dochádzky – ak nesedí deň alebo čas, oprav dochádzku. Inak napíš, čo nesedí.</p>' : "") +
      (x.typ === "cp" ? '<p class="muted">Cesty (miesta, časy, km) môžeš upraviť priamo v Cestovných príkazoch.</p><div class="np-tl"><button type="button" class="btn" data-np="cp-modul">🧾 Upraviť cesty</button></div>' : "") +
      '<label class="field"><span class="label">Čo treba upraviť? Správa príde CEO.</span><textarea id="np-u-txt" rows="3" maxlength="2000"></textarea></label>' +
      '<div class="np-tl"><button type="button" class="btn btn-primary" data-np="prip-ok"' + (o.prace ? " disabled" : "") + ">Poslať CEO</button>" + zrus + "</div></section>";
  }

  // PDF (zmluva, dohoda…) – strany priamo v okne
  function pdfStrany(blob) {
    var PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/";
    var kn = window.pdfjsLib ? Promise.resolve(window.pdfjsLib) : new Promise(function (ok, zle) {
      var s = document.createElement("script"); s.src = PDFJS + "pdf.min.js";
      s.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; ok(window.pdfjsLib); };
      s.onerror = function () { zle(new Error("Prehliadač PDF sa nenačítal – skontroluj signál")); }; document.head.appendChild(s);
    });
    Promise.all([kn, blob.arrayBuffer()]).then(function (v) {
      return v[0].getDocument({ data: new Uint8Array(v[1]) }).promise.then(function (pdf) {
        var el = document.getElementById("np-pdf"); if (!el) return;
        el.innerHTML = "";
        var sirka = Math.min(el.clientWidth || 600, 900), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        var strana = function (i) {
          var e2 = document.getElementById("np-pdf"); if (!e2 || i > pdf.numPages) return;
          return pdf.getPage(i).then(function (p) {
            var z = p.getViewport({ scale: 1 }), vp = p.getViewport({ scale: sirka / z.width * dpr });
            var c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height; c.style.width = "100%"; c.className = "np-str"; e2.appendChild(c);
            return p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise.then(function () { return strana(i + 1); });
          });
        };
        return strana(1);
      });
    }).catch(function (e) { var el = document.getElementById("np-pdf"); if (el) el.innerHTML = '<p class="f-sprava f-chyba">' + esc(chyba(e)) + "</p>"; });
  }

  // ---------- akcie v okne ----------
  function podpis() {
    var o = S.o, x = o.x, d = o.data, os = osM(), P = window.lbzPodpis, m = meno(), ym = String(x.mesiac || "").slice(0, 7), pr, V = o.v;
    if (!P || !d || blok()) return;
    var zak = { db: DB, rola: V ? "zamestnavatel" : "zamestnanec", osoba: os };
    if (x.typ === "dochadzka") pr = P.podpisat(Object.assign(zak, { typ: "dochadzka", dokument: x.dokument, nazov: "Dochádzka " + mesNazov(x.mesiac) + " – " + m, subor: "dochadzka_" + ym,
      titul: V ? "Potvrdenie dochádzky za zamestnávateľa" : "Podpis dochádzky", vyhlasenie: V ? "Potvrdzujem výkaz dochádzky za " + mesNazov(x.mesiac) + " – " + m + "." : "Potvrdzujem, že výkaz dochádzky za " + mesNazov(x.mesiac) + " je správny.",
      obsah: JSON.stringify((d.riadky || []).map(function (r) { return [r.datum, r.typ, r.prichod, r.odchod, r.odpracovane_min, r.stravne]; })),
      html: function (pod) { return dochHtml(x, d.riadky || [], pod, false); } }));
    else if (x.typ === "stravne") {
      var s = d.stravne || {};
      pr = P.podpisat(Object.assign(zak, { typ: "mesiac", dokument: d.dokument, nazov: "Stravné " + mesNazov(x.mesiac) + " – " + m, subor: "stravne_" + ym, titul: V ? "Stravné – podpis za zamestnávateľa" : "Podpis – stravné",
        vyhlasenie: (V ? m + ": " : "") + "Potvrdzujem vyúčtovanie stravného za " + mesNazov(x.mesiac) + " (k výplate " + eur(s.k_vyplate) + ") a zálohu stravného na " + mesNazov(posun(x.mesiac, 1)) + " (" + eur(s.zaloha_dalsi) + ").",
        obsah: JSON.stringify([d.dokument, s.skutocne, s.zaloha, s.zaloha_dalsi, ((s.plan_dalsi || {}).smeny || []).map(function (r) { return [r.datum, r.miesto, r.min, r.suma]; })]),
        html: function (pod) { return stravHtml(d, pod); } }));
    }
    else if (x.typ === "cp" || x.typ === "hotovost") pr = d.podpisat();
    else if (x.typ === "absencia") pr = window.LBZ_DOCHADZKA && LBZ_DOCHADZKA.listokPodpis ? LBZ_DOCHADZKA.listokPodpis(d.a, m, os, zak.rola) : Promise.resolve({ ok: false, text: "Obnov appku" });
    else if (x.typ === "dokument") pr = P.podpisat(Object.assign(zak, { typ: "dokument", dokument: x.dokument, nazov: x.nazov + " – " + m, subor: "dokument_" + x.id,
      titul: papier(x) ? "Potvrdenie o prečítaní" : oboz(x) ? "Potvrdenie o oboznámení" : "Podpis dokumentu",
      vyhlasenie: papier(x) ? "Prečítal(a) som si dokument „" + x.nazov + "“. Originál podpíšem na papieri." : oboz(x) ? "Bol(a) som oboznámený(á) s dokumentom „" + x.nazov + "“, porozumel(a) som mu a budem ho dodržiavať." : "Prečítal(a) som si dokument „" + x.nazov + "“ a podpisujem ho.", obsah: d.hash,
      html: function (pod) { return dokHtml(x, d.hash, pod); } }));
    if (!pr) return;
    o.prace = true; casti();
    pr.then(function (r) {
      if (S.o !== o) return; o.prace = false;
      if (r && r.zrusene) { casti(); return; }
      if (r && r.ok && V) { o.hotovo = true; o.sprava = { typ: "ok", text: "✅ Podpísané za zamestnávateľa. PDF je v dokumentoch zamestnanca." }; teloKresli(); obnovKartu(); }
      else if (r && r.ok) { o.hotovo = true; o.upr = null; o.sprava = { typ: "ok", text: papier(x) ? "✅ Potvrdené. Originál podpíšeš na papieri." : oboz(x) ? "✅ Ďakujeme, oboznámenie je potvrdené." : "✅ Podpísané. Ďakujeme! PDF s podpisom je uložené v tvojich dokumentoch." }; teloKresli(); obnovKartu(); }
      else { o.sprava = { typ: "chyba", text: (r && r.text) || "Podpis sa nepodaril" }; casti(); }
    });
  }
  function posliOpravu() {
    var o = S.o, x = o.x, r = o.upr && o.upr.r, dat = r ? r.datum : hodnota("np-u-dat"), pr = hodnota("np-u-pr"), od = hodnota("np-u-od"), poz = hodnota("np-u-poz");
    if (!dat || dat.slice(0, 7) !== x.mesiac.slice(0, 7)) { o.sprava = { typ: "chyba", text: "Vyber deň v mesiaci " + mesNazov(x.mesiac) }; casti(); return; }
    if (!pr && !od) { o.sprava = { typ: "chyba", text: "Zadaj správny príchod alebo odchod" }; casti(); return; }
    if (poz.length < 3) { o.sprava = { typ: "chyba", text: "Napíš dôvod úpravy" }; casti(); return; }
    o.prace = true; o.sprava = null; casti();
    rpc("dochadzka_ziadost", { p: { prilohy: [], typ: "oprava", od: dat, do: dat, cas_od: pr, cas_do: od, poznamka: poz, miesto: r ? (r.miesto || "") : hodnota("np-u-mie"), dochadzka_id: r ? r.id : null } })
      .then(function (v) {
        if (!v || v.ok === false) throw new Error((v && v.text) || "Neodoslané");
        try { DB.functions.invoke("upozornenia", { body: { akcia: "ziadost" } }); } catch (e) { /* */ }
        if (S.o !== o) return;
        o.prace = false; o.upr = null; x.cakajuce_upravy = (x.cakajuce_upravy || 0) + 1;
        o.sprava = { typ: "ok", text: "Úprava odoslaná CEO na schválenie. Po schválení sa dochádzka opraví a potom ju podpíšeš." }; casti(); obnovKartu();
      }).catch(function (e) { if (S.o !== o) return; o.prace = false; o.sprava = { typ: "chyba", text: chyba(e) }; casti(); });
  }
  function posliPripomienku() {
    var o = S.o, x = o.x, t = hodnota("np-u-txt");
    if (t.length < 3) { o.sprava = { typ: "chyba", text: "Napíš, čo treba upraviť" }; casti(); return; }
    o.prace = true; o.sprava = null; casti();
    rpc("podpis_pripomienka", { p: { dokument: x.dokument, nazov: nazov(x), text: t } }).then(function (v) {
      if (!v || !v.ok) throw new Error((v && v.text) || "Neodoslané");
      fronta();
      if (S.o !== o) return;
      o.prace = false; o.upr = null; x.pripomienka = { text: t };
      o.sprava = { typ: "ok", text: "Pripomienka odoslaná CEO. Keď dokument upraví, príde ti znova na podpis." }; casti(); obnovKartu();
    }).catch(function (e) { if (S.o !== o) return; o.prace = false; o.sprava = { typ: "chyba", text: chyba(e) }; casti(); });
  }
  function otvorSubor(cesta, nazovSub) {
    var data = DB.storage.from("zamestnanci").download(cesta).then(function (r) { if (r.error || !r.data) throw r.error || new Error("Súbor sa nenašiel"); return r.data; });
    if (/\.pdf$/i.test(cesta) && window.lbzPdf) { window.lbzPdf(nazovSub, data); return; }
    var w = document.createElement("div"); w.className = "np-okno np-obr"; w.innerHTML = '<div class="np-hl"><button type="button" class="btn" data-np-obr-x="1">← Späť</button><b>' + esc(nazovSub) + '</b></div><div class="np-telo"><p class="muted">Načítavam…</p></div>';
    document.body.appendChild(w);
    data.then(function (b) { var u = URL.createObjectURL(b); w.querySelector(".np-telo").innerHTML = '<img src="' + u + '" alt="" style="max-width:100%;height:auto;display:block;margin:0 auto">'; })
      .catch(function (e) { w.querySelector(".np-telo").innerHTML = '<p class="f-sprava f-chyba">' + esc(chyba(e)) + "</p>"; });
  }

  // ---------- karta zamestnanca: nahraté dokumenty + poslanie na podpis ----------
  function sekcia(os, info) {
    if (!DB || !os || !info || !(info.ja || info.spravca)) return "";
    var st = S.sek[os];
    if (!st) { st = S.sek[os] = { info: info, nahrane: null, podpis: null, form: null, prace: false, sprava: null }; sekNacitaj(os); }
    st.info = info;
    return '<section class="card zm-sekcia np-sek" id="np-sek-' + os + '">' + sekHtml(os) + "</section>";
  }
  function sekNacitaj(os) {
    var st = S.sek[os];
    rpc("dokumenty_nahrane_zoznam", { p_osoba: os }).then(function (d) { st.nahrane = d || []; sekObnov(os); }).catch(function () { st.nahrane = []; sekObnov(os); });
    if (st.info.spravca) rpc("dokumenty_podpis_zoznam", { p_osoba: os }).then(function (d) { st.podpis = d || []; sekObnov(os); }).catch(function () { st.podpis = []; sekObnov(os); });
  }
  function sekObnov(os) { var el = document.getElementById("np-sek-" + os); if (el) el.innerHTML = sekHtml(os); }
  function sekHtml(os) {
    var st = S.sek[os], i = st.info, n = st.nahrane, h = '<div class="zm-s-hl"><h3>📎 ' + (i.ja ? "Moje nahraté dokumenty" : "Nahraté dokumenty") + "</h3></div>";
    if (st.sprava) h += '<p class="f-sprava f-' + st.sprava.typ + '">' + esc(st.sprava.text) + "</p>";
    h += n == null ? '<p class="muted" style="margin:0">Načítavam…</p>' : !n.length ? '<p class="muted" style="margin:0">Zatiaľ nič.' + (i.ja ? " Tu nahráš napr. potvrdenie o návšteve školy alebo súhlas zákonného zástupcu." : "") + "</p>" :
      '<div class="rows">' + n.map(function (x) {
        return '<div class="np-sek-r"><button type="button" class="row zm-dok-riadok" data-np-sub="' + esc(x.cesta) + '" data-nazov="' + esc(x.nazov) + '"><span>📎 ' + esc(x.nazov) + '</span><span class="muted">' +
          (x.platnost_do ? "platí do " + esc(datumD(x.platnost_do)) + " · " : "") + esc(new Date(x.vytvorene).toLocaleDateString("sk-SK")) + " ›</span></button>" +
          (i.spravca ? '<button type="button" class="np-x" data-np-nzmaz="' + x.id + '" data-os="' + os + '" title="Odstrániť">🗑</button>' : "") + "</div>";
      }).join("") + "</div>";
    if (st.form === "nahraj") {
      h += '<div class="np-form"><label class="field"><span class="label">O aký dokument ide?</span><select id="np-n-druh" data-np-druh="1"><option value="">– vyber –</option>' +
        DRUH_NAHRAJ.map(function (d) { return "<option>" + esc(d) + "</option>"; }).join("") + '<option value="ine">Iné – napíšem</option></select></label>' +
        '<label class="field" id="np-n-ine-p" hidden><span class="label">Napíš, o čo ide</span><input type="text" id="np-n-ine" maxlength="120"></label>' +
        '<label class="field"><span class="label">Platí do (ak je uvedené)</span><input type="date" id="np-n-plat"></label>' +
        '<label class="field"><span class="label">Súbor – fotka alebo PDF</span><input type="file" id="np-n-sub" accept="image/*,application/pdf"></label>' +
        '<div class="np-tl"><button type="button" class="btn btn-primary" data-np-sek="nahraj-ok" data-os="' + os + '"' + (st.prace ? " disabled" : "") + ">" + (st.prace ? "Nahrávam…" : "📎 Nahrať") + "</button>" +
        '<button type="button" class="btn" data-np-sek="zrus" data-os="' + os + '">Zrušiť</button></div></div>';
    } else h += '<div class="f-akcie"><button type="button" class="btn" data-np-sek="nahraj" data-os="' + os + '">📎 Nahrať dokument</button></div>';
    if (i.spravca) {
      var p = st.podpis;
      h += '<h4 style="margin:14px 0 4px">✍️ Poslané na podpis</h4>' + (p == null ? '<p class="muted" style="margin:0">Načítavam…</p>' : !p.length ? '<p class="muted" style="margin:0">Nič.</p>' :
        '<div class="rows">' + p.map(function (x) {
          return '<div class="np-sek-r"><button type="button" class="row zm-dok-riadok" data-np-sub="' + esc(x.cesta) + '" data-nazov="' + esc(x.nazov) + '"><span>' + (x.podpisane ? "✅ " : "⏳ ") + esc(x.nazov) + '</span><span class="muted">' +
            (x.podpisane ? (PAPIER.indexOf(x.druh) > -1 ? "prečítané " : "podpísané ") + esc(new Date(x.podpisane).toLocaleDateString("sk-SK")) + (PAPIER.indexOf(x.druh) > -1 ? " · originál na papieri" : "") : "čaká" + (x.termin ? " · do " + esc(datumK(x.termin)) : "")) + " ›</span></button>" +
            (x.podpisane ? "" : '<button type="button" class="np-x" data-np-dzrus="' + x.id + '" data-os="' + os + '" title="Zrušiť">✖</button>') + "</div>";
        }).join("") + "</div>");
      if (st.form === "podpis") {
        h += '<div class="np-form"><label class="field"><span class="label">Druh</span><select id="np-p-druh">' + DRUH_PODPIS.map(function (d) { return '<option value="' + d[0] + '">' + esc(d[1]) + "</option>"; }).join("") + "</select></label>" +
          '<label class="field"><span class="label">Názov (uvidí ho zamestnanec)</span><input type="text" id="np-p-naz" maxlength="150" placeholder="napr. Dohoda o brigádnickej práci študentov"></label>' +
          '<p class="muted" style="margin:0 0 6px">Zmluva, dohoda, dodatok: zamestnanec v appke len potvrdí, že si ich prečítal – originál podpíšete na papieri. GDPR a iné dokumenty podpíše v appke.</p>' +
          '<label class="field"><span class="label">Termín (prázdne = deň pred nástupom)</span><input type="date" id="np-p-ter"></label>' +
          '<label class="field"><span class="label">Súbor PDF</span><input type="file" id="np-p-sub" accept="application/pdf"></label>' +
          '<div class="np-tl"><button type="button" class="btn btn-primary" data-np-sek="podpis-ok" data-os="' + os + '"' + (st.prace ? " disabled" : "") + ">" + (st.prace ? "Posielam…" : "✍️ Poslať na podpis") + "</button>" +
          '<button type="button" class="btn" data-np-sek="zrus" data-os="' + os + '">Zrušiť</button></div></div>';
      } else h += '<div class="f-akcie"><button type="button" class="btn" data-np-sek="podpis" data-os="' + os + '">✍️ Poslať dokument na podpis</button></div>';
    }
    return h;
  }
  function nahraj(os) {
    var st = S.sek[os], druh = hodnota("np-n-druh"), ine = hodnota("np-n-ine"), plat = hodnota("np-n-plat"), f = document.getElementById("np-n-sub"), sub = f && f.files && f.files[0];
    if (druh === "ine") druh = ine;
    if (!druh) { st.sprava = { typ: "chyba", text: "Vyber alebo napíš, o aký dokument ide" }; sekObnov(os); return; }
    if (!sub) { st.sprava = { typ: "chyba", text: "Vyber súbor (fotku alebo PDF)" }; sekObnov(os); return; }
    if (sub.size > 15 * 1024 * 1024) { st.sprava = { typ: "chyba", text: "Súbor je väčší ako 15 MB" }; sekObnov(os); return; }
    var ext = (String(sub.name).match(/\.([a-z0-9]{2,5})$/i) || [, sub.type === "application/pdf" ? "pdf" : "jpg"])[1].toLowerCase();
    var naz = druh + " – " + (st.info.meno || "") + " – " + datumD(dnesIso());
    var cesta = os + "/nahrane/" + Date.now() + "_" + bezDiak(druh) + "." + ext;
    st.prace = true; st.sprava = null; sekObnov(os);
    DB.storage.from("zamestnanci").upload(cesta, sub, { contentType: sub.type || "application/octet-stream", upsert: false }).then(function (u) {
      if (u.error) throw u.error;
      return rpc("dokument_nahraj", { p: { osoba_id: os, druh: druh, nazov: naz, cesta: cesta, platnost_do: plat || null } });
    }).then(function (v) {
      if (!v || !v.ok) throw new Error((v && v.text) || "Neuložené");
      fronta(); st.prace = false; st.form = null; st.sprava = { typ: "ok", text: "Nahraté: " + naz }; sekNacitaj(os);
    }).catch(function (e) { st.prace = false; st.sprava = { typ: "chyba", text: chyba(e) }; sekObnov(os); });
  }
  function poslatNaPodpis(os) {
    var st = S.sek[os], druh = hodnota("np-p-druh"), naz = hodnota("np-p-naz"), ter = hodnota("np-p-ter"), f = document.getElementById("np-p-sub"), sub = f && f.files && f.files[0];
    if (!sub || !/pdf/i.test(sub.type || sub.name)) { st.sprava = { typ: "chyba", text: "Vyber súbor PDF" }; sekObnov(os); return; }
    if (!naz) naz = (DRUH_PODPIS.filter(function (d) { return d[0] === druh; })[0] || ["", "Dokument"])[1];
    var cesta = os + "/na_podpis/" + Date.now() + "_" + bezDiak(naz) + ".pdf";
    st.prace = true; st.sprava = null; sekObnov(os);
    lbzPodpis.sha256(sub).then(function (h) {
      return DB.storage.from("zamestnanci").upload(cesta, sub, { contentType: "application/pdf", upsert: false }).then(function (u) {
        if (u.error) throw u.error;
        return rpc("dokument_na_podpis", { p: { osoba_id: os, druh: druh, nazov: naz, cesta: cesta, sha256: h, termin: ter || null } });
      });
    }).then(function (v) {
      if (!v || !v.ok) throw new Error((v && v.text) || "Neodoslané");
      fronta(); st.prace = false; st.form = null; st.sprava = { typ: "ok", text: "Poslané na podpis: " + naz + " – zamestnancovi príde upozornenie." }; sekNacitaj(os);
    }).catch(function (e) { st.prace = false; st.sprava = { typ: "chyba", text: chyba(e) }; sekObnov(os); });
  }

  // CEO: ✏️ Upraviť → otvorí modul s dokumentom zamestnanca (dochádzka / cestovné príkazy)
  function vUpravit(x) {
    zavri(true);
    if ((x.typ === "dochadzka" || x.typ === "stravne") && window.LBZ_DOCHADZKA && LBZ_DOCHADZKA.otvorOsobu) { LBZ_DOCHADZKA.otvorOsobu(x.osoba_id, x.mesiac); if (window.lbzOtvorModul) lbzOtvorModul("dochadzka"); }
    else if ((x.typ === "cp" || x.typ === "hotovost") && window.LBZ_CESTY && LBZ_CESTY.otvor) { LBZ_CESTY.otvor(x.osoba_id, x.mesiac); if (window.lbzOtvorModul) lbzOtvorModul("cestovne"); }
  }

  // ---------- kliky ----------
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest("[data-np-otvor],[data-np-otvorv],[data-np],[data-np-opr],[data-np-vybav],[data-np-sub],[data-np-sek],[data-np-nzmaz],[data-np-dzrus],[data-np-obr-x]");
    if (!t || !DB) return;
    var d = t.dataset, o = S.o;
    if (d.npOtvor != null) { e.preventDefault(); otvor(+d.npOtvor); return; }
    if (d.npOtvorv != null) { e.preventDefault(); otvor(+d.npOtvorv, true); return; }
    if (d.npObrX) { var w = t.closest(".np-obr"); if (w) w.remove(); return; }
    if (d.npSub) { e.preventDefault(); otvorSubor(d.npSub, d.nazov || "Dokument"); return; }
    if (d.npVybav) {
      if (!lbzPotvrd("Označiť pripomienku ako vybavenú? Zamestnancovi príde upozornenie.")) return;
      rpc("podpis_pripomienka_vybav", { p_id: +d.npVybav, p_odpoved: null }).then(function () { fronta(); obnovKartu(); }).catch(function (x) { lbzInfo(chyba(x)); });
      return;
    }
    if (d.npSek) {
      var os = +d.os, st = S.sek[os]; if (!st) return;
      if (d.npSek === "nahraj" || d.npSek === "podpis") { st.form = d.npSek; st.sprava = null; sekObnov(os); }
      else if (d.npSek === "zrus") { st.form = null; st.sprava = null; sekObnov(os); }
      else if (d.npSek === "nahraj-ok") nahraj(os);
      else if (d.npSek === "podpis-ok") poslatNaPodpis(os);
      return;
    }
    if (d.npNzmaz) {
      if (!lbzPotvrd("Odstrániť nahratý dokument zo zoznamu?")) return;
      var os2 = +d.os; rpc("dokument_nahrany_zmaz", { p_id: +d.npNzmaz }).then(function () { sekNacitaj(os2); }).catch(function (x) { lbzInfo(chyba(x)); });
      return;
    }
    if (d.npDzrus) {
      if (!lbzPotvrd("Zrušiť dokument na podpis? Zamestnancovi zmizne zo zoznamu „Máš podpísať“.")) return;
      var os3 = +d.os; rpc("dokument_na_podpis_zrus", { p_id: +d.npDzrus }).then(function () { sekNacitaj(os3); obnovKartu(); }).catch(function (x) { lbzInfo(chyba(x)); });
      return;
    }
    if (!o) return;
    if (d.npOpr != null) { var r = ((o.data && o.data.riadky) || [])[+d.npOpr]; if (!r) return; o.upr = { r: r }; o.sprava = null; casti(); scrollUpr(); return; }
    switch (d.np) {
      case "zavri": zavri(); obnovKartu(); break;
      case "v-upr": vUpravit(o.x); break;
      case "podpis": podpis(); break;
      case "upr": o.upr = o.x.typ === "dochadzka" ? { navod: true } : {}; o.sprava = null; casti(); scrollUpr(); break;
      case "upr-den": o.upr = { r: null }; casti(); scrollUpr(); break;
      case "upr-zrus": o.upr = null; casti(); break;
      case "opr-ok": posliOpravu(); break;
      case "prip-ok": posliPripomienku(); break;
      case "cp-modul":
        if (window.LBZ_CESTY && LBZ_CESTY.nastavMesiac) LBZ_CESTY.nastavMesiac(o.x.mesiac);
        zavri(); if (window.lbzOtvorModul) window.lbzOtvorModul("cestovne"); break;
    }
  });
  document.addEventListener("change", function (e) {
    if (e.target && e.target.id === "np-n-druh") { var p = document.getElementById("np-n-ine-p"); if (p) p.hidden = e.target.value !== "ine"; }
  });
  function scrollUpr() { setTimeout(function () { var u = document.getElementById("np-upr"); if (u && u.firstChild) u.firstChild.scrollIntoView({ behavior: "smooth", block: "start" }); }, 30); }

  // ---------- štýly ----------
  var st = document.createElement("style");
  st.textContent = ".np-karta{border:2px solid var(--gold,#CBA75B)}.np-pozn{margin:0 0 8px;font-size:13px}.np-zoz{display:flex;flex-direction:column;gap:6px}" +
    ".np-pol{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid var(--line,#e6dccb);border-radius:12px;background:var(--surface,#fff);color:inherit;padding:10px 12px;font:inherit;cursor:pointer;min-height:52px}" +
    ".np-pol.np-po{border-color:#c62828;background:#fdecea}.np-pol.np-po small{color:#b71c1c;font-weight:600}.np-ik{font-size:22px}.np-t{flex:1;min-width:0;display:flex;flex-direction:column}.np-t small{color:var(--muted,#6b5b55)}.np-sip{font-size:20px;color:var(--muted,#6b5b55)}" +
    ".np-h4{margin:14px 0 6px}.np-pr{display:flex;gap:8px;align-items:center;justify-content:space-between;border-top:1px dashed var(--line,#e6dccb);padding:8px 0}.np-pr-t{font-style:italic}" +
    ".np-okno{position:fixed;inset:0;z-index:2000;background:var(--bg,#faf6ee);display:flex;flex-direction:column}" +
    ".np-hl{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line,#e6dccb);background:var(--surface,#fff)}.np-hl b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".np-telo{flex:1;overflow:auto;padding:12px;-webkit-overflow-scrolling:touch}.np-dok{background:#fff;color:#222;border-radius:12px;padding:14px;max-width:900px;margin:0 auto;box-shadow:0 1px 4px rgba(0,0,0,.08)}" +
    ".np-dok h1{font-size:20px;margin:0 0 6px}.np-dok h2{font-size:16px}.np-dok h3{font-size:15px;margin:12px 0 4px}.np-dok table{width:100%;border-collapse:collapse;margin:6px 0;font-size:13px}" +
    ".np-dok th,.np-dok td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top}.np-dok th{background:#f5ecd9}.np-dok .t-r{text-align:right;white-space:nowrap}.np-tab{overflow-x:auto}" +
    ".np-dok .pdp-riadok{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:16px}.np-dok .pdp-slot{font-size:12px}.np-opr{border:1px solid var(--line,#ddd);background:#fff;border-radius:8px;min-width:36px;min-height:36px;cursor:pointer}" +
    ".np-pdf .np-str{display:block;margin:0 auto 10px;box-shadow:0 1px 4px rgba(0,0,0,.2)}.np-upr{max-width:900px;margin:12px auto;background:var(--surface,#fff);border:2px solid var(--gold,#CBA75B);border-radius:12px;padding:12px}" +
    ".np-upr h3{margin:0 0 6px}.np-2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.np-upr textarea,.np-upr input,.np-upr select,.np-form input,.np-form select{width:100%;min-height:44px;font:inherit;border:1px solid var(--line,#ddd);border-radius:8px;padding:8px;background:var(--bg,#fff);color:inherit}" +
    ".np-paticka{padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--line,#e6dccb);background:var(--surface,#fff)}.np-tl{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}" +
    ".np-paticka .np-tl .btn{flex:1;min-height:48px;font-size:16px}.np-blok{margin:0 0 8px;font-size:13px;color:#8a4b00}.np-papier{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:#fff4dc;border:1px solid #CBA75B;color:#5a3d00;font-size:14px}body.np-otvorene{overflow:hidden}#np-msg .f-sprava{max-width:900px;margin:10px auto}" +
    ".np-sek-r{display:flex;align-items:center;gap:6px}.np-sek-r .row{flex:1}.np-x{border:0;background:none;font-size:16px;cursor:pointer;min-width:40px;min-height:40px}.np-form{margin-top:8px;padding:10px;border:1px dashed var(--line,#ddd);border-radius:10px}";
  document.head.appendChild(st);

  window.LBZ_NAPODPIS = {
    nastavDb: function (klient, rola) { DB = klient || null; ROLA = klient ? rola : null; S.karta = null; S.sek = {}; if (!klient) zavri(true); },
    karta: karta,
    sekcia: sekcia,
    obnov: obnovKartu,
    _test: { S: S, otvor: otvor }   // testovanie z konzoly (vzorky na testovacom profile)
  };
})();
