// LBZ aplikácia – modul Zamestnanci
// IT/CEO: zoznam a karta zamestnanca (kontakt, pracovný pomer, dane a odvody, citlivé údaje, dokumenty, história zmien), nový zamestnanec.
// Účtovníčka: len čítanie. Zamestnanec: „Moje údaje“ – vidí a dopĺňa svoje osobné údaje (namiesto formulára „Zamestnanci – prihlásenie“).
// Mzdy sa v appke nevedú. Citlivé údaje sú skryté, kým ich nezobrazíš.

(function () {
  "use strict";

  var DB = null, ROLA = null, koren = null;
  var Z = { zoznam: null, info: null, detail: null, osoba: null, uprav: null, filter: "aktivni", hladaj: "", sprava: null, ukazCitlive: false, novy: false, prace: false };

  var TYP_VZTAHU = ["TPP", "DPČ", "DoVP", "DoBPŠ", "Študent", "Paušál", "DOV"];
  var POZICIE = ["Pomocný pekár", "Pomocný pekár a predavač", "Čašník – obsluha", "Prevádzkar", "Rozvozár – zásobovač", "Manažment"];
  var POISTOVNE = ["VšZP", "Dôvera", "Union"];
  var VZDELANIE = ["Základné", "Stredné bez maturity (výučný list)", "Stredné s maturitou", "Vyššie odborné", "Vysokoškolské I. stupňa", "Vysokoškolské II. stupňa", "Vysokoškolské III. stupňa"];

  // [kľúč, popis, typ, možnosti] – typ: t text, d dátum, b áno/nie, s výber, a dlhý text, n číslo, e e-mail, p telefón, u odkaz
  var SEKCIE = [
    { id: "kontakt", nazov: "👤 Osobné a kontakt", tab: "z", polia: [
      ["titul", "Titul", "t"], ["meno", "Meno", "t"], ["priezvisko", "Priezvisko", "t"], ["telefon", "Telefón", "p"], ["email", "E-mail", "e"],
      ["ulica", "Ulica a číslo (trvalý pobyt)", "t"], ["psc", "PSČ", "t"], ["obec", "Obec", "t"], ["kor_adresa", "Korešpondenčná adresa (ak je iná)", "t"],
      ["vzdelanie", "Najvyššie vzdelanie", "s", VZDELANIE], ["odbor", "Odbor / škola", "t"], ["vodicak", "Vodičský preukaz", "b"],
      ["zdrav_preukaz", "Zdravotný preukaz (potravinárstvo) – vydaný", "d"]] },
    { id: "pomer", nazov: "💼 Pracovný pomer", tab: "z", pomer: true, polia: [
      ["stav", "Stav", "s", [["aktivny", "pracuje"], ["uchadzac", "uchádzač / pred nástupom"], ["ukonceny", "ukončený"]]],
      ["typ_vztahu", "Typ vzťahu", "s", TYP_VZTAHU], ["pozicia", "Pozícia", "s", POZICIE], ["druh_prace", "Druh práce (stručne)", "t"],
      ["napln_prace", "Náplň práce", "a"], ["miesto_vykonu", "Miesto výkonu práce", "t"], ["nastup", "Deň nástupu", "d"], ["koniec", "Koniec (prázdne = neurčito)", "d"],
      ["skusobna", "Skúšobná doba", "t"], ["narocnost", "Stupeň náročnosti (1–6)", "n"], ["isco", "Kód ISCO-08", "t"], ["rozsah_hodin", "Rozsah hodín (týždenne)", "t"],
      ["pracovne_dni", "Pracovné dni", "t"], ["pracovny_cas", "Pracovný čas", "t"], ["typ_prijmu", "Typ príjmu", "s", ["Pravidelný", "Nepravidelný"]],
      ["poznamka", "Poznámka", "a"]] },
    { id: "dane", nazov: "🧾 Dane a odvody", tab: "z", polia: [
      ["nczd", "Uplatňuje NČZD u nás", "b"], ["bonus_deti", "Daňový bonus na deti", "b"], ["odvod_vynimka", "Odvodová výnimka (dohoda – študent / dôchodca)", "b"],
      ["student", "Študent", "b"], ["skola", "Škola a platnosť potvrdenia", "t"], ["dochodca", "Poberateľ dôchodku", "b"], ["urad_prace", "Evidovaný na úrade práce", "b"],
      ["ine_zamestnanie", "Iné zamestnanie / SZČO", "b"]] },
    { id: "citlive", nazov: "🔒 Citlivé údaje", tab: "c", citlive: true, polia: [
      ["rodne_priezvisko", "Rodné priezvisko", "t"], ["pohlavie", "Pohlavie", "s", ["žena", "muž"]], ["datum_narodenia", "Dátum narodenia", "d"], ["miesto_narodenia", "Miesto narodenia", "t"],
      ["rodne_cislo", "Rodné číslo", "t"], ["cislo_op", "Číslo občianskeho preukazu", "t"], ["statna_prislusnost", "Štátna príslušnosť", "t"], ["rodinny_stav", "Rodinný stav", "t"],
      ["zdravotna_poistovna", "Zdravotná poisťovňa", "s", POISTOVNE], ["iban", "IBAN (výplata)", "t"], ["ztp", "Preukaz ZŤP", "b"],
      ["deti", "Deti (meno, priezvisko, rodné číslo – každé na riadok)", "a"], ["zakonny_zastupca", "Zákonný zástupca (ak je mladší ako 18)", "a"], ["cudzinec", "Cudzinec: štát narodenia, povolenie na pobyt", "t"]] },
    { id: "dokumenty", nazov: "📁 Dokumenty", tab: "z", pomer: true, polia: [["dokumenty_url", "Priečinok s dokumentmi (odkaz na Disk)", "u"], ["dochadzka_subor", "Stará dochádzka (ID súboru)", "t"]] }
  ];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function rpc(n, a) { return DB.rpc(n, a || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function chybaText(e) { return (e && (e.message || e.text)) || "Bez spojenia so serverom"; }
  function datum(s) { if (!s) return ""; var p = String(s).slice(0, 10).split("-"); return +p[2] + ". " + +p[1] + ". " + p[0]; }
  function kresli() { if (koren && koren.isConnected) prekresli(); }
  function spravca() { return ROLA === "it" || ROLA === "ceo"; }
  function citatel() { return spravca() || ROLA === "uctovnicka"; }
  function celeMeno(x) { var m = [x.priezvisko, x.meno].filter(Boolean).join(" "); return m || x.prezyvka || ""; }
  function iniciala(x) { return String((x.meno || x.prezyvka || "?")).trim().charAt(0).toUpperCase(); }
  function farbaText(bg) { var m = /^#?([0-9a-f]{6})$/i.exec(bg || ""); if (!m) return "#2b1d1a"; var n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#2b1d1a" : "#fff"; }
  function avatar(x, velky) { return '<span class="zm-av' + (velky ? " zm-av-v" : "") + '" style="background:' + esc(x.farba || "#CBA75B") + ";color:" + farbaText(x.farba) + '">' + esc(iniciala(x)) + "</span>"; }

  // ---------- načítanie ----------
  function nacitajZoznam() {
    return rpc("zam_zoznam").then(function (d) {
      if (!d || !d.ok) { Z.zoznam = []; Z.sprava = { typ: "chyba", text: (d && d.text) || "Nenačítané" }; kresli(); return; }
      Z.info = d; Z.zoznam = d.zoznam || [];
      if (!d.citatel && d.moja && Z.osoba == null) otvor(d.moja); else kresli();
    }).catch(function (e) { Z.zoznam = []; Z.sprava = { typ: "chyba", text: chybaText(e) }; kresli(); });
  }
  function otvor(id) {
    Z.osoba = id; Z.detail = null; Z.uprav = null; Z.ukazCitlive = false; kresli();
    if (window.lbzPamat) lbzPamat.uloz("zam", { osoba: id });
    return rpc("zam_detail", { p_osoba: id }).then(function (d) { Z.detail = d && d.ok ? d : { chyba: (d && d.text) || "Nenačítané" }; kresli(); })
      .catch(function (e) { Z.detail = { chyba: chybaText(e) }; kresli(); });
  }

  // ---------- zoznam ----------
  function pohladZoznam() {
    if (Z.zoznam == null) return '<div class="empty"><strong>Načítavam…</strong></div>';
    var q = Z.hladaj.toLowerCase();
    var z = Z.zoznam.filter(function (x) {
      if (Z.filter === "aktivni" && (x.stav === "ukonceny" || !x.aktivny)) return false;
      if (Z.filter === "ukonceni" && !(x.stav === "ukonceny" || !x.aktivny)) return false;
      return !q || (celeMeno(x) + " " + x.prezyvka + " " + (x.pozicia || "") + " " + (x.email || "")).toLowerCase().indexOf(q) > -1;
    });
    var bezUctu = Z.zoznam.filter(function (x) { return x.stav !== "ukonceny" && x.aktivny && !x.ucet; }).length;
    return '<div class="zm-lista"><input id="zm-hladaj" class="zm-hladaj" type="search" placeholder="🔍 Hľadať meno, pozíciu…" value="' + esc(Z.hladaj) + '">' +
      '<div class="f-seg" role="group">' + [["aktivni", "Aktívni"], ["ukonceni", "Ukončení"], ["vsetci", "Všetci"]].map(function (f) {
        return '<button data-zm-filter="' + f[0] + '" aria-pressed="' + (Z.filter === f[0]) + '">' + f[1] + "</button>";
      }).join("") + "</div>" + (spravca() ? '<button class="btn btn-primary zm-novy-tl" data-zm="novy">➕ Nový zamestnanec</button>' : "") + "</div>" +
      (bezUctu && citatel() ? '<p class="muted zm-tip">💡 ' + bezUctu + " ľudí zatiaľ nemá účet v appke (chýba e-mail alebo sa ešte neprihlásili) – nevidia svoje smeny ani dochádzku.</p>" : "") +
      (z.length ? '<div class="zm-grid">' + z.map(function (x) {
        var vypl = Math.round(Math.min(11, x.vyplnene || 0) / 11 * 100);
        return '<button class="zm-karta' + (x.stav === "ukonceny" || !x.aktivny ? " zm-ukonc" : "") + '" data-zm-osoba="' + x.osoba_id + '">' + avatar(x) +
          '<span class="zm-k-txt"><b>' + esc(celeMeno(x)) + "</b>" + (celeMeno(x) !== x.prezyvka ? ' <span class="muted">(' + esc(x.prezyvka) + ")</span>" : "") +
          '<span class="zm-k-pod">' + esc([x.pozicia, x.typ_vztahu].filter(Boolean).join(" · ") || "doplň pracovný pomer") + "</span>" +
          '<span class="zm-k-stitky">' + (x.stav === "uchadzac" ? '<span class="pill info">pred nástupom</span>' : "") +
          (!x.ucet ? '<span class="pill warn">bez účtu</span>' : "") + (x.dotaznik ? '<span class="pill ok">✓ údaje potvrdené</span>' : "") + "</span></span>" +
          '<span class="zm-k-vypl" title="Vyplnené údaje"><i style="width:' + vypl + '%"></i></span></button>';
      }).join("") + "</div>" : '<div class="empty"><strong>Nikto nezodpovedá filtru</strong></div>');
  }

  // ---------- detail ----------
  function hodnota(p, v) {
    if (v == null || v === "") return '<span class="muted">—</span>';
    if (p[2] === "b") return v === true || v === "true" ? "áno" : "nie";
    if (p[2] === "d") return esc(datum(v));
    if (p[2] === "u") return '<a href="' + esc(v) + '" target="_blank" rel="noopener">Otvoriť ↗</a>';
    if (p[2] === "e") return '<a href="mailto:' + esc(v) + '">' + esc(v) + "</a>";
    if (p[2] === "p") return '<a href="tel:' + esc(String(v).replace(/\s/g, "")) + '">' + esc(v) + "</a>";
    if (p[2] === "s" && p[3] && Array.isArray(p[3][0])) { var o = p[3].filter(function (x) { return x[0] === v; })[0]; return esc(o ? o[1] : v); }
    return esc(v).replace(/\n/g, "<br>");
  }
  function vstup(p, v, sekcia) {
    var id = "zm-f-" + p[0], val = v == null ? "" : v;
    if (p[2] === "b") return '<select id="' + id + '" data-zm-pole="' + p[0] + '" data-zm-tab="' + sekcia.tab + '"><option value=""></option><option value="true"' + (val === true ? " selected" : "") + '>áno</option><option value="false"' + (val === false ? " selected" : "") + ">nie</option></select>";
    if (p[2] === "s") {
      var opt = p[3].map(function (o) { return Array.isArray(o) ? o : [o, o]; });
      if (val && !opt.some(function (o) { return o[0] === val; })) opt.push([val, val]);
      return '<select id="' + id + '" data-zm-pole="' + p[0] + '" data-zm-tab="' + sekcia.tab + '"><option value=""></option>' + opt.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === val ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>";
    }
    if (p[2] === "a") return '<textarea id="' + id + '" rows="3" data-zm-pole="' + p[0] + '" data-zm-tab="' + sekcia.tab + '">' + esc(val) + "</textarea>";
    var typ = { d: "date", n: "number", e: "email", p: "tel", u: "url" }[p[2]] || "text";
    return '<input id="' + id + '" type="' + typ + '" data-zm-pole="' + p[0] + '" data-zm-tab="' + sekcia.tab + '" value="' + esc(String(val).slice(0, typ === "date" ? 10 : 999)) + '"' + (p[0] === "narocnost" ? ' min="1" max="6"' : "") + ">";
  }
  function mozemUpravit(s) {
    var d = Z.detail; if (!d) return false;
    if (d.spravca) return true;
    return d.ja && !s.pomer;   // zamestnanec: osobné, dane, citlivé
  }
  function sekciaHtml(s) {
    var d = Z.detail, data = d[s.tab] || {}, upr = Z.uprav === s.id;
    var skryte = s.citlive && !Z.ukazCitlive && !upr;
    var vyplnene = s.polia.filter(function (p) { return data[p[0]] != null && data[p[0]] !== ""; }).length;
    var hl = '<div class="zm-s-hl"><h3>' + s.nazov + ' <span class="muted zm-s-poc">' + vyplnene + "/" + s.polia.length + "</span></h3>" +
      (upr ? "" : (s.citlive && !upr ? '<button class="btn-link" data-zm="citlive">' + (Z.ukazCitlive ? "🙈 Skryť" : "👁 Zobraziť") + "</button>" : "") +
        (mozemUpravit(s) ? '<button class="btn zm-upr" data-zm-upr="' + s.id + '">✏️ Upraviť</button>' : "")) + "</div>";
    if (upr) {
      return '<form class="card zm-sekcia zm-edit" id="zm-form" data-sekcia="' + s.id + '">' + hl + '<div class="zm-polia">' +
        s.polia.map(function (p) { return '<label class="field' + (p[2] === "a" ? " zm-siroke" : "") + '"><span class="label">' + esc(p[1]) + "</span>" + vstup(p, data[p[0]], s) + "</label>"; }).join("") +
        (s.id === "pomer" && d.spravca ? '<label class="field"><span class="label">Denná norma (h) – dochádzka</span><input id="zm-f-norma" type="number" step="0.25" min="1" max="24" value="' + esc(d.osoba && d.osoba.norma_h) + '"></label>' : "") +
        '</div><div class="f-akcie"><button class="btn btn-primary" type="submit"' + (Z.prace ? " disabled" : "") + ">" + (Z.prace ? "Ukladám…" : "Uložiť") + '</button><button class="btn" type="button" data-zm="zrus">Zrušiť</button></div></form>';
    }
    return '<section class="card zm-sekcia">' + hl + (skryte ? '<p class="muted zm-skryte">Údaje sú skryté. Vyplnené ' + vyplnene + " z " + s.polia.length + ".</p>" :
      (vyplnene || s.id === "pomer" ? '<dl class="zm-dl">' + s.polia.filter(function (p) { return data[p[0]] != null && data[p[0]] !== ""; }).map(function (p) { return "<dt>" + esc(p[1]) + "</dt><dd>" + hodnota(p, data[p[0]]) + "</dd>"; }).join("") +
      (s.id === "pomer" ? "<dt>Denná norma (dochádzka)</dt><dd>" + esc(d.osoba && d.osoba.norma_h) + " h</dd>" : "") + "</dl>" : "") +
      (vyplnene < s.polia.length ? '<p class="muted zm-chyba-pol">' + (vyplnene ? "Nevyplnené: " : "Zatiaľ nevyplnené: ") + esc(s.polia.filter(function (p) { return data[p[0]] == null || data[p[0]] === ""; }).map(function (p) { return p[1].replace(/ \(.*\)$/, ""); }).join(", ")) + "</p>" : "")) + "</section>";
  }
  function pohladDetail() {
    var d = Z.detail;
    var spat = citatel() ? '<button class="btn-link zm-spat" data-zm="spat">← Zamestnanci</button>' : "";
    if (!d) return spat + '<div class="empty"><strong>Načítavam…</strong></div>';
    if (d.chyba) return spat + '<div class="empty"><strong>' + esc(d.chyba) + "</strong></div>";
    var o = d.osoba || {}, z = d.z || {};
    var x = { farba: o.farba, meno: z.meno, prezyvka: o.prezyvka };
    var sekcie = SEKCIE.filter(function (s) { return !(s.id === "dokumenty" && !citatel()); });
    return spat + '<div class="zm-hlava">' + avatar(x, true) + '<div><h2>' + esc(celeMeno({ priezvisko: z.priezvisko, meno: z.meno, prezyvka: o.prezyvka })) + "</h2>" +
      '<div class="sub">' + esc([o.prezyvka !== celeMeno({ priezvisko: z.priezvisko, meno: z.meno, prezyvka: o.prezyvka }) ? "v rozpise „" + o.prezyvka + "“" : "", z.pozicia, z.typ_vztahu, z.nastup ? "od " + datum(z.nastup) : ""].filter(Boolean).join(" · ")) + "</div>" +
      '<div class="zm-k-stitky">' + (d.ucet ? '<span class="pill ok">má účet v appke</span>' : '<span class="pill warn">bez účtu v appke</span>') +
      (z.dotaznik ? '<span class="pill ok">údaje potvrdené ' + esc(datum(z.dotaznik)) + "</span>" : '<span class="pill info">údaje nepotvrdené</span>') + "</div></div></div>" +
      (d.ja && !z.dotaznik ? '<div class="card zm-vyzva"><b>📝 Skontroluj a doplň svoje údaje</b><p class="muted">Potrebujeme ich na pracovnú zmluvu a mzdy. Vidí ich len vedenie a účtovníčka.</p>' +
        '<label class="k-prepinac"><input type="checkbox" id="zm-suhlas"> <span>Súhlasím so spracúvaním osobných údajov na účely pracovnoprávneho vzťahu (V sedle u Falťanov s.r.o.).</span></label>' +
        '<button class="btn btn-primary" data-zm="potvrd">✅ Moje údaje sú správne</button></div>' : "") +
      '<div class="zm-sekcie">' + sekcie.map(sekciaHtml).join("") + "</div>" +
      (citatel() && (d.log || []).length ? '<details class="card zm-log"><summary>🕘 História zmien</summary><div class="rows">' + d.log.map(function (l) {
        return '<div class="row"><span>' + esc(new Date(l.kedy).toLocaleString("sk-SK", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })) + " · " + esc(l.kto || "") + '</span><span class="muted">' + esc((l.polia || []).join(", ")) + "</span></div>";
      }).join("") + "</div></details>" : "");
  }

  function dialogNovy() {
    if (!Z.novy) return "";
    return '<div class="f-dialog-pozadie" data-zm="zavri-novy"></div><div class="f-dialog" role="dialog" aria-modal="true"><form class="f-form" id="zm-novy-form"><h3>Nový zamestnanec</h3>' +
      '<div class="d-riadok"><label class="field"><span class="label">Meno</span><input id="zm-n-meno" required></label><label class="field"><span class="label">Priezvisko</span><input id="zm-n-priezvisko" required></label></div>' +
      '<div class="d-riadok"><label class="field"><span class="label">Meno v rozpise (prezývka)</span><input id="zm-n-prez" required placeholder="napr. Zuzka"></label><label class="field"><span class="label">E-mail (na prihlásenie)</span><input id="zm-n-email" type="email"></label></div>' +
      '<div class="d-riadok"><label class="field"><span class="label">Typ vzťahu</span><select id="zm-n-typ"><option></option>' + TYP_VZTAHU.map(function (t) { return "<option>" + t + "</option>"; }).join("") + "</select></label>" +
      '<label class="field"><span class="label">Pozícia</span><select id="zm-n-poz"><option></option>' + POZICIE.map(function (t) { return "<option>" + esc(t) + "</option>"; }).join("") + "</select></label></div>" +
      '<div class="d-riadok"><label class="field"><span class="label">Deň nástupu</span><input id="zm-n-nastup" type="date"></label>' +
      '<label class="field"><span class="label">Stav</span><select id="zm-n-stav"><option value="aktivny">pracuje</option><option value="uchadzac">uchádzač / pred nástupom</option></select></label></div>' +
      '<p class="muted" style="margin:0;font-size:13px">Po uložení mu pošli odkaz na appku – po prihlásení (Google alebo e-mail) si sám doplní osobné údaje.</p>' +
      '<div class="f-akcie"><button class="btn btn-primary" type="submit">Pridať</button><button class="btn" type="button" data-zm="zavri-novy">Zrušiť</button></div></form></div>';
  }

  function prekresli() {
    if (!koren) return;
    var y = window.scrollY, fok = document.activeElement && document.activeElement.id;
    koren.innerHTML = '<div class="zm-modul">' + (Z.osoba == null ? '<div class="head"><div><h2>Zamestnanci</h2><div class="sub">' + (Z.zoznam ? Z.zoznam.filter(function (x) { return x.stav !== "ukonceny" && x.aktivny; }).length + " aktívnych" : "") + "</div></div></div>" : "") +
      (Z.sprava ? '<p class="f-sprava f-' + Z.sprava.typ + '">' + esc(Z.sprava.text) + ' <button class="btn-link" data-zm="zavri-spravu">✕</button></p>' : "") +
      (Z.osoba == null ? pohladZoznam() : pohladDetail()) + "</div>" + dialogNovy();
    if (fok === "zm-hladaj") { var h = document.getElementById("zm-hladaj"); if (h) { h.focus(); h.setSelectionRange(h.value.length, h.value.length); } }
    window.scrollTo(0, y);
  }

  // ---------- udalosti ----------
  function klik(e) {
    var t = e.target.closest("button, [data-zm]"); if (!t || !koren.contains(t)) return;
    if (t.dataset.zmOsoba) { otvor(+t.dataset.zmOsoba); window.scrollTo(0, 0); return; }
    if (t.dataset.zmFilter) { Z.filter = t.dataset.zmFilter; prekresli(); return; }
    if (t.dataset.zmUpr) { Z.uprav = t.dataset.zmUpr; Z.sprava = null; prekresli(); var f = document.getElementById("zm-form"); if (f) f.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
    var a = t.dataset.zm;
    if (a === "spat") { Z.osoba = null; Z.detail = null; Z.uprav = null; if (window.lbzPamat) lbzPamat.uloz("zam", {}); nacitajZoznam(); prekresli(); }
    else if (a === "zrus") { Z.uprav = null; prekresli(); }
    else if (a === "citlive") { Z.ukazCitlive = !Z.ukazCitlive; prekresli(); }
    else if (a === "novy") { Z.novy = true; prekresli(); var m = document.getElementById("zm-n-meno"); if (m) m.focus(); }
    else if (a === "zavri-novy") { Z.novy = false; prekresli(); }
    else if (a === "zavri-spravu") { Z.sprava = null; prekresli(); }
    else if (a === "potvrd") {
      var s = document.getElementById("zm-suhlas");
      if (!s || !s.checked) { lbzInfo("Najprv zaškrtni súhlas so spracúvaním osobných údajov."); return; }
      rpc("zam_uloz", { p: { osoba_id: Z.osoba, dotaznik: true, suhlas: true } }).then(function () { Z.sprava = { typ: "ok", text: "Ďakujeme, údaje sú potvrdené." }; otvor(Z.osoba); })
        .catch(function (x) { lbzInfo(chybaText(x)); });
    }
  }
  function odoslanie(e) {
    if (e.target.id === "zm-form") {
      e.preventDefault();
      var p = { osoba_id: Z.osoba, z: {}, c: {} };
      e.target.querySelectorAll("[data-zm-pole]").forEach(function (el) { p[el.dataset.zmTab][el.dataset.zmPole] = el.value.trim(); });
      var n = document.getElementById("zm-f-norma"); if (n) p.norma_h = n.value;
      Z.prace = true; prekresli();
      rpc("zam_uloz", { p: p }).then(function (r) {
        Z.prace = false;
        if (r && r.ok) { Z.uprav = null; Z.sprava = { typ: "ok", text: r.text }; otvor(Z.osoba); } else { Z.sprava = { typ: "chyba", text: (r && r.text) || "Nepodarilo sa uložiť" }; prekresli(); }
      }).catch(function (x) { Z.prace = false; Z.sprava = { typ: "chyba", text: chybaText(x) }; prekresli(); });
    } else if (e.target.id === "zm-novy-form") {
      e.preventDefault();
      var g = function (id) { return document.getElementById(id).value.trim(); };
      rpc("zam_novy", { p: { meno: g("zm-n-meno"), priezvisko: g("zm-n-priezvisko"), prezyvka: g("zm-n-prez"), email: g("zm-n-email"), typ_vztahu: g("zm-n-typ"), pozicia: g("zm-n-poz"), nastup: g("zm-n-nastup"), stav: g("zm-n-stav") } })
        .then(function (r) {
          if (r && r.ok) { Z.novy = false; Z.sprava = { typ: "ok", text: r.text }; nacitajZoznam(); otvor(r.osoba_id); }
          else lbzInfo((r && r.text) || "Nepodarilo sa pridať");
        }).catch(function (x) { lbzInfo(chybaText(x)); });
    }
  }
  function vstupEv(e) { if (e.target.id === "zm-hladaj") { Z.hladaj = e.target.value; prekresli(); } }

  window.LBZ_ZAMESTNANCI = {
    nastavDb: function (klient, rola) { DB = klient || null; ROLA = klient ? rola : null; Z.zoznam = null; Z.detail = null; Z.osoba = null; },
    mozem: function () { return !!DB && ["it", "ceo", "uctovnicka", "zamestnanec"].indexOf(ROLA) > -1; },
    mount: function (el) {
      koren = el;
      el.addEventListener("click", klik); el.addEventListener("submit", odoslanie); el.addEventListener("input", vstupEv);
      var pam = window.lbzPamat && lbzPamat.nacitaj("zam");
      prekresli();
      nacitajZoznam().then(function () { if (pam && pam.osoba && Z.osoba == null && citatel()) otvor(pam.osoba); });
    }
  };
})();
