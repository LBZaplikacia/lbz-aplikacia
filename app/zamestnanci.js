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
  function spravca() { return ROLA === "it" || ROLA === "ceo" || ROLA === "uctovnicka"; }
  function citatel() { return spravca(); }
  function pole(k) { for (var i = 0; i < SEKCIE.length; i++) { var p = SEKCIE[i].polia.filter(function (x) { return x[0] === k; })[0]; if (p) return p; } return [k, k, "t"]; }
  function zmenyHtml(zm, stare) {
    var r = [];
    ["z", "c"].forEach(function (t) { Object.keys((zm && zm[t]) || {}).forEach(function (k) {
      var p = pole(k), st = stare && stare[t] ? stare[t][k] : undefined;
      r.push("<li><b>" + esc(p[1].replace(/ \(.*\)$/, "")) + ":</b> " + (st != null && st !== "" ? '<s class="muted">' + hodnota(p, st) + "</s> → " : "") + (zm[t][k] === "" || zm[t][k] == null ? "<i>vymazať</i>" : hodnota(p, zm[t][k])) + "</li>");
    }); });
    return '<ul class="zm-zmeny">' + r.join("") + "</ul>";
  }
  function ziadostiHtml(zoz, sDetailom) {
    if (!zoz || !zoz.length) return "";
    return '<section class="card zm-ziadosti"><h3>📨 Žiadosti o zmenu údajov <span class="pill warn">' + zoz.length + "</span></h3>" + zoz.map(function (z) {
      return '<div class="zm-ziadost">' + (sDetailom ? '<button class="btn-link" data-zm-osoba="' + z.osoba_id + '"><b>' + esc(z.osoba) + "</b></button> " : "") +
        '<span class="muted">' + esc(new Date(z.kedy).toLocaleString("sk-SK", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })) + "</span>" +
        zmenyHtml(z.zmeny, !sDetailom && Z.detail ? { z: Z.detail.z, c: Z.detail.c } : null) + (z.poznamka ? '<p class="muted">„' + esc(z.poznamka) + "“</p>" : "") +
        '<div class="f-akcie"><button class="btn btn-primary" data-zm-rozhodni="' + z.id + '" data-ano="1">✅ Schváliť</button><button class="btn" data-zm-rozhodni="' + z.id + '" data-ano="0">Zamietnuť</button></div></div>';
    }).join("") + "</section>";
  }
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
  function zdravZoznam(id) {
    var l = ZD.stav && ZD.stav.ludia || [], x = l.filter(function (y) { return y.osoba_id === id; })[0];
    return x ? zdravPill(x.do) : "";
  }
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
      (spravca() && Z.info ? ziadostiHtml(Z.info.ziadosti, true) : "") +
      (bezUctu && citatel() ? '<p class="muted zm-tip">💡 ' + bezUctu + " ľudí zatiaľ nemá účet v appke (chýba e-mail alebo sa ešte neprihlásili) – nevidia svoje smeny ani dochádzku.</p>" : "") +
      (z.length ? '<div class="zm-grid">' + z.map(function (x) {
        var vypl = Math.round(Math.min(11, x.vyplnene || 0) / 11 * 100);
        return '<button class="zm-karta' + (x.stav === "ukonceny" || !x.aktivny ? " zm-ukonc" : "") + '" data-zm-osoba="' + x.osoba_id + '">' + avatar(x) +
          '<span class="zm-k-txt"><b>' + esc(celeMeno(x)) + "</b>" + (celeMeno(x) !== x.prezyvka ? ' <span class="muted">(' + esc(x.prezyvka) + ")</span>" : "") +
          '<span class="zm-k-pod">' + esc([x.pozicia, x.typ_vztahu].filter(Boolean).join(" · ") || "doplň pracovný pomer") + "</span>" +
          '<span class="zm-k-stitky">' + (x.stav === "uchadzac" ? '<span class="pill info">pred nástupom</span>' : "") +
          (!x.ucet ? '<span class="pill warn">bez účtu</span>' : "") + (x.dotaznik ? '<span class="pill ok">✓ údaje potvrdené</span>' : "") + zdravZoznam(x.osoba_id) + "</span></span>" +
          '<span class="zm-k-vypl" title="Vyplnené údaje"><i style="width:' + vypl + '%"></i></span></button>';
      }).join("") + "</div>" : '<div class="empty"><strong>Nikto nezodpovedá filtru</strong></div>');
  }

  // ---------- zdravotný preukaz (platnosť + fotka) ----------
  var ZD = { stav: null, foto: null, prace: false };
  function dnesIso() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function plus30() { var d = new Date(); d.setDate(d.getDate() + 30); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function zdravPill(doD) {
    if (!doD) return '<span class="pill warn">🩺 preukaz chýba</span>';
    if (doD < dnesIso()) return '<span class="pill bad">🩺 preukaz prepadnutý ' + esc(datum(doD)) + "</span>";
    if (doD < plus30()) return '<span class="pill warn">🩺 preukaz končí ' + esc(datum(doD)) + "</span>";
    return '<span class="pill ok">🩺 preukaz do ' + esc(datum(doD)) + "</span>";
  }
  function nacitajZdrav() {
    if (!DB) return Promise.resolve();
    return rpc("zdrav_stav").then(function (d) { ZD.stav = d && d.ok ? d : null; kresli(); window.dispatchEvent(new Event("lbz-prekresli")); }).catch(function () { /* */ });
  }
  function zdravSekcia() {
    var d = Z.detail; if (!d || !(d.ja || d.spravca)) return "";
    var doD = (d.z || {}).zdrav_preukaz_do, foto = (d.z || {}).zdrav_preukaz_foto;
    return '<form class="card zm-sekcia zm-zdrav" id="zm-zdrav-form"><div class="zm-s-hl"><h3>🩺 Zdravotný preukaz</h3>' + zdravPill(doD) + "</div>" +
      '<p class="muted" style="margin:0">Odfoť platný preukaz a zadaj dátum, do kedy platí. 30 a 7 dní pred koncom ti appka pripomenie obnovu.</p>' +
      '<div class="d-riadok"><label class="field"><span class="label">Platí do</span><input type="date" id="zm-zd-do" value="' + esc(doD || "") + '" required></label>' +
      '<label class="field"><span class="label">Fotka preukazu</span><input type="file" id="zm-zd-foto" accept="image/*" capture="environment"></label></div>' +
      (ZD.foto ? '<img class="zm-zd-img" src="' + esc(ZD.foto) + '" alt="Zdravotný preukaz">' : foto ? '<button type="button" class="btn-link" data-zm="zd-ukaz">🖼 Zobraziť uloženú fotku</button>' : "") +
      '<div class="f-akcie"><button class="btn btn-primary" type="submit"' + (ZD.prace ? " disabled" : "") + ">" + (ZD.prace ? "Ukladám…" : "💾 Uložiť preukaz") + "</button></div></form>";
  }
  function zmensiFotku(file) {
    return new Promise(function (ok, chyba) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? ok(b) : chyba(new Error("Fotku sa nepodarilo spracovať")); }, "image/jpeg", 0.82);
      };
      img.onerror = function () { chyba(new Error("Súbor nie je obrázok")); };
      img.src = url;
    });
  }
  function ulozZdrav() {
    var doD = document.getElementById("zm-zd-do").value, f = document.getElementById("zm-zd-foto").files[0], os = Z.osoba;
    if (!doD) { lbzInfo("Zadaj dátum platnosti."); return; }
    ZD.prace = true; prekresli();
    var nahraj = f ? zmensiFotku(f).then(function (b) {
      var cesta = os + "/zdrav_" + Date.now() + ".jpg";
      return DB.storage.from("zamestnanci").upload(cesta, b, { contentType: "image/jpeg" }).then(function (r) { if (r.error) throw r.error; return cesta; });
    }) : Promise.resolve(null);
    nahraj.then(function (cesta) { return rpc("zam_zdrav_uloz", { p_osoba: os, p_do: doD, p_foto: cesta }); })
      .then(function (r) { ZD.prace = false; ZD.foto = null; Z.sprava = { typ: r && r.ok ? "ok" : "chyba", text: (r && r.text) || "Chyba" }; otvor(os); nacitajZdrav(); })
      .catch(function (x) { ZD.prace = false; Z.sprava = { typ: "chyba", text: chybaText(x) }; prekresli(); });
  }
  function kartaZdrav() {
    var st = ZD.stav; if (!st) return "";
    var m = st.moj;
    if (st.spravca) {
      var l = st.ludia || []; if (!l.length) return "";
      var zle = l.filter(function (x) { return x.do && x.do < dnesIso(); }).length, chyba = l.filter(function (x) { return !x.do; }).length;
      return '<section class="card zm-zdrav-karta"><h3>🩺 Zdravotné preukazy <span class="pill warn num">' + l.length + "</span></h3>" +
        '<div class="rows">' + l.slice(0, 6).map(function (x) { return '<div class="row"><span>' + esc(x.meno) + "</span>" + zdravPill(x.do) + "</div>"; }).join("") + "</div>" +
        (l.length > 6 ? '<p class="muted" style="margin:0">… a ďalší (' + (l.length - 6) + ")</p>" : "") +
        '<p class="muted" style="margin:0">' + (zle ? zle + " prepadnutých · " : "") + (chyba ? chyba + " bez zadaného preukazu" : "") + "</p>" +
        '<button class="btn" data-mod="zamestnanci">Otvoriť Ľudí</button></section>';
    }
    if (!m || !m.osoba_id) return "";
    if (m.do && m.do >= plus30()) return "";
    return '<section class="card zm-zdrav-karta"><h3>🩺 Zdravotný preukaz</h3>' + zdravPill(m.do) +
      '<p class="muted" style="margin:0">' + (!m.do ? "Odfoť svoj platný zdravotný preukaz a zadaj dátum platnosti." : m.do < dnesIso() ? "Preukaz je prepadnutý – vybav si nový a nahraj ho." : "Preukaz čoskoro končí – vybav si obnovu.") + "</p>" +
      '<button class="btn btn-primary" data-mod="zamestnanci">📷 Nahrať preukaz</button></section>';
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
    return d.ja && !s.pomer;   // zamestnanec: osobné, dane, citlivé – ako žiadosť o zmenu
  }
  function sekciaHtml(s) {
    var d = Z.detail, data = d[s.tab] || {}, upr = Z.uprav === s.id;
    var skryte = s.citlive && !Z.ukazCitlive && !upr;
    var vyplnene = s.polia.filter(function (p) { return data[p[0]] != null && data[p[0]] !== ""; }).length;
    var hl = '<div class="zm-s-hl"><h3>' + s.nazov + ' <span class="muted zm-s-poc">' + vyplnene + "/" + s.polia.length + "</span></h3>" +
      (upr ? "" : (s.citlive && !upr ? '<button class="btn-link" data-zm="citlive">' + (Z.ukazCitlive ? "🙈 Skryť" : "👁 Zobraziť") + "</button>" : "") +
        (mozemUpravit(s) ? '<button class="btn zm-upr" data-zm-upr="' + s.id + '">' + (d.spravca ? "✏️ Upraviť" : "✏️ Požiadať o zmenu") + "</button>" : "")) + "</div>";
    if (upr) {
      return '<form class="card zm-sekcia zm-edit" id="zm-form" data-sekcia="' + s.id + '">' + hl + '<div class="zm-polia">' +
        s.polia.map(function (p) { return '<label class="field' + (p[2] === "a" ? " zm-siroke" : "") + '"><span class="label">' + esc(p[1]) + "</span>" + vstup(p, data[p[0]], s) + "</label>"; }).join("") +
        (s.id === "pomer" && d.spravca ? '<label class="field"><span class="label">Denná norma (h) – dochádzka</span><input id="zm-f-norma" type="number" step="0.25" min="1" max="24" value="' + esc(d.osoba && d.osoba.norma_h) + '"></label>' : "") +
        (d.spravca ? "" : '<label class="field zm-siroke"><span class="label">Poznámka pre vedenie (nepovinné)</span><input id="zm-f-pozn" maxlength="300"></label><p class="muted zm-siroke">Zmena sa prejaví po schválení vedením.</p>') +
        '</div><div class="f-akcie"><button class="btn btn-primary" type="submit"' + (Z.prace ? " disabled" : "") + ">" + (Z.prace ? "Ukladám…" : d.spravca ? "Uložiť" : "📨 Odoslať žiadosť") + '</button><button class="btn" type="button" data-zm="zrus">Zrušiť</button></div></form>';
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
      (d.spravca ? ziadostiHtml((d.ziadosti || []).filter(function (z) { return z.stav === "ziadost"; }), false) :
        (d.ziadosti || []).filter(function (z) { return z.stav === "ziadost"; }).map(function (z) { return '<div class="card zm-caka">⏳ <b>Žiadosť o zmenu čaká na schválenie</b>' + zmenyHtml(z.zmeny, null) + "</div>"; }).join("") +
        (d.ziadosti || []).filter(function (z) { return z.stav !== "ziadost"; }).slice(0, 2).map(function (z) { return '<p class="muted zm-vybavena">' + (z.stav === "schvalena" ? "✅ Tvoja žiadosť o zmenu bola schválená" : "✖ Tvoja žiadosť o zmenu bola zamietnutá") + " (" + esc(datum(z.kedy)) + ")</p>"; }).join("")) +
      zdravSekcia() + dkSekcia() + paSekcia() +
      '<div class="zm-sekcie">' + sekcie.map(sekciaHtml).join("") + "</div>" +
      (citatel() && (d.log || []).length ? '<details class="card zm-log"><summary>🕘 História zmien</summary><div class="rows">' + d.log.map(function (l) {
        return '<div class="row"><span>' + esc(new Date(l.kedy).toLocaleString("sk-SK", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })) + " · " + esc(l.kto || "") + '</span><span class="muted">' + esc((l.polia || []).join(", ")) + "</span></div>";
      }).join("") + "</div></details>" : "");
  }

  // ---------- nástupné dokumenty (skript „Formular prihlasenie“ cez Edge Function personalna) ----------
  var PA = { osoba: null, stav: null, dialog: false, prace: false, vysledok: null };
  var DK = { osoba: null, zoznam: null, chyba: null };
  var PA_TYPY = ["HPP – pracovná zmluva", "DoPČ – dohoda o pracovnej činnosti", "DoVP – dohoda o vykonaní práce", "DoBPŠ – dohoda o brigádnickej práci študentov"];
  var PA_OKRESY = ["603 - Brezno", "601 - Banská Bystrica", "609 - Rimavská Sobota", "608 - Revúca", "611 - Zvolen", "604 - Detva", "606 - Lučenec", "607 - Poltár", "610 - Veľký Krtíš", "613 - Žiar nad Hronom", "612 - Žarnovica", "602 - Banská Štiavnica", "605 - Krupina"];
  var PA_DOCHODOK = ["Starobný", "Predčasný starobný", "Invalidný", "Výsluhový", "Iný"];
  function paTyp(t) { return { "TPP": PA_TYPY[0], "DPČ": PA_TYPY[1], "DoVP": PA_TYPY[2], "DoBPŠ": PA_TYPY[3], "Študent": PA_TYPY[3] }[t] || ""; }
  function paVolaj(akcia, extra) {
    return DB.functions.invoke("personalna", { body: { akcia: akcia, osoba_id: Z.osoba, extra: extra || null } }).then(function (r) {
      if (r.error) { var c = r.error.context; return c && c.json ? c.json().catch(function () { throw r.error; }) : Promise.reject(r.error); }
      return r.data;
    });
  }
  function paNacitajStav() {
    var os = Z.osoba; PA.osoba = os; PA.stav = { nacitavam: true };
    paVolaj("stav").then(function (r) { if (PA.osoba === os) { PA.stav = r || { ok: false, text: "Bez odpovede" }; kresli(); } })
      .catch(function (x) { if (PA.osoba === os) { PA.stav = { ok: false, text: chybaText(x) }; kresli(); } });
  }
  function paSekcia() {
    var d = Z.detail; if (!d || !d.spravca) return "";
    if (PA.osoba !== Z.osoba) { PA.vysledok = null; paNacitajStav(); }
    var st = PA.stav || {}, z = d.z || {}, url = st.priecinok || z.dokumenty_url, v = PA.vysledok;
    var info = st.nacitavam ? '<span class="muted">Zisťujem stav v tabuľke…</span>'
      : st.row ? "<span>V tabuľke (riadok " + esc(st.row) + "): <b>" + esc(st.stav || "zatiaľ negenerované") + "</b></span>"
      : st.ok === false ? '<span class="zm-chyba-pol">' + esc(st.text || "Skript nedostupný") + "</span>"
      : '<span class="muted">V tabuľke ešte nie je – dokumenty sa zatiaľ negenerovali.</span>';
    return '<section class="card zm-sekcia zm-pa"><div class="zm-s-hl"><h3>📄 Nástupné dokumenty</h3></div>' +
      '<p class="muted" style="margin:0">Zmluva / dohoda + prílohy (GDPR, NČZD, výnimka…), MRP XML a PDF pre mzdárku. Vytvára ich skript v Personálnej agende podľa údajov z appky a pošle e-maily.</p>' +
      '<p style="margin:0">' + info + "</p>" +
      (v ? '<div class="f-sprava f-' + (v.ok ? "ok" : "chyba") + '">' + esc(v.ok ? "✅ " + (v.stav || "Hotovo") + (v.stav && /^Hotovo/.test(v.stav) ? " – PDF sú v appke v Dokumentoch zamestnanca aj v priečinku na Disku, e-mail s kontrolným zoznamom ti prišiel." : "") : (v.chyby && v.chyby.length ? "Dokumenty sa nevygenerovali, oprav:" : (v.text || v.stav || "Chyba"))) +
        (v.chyby && v.chyby.length ? '<ul class="zm-zmeny">' + v.chyby.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + "</ul>" : "") + "</div>" : "") +
      '<div class="f-akcie"><button class="btn btn-primary" type="button" data-zm="pa-dialog"' + (PA.prace ? " disabled" : "") + ">" + (PA.prace ? "Pracujem… (do 1 min)" : "📄 Vygenerovať dokumenty") + "</button>" +
      (url ? '<a class="btn" href="' + esc(url) + '" target="_blank" rel="noopener">📁 Priečinok</a>' : "") +
      (st.row && url ? '<button class="btn" type="button" data-zm="pa-dok"' + (PA.prace ? " disabled" : "") + ">🔄 Dokumenty z Disku do appky</button>" : "") +
      (st.row && url ? '<button class="btn" type="button" data-zm="pa-mzdarke"' + (PA.prace ? " disabled" : "") + ">📧 Poslať mzdárke</button>" : "") + "</div></section>";
  }
  // ---------- dokumenty zamestnanca (PDF v úložisku zamestnanci/<osoba>/dokumenty/) ----------
  function dkNacitaj() {
    var os = Z.osoba; DK.osoba = os; DK.zoznam = null; DK.chyba = null;
    DB.storage.from("zamestnanci").download(os + "/dokumenty/_zoznam.json").then(function (r) {
      if (DK.osoba !== os) return;
      if (r.error || !r.data) { DK.zoznam = []; kresli(); return; }
      return r.data.text().then(function (t) { var j = {}; try { j = JSON.parse(t); } catch (x) { /* */ } DK.zoznam = j.subory || []; kresli(); });
    }).catch(function () { if (DK.osoba === os) { DK.zoznam = []; kresli(); } });
  }
  function dkSekcia() {
    var d = Z.detail; if (!d || !(d.ja || d.spravca)) return "";
    if (DK.osoba !== Z.osoba) dkNacitaj();
    var l = DK.zoznam;
    return '<section class="card zm-sekcia zm-dok"><div class="zm-s-hl"><h3>📑 ' + (d.ja ? "Moje dokumenty" : "Dokumenty zamestnanca") + "</h3></div>" +
      (l == null ? '<p class="muted" style="margin:0">Načítavam…</p>' : !l.length ? '<p class="muted" style="margin:0">Zatiaľ tu nie sú žiadne dokumenty.' + (d.spravca ? " Objavia sa po vygenerovaní nástupných dokumentov." : "") + "</p>" :
        '<div class="rows">' + l.map(function (x) {
          return '<button type="button" class="row zm-dok-riadok" data-zm-dok="' + esc(x.subor) + '"><span>📄 ' + esc(x.nazov) + '</span><span class="muted">' + esc(x.datum ? datum(x.datum) : "") + " ›</span></button>";
        }).join("") + "</div>") + "</section>";
  }
  function dkOtvor(subor) {
    var okno = window.open("", "_blank");
    DB.storage.from("zamestnanci").createSignedUrl(Z.osoba + "/dokumenty/" + subor, 300).then(function (r) {
      if (r.error || !r.data) throw r.error || new Error("Súbor sa nenašiel");
      if (okno) okno.location = r.data.signedUrl; else window.location = r.data.signedUrl;
    }).catch(function (x) { if (okno) okno.close(); lbzInfo(chybaText(x)); });
  }
  function paNacitajDok() {
    var os = Z.osoba; PA.prace = true; prekresli();
    paVolaj("dokumenty").then(function (r) {
      PA.prace = false; if (PA.osoba !== os) return;
      PA.vysledok = r && r.ok ? { ok: true, stav: "Načítané dokumenty: " + ((r.subory || []).length) + (r.upozornenie ? " – " + r.upozornenie : "") } : (r || { ok: false, text: "Chyba" });
      DK.osoba = null; kresli();
    }).catch(function (e) { PA.prace = false; PA.vysledok = { ok: false, text: chybaText(e) }; kresli(); });
  }

  function dialogDok() {
    if (!PA.dialog || !Z.detail) return "";
    var z = Z.detail.z || {}, typ = paTyp(z.typ_vztahu), hpp = /^HPP/.test(typ);
    var opt = function (zoz, sel) { return zoz.map(function (t) { return "<option" + (t === sel ? " selected" : "") + ">" + esc(t) + "</option>"; }).join(""); };
    return '<div class="f-dialog-pozadie" data-zm="pa-zavri"></div><div class="f-dialog" role="dialog" aria-modal="true"><form class="f-form" id="zm-pa-form"><h3>📄 Vygenerovať nástupné dokumenty</h3>' +
      '<p class="muted" style="margin:0;font-size:13px">Osobné a pracovné údaje sa vezmú z karty zamestnanca. Tu doplň, čo sa v appke neukladá (mzda sa v appke neukladá – zapíše sa len do tabuľky Personálnej agendy).</p>' +
      '<div class="d-riadok"><label class="field"><span class="label">Typ vzťahu</span><select id="pa-typ" required><option></option>' + opt(PA_TYPY, typ) + "</select></label>" +
      '<label class="field"><span class="label">Okres trvalého pobytu</span><input id="pa-okres" list="pa-okresy" placeholder="napr. 603 - Brezno"><datalist id="pa-okresy">' + opt(PA_OKRESY) + "</datalist></label></div>" +
      '<div class="d-riadok"><label class="field"><span class="label">Mzda / odmena (EUR brutto)</span><input id="pa-mzda" inputmode="decimal" required autocomplete="off"></label>' +
      '<label class="field"><span class="label">Odmena za</span><select id="pa-jedn">' + opt(["mesačne", "za hodinu"], hpp ? "mesačne" : "za hodinu") + "</select></label></div>" +
      '<div class="d-riadok"><label class="field"><span class="label">Výplata</span><select id="pa-vyplata">' + opt(["na účet", "v hotovosti"], "na účet") + "</select></label>" +
      '<label class="field"><span class="label">Pracovný čas</span><select id="pa-prac">' + opt(["pevný pracovný čas", "pružný pracovný čas"], /pruž/i.test(z.pracovny_cas || "") ? "pružný pracovný čas" : "pevný pracovný čas") + "</select></label></div>" +
      '<div class="d-riadok"><label class="field"><span class="label">Čas od</span><input id="pa-od" value="06.00"></label><label class="field"><span class="label">Čas do</span><input id="pa-do" value="22.00"></label></div>' +
      '<div class="d-riadok"><label class="field"><span class="label">Dátum podpisu</span><input id="pa-podpis" type="date" value="' + esc(z.nastup && z.nastup >= dnesIso() ? String(z.nastup).slice(0, 10) : dnesIso()) + '"></label>' +
      '<label class="field"><span class="label">Miesto podpisu</span><input id="pa-miesto" value="Pohronskej Polhore"></label></div>' +
      (z.dochodca ? '<div class="d-riadok"><label class="field"><span class="label">Druh dôchodku</span><select id="pa-doch">' + opt(PA_DOCHODOK, "Starobný") + '</select></label><label class="field"><span class="label">Dôchodok priznaný od</span><input id="pa-doch-od"></label></div>' : "") +
      (z.ine_zamestnanie ? '<label class="field"><span class="label">Iné zamestnanie</span><select id="pa-ine">' + opt(["Áno – iné zamestnanie", "Áno – SZČO", "Áno – poistenec štátu (napr. rodičovský príspevok, študent)"]) + "</select></label>" : "") +
      '<label class="k-prepinac"><input type="checkbox" id="pa-bez"> <span>Zamestnancovi zatiaľ nič neposielať (dokumenty len do Disku)</span></label>' +
      (z.nastup ? "" : '<p class="zm-chyba-pol" style="margin:0">Chýba deň nástupu v Pracovnom pomere.</p>') + (z.pozicia ? "" : '<p class="zm-chyba-pol" style="margin:0">Chýba pozícia v Pracovnom pomere.</p>') +
      '<div class="f-akcie"><button class="btn btn-primary" type="submit">📄 Vygenerovať</button><button class="btn" type="button" data-zm="pa-zavri">Zrušiť</button></div></form></div>';
  }
  function paGeneruj() {
    var g = function (id) { var el = document.getElementById(id); return el ? (el.type === "checkbox" ? el.checked : el.value.trim()) : ""; };
    var x = { TYP_VZTAHU: g("pa-typ"), OKRES: g("pa-okres"), MZDA: g("pa-mzda"), ODMENA_JEDNOTKA: g("pa-jedn"), VYPLATA: g("pa-vyplata"), PRAC_CAS: g("pa-prac"),
      CAS_OD: g("pa-od"), CAS_DO: g("pa-do"), DATUM_PODPISU: g("pa-podpis"), MIESTO_PODPISU: g("pa-miesto"), DOCHODOK: g("pa-doch"), DOCHODOK_OD: g("pa-doch-od"),
      INE_ZAMESTNANIE: g("pa-ine"), BEZ_EMAILU: g("pa-bez") };
    if (!x.TYP_VZTAHU || !x.MZDA) { lbzInfo("Vyplň typ vzťahu a mzdu."); return; }
    var os = Z.osoba;
    PA.dialog = false; PA.prace = true; PA.vysledok = null; prekresli();
    paVolaj("generuj", x).then(function (r) {
      PA.prace = false; if (PA.osoba !== os) return;
      PA.vysledok = r || { ok: false, text: "Bez odpovede" };
      if (r && r.row) PA.stav = r;
      if (r && r.upozornenie) PA.vysledok.text = r.upozornenie;
      DK.osoba = null;
      if (r && r.ok) otvor(os); else kresli();
    }).catch(function (e) { PA.prace = false; PA.vysledok = { ok: false, text: chybaText(e) }; kresli(); });
  }
  function paMzdarke() {
    if (!lbzPotvrd("Poslať mzdárke MRP XML a PDF podklady e-mailom?")) return;
    var os = Z.osoba; PA.prace = true; prekresli();
    paVolaj("mzdarke").then(function (r) { PA.prace = false; if (PA.osoba !== os) return; PA.vysledok = r && r.ok ? { ok: true, stav: "odoslané mzdárke" } : (r || { ok: false, text: "Chyba" }); if (r && r.row) PA.stav = r; kresli(); })
      .catch(function (e) { PA.prace = false; PA.vysledok = { ok: false, text: chybaText(e) }; kresli(); });
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
      (Z.osoba == null ? pohladZoznam() : pohladDetail()) + "</div>" + dialogNovy() + dialogDok();
    if (fok === "zm-hladaj") { var h = document.getElementById("zm-hladaj"); if (h) { h.focus(); h.setSelectionRange(h.value.length, h.value.length); } }
    window.scrollTo(0, y);
  }

  // ---------- udalosti ----------
  function klik(e) {
    var t = e.target.closest("button, [data-zm]"); if (!t || !koren.contains(t)) return;
    if (t.dataset.zmOsoba) { otvor(+t.dataset.zmOsoba); window.scrollTo(0, 0); return; }
    if (t.dataset.zmRozhodni) {
      var ano = t.dataset.ano === "1";
      if (!ano && !lbzPotvrd("Zamietnuť túto žiadosť o zmenu?")) return;
      rpc("zam_ziadost_rozhodni", { p_id: +t.dataset.zmRozhodni, p_schvalit: ano }).then(function (r) {
        Z.sprava = { typ: r && r.ok ? "ok" : "chyba", text: (r && r.text) || "Chyba" };
        nacitajZoznam(); if (Z.osoba != null) otvor(Z.osoba); else prekresli();
      }).catch(function (x) { lbzInfo(chybaText(x)); });
      return;
    }
    if (t.dataset.zmDok) { dkOtvor(t.dataset.zmDok); return; }
    if (t.dataset.zmFilter) { Z.filter = t.dataset.zmFilter; prekresli(); return; }
    if (t.dataset.zmUpr) { Z.uprav = t.dataset.zmUpr; Z.sprava = null; prekresli(); var f = document.getElementById("zm-form"); if (f) f.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
    var a = t.dataset.zm;
    if (a === "spat") { Z.osoba = null; Z.detail = null; Z.uprav = null; if (window.lbzPamat) lbzPamat.uloz("zam", {}); nacitajZoznam(); prekresli(); }
    else if (a === "zrus") { Z.uprav = null; prekresli(); }
    else if (a === "citlive") { Z.ukazCitlive = !Z.ukazCitlive; prekresli(); }
    else if (a === "novy") { Z.novy = true; prekresli(); var m = document.getElementById("zm-n-meno"); if (m) m.focus(); }
    else if (a === "zavri-novy") { Z.novy = false; prekresli(); }
    else if (a === "zavri-spravu") { Z.sprava = null; prekresli(); }
    else if (a === "pa-dialog") { PA.dialog = true; prekresli(); var m = document.getElementById("pa-mzda"); if (m) m.focus(); }
    else if (a === "pa-zavri") { PA.dialog = false; prekresli(); }
    else if (a === "pa-mzdarke") paMzdarke();
    else if (a === "pa-dok") paNacitajDok();
    else if (a === "zd-ukaz") {
      rpc("zam_zdrav_foto", { p_osoba: Z.osoba }).then(function (c) { if (!c) return; return DB.storage.from("zamestnanci").createSignedUrl(c, 300); })
        .then(function (r) { if (r && r.data) { ZD.foto = r.data.signedUrl; prekresli(); } }).catch(function (x) { lbzInfo(chybaText(x)); });
    }
    else if (a === "potvrd") {
      var s = document.getElementById("zm-suhlas");
      if (!s || !s.checked) { lbzInfo("Najprv zaškrtni súhlas so spracúvaním osobných údajov."); return; }
      rpc("zam_uloz", { p: { osoba_id: Z.osoba, dotaznik: true, suhlas: true } }).then(function () { Z.sprava = { typ: "ok", text: "Ďakujeme, údaje sú potvrdené." }; otvor(Z.osoba); })
        .catch(function (x) { lbzInfo(chybaText(x)); });
    }
  }
  function odoslanie(e) {
    if (e.target.id === "zm-zdrav-form") { e.preventDefault(); ulozZdrav(); return; }
    if (e.target.id === "zm-pa-form") { e.preventDefault(); paGeneruj(); return; }
    if (e.target.id === "zm-form") {
      e.preventDefault();
      var p = { osoba_id: Z.osoba, z: {}, c: {} };
      e.target.querySelectorAll("[data-zm-pole]").forEach(function (el) { p[el.dataset.zmTab][el.dataset.zmPole] = el.value.trim(); });
      var n = document.getElementById("zm-f-norma"); if (n) p.norma_h = n.value;
      var ziadost = Z.detail && !Z.detail.spravca;
      if (ziadost) {
        ["z", "c"].forEach(function (t) { var st = Z.detail[t] || {}; Object.keys(p[t]).forEach(function (k) { if (String(st[k] == null ? "" : st[k]) === p[t][k]) delete p[t][k]; }); });
        if (!Object.keys(p.z).length && !Object.keys(p.c).length) { lbzInfo("Nič si nezmenil/a."); return; }
        var pz = document.getElementById("zm-f-pozn"); p = { z: p.z, c: p.c, poznamka: pz ? pz.value.trim() : "" };
      }
      Z.prace = true; prekresli();
      rpc(ziadost ? "zam_ziadost" : "zam_uloz", { p: p }).then(function (r) {
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
  function vstupEv(e) {
    if (e.target.id === "zm-hladaj") { Z.hladaj = e.target.value; prekresli(); }
    if (e.target.id === "pa-typ") { var j = document.getElementById("pa-jedn"); if (j) j.value = /^HPP/.test(e.target.value) ? "mesačne" : "za hodinu"; }
  }

  window.LBZ_ZAMESTNANCI = {
    nastavDb: function (klient, rola) { DB = klient || null; ROLA = klient ? rola : null; Z.zoznam = null; Z.detail = null; Z.osoba = null; PA.osoba = null; DK.osoba = null; DK.zoznam = null; PA.stav = null; PA.vysledok = null; PA.dialog = false; ZD.stav = null; ZD.foto = null; if (DB && this.mozem()) nacitajZdrav(); },
    karta: function () { return kartaZdrav(); },
    mozem: function () { return !!DB && ["it", "ceo", "uctovnicka", "zamestnanec", "zakaznicky_servis"].indexOf(ROLA) > -1; },
    mount: function (el) {
      koren = el;
      el.addEventListener("click", klik); el.addEventListener("submit", odoslanie); el.addEventListener("input", vstupEv);
      var pam = window.lbzPamat && lbzPamat.nacitaj("zam");
      prekresli();
      nacitajZoznam().then(function () { if (pam && pam.osoba && Z.osoba == null && citatel()) otvor(pam.osoba); });
    }
  };
})();
