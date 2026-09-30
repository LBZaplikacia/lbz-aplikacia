// LBZ aplikácia – modul FURMANKY (objednávky z Upgates priamo v appke)
// Vidia a upravujú: IT, CEO, zákaznícky servis. Údaje sú v databáze appky (Supabase),
// z Upgates ich sťahuje server appky 3× denne (6:00, 11:30, 14:00) alebo tlačidlo „Aktualizovať z Upgates“.
// Počas testu appka do Upgates nič nezapisuje.
// Tabuľka je ako záložky v „Správe objednávok“: zákazníci v stĺpcoch, produkty v riadkoch, medzisúčty a dávky
// podľa tých istých vzorcov (šablóna z hárka Default).

(function () {
  "use strict";

  var DB = null, ROLA = null;
  var koren = null;
  var F = {
    zoznam: null, beh: null, odobrate: 0, archivN: 0,
    archiv: null, archivText: "", zArchivu: false,
    id: null,                 // otvorená furmanka (id, "odobrate" alebo null = zoznam)
    data: null,               // { furmanka, objednavky }
    sablona: null,
    skryt: true,              // skryť prázdne riadky
    zobrazenie: null,         // "tabulka" | "zoznam" (null = podľa šírky obrazovky)
    nacitavam: false, stahujem: false,
    sprava: null,             // { typ: ok|chyba|info, text }
    dialog: null              // { typ, ... }
  };
  (function () { var p = window.lbzPamat && lbzPamat.nacitaj("furmanky"); if (p && p.id != null) F.id = p.id; })();

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function bezDiakritiky(s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function rpc(nazov, args) {
    return DB.rpc(nazov, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function chybaText(e) { return (e && (e.message || e.text)) || "Bez spojenia so serverom"; }
  function cislo(n, des) {
    if (n == null || n === "" || isNaN(n)) return "";
    var x = Number(n);
    return x.toLocaleString("sk-SK", { minimumFractionDigits: des || 0, maximumFractionDigits: des == null ? 2 : des });
  }
  function eur(n) { return n == null || n === "" ? "" : Number(n).toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
  function datumSk(d) { if (!d) return ""; var p = String(d).slice(0, 10).split("-"); return p[2] + "." + p[1] + "." + p[0]; }
  function casSk(t) { if (!t) return ""; var d = new Date(t); return d.toLocaleDateString("sk-SK", { day: "numeric", month: "numeric" }) + " " + d.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" }); }
  function siroka() { return window.matchMedia && window.matchMedia("(min-width: 900px)").matches; }
  function zobrazenie() { return F.zobrazenie || (siroka() ? "tabulka" : "zoznam"); }
  function stavPill(s) {
    return s === "full" ? '<span class="pill warn">FULL</span>' : s === "rozvezena" ? '<span class="pill info">rozvezená</span>' : '<span class="pill ok">otvorená</span>';
  }

  // ---------- načítanie ----------
  function nacitajZoznam() {
    F.nacitavam = true; prekresli();
    return rpc("furmanky_zoznam").then(function (r) {
      F.nacitavam = false;
      if (!r || r.ok === false) { F.sprava = { typ: "chyba", text: (r && r.text) || "Furmanky sa nenačítali" }; F.zoznam = F.zoznam || []; }
      else { F.zoznam = r.furmanky || []; F.beh = r.beh || null; F.odobrate = r.odobrate || 0; F.archivN = r.archiv || 0; }
      prekresli();
    }).catch(function (e) { F.nacitavam = false; F.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }
  function nacitajSablonu() {
    if (F.sablona) return Promise.resolve(F.sablona);
    return rpc("furmanky_sablona_data").then(function (s) { F.sablona = s || []; return F.sablona; });
  }
  function nacitajFurmanku(tiho) {
    if (F.id == null) return Promise.resolve();
    if (!tiho) { F.nacitavam = true; prekresli(); }
    return Promise.all([nacitajSablonu(), rpc("furmanka_data", { p_id: F.id === "odobrate" ? null : F.id })]).then(function (v) {
      F.nacitavam = false;
      var r = v[1];
      if (!r || r.ok === false) { F.sprava = { typ: "chyba", text: (r && r.text) || "Furmanka sa nenačítala" }; F.data = null; }
      else { F.data = r; if (r.furmanka && r.furmanka.id && r.furmanka.rozvoz) nacitajTrasu(r.furmanka.id); else F.trasa = null; }
      prekresli();
    }).catch(function (e) { F.nacitavam = false; F.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }
  // trasa pre furmana (modul Trasa): čas odchodu → poradie a časy príchodov (Edge Function, Google Mapy)
  function nacitajTrasu(id) {
    return rpc("trasa_data", { p_id: id }).then(function (d) { if (F.data && F.data.furmanka && F.data.furmanka.id === id) { F.trasa = d && d.ok ? d : null; prekresli(); } }).catch(function () {});
  }
  function trasaHtml(f) {
    if (!f.id || !f.rozvoz || !f.datum) return "";
    var d = F.trasa, t = d && d.trasa, z = (d && d.zastavky) || [];
    var hhmm = function (x) { return x ? new Date(x).toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" }) : ""; };
    var moze = !t || t.stav === "naplanovana";
    var hotovo = z.filter(function (x) { return x.stav !== "caka"; }).length;
    return '<details class="card f-trasa"' + (t ? "" : " open") + "><summary><strong>🗺️ Trasa pre furmana</strong> " +
        (t ? '<span class="muted">odchod ' + esc(hhmm(t.odchod)) + " · návrat ~" + esc(hhmm(t.navrat)) + " · " + (t.stav === "naplanovana" ? "naplánovaná" : t.stav === "na_ceste" ? "na ceste " + hotovo + "/" + z.length : "ukončená") + "</span>"
          : '<span class="muted">zatiaľ nevytvorená</span>') + "</summary>" +
      (moze && f.stav !== "rozvezena" ? '<form class="f-trasa-riadok" id="f-trasa-form"><label class="field"><span class="label">Čas odchodu</span>' +
          '<input type="time" name="odchod" required value="' + esc(t ? hhmm(t.odchod) : "07:00") + '"></label>' +
          '<button class="btn btn-primary" type="submit"' + (F.trasaPocita ? " disabled" : "") + ">" + (F.trasaPocita ? "⏳ Počítam trasu…" : t ? "🔄 Prepočítať trasu" : "🗺️ Vytvoriť trasu") + "</button>" +
          '<span class="muted f-mini">Poradie a časy vypočíta Google Mapy – ⭐ priorita ide prvá, ručné poradie (↕️) sa dodrží, vykládka podľa stĺpca Vykládka. Furman ju hneď uvidí v module Trasa.</span></form>'
        : '<p class="muted" style="margin:0">Furman už je na ceste – trasa sa nedá prepočítať.</p>') +
      (z.length ? "<ol>" + z.map(function (x) {
        return "<li>" + (x.eta ? '<b class="num">' + esc(hhmm(x.eta)) + "</b> " : "") + esc(x.meno || x.firma || x.cislo) + ' <span class="muted">' + esc(x.adresa || "") + "</span>" +
          (x.bez_gps ? ' <span class="pill warn">adresa nenájdená</span>' : "") + (x.stav === "dorucene" ? " ✅" : x.stav === "nedorucene" ? " ❌" : "") +
          (x.sms_den ? ' <span class="muted" title="SMS deň vopred odoslaná ' + esc(casSk(x.sms_den)) + '">📱</span>' : "") +
          ((x.odpovede || []).length ? '<div class="f-sms-odp">💬 ' + x.odpovede.map(function (o) { return esc(o.text); }).join(" · ") + "</div>" : "") + "</li>";
      }).join("") + "</ol>" : "") + "</details>";
  }
  // ---------- SMS deň vopred (GoSMS) – text a časové okno ako v starom skripte: ETA −15 min až +90 min ----------
  function hm(d) { return d.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" }); }
  function smsText(x, datum) {
    var eta = new Date(x.eta), od = new Date(eta.getTime() - 15 * 60000), po = new Date(eta.getTime() + 90 * 60000);
    var p = String(datum).slice(0, 10).split("-"), den = +p[2] + "." + +p[1] + "." + p[0];
    var dob = x.platba !== "ZAPLATENÉ" && x.platba !== "NA FAKTÚRU";
    return "Dobrý deň " + (x.meno || x.firma || "") + ", vaša objednávka Legendárnych buchiet Zbojská č. " + x.cislo + " bude doručená na adresu " + (x.adresa || "") +
      " dňa " + den + " v čase " + hm(od) + " - " + hm(po) + "." + (dob ? " Suma na úhradu je " + eur(x.suma) + ". Možná platba kartou aj v hotovosti." : "") +
      " S pozdravom Tím Legendárne buchty ZBOJSKÁ";
  }
  function smsKandidati() {
    var z = (F.trasa && F.trasa.zastavky) || [];
    return z.filter(function (x) { return x.eta && x.telefon && x.stav === "caka" && !x.sms_den; });
  }
  function smsPocet() { var n = smsKandidati().length; return n ? ' <span class="pill num">' + n + "</span>" : " ✓"; }
  function posliSms() {
    var t = F.trasa && F.trasa.trasa; if (!t) { lbzInfo("Najprv vytvorte trasu pre furmana."); return; }
    var z = smsKandidati(), vsetky = (F.trasa.zastavky || []);
    var bezTel = vsetky.filter(function (x) { return !x.telefon; }).length, bezCasu = vsetky.filter(function (x) { return x.telefon && !x.eta; }).length;
    if (!z.length) { lbzInfo("Všetkým zákazníkom s telefónom v tejto trase už bola SMS odoslaná." + (bezTel ? "\n\nBez telefónu: " + bezTel : "")); return; }
    if (!lbzPotvrd("Poslať " + z.length + " SMS zákazníkom furmanky " + F.data.furmanka.nazov + "?" +
        (bezTel ? "\nBez telefónu (nedostanú SMS): " + bezTel : "") + (bezCasu ? "\nBez času príchodu (adresa nenájdená): " + bezCasu : "") +
        "\n\nUkážka:\n" + smsText(z[0], t.datum))) return;
    F.sprava = { typ: "info", text: "Posielam " + z.length + " SMS…" }; prekresli();
    var pol = z.map(function (x) { return { cislo: x.cislo, furmanka_id: t.id, telefon: x.telefon, text: smsText(x, t.datum), typ: "den_vopred" }; });
    DB.functions.invoke("gosms", { body: { akcia: "posli", polozky: pol } }).then(function (res) {
      var d = res.data;
      var hotovo = function (j) { F.sprava = { typ: j && j.ok ? "ok" : "chyba", text: (j && j.text) || "SMS sa neodoslali" }; nacitajTrasu(t.id); };
      if (res.error && !d) { var ctx = res.error.context; if (ctx && ctx.json) return ctx.json().then(hotovo, function () { hotovo({ text: chybaText(res.error) }); }); return hotovo({ text: chybaText(res.error) }); }
      hotovo(d);
    }).catch(function (e) { F.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }
  function vytvorTrasu(odchod) {
    var id = F.data.furmanka.id;
    F.trasaPocita = true; F.sprava = null; prekresli();
    DB.functions.invoke("upgates-sync", { body: { akcia: "trasa", id: id, odchod: odchod } }).then(function (res) {
      F.trasaPocita = false;
      var d = res.data;
      var hotovo = function (j) { F.sprava = { typ: j && j.ok ? "ok" : "chyba", text: (j && j.text) || "Trasa sa nevytvorila", zle: (j && j.zle) || null }; nacitajTrasu(id); nacitajFurmanku(true); };
      if (res.error && !d) { var ctx = res.error.context; if (ctx && ctx.json) return ctx.json().then(hotovo, function () { hotovo({ text: chybaText(res.error) }); }); return hotovo({ text: chybaText(res.error) }); }
      hotovo(d);
    }).catch(function (e) { F.trasaPocita = false; F.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }
  function otvor(id) {
    F.id = id; F.data = null; F.sprava = null; F.dialog = null; F.poradieRezim = false;
    prekresli(); window.scrollTo(0, 0);
    nacitajFurmanku();
  }

  // ---------- Aktualizovať z Upgates ----------
  function stiahni() {
    if (F.stahujem) return;
    if (!lbzPotvrd("Naozaj stiahnuť objednávky z Upgates teraz?\n\nFurmanky sa podľa nich prepočítajú. Ručné zmeny v appke ostanú.")) return;
    F.stahujem = true; F.sprava = { typ: "info", text: "Sťahujem objednávky z Upgates… (môže to trvať aj minútu)" }; prekresli();
    DB.functions.invoke("upgates-sync", { body: { akcia: "sync" } }).then(function (res) {
      F.stahujem = false;
      var d = res.data;
      if (res.error && !d) {
        var ctx = res.error.context;
        if (ctx && ctx.json) return ctx.json().then(function (j) { F.sprava = { typ: "chyba", text: (j && j.text) || chybaText(res.error) }; prekresli(); }, function () { F.sprava = { typ: "chyba", text: chybaText(res.error) }; prekresli(); });
        F.sprava = { typ: "chyba", text: chybaText(res.error) }; prekresli(); return;
      }
      F.sprava = { typ: d && d.ok ? "ok" : "chyba", text: (d && d.text) || "Hotovo" };
      nacitajZoznam(); if (F.id != null) nacitajFurmanku(true);
    }).catch(function (e) { F.stahujem = false; F.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }

  // ---------- výpočty ako v tabuľke (vzorce R1C1 z hárka Default) ----------
  // stĺpce: D = 4 (Spolu ks), E = 5 (Spolu dávok), od I = 9 zákazníci
  function hodnotaObjednavky(o, riadok) {
    if (!riadok) return 0;
    if (riadok.typ === "suma") return Number(o.suma) || 0;
    if (riadok.kod) return Number((o.polozky || {})[riadok.kod]) || 0;
    return 0;
  }
  function vypocitaj(sablona, objednavky) {
    var podla = {}; sablona.forEach(function (r) { podla[r.riadok] = r; });
    var pamat = {};
    function sucetObj(riadok) {
      var r = podla[riadok]; if (!r) return 0;
      return objednavky.reduce(function (a, o) { return a + hodnotaObjednavky(o, r); }, 0);
    }
    function bunka(riadok, stlpec) {
      if (stlpec >= 9) return sucetObj(riadok);
      if (stlpec !== 4 && stlpec !== 5) return 0;
      var k = riadok + ":" + stlpec;
      if (k in pamat) return pamat[k];
      pamat[k] = 0; // ochrana pred kruhom
      var r = podla[riadok];
      var vz = r ? (stlpec === 4 ? r.vzorec_ks : r.vzorec_davky) : null;
      pamat[k] = vz ? vyhodnot(vz, riadok, stlpec) : 0;
      return pamat[k];
    }
    function vyhodnot(vz, riadok, stlpec) {
      var s = String(vz).replace(/^=/, "");
      s = s.replace(/SUM\(R\[(-?\d+)\]C\[(-?\d+)\]:R\[(-?\d+)\]C\[(-?\d+)\]\)/gi, function (_, r1, c1, r2, c2) {
        var a = riadok + +r1, b = riadok + +r2, ca = stlpec + +c1, cb = stlpec + +c2, sum = 0;
        for (var rr = Math.min(a, b); rr <= Math.max(a, b); rr++) {
          if (Math.max(ca, cb) >= 9) sum += sucetObj(rr);
          else for (var cc = Math.min(ca, cb); cc <= Math.max(ca, cb); cc++) sum += bunka(rr, cc);
        }
        return "(" + sum + ")";
      });
      s = s.replace(/R\[(-?\d+)\]C\[(-?\d+)\]/gi, function (_, r1, c1) { return "(" + bunka(riadok + +r1, stlpec + +c1) + ")"; });
      if (!/^[\d.()+\-*/\s e]*$/.test(s)) return 0;
      try { var v = Function('"use strict";return (' + s + ")")(); return isFinite(v) ? v : 0; } catch (e) { return 0; }
    }
    var out = {};
    sablona.forEach(function (r) { out[r.riadok] = { ks: r.vzorec_ks ? bunka(r.riadok, 4) : null, davky: r.vzorec_davky ? bunka(r.riadok, 5) : null }; });
    return out;
  }
  // produkty v objednávkach, ktoré nie sú v šablóne (v starej tabuľke by sa stratili)
  function inePolozky(sablona, objednavky) {
    var zname = {}; sablona.forEach(function (r) { if (r.kod) zname[r.kod] = true; });
    var ine = {};
    objednavky.forEach(function (o) {
      Object.keys(o.polozky || {}).forEach(function (k) { if (!zname[k]) ine[k] = (o.nazvy && o.nazvy[k]) || ine[k] || k; });
    });
    return Object.keys(ine).sort().map(function (k) { return { riadok: "x-" + k, kod: k, nazov: ine[k], typ: "produkt", ine: true, farba: "#eeeeee" }; });
  }

  // ---------- zobrazenie ----------
  function prekresli() {
    if (!koren) return;
    var html = F.id == null ? pohladZoznam() : F.id === "archiv" ? pohladArchiv() : pohladFurmanka();
    koren.innerHTML = html + (F.dialog ? dialogHtml() : "");
    if (window.lbzPamat) lbzPamat.uloz("furmanky", { id: F.id });
    koren.classList.toggle("f-siroke", F.id != null && zobrazenie() === "tabulka");
    var fok = koren.querySelector("[data-f-fokus]"); if (fok) fok.focus();
    var zoz = koren.querySelector("#f-poradie-zoz"); if (zoz) zapniTahanie(zoz);
  }
  // ---------- poradie ťahaním (myš aj prst) – knižnica SortableJS ----------
  function zapniTahanie(el) {
    var spusti = function () { if (window.Sortable && el.isConnected) window.Sortable.create(el, { animation: 150, delay: 120, delayOnTouchOnly: true, ghostClass: "f-por-duch" }); };
    if (window.Sortable) return spusti();
    var sc = document.createElement("script");
    sc.src = "https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js";
    sc.onload = spusti;
    sc.onerror = function () { F.sprava = { typ: "chyba", text: "Knižnica na ťahanie sa nenačítala (bez signálu?)" }; prekresli(); };
    document.head.appendChild(sc);
  }
  function jeDobierka(o) { return o.platba !== "ZAPLATENÉ" && o.platba !== "NA FAKTÚRU"; }
  function poradieHtml(obj) {
    var zor = obj.slice().sort(function (a, b) { return (a.poradie || 999) - (b.poradie || 999); });
    return '<section class="card f-poradie"><h3>↕️ Poradie zastávok</h3><p class="muted" style="margin:0">Potiahnite objednávky myšou alebo prstom. Trasa pôjde presne v tomto poradí (bez optimalizácie). Po uložení dajte v Trase pre furmana <b>Prepočítať trasu</b>.</p>' +
      '<ol id="f-poradie-zoz" class="f-poradie-zoz">' + zor.map(function (o) {
        return '<li data-c="' + esc(o.cislo) + '"><span class="f-uchyt" aria-hidden="true">≡</span><span><b>' + esc(o.meno || o.firma || o.cislo) + "</b>" + (o.priorita ? " ⭐" : "") +
          '<br><span class="muted f-mini">' + esc([o.ulica, [o.psc, o.mesto].filter(Boolean).join(" ")].filter(Boolean).join(", ")) + "</span></span></li>";
      }).join("") + "</ol>" +
      '<div class="f-tl"><button class="btn btn-primary" data-f="poradie-uloz">💾 Uložiť poradie</button>' +
      '<button class="btn" data-f="poradie-auto">🔄 Automatické poradie</button><button class="btn" data-f="poradie-zrus">Zrušiť</button></div></section>';
  }
  function trasaRiadky(obj) {
    return '<tr class="f-hl f-hl-trasa"><th class="f-n" colspan="3">Poradie</th>' + obj.map(function (o) {
        return '<td class="f-o">' + (o.poradie_pevne ? "<b>" + esc(o.poradie) + ".</b> pevné" : o.priorita ? "⭐ prvá" : '<span class="muted">auto</span>') + "</td>";
      }).join("") + "</tr>" +
      '<tr class="f-hl f-hl-trasa"><th class="f-n" colspan="3">Priorita (ide prvá)</th>' + obj.map(function (o) {
        return '<td class="f-o"><input type="checkbox" data-f-prio="' + esc(o.cislo) + '"' + (o.priorita ? " checked" : "") + ' aria-label="Priorita ' + esc(o.meno || o.cislo) + '"></td>';
      }).join("") + "</tr>" +
      '<tr class="f-hl f-hl-trasa"><th class="f-n" colspan="3">Vykládka (min)</th>' + obj.map(function (o) {
        return '<td class="f-o"><input class="f-vykl" inputmode="numeric" data-f-vykl="' + esc(o.cislo) + '" value="' + (o.vykladka_min != null ? esc(o.vykladka_min) : "") + '" placeholder="' + (jeDobierka(o) ? 10 : 5) + '" aria-label="Vykládka v minútach ' + esc(o.meno || o.cislo) + '"></td>';
      }).join("") + "</tr>";
  }
  function spravaHtml() {
    if (!F.sprava) return "";
    var zle = F.sprava.zle && F.sprava.zle.length ? '<ul class="f-zle-adresy">' + F.sprava.zle.map(function (z) {
      var o = objednavka(z.cislo) || {};
      return '<li><b>' + esc(o.meno || o.firma || z.cislo) + '</b> <span class="muted">' + esc(z.cislo) + '</span><br>📍 ' + esc(z.adresa || "chýba adresa") +
        ' <button class="btn" data-f-obj="' + esc(z.cislo) + '">✏️ Opraviť adresu</button></li>';
    }).join("") + "</ul>" : "";
    return '<div class="f-sprava f-' + F.sprava.typ + '" role="status">' + esc(F.sprava.text) + ' <button class="btn-link" data-f="zavri-spravu" aria-label="Zavrieť">✕</button>' + zle + "</div>";
  }
  function testHtml() {
    return '<p class="s-test" title="Appka z Upgates len číta – nevypína články, nepíše [NEPOSIELAT] ani statusy a neposiela e-maily. Ostrá práca zatiaľ v Správe objednávok.">🧪 Test – z Upgates len číta, ostrá práca v Správe objednávok</p>';
  }
  function behHtml() {
    var b = F.beh && F.beh.posledny;
    if (!b) return '<span class="muted">Z Upgates sa ešte nesťahovalo.</span>';
    return '<span class="muted">⟳ Upgates ' + esc(casSk(b.cas)) + (b.typ === "auto" ? " · automaticky" : " · ručne") +
      (b.ok ? "" : ' · <strong class="f-zle">' + esc(b.text) + "</strong>") + "</span>";
  }

  var MAX_HODIN = 11.75;
  function kartaRozvozu(f) {
    var d = f.datum ? new Date(f.datum + "T12:00:00") : null;
    var hod = Number(f.trasa_hodiny) || 0, sirka = Math.min(100, Math.round(hod / MAX_HODIN * 100));
    var trieda = f.stav === "full" ? " f-k-full" : f.stav === "rozvezena" ? " f-k-rozv" : "";
    return '<button class="card f-karta' + trieda + '" data-f-otvor="' + f.id + '">' +
      '<span class="f-k-hore"><span class="f-k-den">' + (d ? esc(d.toLocaleDateString("sk-SK", { weekday: "short" })) : "&nbsp;") + "</span>" + stavPill(f.stav) + "</span>" +
      '<span class="f-k-datum">' + (d ? d.getDate() + ". " + (d.getMonth() + 1) + "." : "bez termínu") + "</span>" +
      '<span class="f-k-region">' + esc(f.region) + "</span>" +
      '<span class="f-k-cisla"><span><b class="num">' + f.pocet + "</b> obj.</span><span><b class=\"num\">" + esc(eur(f.suma)) + "</b></span></span>" +
      (f.rozvoz ? '<span class="f-k-bar"><i style="width:' + sirka + '%"></i></span><span class="f-k-trasa">' +
        (hod ? "trasa " + cislo(hod, 1) + " h / " + cislo(MAX_HODIN, 2) + " h" : "trasa sa ešte nepočítala") + "</span>" : "") +
      (f.naplanovane ? '<span class="f-k-napl">✓ naplánované</span>' : "") +
      (f.zabalene ? '<span class="f-k-trasa">📦 zabalené ' + f.zabalene + " / " + f.pocet + "</span>" : "") +
      (f.odlozene ? '<span class="b-st b-st-odl">⚠️ odložené pri balení: ' + f.odlozene + "</span>" : "") +
      (f.datum && !f.v_kalendari ? '<span class="pill bad">nie je v kalendári</span>' : "") +
      "</button>";
  }
  function kartaIna(f, ikona, text) {
    return '<button class="card f-karta f-k-ina" ' + (f.id === "archiv" ? 'data-f="archiv"' : 'data-f-otvor="' + f.id + '"') + ">" +
      '<span class="f-k-ik" aria-hidden="true">' + ikona + '</span><span class="f-k-region">' + esc(f.region) + "</span>" +
      '<span class="muted">' + text + "</span></button>";
  }
  function pohladZoznam() {
    var z = F.zoznam || [];
    var hranica = new Date(); hranica.setDate(hranica.getDate() + 7);
    var do7 = hranica.getFullYear() + "-" + ("0" + (hranica.getMonth() + 1)).slice(-2) + "-" + ("0" + hranica.getDate()).slice(-2);
    var vsetkyRozvozy = z.filter(function (f) { return f.rozvoz && f.datum; });
    var rozvozy = vsetkyRozvozy.filter(function (f) { return F.vsetky || f.datum <= do7; });   // len najbližších 7 dní
    var neskor = vsetkyRozvozy.length - rozvozy.length;
    var ostatne = z.filter(function (f) { return !(f.rozvoz && f.datum); });
    var nezar = z.filter(function (f) { return f.region === "NEZARADENÉ"; }).reduce(function (a, f) { return a + (f.pocet || 0); }, 0);
    var objSpolu = rozvozy.reduce(function (a, f) { return a + (f.pocet || 0); }, 0);
    var sumaSpolu = rozvozy.reduce(function (a, f) { return a + (Number(f.suma) || 0); }, 0);
    var ikonaIne = function (f) { return f.region === "NEZARADENÉ" ? "⚠️" : f.region === "Osobný odber" ? "🏪" : f.region === "Elektronicky" ? "✉️" : "🚚"; };
    var kpi = '<div class="kpi">' +
      '<div class="k"><span class="k-ik" aria-hidden="true">🚚</span><b class="num">' + rozvozy.length + "</b><span>" + (F.vsetky ? "furmaniek" : "furmaniek na 7 dní") + "</span></div>" +
      '<div class="k"><span class="k-ik" aria-hidden="true">🧾</span><b class="num">' + objSpolu + "</b><span>objednávok na rozvoz</span></div>" +
      '<div class="k"><span class="k-ik" aria-hidden="true">💶</span><b class="num">' + esc(eur(sumaSpolu).replace(",00", "")) + "</b><span>spolu</span></div>" +
      '<div class="k' + (nezar ? " k-pozor" : "") + '"><span class="k-ik" aria-hidden="true">' + (nezar ? "⚠️" : "✅") + '</span><b class="num">' + nezar + "</b><span>nezaradených</span></div></div>";
    return '<div class="head"><div><h2>Furmanky</h2><div class="sub">' + behHtml() + '</div></div><span class="head-tl">' +
        '<button class="btn btn-ikona" data-f="obnov" title="Obnoviť zobrazenie" aria-label="Obnoviť zobrazenie"' + (F.nacitavam ? " disabled" : "") + ">↻</button>" +
        '<button class="btn btn-primary" data-f="stiahni"' + (F.stahujem ? " disabled" : "") + '><span aria-hidden="true">⟳</span><span class="tl-text">' + (F.stahujem ? "Sťahujem…" : "Aktualizovať z Upgates") + "</span></button></span></div>" +
      testHtml() + spravaHtml() +
      (F.zoznam == null ? '<div class="empty"><strong>Načítavam furmanky…</strong></div>' :
        (!z.length ? '<div class="empty"><strong>Zatiaľ žiadne furmanky</strong><span class="muted">Stlačte „Aktualizovať z Upgates“.</span></div>' :
          kpi +
          '<div class="f-karty">' + (rozvozy.map(kartaRozvozu).join("") || '<p class="muted">Najbližších 7 dní nie je žiadny rozvoz.</p>') + "</div>" +
          (neskor || F.vsetky ? '<button class="btn-link f-dalsie" data-f="dalsie">' + (F.vsetky ? "Zobraziť len najbližších 7 dní" : "Ďalšie termíny (" + neskor + ")") + "</button>" : "") +
          (ostatne.length || F.archivN || F.odobrate ? '<h3 class="f-nadpis">Ostatné</h3>' : "") + '<div class="f-karty f-karty-ine">' +
            ostatne.map(function (f) { return kartaIna(f, ikonaIne(f), '<span class="num">' + f.pocet + "</span> obj." + (f.suma ? " · " + esc(eur(f.suma)) : "")); }).join("") +
            (F.archivN ? kartaIna({ id: "archiv", region: "Archív" }, "🗄️", '<span class="num">' + F.archivN + "</span> rozvezených") : "") +
            (F.odobrate ? kartaIna({ id: "odobrate", region: "Odobraté" }, "🚫", '<span class="num">' + F.odobrate + "</span> vyradených ručne") : "") +
          "</div>"));
  }

  function nacitajArchiv() {
    F.nacitavam = true; prekresli();
    return rpc("furmanky_archiv", { p_text: F.archivText || null }).then(function (r) {
      F.nacitavam = false;
      if (!r || r.ok === false) F.sprava = { typ: "chyba", text: (r && r.text) || "Archív sa nenačítal" };
      else F.archiv = r.furmanky || [];
      prekresli();
    }).catch(function (e) { F.nacitavam = false; F.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }
  function pohladArchiv() {
    var z = F.archiv;
    return '<div class="head"><div><button class="btn-link spat" data-f="spat">← Furmanky</button><h2>Archív rozvozov</h2></div></div>' +
      '<form id="f-archiv-form" class="f-hladaj-riadok"><input class="f-hladat" data-f-archiv-text placeholder="Číslo objednávky, meno, telefón, región alebo dátum" value="' + esc(F.archivText) + '">' +
      '<button class="btn btn-primary" type="submit">Hľadať</button></form>' + spravaHtml() +
      (z == null ? '<div class="empty"><strong>Načítavam…</strong></div>' : !z.length ? '<div class="empty"><strong>Nič sa nenašlo</strong></div>' :
        '<div class="f-karty">' + z.map(function (f) {
          return '<button class="card f-karta" data-f-otvor="' + f.id + '"><span class="f-karta-hore"><strong>' + esc(f.region) + "</strong>" + stavPill(f.stav) + "</span>" +
            '<span class="f-datum">' + esc(datumSk(f.datum)) + "</span>" +
            '<span class="muted"><span class="num">' + f.pocet + "</span> obj. · " + esc(eur(f.suma)) + "</span>" +
            (f.najdene ? '<span class="f-mini">' + f.najdene.map(esc).join("<br>") + "</span>" : "") + "</button>";
        }).join("") + "</div>");
  }

  function pohladFurmanka() {
    var d = F.data, f = d && d.furmanka;
    var hore = '<div class="head"><div><button class="btn-link spat" data-f="spat">← Furmanky</button><h2>' +
      esc(f ? f.nazov : "Furmanka") + " " + (f && f.id ? stavPill(f.stav) : "") + "</h2>" +
      (f && f.dovod ? '<div class="muted f-mini">' + esc(f.dovod) + (f.uzavreta ? " · " + esc(casSk(f.uzavreta)) : "") + "</div>" : "") +
      "</div></div>";
    if (!d) return hore + spravaHtml() + '<div class="empty"><strong>' + (F.nacitavam ? "Načítavam…" : "Furmanka sa nenačítala") + "</strong></div>";
    var obj = d.objednavky || [];
    var suma = obj.reduce(function (a, o) { return a + (Number(o.suma) || 0); }, 0);
    var lista = '<div class="f-lista">' +
      '<span class="muted"><span class="num">' + obj.length + "</span> objednávok · " + esc(eur(suma)) + (f.trasa_hodiny ? " · trasa " + cislo(f.trasa_hodiny, 1) + " h" : "") + "</span>" +
      '<span class="f-lista-tl">' +
        (f.id ? '<button class="btn" data-f="pridat">+ Objednávka</button>' : "") +
        (f.id ? (f.stav === "otvorena" ? '<button class="btn f-tl-full" data-f="stav" data-stav="full">🔒 Uzavrieť (FULL)</button>' :
          f.stav === "rozvezena" ? '<button class="btn" data-f="stav" data-stav="full">↩️ Vrátiť z archívu</button>' :
          '<button class="btn" data-f="stav" data-stav="otvorena">Otvoriť</button>') : "") +
        (f.id && f.rozvoz && f.stav !== "rozvezena" ? (f.naplanovane ? '<span class="pill ok f-napl">✓ Naplánované ' + esc(casSk(f.naplanovane)) + "</span>" :
          (F.trasa && F.trasa.trasa ? '<button class="btn f-tl-napl" data-f="naplanovane">✅ Naplánované</button>'
            : '<button class="btn f-tl-napl" type="button" disabled title="Najprv vytvorte trasu pre furmana – podľa nej sa pripravia SMS">✅ Naplánované <small>(najprv trasa)</small></button>')) +
          '<button class="btn f-tl-vrat" data-f="vrat-statusy">↩️ Vrátiť statusy</button>' +
          (F.trasa && F.trasa.trasa && F.trasa.trasa.stav !== "ukoncena" ? '<button class="btn f-tl-sms" data-f="sms">📱 Poslať SMS' + smsPocet() + "</button>" : "") : "") +
        // Rozvezené nastaví furman v module Trasa (bez uzavretého rozvozu sa neodhlási z práce); ručne sa dá archivovať kedykoľvek
        (f.id && f.stav !== "rozvezena" ? '<button class="btn" data-f="stav" data-stav="rozvezena">🗄️ Archivovať</button>' : "") +
        (f.id && f.rozvoz && f.stav !== "rozvezena" ? '<button class="btn" data-f="poradie">↕️ Upraviť poradie</button>' : "") +
        '<button class="btn" data-f="sumar">🖨️ Sumár výroby</button>' +
      "</span></div>" +
      '<div class="f-prepinace">' +
        '<label class="f-check"><input type="checkbox" data-f-skryt' + (F.skryt ? " checked" : "") + "> Skryť prázdne riadky</label>" +
        '<span class="f-seg" role="group" aria-label="Zobrazenie"><button data-f-zobraz="tabulka" aria-pressed="' + (zobrazenie() === "tabulka") + '">Tabuľka</button>' +
        '<button data-f-zobraz="zoznam" aria-pressed="' + (zobrazenie() === "zoznam") + '">Zoznam</button></span>' +
        '<button class="btn-link" data-f="obnov-f">Obnoviť</button></div>';
    var telo = !obj.length ? '<div class="empty"><strong>Vo furmanke nie sú objednávky</strong></div>'
      : F.poradieRezim ? poradieHtml(obj) : (zobrazenie() === "tabulka" ? tabulkaHtml(obj) : zoznamHtml(obj));
    return hore + (f.id ? testHtml() : "") + spravaHtml() + lista + trasaHtml(f) + telo;
  }

  function riadkyNaZobrazenie(obj) {
    var sab = F.sablona || [];
    var v = vypocitaj(sab, obj);
    var ine = inePolozky(sab, obj);
    var riadky = sab.filter(function (r) { return r.typ !== "suma"; }).concat(ine).concat(sab.filter(function (r) { return r.typ === "suma"; }));
    return riadky.map(function (r) {
      var h = v[r.riadok] || {};
      var ks = r.ine ? obj.reduce(function (a, o) { return a + (Number((o.polozky || {})[r.kod]) || 0); }, 0) : h.ks;
      return { r: r, ks: ks, davky: h.davky, prazdny: !(Number(ks) || Number(h.davky)) };
    }).filter(function (x) { return !F.skryt || !x.prazdny || x.r.typ === "suma"; });
  }

  function hlavickaObjednavky(o) {
    var ozn = (o.rucne_polia && o.rucne_polia.length) || o.rucne ? ' <span class="f-rucne" title="Zmenené v appke">✎</span>' : "";
    var b = o.balenie, bal = !b ? "" : b.stav === "odlozena" ? ' <span class="b-st b-st-odl" title="' + esc(b.dovod || "") + '">📦 odložená: ' + esc(b.dovod || "") + "</span>"
      : b.stav === "zabalena" ? ' <span class="b-st b-st-ok">📦 zabalená</span>' : ' <span class="b-st b-st-rozp">📦 balí sa</span>';
    return esc(o.meno || o.firma || "(bez mena)") + ozn + bal;
  }
  var HLAVICKA = [
    ["Meno/Firma", function (o) { return hlavickaObjednavky(o); }],
    ["Dátum", function (o) { return esc(o.vytvorena ? new Date(o.vytvorena).toLocaleDateString("sk-SK") : "-"); }],
    ["Telefón", function (o) { return o.telefon ? '<a href="tel:' + esc(o.telefon) + '">' + esc(o.telefon) + "</a>" : ""; }],
    ["Adresa", function (o) { return esc([o.ulica, [o.psc, o.mesto].filter(Boolean).join(" ")].filter(Boolean).join(", ")); }],
    ["Č. objednávky", function (o) { return esc(o.cislo); }],
    ["Č. faktúry", function (o) { return esc(o.faktura || "-"); }],
    ["Platba", function (o) { return '<span class="f-platba f-p-' + (o.platba === "ZAPLATENÉ" ? "ok" : o.platba === "NA FAKTÚRU" ? "fa" : "db") + '">' + esc(o.platba || "DOBIERKA") + "</span>"; }],
    ["Stav", function (o) { return esc(o.status || ""); }],
    ["Poznámka", function (o) { return esc([o.poznamka, o.upozornenie].filter(Boolean).join(" | ")); }]
  ];

  function tabulkaHtml(obj) {
    var riadky = riadkyNaZobrazenie(obj);
    var hl = HLAVICKA.map(function (h, i) {
      return "<tr class=\"f-hl" + (i === 0 ? " f-hl-meno" : "") + "\"><th class=\"f-n\" colspan=\"3\">" + esc(h[0]) + "</th>" + obj.map(function (o) {
        return '<td class="f-o" data-f-obj="' + esc(o.cislo) + '">' + h[1](o) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    var hlavy = '<tr class="f-stlpce"><th class="f-n">Názov</th><th class="f-k">Spolu ks</th><th class="f-d">Dávky</th>' +
      obj.map(function (o) { return '<th class="f-o"><button class="btn-link" data-f-obj="' + esc(o.cislo) + '">Upraviť</button> · <button class="btn-link" data-f-presun-obj="' + esc(o.cislo) + '">Presunúť</button></th>'; }).join("") + "</tr>";
    var telo = riadky.map(function (x) {
      var r = x.r, farba = r.farba ? ' style="background:' + esc(r.farba) + ';color:#1d1412"' : "";
      var jeProdukt = r.typ === "produkt";
      var bunky = obj.map(function (o) {
        if (r.typ === "suma") return '<td class="f-o f-num">' + esc(o.suma != null ? cislo(o.suma, 2) : "") + "</td>";
        if (!jeProdukt) return '<td class="f-o"></td>';
        var v = (o.polozky || {})[r.kod];
        return '<td class="f-o f-bunka"><input inputmode="decimal" aria-label="' + esc(r.nazov + " – " + (o.meno || o.cislo)) + '" data-f-bunka="' + esc(o.cislo) + '" data-kod="' + esc(r.kod) + '" value="' + (v ? esc(v) : "") + '"></td>';
      }).join("");
      return '<tr class="f-r f-t-' + r.typ + (r.ine ? " f-ine" : "") + '"><th class="f-n"' + farba + ">" + esc(r.nazov) + (r.ine ? ' <span class="muted f-mini">(' + esc(r.kod) + ", mimo šablóny)</span>" : "") + "</th>" +
        '<td class="f-k f-num"' + farba + ">" + (x.ks == null ? "" : (r.typ === "suma" ? "SUM" : cislo(x.ks))) + "</td>" +
        '<td class="f-d f-num"' + farba + ">" + (x.davky == null ? "" : (r.typ === "suma" ? esc(eur(x.davky)) : cislo(x.davky, 2))) + "</td>" + bunky + "</tr>";
    }).join("");
    var tr = F.data && F.data.furmanka && F.data.furmanka.rozvoz ? trasaRiadky(obj) : "";
    return '<div class="f-obal"><table class="f-tab"><tbody>' + hl + tr + hlavy + telo + "</tbody></table></div>";
  }

  function zoznamHtml(obj) {
    var sab = F.sablona || [];
    var poKode = {}; sab.forEach(function (r) { if (r.kod) poKode[r.kod] = r; });
    var riadky = riadkyNaZobrazenie(obj).filter(function (x) { return x.r.typ !== "suma" && !x.prazdny; });
    var sumar = '<details class="card f-sumar-m"' + (obj.length ? "" : " open") + "><summary><strong>Spolu za furmanku</strong></summary><div class=\"rows\">" +
      riadky.map(function (x) {
        return '<div class="row f-r-' + x.r.typ + '"' + (x.r.farba ? ' style="background:' + esc(x.r.farba) + ';color:#1d1412"' : "") + "><span>" + esc(x.r.nazov) + '</span><span class="num">' + cislo(x.ks) + (x.davky ? ' <span class="muted">· ' + cislo(x.davky, 2) + " dáv.</span>" : "") + "</span></div>";
      }).join("") + "</div></details>";
    return sumar + '<div class="f-obj-karty">' + obj.map(function (o) {
      var pol = Object.keys(o.polozky || {}).map(function (k) {
        var r = poKode[k];
        return { kod: k, nazov: (r && r.nazov) || (o.nazvy && o.nazvy[k]) || k, farba: r && r.farba, poradie: r ? r.riadok : 999, ks: o.polozky[k] };
      }).sort(function (a, b) { return a.poradie - b.poradie; });
      return '<section class="card f-obj">' +
        '<h3><span>' + hlavickaObjednavky(o) + '</span><span class="muted num f-mini">' + esc(o.cislo) + "</span></h3>" +
        '<div class="muted f-mini">' + HLAVICKA[3][1](o) + (o.telefon ? " · " + HLAVICKA[2][1](o) : "") + "</div>" +
        '<div class="f-mini">' + HLAVICKA[6][1](o) + " " + esc(eur(o.suma)) + " · " + esc(o.status || "") + "</div>" +
        (F.data && F.data.furmanka && F.data.furmanka.rozvoz ? '<div class="f-mini f-trasa-obj"><label class="f-check"><input type="checkbox" data-f-prio="' + esc(o.cislo) + '"' + (o.priorita ? " checked" : "") + "> ⭐ Priorita</label>" +
          '<label>Vykládka <input class="f-vykl" inputmode="numeric" data-f-vykl="' + esc(o.cislo) + '" value="' + (o.vykladka_min != null ? esc(o.vykladka_min) : "") + '" placeholder="' + (jeDobierka(o) ? 10 : 5) + '"> min</label>' +
          '<span class="muted">' + (o.poradie_pevne ? "poradie " + esc(o.poradie) + ". (pevné)" : "poradie auto") + "</span></div>" : "") +
        (o.poznamka || o.upozornenie ? '<div class="f-pozn">' + HLAVICKA[8][1](o) + "</div>" : "") +
        '<div class="rows">' + pol.map(function (p) {
          return '<div class="row"' + (p.farba ? ' style="background:' + esc(p.farba) + ';color:#1d1412"' : "") + "><span>" + esc(p.nazov) + "</span>" +
            '<input class="f-ks" inputmode="decimal" aria-label="Počet ' + esc(p.nazov) + '" data-f-bunka="' + esc(o.cislo) + '" data-kod="' + esc(p.kod) + '" value="' + esc(p.ks) + '"></div>';
        }).join("") + "</div>" +
        '<div class="f-tl"><button class="btn" data-f-presun-obj="' + esc(o.cislo) + '">Presunúť</button><button class="btn" data-f-obj="' + esc(o.cislo) + '">Upraviť objednávku</button></div></section>';
    }).join("") + "</div>";
  }

  // ---------- dialógy ----------
  function objednavka(cislo) { return ((F.data && F.data.objednavky) || []).filter(function (o) { return o.cislo === cislo; })[0]; }
  function dialogHtml() {
    var d = F.dialog, telo = "";
    if (d.typ === "obj") telo = dialogObjednavka(d);
    else if (d.typ === "pridat") telo = dialogPridat(d);
    else if (d.typ === "presun") telo = dialogPresun(d);
    return '<div class="f-dialog-pozadie" data-f="zavri-dialog"></div><div class="f-dialog" role="dialog" aria-modal="true">' + telo + "</div>";
  }
  function pole(nazov, kluc, hodnota, typ) {
    return '<label class="field"><span class="label">' + esc(nazov) + '</span><input data-pole="' + kluc + '" type="' + (typ || "text") + '" value="' + esc(hodnota == null ? "" : hodnota) + '"></label>';
  }
  function dialogObjednavka(d) {
    var o = d.nova ? { cislo: "", platba: "DOBIERKA", polozky: {} } : (objednavka(d.cislo) || {});
    var sab = (F.sablona || []).filter(function (r) { return r.typ === "produkt"; });
    var hl = (d.hladat || "").trim().toLowerCase();
    var polozky = {};
    Object.keys(d.nova ? {} : (o.polozky || {})).forEach(function (k) { polozky[k] = o.polozky[k]; });
    Object.keys(d.zmeny || {}).forEach(function (k) { polozky[k] = d.zmeny[k]; });
    var produkty = sab.filter(function (r) {
      return polozky[r.kod] || (hl && bezDiakritiky(r.nazov + " " + r.kod).toLowerCase().indexOf(bezDiakritiky(hl)) > -1);
    });
    var akcie = d.nova ? "" : '<div class="f-akcie">' +
      '<button class="btn" data-f="presun">Presunúť do inej furmanky</button>' +
      (o.furmanka_id ? '<button class="btn" data-f="odobrat">Odobrať z furmanky</button>' : "") +
      (o.rucne ? '<button class="btn" data-f="auto">Vrátiť automatike</button>' : "") +
      (o.zdroj === "upgates" && o.rucne_polia && o.rucne_polia.length ? '<button class="btn" data-f="z-upgates">Zahodiť zmeny a načítať z Upgates</button>' : "") +
      "</div>";
    return '<h3>' + (d.nova ? "Nová objednávka (ručne)" : "Objednávka " + esc(o.cislo)) + "</h3>" +
      (!d.nova && o.rucne_polia && o.rucne_polia.length ? '<p class="muted f-mini">Zmenené v appke: ' + esc(o.rucne_polia.join(", ")) + " – Upgates tieto údaje neprepíše.</p>" : "") +
      (o.upozornenie ? '<p class="f-sprava f-chyba">' + esc(o.upozornenie) + "</p>" : "") +
      '<form id="f-obj-form" class="f-form">' +
        '<div class="f-2">' + pole("Meno", "meno", o.meno) + pole("Firma", "firma", o.firma) + "</div>" +
        '<div class="f-2">' + pole("Telefón", "telefon", o.telefon, "tel") + pole("E-mail", "email", o.email, "email") + "</div>" +
        pole("Ulica a číslo", "ulica", o.ulica) +
        '<div class="f-2">' + pole("PSČ", "psc", o.psc) + pole("Mesto / obec", "mesto", o.mesto) + "</div>" +
        '<div class="f-2"><label class="field"><span class="label">Platba</span><select data-pole="platba">' +
          ["DOBIERKA", "ZAPLATENÉ", "NA FAKTÚRU"].map(function (p) { return "<option" + ((o.platba || "DOBIERKA") === p ? " selected" : "") + ">" + p + "</option>"; }).join("") +
        "</select></label>" + pole("Suma €", "suma", o.suma != null ? String(o.suma).replace(".", ",") : "", "text") + "</div>" +
        '<label class="field"><span class="label">Poznámka (STOP, PORADIE: n, PRIORITA, ČAS: n)</span><textarea data-pole="poznamka" rows="2">' + esc(o.poznamka || "") + "</textarea></label>" +
        '<div class="f-polozky"><span class="label">Položky</span>' +
          '<input class="f-hladat" data-f-hladat placeholder="Pridať produkt – napíšte názov alebo kód" value="' + esc(d.hladat || "") + '"' + (d.fokusHladat ? " data-f-fokus" : "") + ">" +
          '<div class="rows">' + (produkty.length ? produkty.map(function (r) {
            return '<div class="row" style="background:' + esc(r.farba || "#fff") + ';color:#1d1412"><span>' + esc(r.nazov) + ' <span class="muted f-mini">' + esc(r.kod) + "</span></span>" +
              '<input class="f-ks" inputmode="decimal" data-f-pol="' + esc(r.kod) + '" value="' + esc(polozky[r.kod] || "") + '" aria-label="Počet ' + esc(r.nazov) + '"></div>';
          }).join("") : '<p class="muted f-mini">' + (hl ? "Nič sa nenašlo." : "Zatiaľ žiadne položky – vyhľadajte produkt.") + "</p>") + "</div></div>" +
        '<div class="f-tl"><button class="btn" type="button" data-f="zavri-dialog">Zrušiť</button><button class="btn btn-primary" type="submit">' + (d.nova ? "Vytvoriť" : "Uložiť") + "</button></div>" +
      "</form>" + akcie;
  }
  function dialogPridat(d) {
    var vysl = d.vysledky;
    return "<h3>Pridať objednávku do furmanky</h3>" +
      '<form id="f-hladaj-form" class="f-form"><label class="field"><span class="label">Číslo objednávky, meno alebo telefón</span>' +
      '<input data-f-hladaj-obj value="' + esc(d.text || "") + '" data-f-fokus autocomplete="off"></label>' +
      '<div class="f-tl"><button class="btn btn-primary" type="submit">Hľadať</button></div></form>' +
      (d.info ? '<p class="f-sprava f-' + d.info.typ + '">' + esc(d.info.text) + "</p>" : "") +
      (vysl ? (vysl.length ? '<div class="rows">' + vysl.map(function (x) {
        return '<div class="row"><span><strong>' + esc(x.cislo) + "</strong> " + esc(x.meno || "") + ' <span class="muted f-mini">' + esc([x.mesto, x.status, x.furmanka ? "teraz: " + x.furmanka : "bez furmanky"].filter(Boolean).join(" · ")) + "</span></span>" +
          '<button class="btn" data-f-pridaj="' + esc(x.cislo) + '">Pridať sem</button></div>';
      }).join("") + "</div>" : '<p class="muted">V appke sa nenašla.</p>') : "") +
      (d.text && /\d/.test(d.text) ? '<button class="btn" data-f="z-upgates-cislo">Načítať ' + esc(d.text.trim()) + " z Upgates a pridať</button>" : "") +
      '<hr class="f-hr"><button class="btn" data-f="nova">+ Vytvoriť objednávku ručne</button>' +
      '<div class="f-tl"><button class="btn" data-f="zavri-dialog">Zavrieť</button></div>';
  }
  function dialogPresun(d) {
    var z = (F.zoznam || []).filter(function (f) { return !F.data || f.id !== F.data.furmanka.id; });
    var o = objednavka(d.cislo) || {};
    return "<h3>Presunúť " + esc(d.cislo) + "</h3>" +
      '<p class="muted f-mini">' + esc([o.meno || o.firma, [o.ulica, [o.psc, o.mesto].filter(Boolean).join(" ")].filter(Boolean).join(", "), o.doprava].filter(Boolean).join(" · ")) + "</p>" +
      "<div class=\"rows\">" + z.map(function (f) {
      return '<div class="row"><span>' + esc(f.nazov) + " " + stavPill(f.stav) + '</span><button class="btn" data-f-presun="' + f.id + '">Sem</button></div>';
    }).join("") + '</div><div class="f-tl"><button class="btn" data-f="zavri-dialog">Zrušiť</button></div>';
  }

  // ---------- akcie ----------
  function po(promise, okText) {
    return promise.then(function (r) {
      if (r && r.ok === false) { F.sprava = { typ: "chyba", text: r.text || "Nepodarilo sa" }; prekresli(); return r; }
      if (okText) F.sprava = { typ: "ok", text: typeof okText === "function" ? okText(r) : okText };
      return r;
    }).catch(function (e) { F.sprava = { typ: "chyba", text: "Neuložené: " + chybaText(e) }; prekresli(); });
  }
  function ulozBunku(inp) {
    var cislo = inp.getAttribute("data-f-bunka"), kod = inp.getAttribute("data-kod");
    var t = String(inp.value || "").trim().replace(",", ".");
    if (t !== "" && isNaN(Number(t))) { inp.classList.add("f-zla"); return; }
    inp.classList.remove("f-zla");
    var n = t === "" ? 0 : Number(t);
    var o = objednavka(cislo); if (!o) return;
    var stare = Number((o.polozky || {})[kod]) || 0;
    if (stare === n) return;
    o.polozky = o.polozky || {};
    if (n) o.polozky[kod] = n; else delete o.polozky[kod];
    o.rucne_polia = (o.rucne_polia || []).indexOf("polozky") > -1 || o.zdroj !== "upgates" ? o.rucne_polia : (o.rucne_polia || []).concat("polozky");
    inp.classList.add("f-uklada");
    po(rpc("polozka_nastav", { p_cislo: cislo, p_kod: kod, p_mnozstvo: n })).then(function (r) {
      inp.classList.remove("f-uklada");
      if (r && r.ok) { inp.classList.add("f-ulozene"); setTimeout(function () { inp.classList.remove("f-ulozene"); }, 900); obnovSucty(); }
    });
  }
  // prepočíta súčty bez prekreslenia (aby neskákal kurzor)
  function obnovSucty() {
    if (!koren || !F.data) return;
    var obj = F.data.objednavky || [];
    var riadky = riadkyNaZobrazenie(obj);
    var trs = koren.querySelectorAll("table.f-tab tr.f-r");
    if (trs.length !== riadky.length) return; // počet riadkov sa zmenil – necháme tak do ďalšieho prekreslenia
    riadky.forEach(function (x, i) {
      var tds = trs[i].querySelectorAll("td.f-k, td.f-d");
      if (x.r.typ === "suma") return;
      if (tds[0]) tds[0].textContent = x.ks == null ? "" : cislo(x.ks);
      if (tds[1]) tds[1].textContent = x.davky == null ? "" : cislo(x.davky, 2);
    });
  }
  function ulozObjednavku(form) {
    var d = F.dialog, p = {};
    var o = d.nova ? {} : (objednavka(d.cislo) || {});
    Array.prototype.forEach.call(form.querySelectorAll("[data-pole]"), function (el) {
      var k = el.getAttribute("data-pole"), v = el.value.trim();
      var stare = o[k] == null ? "" : String(o[k]);
      if (k === "suma") { stare = stare.replace(".", ","); }
      if (d.nova ? v !== "" : v !== stare) p[k] = v;
    });
    if (d.nova) {
      if (!p.meno && !p.firma) { lbzInfo("Zadajte meno alebo firmu."); return; }
      p.polozky = {};
      Object.keys(d.zmeny || {}).forEach(function (k) { if (d.zmeny[k]) p.polozky[k] = d.zmeny[k]; });
      p.furmanka_id = F.data.furmanka.id;
    } else {
      p.cislo = d.cislo;
      var zmenene = {};
      Object.keys(d.zmeny || {}).forEach(function (kod) {
        if ((Number((o.polozky || {})[kod]) || 0) !== d.zmeny[kod]) zmenene[kod] = d.zmeny[kod];
      });
      if (Object.keys(zmenene).length) p.polozky = zmenene;
      if (Object.keys(p).length === 1) { F.dialog = null; prekresli(); return; }
    }
    F.dialog = null;
    po(rpc("objednavka_uloz", { p: p }), d.nova ? "Objednávka vytvorená" : "Uložené").then(function (r) { if (r && r.ok) { nacitajFurmanku(true); nacitajZoznam(); } });
  }
  function hladajObjednavku(text) {
    F.dialog.text = text; F.dialog.info = null; F.dialog.vysledky = null; prekresli();
    rpc("objednavky_hladaj", { p_text: text }).then(function (v) { if (F.dialog && F.dialog.typ === "pridat") { F.dialog.vysledky = v || []; prekresli(); } })
      .catch(function (e) { if (F.dialog) { F.dialog.info = { typ: "chyba", text: chybaText(e) }; prekresli(); } });
  }
  function pridajDoFurmanky(cislo) {
    var id = F.data.furmanka.id;
    F.dialog = null;
    po(rpc("zaradenie_nastav", { p_cislo: cislo, p_furmanka_id: id }), "Objednávka " + cislo + " pridaná").then(function (r) { if (r && r.ok) { nacitajFurmanku(true); nacitajZoznam(); } });
  }
  function nacitajZUpgates(cislo, pridat) {
    if (F.dialog) { F.dialog.info = { typ: "info", text: "Načítavam " + cislo + " z Upgates…" }; prekresli(); }
    return DB.functions.invoke("upgates-sync", { body: { akcia: "objednavka", cislo: cislo, obnovit: !pridat } }).then(function (res) {
      var d = res.data;
      if (!d && res.error && res.error.context && res.error.context.json) return res.error.context.json();
      return d || { ok: false, text: chybaText(res.error) };
    }).then(function (d) {
      if (!d || !d.ok) { if (F.dialog) { F.dialog.info = { typ: "chyba", text: (d && d.text) || "Nepodarilo sa" }; prekresli(); } else { F.sprava = { typ: "chyba", text: (d && d.text) || "Nepodarilo sa" }; prekresli(); } return; }
      if (pridat) pridajDoFurmanky(cislo);
      else { F.dialog = null; F.sprava = { typ: "ok", text: d.text }; nacitajFurmanku(true); }
    }).catch(function (e) { F.sprava = { typ: "chyba", text: chybaText(e) }; F.dialog = null; prekresli(); });
  }

  // ---------- tlač ----------
  function tlacHtml(html, trieda) {
    var obal = document.getElementById("tlac-oblast");
    if (!obal) { obal = document.createElement("div"); obal.id = "tlac-oblast"; document.body.appendChild(obal); }
    obal.className = trieda || "";
    obal.innerHTML = html;
    document.body.classList.add("tlaci");
    var hotovo = function () { document.body.classList.remove("tlaci"); obal.innerHTML = ""; obal.className = ""; window.removeEventListener("afterprint", hotovo); };
    window.addEventListener("afterprint", hotovo);
    setTimeout(function () { window.print(); setTimeout(hotovo, 1500); }, 80);
  }
  // Sumár výroby – rovnaké rozloženie ako PDF zo Správy objednávok (Názov | Spolu ks | Spolu dávok, prázdne riadky skryté)
  function tlacSumar() {
    var obj = F.data.objednavky || [];
    var sab = F.sablona || [];
    var v = vypocitaj(sab, obj);
    var ine = inePolozky(sab, obj);
    var riadky = sab.filter(function (r) { return r.riadok >= 10 && r.riadok < 145 && (Number(v[r.riadok].ks) || Number(v[r.riadok].davky)); });
    var c2 = function (n) { return n == null || n === "" ? "" : Number(n).toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var html = '<table class="f-t-sumar"><thead><tr><th colspan="3" class="f-t-nazov">' + esc(F.data.furmanka.nazov) + (F.data.furmanka.stav !== "otvorena" ? " [FULL]" : "") + "</th></tr>" +
      '<tr class="f-t-hl"><th>Názov</th><th class="t-c">Spolu ks</th><th class="t-c">Spolu dávok</th></tr></thead><tbody>' +
      riadky.map(function (r) {
        var h = v[r.riadok], cls = "";
        if (r.typ === "sucet") cls = r.farba === "#ff0000" ? "f-t-cerveny" : /^POLOTOVAR/.test(r.nazov) ? "f-t-polotovar" : "f-t-medzi";
        return '<tr class="' + cls + '" style="background:' + esc(r.farba || "#fff") + '"><td>' + esc(r.nazov) + '</td><td class="t-c">' + c2(h.ks) + '</td><td class="t-c">' + (h.davky == null ? "" : c2(h.davky)) + "</td></tr>";
      }).join("") +
      ine.map(function (r) {
        var ks = obj.reduce(function (a, o) { return a + (Number((o.polozky || {})[r.kod]) || 0); }, 0);
        return '<tr><td>' + esc(r.nazov) + " (" + esc(r.kod) + ')</td><td class="t-c">' + c2(ks) + '</td><td class="t-c"></td></tr>';
      }).join("") + "</tbody></table>";
    tlacHtml(html, "f-tlac-sumar");
  }
  function qrText(o, furmanka) {
    var sab = F.sablona || [];
    var casti = [o.cislo || "BEZ_CISLA", bezDiakritiky(o.meno || o.firma || ""), bezDiakritiky(furmanka.nazov.trim())];
    sab.forEach(function (r) {
      if (r.riadok >= 10 && r.riadok < 145 && r.kod) { var q = Number((o.polozky || {})[r.kod]) || 0; if (q > 0) casti.push(r.kod + "WWW" + q); }
    });
    return casti.join("QQQ");
  }
  function tlacStitky() {
    var obj = F.data.objednavky || [], f = F.data.furmanka;
    if (!window.LBZ_QR) { F.sprava = { typ: "chyba", text: "Chýba knižnica QR kódov – obnovte appku." }; prekresli(); return; }
    var sab = F.sablona || [];
    var poKode = {}; sab.forEach(function (r) { if (r.kod) poKode[r.kod] = r; });
    var stitok = function (o) {
      var pol = Object.keys(o.polozky || {}).filter(function (k) { return Number(o.polozky[k]) > 0; }).map(function (k) {
        var r = poKode[k]; return { nazov: (r && r.nazov) || (o.nazvy && o.nazvy[k]) || k, farba: (r && r.farba) || "#fff", poradie: r ? r.riadok : 999, ks: o.polozky[k] };
      }).sort(function (a, b) { return a.poradie - b.poradie; });
      var platba = o.platba || "DOBIERKA";
      var sumaTxt = Number(o.suma || 0).toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "€";
      // rozloženie ako „Rozvozové lístky“ zo Správy objednávok: vľavo popis (široký stĺpec), vpravo hodnota na žltom podklade
      return '<table class="f-stitok"><colgroup><col class="f-s-c1"><col class="f-s-c2"></colgroup><tbody>' +
        '<tr class="f-s-meno"><th>Meno / Firma</th><td class="v b">' + esc(o.meno || o.firma || "-") + "</td></tr>" +
        '<tr><th>Telefón</th><td class="v b">' + esc(o.telefon || "-") + "</td></tr>" +
        '<tr class="f-s-qr"><th>' + window.LBZ_QR.svg(qrText(o, f), 118) + '</th><td class="v b">' + esc([o.ulica, [o.psc, o.mesto].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "-") + "</td></tr>" +
        '<tr><th>Č. objednávky</th><td class="v">' + esc(o.cislo || "-") + "</td></tr>" +
        '<tr><th>Č. faktúry</th><td class="v f-s-fakt">' + esc(o.faktura || "-") + "</td></tr>" +
        '<tr class="f-s-stav"><th>STAV PLATBY</th><td class="f-s-' + (platba === "ZAPLATENÉ" ? "ok" : platba === "NA FAKTÚRU" ? "fa" : "db") + '">' + esc(platba) + "</td></tr>" +
        '<tr class="f-s-pozn"><th>Poznámka</th><td class="v">' + esc([o.poznamka, o.upozornenie].filter(Boolean).join(" | ") || "-") + "</td></tr>" +
        '<tr class="f-s-hl"><th>POLOŽKA</th><td>POČET</td></tr>' +
        (pol.length ? pol.map(function (p) {
          return '<tr style="background:' + esc(p.farba) + '"><th class="f-s-pol">' + esc(p.nazov) + '</th><td class="b">' + esc(cislo(p.ks)) + " ks</td></tr>";
        }).join("") : '<tr><th class="f-s-pol">INDIVIDUAL OBJ/VZORKY</th><td class="b">-</td></tr>') +
        '<tr class="f-s-sum"><th>CELKOVÁ SUMA</th><td class="f-s-suma">' + esc(sumaTxt) + "</td></tr>" +
        "</tbody></table>";
    };
    tlacHtml('<div class="f-stitky">' + obj.map(stitok).join("") + "</div>", "f-tlac-stitky");
  }

  // ---------- udalosti ----------
  function klik(e) {
    var t = e.target.closest("[data-f],[data-f-otvor],[data-f-obj],[data-f-zobraz],[data-f-pridaj],[data-f-presun],[data-f-presun-obj]");
    if (!t || !koren.contains(t)) return;
    if (t.tagName === "INPUT") return;
    var d = t.dataset;
    if (d.fPresunObj) { F.dialog = { typ: "presun", cislo: d.fPresunObj }; prekresli(); return; }
    if (d.fOtvor) { otvor(d.fOtvor === "odobrate" ? "odobrate" : Number(d.fOtvor)); return; }
    if (d.fObj && !e.target.closest("a")) { F.dialog = { typ: "obj", cislo: d.fObj }; prekresli(); return; }
    if (d.fZobraz) { F.zobrazenie = d.fZobraz; prekresli(); return; }
    if (d.fPridaj) { pridajDoFurmanky(d.fPridaj); return; }
    if (d.fPresun) {
      var c = F.dialog && F.dialog.cislo; F.dialog = null;
      po(rpc("zaradenie_nastav", { p_cislo: c, p_furmanka_id: Number(d.fPresun) }), "Objednávka " + c + " presunutá").then(function (r) { if (r && r.ok) { nacitajFurmanku(true); nacitajZoznam(); } });
      return;
    }
    var o = F.dialog && F.dialog.cislo;
    switch (d.f) {
      case "zavri-spravu": F.sprava = null; prekresli(); break;
      case "zavri-dialog": F.dialog = null; prekresli(); break;
      case "obnov": nacitajZoznam(); break;
      case "obnov-f": nacitajFurmanku(); nacitajZoznam(); break;
      case "stiahni": stiahni(); break;
      case "spat":
        if (F.zArchivu && F.id !== "archiv") { F.id = "archiv"; F.data = null; F.dialog = null; prekresli(); break; }
        F.id = null; F.data = null; F.sprava = null; F.dialog = null; F.zArchivu = false; prekresli(); nacitajZoznam(); break;
      case "archiv": F.id = "archiv"; F.zArchivu = true; F.sprava = null; F.archiv = null; prekresli(); nacitajArchiv(); break;
      case "naplanovane":
        if (!(F.trasa && F.trasa.trasa)) { lbzInfo("Najprv vytvorte trasu pre furmana (čas odchodu) – podľa nej sa pripravia SMS pre zákazníkov."); return; }
        if (!lbzPotvrd("Potvrdiť, že furmanka " + F.data.furmanka.nazov + " je skontrolovaná a naplánovaná?\n\nObjednávky sa v Upgates označia ako Naplánované a zákazníci dostanú e-mail „Doručujeme vašu objednávku“. SMS sa posielajú zvlášť tlačidlom 📱 Poslať SMS.")) return;
        po(rpc("furmanka_naplanovana", { p_id: F.data.furmanka.id }), function (r) { return (r && r.text) || "Označené ako naplánované"; }).then(function (r) { if (r && r.ok) { nacitajFurmanku(true); nacitajZoznam(); } });
        break;
      case "vrat-statusy":
        if (!lbzPotvrd("Vrátiť statusy vo furmanke " + F.data.furmanka.nazov + "?\n\nZruší sa „Naplánované“ a objednávkam, ktoré ešte nie sú doručené, sa v Upgates vráti pôvodný status.")) return;
        po(rpc("furmanka_vrat_statusy", { p_id: F.data.furmanka.id }), function (r) { return (r && r.text) || "Statusy vrátené"; }).then(function (r) { if (r && r.ok) { nacitajFurmanku(true); nacitajZoznam(); } });
        break;
      case "sms": posliSms(); break;
      case "dalsie": F.vsetky = !F.vsetky; prekresli(); break;
      case "sumar": tlacSumar(); break;
      case "poradie": F.poradieRezim = true; F.sprava = null; prekresli(); break;
      case "poradie-zrus": F.poradieRezim = false; prekresli(); break;
      case "poradie-uloz":
      case "poradie-auto":
        var cisla = d.f === "poradie-auto" ? [] : Array.prototype.map.call(koren.querySelectorAll("#f-poradie-zoz li"), function (li) { return li.getAttribute("data-c"); });
        if (d.f === "poradie-auto" && !lbzPotvrd("Zrušiť ručné poradie? Google zoradí zastávky sám (priority pôjdu prvé).")) return;
        po(rpc("furmanka_poradie_pevne", { p_id: F.data.furmanka.id, p_cisla: cisla }), function (r) { return r.text + " · v Trase pre furmana dajte Prepočítať trasu"; }).then(function (r) {
          if (r && r.ok) { F.poradieRezim = false; nacitajFurmanku(true); }
        });
        break;
      case "stitky": tlacStitky(); break;
      case "pridat": F.dialog = { typ: "pridat" }; prekresli(); break;
      case "nova": F.dialog = { typ: "obj", nova: true, zmeny: {} }; prekresli(); break;
      case "presun": F.dialog = { typ: "presun", cislo: o }; prekresli(); break;
      case "odobrat":
        if (!lbzPotvrd("Odobrať objednávku " + o + " z furmanky? Automatika ju späť nezaradí (nájdete ju v „Odobraté“).")) return;
        F.dialog = null;
        po(rpc("zaradenie_nastav", { p_cislo: o, p_furmanka_id: null }), "Objednávka " + o + " odobratá").then(function (r) { if (r && r.ok) { nacitajFurmanku(true); nacitajZoznam(); } });
        break;
      case "auto":
        F.dialog = null;
        po(rpc("zaradenie_automaticky", { p_cislo: o }), "Objednávka " + o + " zaradená automaticky").then(function (r) { if (r && r.ok) { nacitajFurmanku(true); nacitajZoznam(); } });
        break;
      case "z-upgates":
        if (!lbzPotvrd("Zahodiť zmeny urobené v appke a načítať objednávku " + o + " znova z Upgates?")) return;
        nacitajZUpgates(o, false);
        break;
      case "z-upgates-cislo": nacitajZUpgates(F.dialog.text.trim(), true); break;
      case "stav":
        var s = d.stav, n = F.data.furmanka.nazov;
        var otazka = s === "full" && F.data.furmanka.stav === "rozvezena" ? "Vrátiť furmanku " + n + " z archívu medzi aktívne? Ostane uzavretá (FULL), nové objednávky do nej nepribudnú a statusy objednávok sa nemenia." :
          s === "full" ? "Uzavrieť furmanku " + n + "? Nové objednávky pôjdu na ďalší termín." :
          s === "otvorena" ? "Znova otvoriť furmanku " + n + "? Automatika do nej môže pridať nové objednávky." : "Archivovať furmanku " + n + "? Presunie sa do Archívu (späť ju vrátite tlačidlom Vrátiť z archívu).";
        if (!lbzPotvrd(otazka)) return;
        po(rpc("furmanka_stav", { p_id: F.data.furmanka.id, p_stav: s }), "Hotovo").then(function (r) { if (r && r.ok) { nacitajFurmanku(true); nacitajZoznam(); } });
        break;
    }
  }
  function zmena(e) {
    var t = e.target;
    if (t.hasAttribute("data-f-bunka")) { ulozBunku(t); return; }
    if (t.hasAttribute("data-f-prio")) {
      var oc = objednavka(t.getAttribute("data-f-prio")); if (oc) oc.priorita = t.checked;
      po(rpc("zaradenie_trasa", { p: { cislo: t.getAttribute("data-f-prio"), priorita: t.checked } }), "Priorita uložená · v Trase pre furmana dajte Prepočítať trasu").then(function () { prekresli(); });
      return;
    }
    if (t.hasAttribute("data-f-vykl")) {
      var v = String(t.value || "").trim();
      if (v !== "" && !(/^\d{1,3}$/.test(v) && +v <= 240)) { t.classList.add("f-zla"); return; }
      t.classList.remove("f-zla");
      var ov = objednavka(t.getAttribute("data-f-vykl")); if (ov) ov.vykladka_min = v === "" ? null : +v;
      po(rpc("zaradenie_trasa", { p: { cislo: t.getAttribute("data-f-vykl"), vykladka_min: v === "" ? null : +v } }), "Vykládka uložená · v Trase pre furmana dajte Prepočítať trasu").then(function () { prekresli(); });
      return;
    }
    if (t.hasAttribute("data-f-skryt")) { F.skryt = t.checked; prekresli(); return; }
    if (t.hasAttribute("data-f-pol") && F.dialog) {
      F.dialog.zmeny = F.dialog.zmeny || {};
      F.dialog.zmeny[t.getAttribute("data-f-pol")] = Number(String(t.value).replace(",", ".")) || 0;
    }
  }
  function vstup(e) {
    var t = e.target;
    if (t.hasAttribute("data-f-hladat") && F.dialog) {
      // zachovať rozpísané údaje formulára
      var form = koren.querySelector("#f-obj-form");
      if (form) Array.prototype.forEach.call(form.querySelectorAll("[data-pole]"), function (el) { F.dialog["_" + el.getAttribute("data-pole")] = el.value; });
      F.dialog.hladat = t.value; F.dialog.fokusHladat = true;
      prekresli();
      var inp = koren.querySelector("[data-f-hladat]"); if (inp) { inp.setSelectionRange(inp.value.length, inp.value.length); }
      if (form) {
        var novy = koren.querySelector("#f-obj-form");
        Array.prototype.forEach.call(novy.querySelectorAll("[data-pole]"), function (el) { var v = F.dialog["_" + el.getAttribute("data-pole")]; if (v != null) el.value = v; });
      }
    }
  }
  function odoslanie(e) {
    if (e.target.id === "f-trasa-form") { e.preventDefault(); if (!F.trasaPocita) vytvorTrasu(e.target.elements.odchod.value); return; }
    if (e.target.id === "f-obj-form") { e.preventDefault(); ulozObjednavku(e.target); }
    if (e.target.id === "f-archiv-form") { e.preventDefault(); F.archivText = e.target.querySelector("[data-f-archiv-text]").value.trim(); nacitajArchiv(); return; }
    if (e.target.id === "f-hladaj-form") { e.preventDefault(); var v = e.target.querySelector("[data-f-hladaj-obj]").value.trim(); if (v) hladajObjednavku(v); }
  }
  function klaves(e) {
    if (e.key === "Escape" && F.dialog) { F.dialog = null; prekresli(); return; }
    var t = e.target;
    if (e.key === "Enter" && t.hasAttribute && t.hasAttribute("data-f-bunka")) { e.preventDefault(); t.blur(); }
  }

  // ---------- verejné rozhranie pre app.js ----------
  window.LBZ_FURMANKY = {
    nastavDb: function (klient, rola) {
      DB = klient || null; ROLA = klient ? rola : null;
      if (!DB) { F.zoznam = null; F.data = null; F.id = null; F.sablona = null; }
    },
    tlacStitky: function () { if (F.data) tlacStitky(); },
    // modul Balenie: štítky celej furmanky z jeho dát (prevádzka nemá prístup k modulu Furmanky)
    tlacStitkyZ: function (furmanka, objednavky) {
      if (!DB) return Promise.reject(new Error("Nie ste prihlásený"));
      return nacitajSablonu().then(function () {
        var bol = F.data; F.data = { furmanka: furmanka, objednavky: objednavky };
        try { tlacStitky(); } finally { F.data = bol; }
      });
    },
    mozem: function () { return !!DB && (ROLA === "it" || ROLA === "ceo" || ROLA === "zakaznicky_servis"); },
    mount: function (el) {
      koren = el;
      el.addEventListener("click", klik);
      el.addEventListener("change", zmena);
      el.addEventListener("input", vstup);
      el.addEventListener("submit", odoslanie);
      el.addEventListener("keydown", klaves);
      prekresli();
      nacitajZoznam();
      if (F.id === "archiv") nacitajArchiv(); else if (F.id != null) nacitajFurmanku(true);
    },
    karta: function () {
      var dnes = new Date(), h7 = new Date(); h7.setDate(h7.getDate() + 7);
      var iso = function (d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); };
      var z = (F.zoznam || []).filter(function (f) { return f.rozvoz && f.datum && f.stav !== "rozvezena" && f.datum >= iso(dnes) && f.datum <= iso(h7); }).slice(0, 5);
      if (!F.zoznam && DB) setTimeout(function () { rpc("furmanky_zoznam").then(function (r) { if (r && r.ok) { F.zoznam = r.furmanky || []; F.beh = r.beh; F.odobrate = r.odobrate || 0; F.archivN = r.archiv || 0; window.dispatchEvent(new Event("lbz-prekresli")); } }).catch(function () {}); }, 0);
      return '<section class="card"><h3>Furmanky <span class="pill ok num">' + z.length + "</span></h3>" +
        (z.length ? '<div class="rows">' + z.map(function (f) {
          return '<div class="row"><span>' + esc(f.region) + ' <span class="muted">' + esc(datumSk(f.datum)) + '</span></span><span>' + stavPill(f.stav) + ' <span class="muted num">' + f.pocet + "</span></span></div>";
        }).join("") + "</div>" : '<p class="muted" style="margin:0">Otvorte modul Furmanky.</p>') +
        '<button class="btn" data-mod="furmanky">Otvoriť furmanky</button></section>';
    }
  };
})();
