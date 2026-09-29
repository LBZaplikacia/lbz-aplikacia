// LBZ aplikácia – modul Rozpis práce (smeny)
// Týždeň / mesiac ako v tabuľke „Rozpis práce LBZ 2026“: pozície × dni, farby ľudí.
// IT/CEO všetko, spoločné účty (prevádzka, furman, zákaznícky servis) za ktoréhokoľvek zamestnanca,
// osobný účet zamestnanca len svoje smeny. Každá zmena ide do histórie (rozpis_log).

(function () {
  "use strict";

  var DB = null, ROLA = null, koren = null;
  var R = { pohlad: "tyzden", od: null, data: null, dialog: null, sprava: null, nacitavam: false, historia: null, karta: null };
  var DNI = ["Po", "Ut", "St", "Št", "Pi", "So", "Ne"];
  var DNI_DLHE = ["Pondelok", "Utorok", "Streda", "Štvrtok", "Piatok", "Sobota", "Nedeľa"];
  var MESIACE = ["január", "február", "marec", "apríl", "máj", "jún", "júl", "august", "september", "október", "november", "december"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function rpc(nazov, args) { return DB.rpc(nazov, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function chybaText(e) { return (e && (e.message || e.text)) || "Bez spojenia so serverom"; }
  function iso(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function zIso(s) { var p = String(s).slice(0, 10).split("-"); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function pridaj(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function pondelok(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); return pridaj(x, -((x.getDay() + 6) % 7)); }
  function dnes() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); }
  function kratkyDatum(d) { return d.getDate() + ". " + (d.getMonth() + 1) + "."; }
  function siroka() { return window.matchMedia && window.matchMedia("(min-width: 900px)").matches; }
  function textNa(farba) {                     // čierny alebo biely text podľa farby pozadia
    var h = String(farba || "#eeeeee").replace("#", ""); if (h.length === 3) h = h.replace(/./g, "$&$&");
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#1b120f" : "#ffffff";
  }

  // ---------- rozsah a načítanie ----------
  function rozsah() {
    if (R.pohlad === "mesiac") {
      var z = R.od, prvy = new Date(z.getFullYear(), z.getMonth(), 1, 12), posl = new Date(z.getFullYear(), z.getMonth() + 1, 0, 12);
      return { od: pondelok(prvy), do: pridaj(pondelok(posl), 6), mesiac: prvy };
    }
    var stred = pridaj(pondelok(R.od), 3);             // mesiac týždňa podľa štvrtka
    return { od: pondelok(R.od), do: pridaj(pondelok(R.od), 6), mesiac: new Date(stred.getFullYear(), stred.getMonth(), 1, 12) };
  }
  function nacitaj() {
    if (!DB) return;
    var r = rozsah();
    R.nacitavam = true; prekresli();
    return rpc("rozpis_data", { p_od: iso(r.od), p_do: iso(r.do) }).then(function (d) {
      R.nacitavam = false;
      if (!d || d.ok === false) { R.sprava = { typ: "chyba", text: (d && d.text) || "Rozpis sa nenačítal" }; }
      else R.data = d;
      prekresli();
    }).catch(function (e) { R.nacitavam = false; R.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }
  function nacitajHistoriu() {
    return rpc("rozpis_historia", { p_pocet: 100 }).then(function (h) { R.historia = h || []; prekresli(); })
      .catch(function (e) { R.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }

  // ---------- pomocné nad údajmi ----------
  function osoba(id) { return ((R.data && R.data.osoby) || []).filter(function (o) { return o.id === id; })[0] || null; }
  function pozicie() { return (R.data && R.data.pozicie) || []; }
  function pozicia(kod) { return pozicie().filter(function (p) { return p.kod === kod; })[0] || { nazov: kod }; }
  function miesta(datum, poz) {
    return ((R.data && R.data.miesta) || []).filter(function (m) { return m.datum === datum && m.pozicia === poz; })
      .sort(function (a, b) { return a.miesto - b.miesto; });
  }
  function miesto(id) { return ((R.data && R.data.miesta) || []).filter(function (m) { return m.id === id; })[0] || null; }
  function rola() { return R.data && R.data.rola; }
  function mozemUpravovat() { return ["sprava", "spolocny", "osobny"].indexOf(rola()) > -1; }
  function mozemMiesto(m) {
    if (rola() === "sprava" || rola() === "spolocny") return true;
    return rola() === "osobny" && m.osoba != null && m.osoba === R.data.ja;
  }
  function minule(datum) { return datum < iso(dnes()) && rola() !== "sprava"; }
  function aktivneOsoby() { return ((R.data && R.data.osoby) || []).filter(function (o) { return o.aktivny; }); }

  // ---------- zobrazenie ----------
  function prekresli() {
    if (!koren) return;
    var html = R.pohlad === "ludia" ? pohladLudia() : R.pohlad === "historia" ? pohladHistoria() : pohladRozpis();
    koren.innerHTML = html + (R.dialog ? dialogHtml() : "");
    koren.classList.toggle("r-siroke", siroka() && (R.pohlad === "tyzden" || R.pohlad === "mesiac"));
    var fok = koren.querySelector("[data-r-fokus]"); if (fok) fok.focus();
  }
  function spravaHtml() {
    if (!R.sprava) return "";
    return '<p class="f-sprava f-' + R.sprava.typ + '" role="status">' + esc(R.sprava.text) + ' <button class="btn-link" data-r="zavri-spravu" aria-label="Zavrieť">✕</button></p>';
  }
  function cip(m) {
    var o = osoba(m.osoba), cas = m.od ? m.od + (m.do ? "–" + m.do : "") : "";
    if (!o) {
      return '<button class="r-cip r-volne" data-r-miesto="' + m.id + '"><span>voľné</span>' + (cas ? '<small class="num">' + esc(cas) + "</small>" : "") + "</button>";
    }
    var ja = R.data.ja && o.id === R.data.ja;
    return '<button class="r-cip' + (ja ? " r-ja" : "") + (m.vynimka ? " r-vynimka" : "") + '" data-r-miesto="' + m.id + '" style="background:' + esc(o.farba) + ";color:" + textNa(o.farba) + '">' +
      "<span>" + esc(o.meno) + "</span>" + (cas ? '<small class="num">' + esc(cas) + "</small>" : "") + (m.poznamka ? '<small title="' + esc(m.poznamka) + '">✎</small>' : "") + "</button>";
  }
  function bunka(datum, p) {
    var ms = miesta(datum, p.kod);
    var plus = mozemUpravovat() && !minule(datum) ? '<button class="r-plus" data-r-pridat="' + datum + "|" + p.kod + '" aria-label="Pridať smenu – ' + esc(p.nazov) + " " + esc(datum) + '">+</button>' : "";
    return '<td class="r-bunka' + (ms.length ? "" : " r-nerobi") + '"><div class="r-cipy">' + ms.map(cip).join("") + plus + "</div></td>";
  }
  function tyzdenTabulka(od, mesiac) {
    var dni = []; for (var i = 0; i < 7; i++) dni.push(pridaj(od, i));
    var dn = iso(dnes());
    return '<div class="r-obal"><table class="r-tab"><thead><tr><th class="r-poz"></th>' + dni.map(function (d, i) {
      var mimo = mesiac && d.getMonth() !== mesiac.getMonth();
      return '<th class="' + (iso(d) === dn ? "r-dnes" : "") + (mimo ? " r-mimo" : "") + '"><span class="r-den">' + DNI[i] + '</span> <span class="num">' + kratkyDatum(d) + "</span></th>";
    }).join("") + "</tr></thead><tbody>" + pozicie().map(function (p) {
      return '<tr><th class="r-poz">' + esc(p.nazov) + "</th>" + dni.map(function (d) { return bunka(iso(d), p); }).join("") + "</tr>";
    }).join("") + "</tbody></table></div>";
  }
  function dniZoznam(od, koniec) {                    // mobil: po dňoch
    var out = [], dn = iso(dnes());
    for (var d = new Date(od); d <= koniec; d = pridaj(d, 1)) {
      var di = iso(d), riadky = pozicie().map(function (p) {
        var ms = miesta(di, p.kod);
        if (!ms.length) return "";
        return '<div class="r-den-riadok"><span class="r-den-poz">' + esc(p.nazov) + '</span><span class="r-cipy">' + ms.map(cip).join("") + "</span></div>";
      }).join("");
      if (!riadky && di < dn) continue;
      out.push('<section class="card r-den-karta' + (di === dn ? " r-dnes-karta" : "") + '"><h3><span>' + DNI_DLHE[(d.getDay() + 6) % 7] + ' <span class="num">' + kratkyDatum(d) + "</span></span>" +
        (mozemUpravovat() && !minule(di) ? '<button class="btn r-mini" data-r-pridat="' + di + '|">+ Smena</button>' : "") + "</h3>" +
        (riadky || '<p class="muted" style="margin:0">Nikto nie je zapísaný.</p>') + "</section>");
    }
    return out.join("") || '<div class="empty"><strong>V tomto období nie sú smeny.</strong></div>';
  }
  function mojeSmeny() {
    if (!R.data || !R.data.ja) return "";
    var dn = iso(dnes());
    var moje = (R.data.miesta || []).filter(function (m) { return m.osoba === R.data.ja && m.datum >= dn; }).slice(0, 6);
    return '<section class="card r-moje"><h3>Moje smeny</h3>' + (moje.length ? '<div class="r-moje-zoznam">' + moje.map(function (m) {
      var d = zIso(m.datum);
      return '<button class="r-moja" data-r-miesto="' + m.id + '"><b>' + DNI[(d.getDay() + 6) % 7] + " " + kratkyDatum(d) + "</b><span>" + esc(pozicia(m.pozicia).nazov) +
        (m.od ? ' · <span class="num">' + esc(m.od + (m.do ? "–" + m.do : "")) + "</span>" : "") + "</span></button>";
    }).join("") + "</div>" : '<p class="muted" style="margin:0">V tomto období nemáte smenu.</p>') + "</section>";
  }
  function poznamkyHtml(mesiac) {
    var m = iso(mesiac), n = ((R.data && R.data.poznamky) || []).filter(function (x) { return String(x.mesiac).slice(0, 10) === m; })[0];
    if (rola() === "sprava") {
      return '<form class="card r-pozn" id="r-pozn-form" data-mesiac="' + m + '"><h3>Poznámky – ' + MESIACE[mesiac.getMonth()] + "</h3>" +
        '<textarea rows="3" id="r-pozn-text" placeholder="Pokyny k rozpisu pre všetkých (zaúčanie, výnimky…)">' + esc(n && n.text) + "</textarea>" +
        '<button class="btn" type="submit">Uložiť poznámku</button></form>';
    }
    return n && n.text ? '<section class="card r-pozn"><h3>Poznámky – ' + MESIACE[mesiac.getMonth()] + '</h3><p style="margin:0;white-space:pre-line">' + esc(n.text) + "</p></section>" : "";
  }
  function legenda() {
    var o = aktivneOsoby(); if (!o.length) return "";
    return '<div class="r-legenda">' + o.map(function (x) {
      return '<span class="r-leg" style="background:' + esc(x.farba) + ";color:" + textNa(x.farba) + '">' + esc(x.meno) + "</span>";
    }).join("") + "</div>";
  }

  function pohladRozpis() {
    var r = rozsah();
    var nadpis = R.pohlad === "mesiac" ? MESIACE[r.mesiac.getMonth()] + " " + r.mesiac.getFullYear() : kratkyDatum(r.od) + " – " + kratkyDatum(r.do) + " " + r.do.getFullYear();
    var head = '<div class="head"><div><h2>Rozpis práce</h2><div class="sub">' + esc(nadpis) + (R.nacitavam ? " · načítavam…" : "") + "</div></div>" +
      '<span class="head-tl">' +
        '<span class="f-seg" role="group" aria-label="Zobrazenie"><button data-r-pohlad="tyzden" aria-pressed="' + (R.pohlad === "tyzden") + '">Týždeň</button>' +
        '<button data-r-pohlad="mesiac" aria-pressed="' + (R.pohlad === "mesiac") + '">Mesiac</button></span>' +
        '<button class="btn btn-ikona" data-r="spat" aria-label="Predchádzajúce">‹</button><button class="btn" data-r="dnes">Dnes</button>' +
        '<button class="btn btn-ikona" data-r="dalej" aria-label="Ďalšie">›</button></span></div>';
    var spravaTl = rola() === "sprava" || rola() === "spolocny" ? '<div class="r-lista">' +
      (rola() === "sprava" ? '<button class="btn r-mini" data-r-pohlad="ludia">👥 Ľudia a farby</button>' : "") +
      '<button class="btn r-mini" data-r-pohlad="historia">🕘 História zmien</button></div>' : "";
    if (!R.data) return head + spravaHtml() + '<div class="empty"><strong>' + (R.nacitavam ? "Načítavam rozpis…" : "Rozpis sa nenačítal") + "</strong></div>";
    var telo;
    if (siroka()) {
      if (R.pohlad === "mesiac") {
        var tyz = []; for (var t = new Date(r.od); t <= r.do; t = pridaj(t, 7)) tyz.push(tyzdenTabulka(t, r.mesiac));
        telo = tyz.join("");
      } else telo = tyzdenTabulka(r.od);
    } else {
      var od = R.pohlad === "mesiac" ? r.mesiac : r.od, dok = R.pohlad === "mesiac" ? new Date(r.mesiac.getFullYear(), r.mesiac.getMonth() + 1, 0, 12) : r.do;
      telo = '<div class="r-dni">' + dniZoznam(od, dok) + "</div>";
    }
    var upoz = rola() === "osobny" && !R.data.ja ? '<p class="s-varovanie">Váš účet ešte nie je spojený s menom v rozpise – vedenie ho spojí v „Ľudia a farby“ (podľa e-mailu).</p>' : "";
    return head + spravaHtml() + upoz + mojeSmeny() + telo + legenda() + spravaTl + poznamkyHtml(r.mesiac);
  }

  function pohladLudia() {
    var o = (R.data && R.data.osoby) || [];
    return '<div class="head"><div><button class="btn-link spat" data-r-pohlad="tyzden">← Rozpis</button><h2>Ľudia a farby</h2>' +
      '<div class="sub">E-mail spojí meno v rozpise s osobným účtom zamestnanca v appke.</div></div></div>' + spravaHtml() +
      '<section class="card"><div class="r-ludia">' + o.map(function (x) {
        return '<form class="r-clovek" data-r-osoba="' + x.id + '"><input type="color" name="farba" value="' + esc(x.farba) + '" aria-label="Farba">' +
          '<input name="meno" value="' + esc(x.meno) + '" aria-label="Meno" required><input name="email" type="email" value="' + esc(x.email || "") + '" placeholder="e-mail (osobný účet)" aria-label="E-mail">' +
          '<label class="f-check"><input type="checkbox" name="aktivny"' + (x.aktivny ? " checked" : "") + "> aktívny</label>" +
          '<button class="btn r-mini" type="submit">Uložiť</button></form>';
      }).join("") +
      '<form class="r-clovek r-novy" data-r-osoba=""><input type="color" name="farba" value="#cba75b" aria-label="Farba"><input name="meno" placeholder="Nové meno" aria-label="Meno" required>' +
        '<input name="email" type="email" placeholder="e-mail (nepovinné)" aria-label="E-mail"><span></span><button class="btn btn-primary r-mini" type="submit">Pridať</button></form>' +
      "</div></section>";
  }
  function pohladHistoria() {
    var h = R.historia;
    return '<div class="head"><div><button class="btn-link spat" data-r-pohlad="tyzden">← Rozpis</button><h2>História zmien</h2></div></div>' + spravaHtml() +
      (h == null ? '<div class="empty"><strong>Načítavam…</strong></div>' : !h.length ? '<div class="empty"><strong>Zatiaľ žiadne zmeny</strong></div>' :
        '<section class="card"><div class="rows">' + h.map(function (x) {
          var d = x.datum ? zIso(x.datum) : null;
          return '<div class="row r-hist"><span><b>' + esc(x.text) + '</b><span class="muted"> · ' + esc(pozicia(x.pozicia).nazov || "") + (d ? " " + kratkyDatum(d) : "") + "</span></span>" +
            '<span class="muted r-hist-kto">' + esc(new Date(x.cas).toLocaleString("sk-SK", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })) + "<br>" + esc(x.ucet || "") + "</span></div>";
        }).join("") + "</div></section>");
  }

  // ---------- dialóg ----------
  function vyberOsoby(meno, vynechaj) {
    return '<select name="' + meno + '" class="r-select">' + aktivneOsoby().filter(function (o) { return o.id !== vynechaj; }).map(function (o) {
      return '<option value="' + o.id + '">' + esc(o.meno) + "</option>";
    }).join("") + "</select>";
  }
  function casy(m) {
    return '<div class="f-2"><label class="field"><span class="label">Od</span><input type="time" name="od" value="' + esc(m && m.od || "") + '"></label>' +
      '<label class="field"><span class="label">Do</span><input type="time" name="do" value="' + esc(m && m.do || "") + '"></label></div>';
  }
  function dialogHtml() {
    var D = R.dialog, obsah = "", nadpis = "";
    if (D.typ === "miesto") {
      var m = miesto(D.id); if (!m) { R.dialog = null; return ""; }
      var d = zIso(m.datum), o = osoba(m.osoba), moze = mozemMiesto(m) && !minule(m.datum);
      nadpis = esc(pozicia(m.pozicia).nazov) + " · " + DNI_DLHE[(d.getDay() + 6) % 7].toLowerCase() + " " + kratkyDatum(d);
      if (!o) {
        obsah = '<p style="margin:0">Voľná smena' + (m.od ? ' <span class="num">' + esc(m.od + (m.do ? "–" + m.do : "")) + "</span>" : "") + ".</p>";
        if (mozemUpravovat() && !minule(m.datum)) {
          obsah += '<form class="f-form" data-r-akcia="zapisat" data-id="' + m.id + '">' +
            (rola() === "osobny" ? "" : '<label class="field"><span class="label">Kto</span>' + vyberOsoby("osoba") + "</label>") + casy(m) +
            '<button class="btn btn-primary" type="submit" data-r-fokus>' + (rola() === "osobny" ? "Zapísať sa" : "Zapísať") + "</button></form>";
        }
        if (rola() === "sprava") obsah += '<div class="f-akcie"><button class="btn" data-r-akcia-tl="zmazat" data-id="' + m.id + '">Zrušiť toto miesto</button></div>';
      } else {
        obsah = '<p class="r-kto"><span class="r-leg" style="background:' + esc(o.farba) + ";color:" + textNa(o.farba) + '">' + esc(o.meno) + "</span>" +
          (m.od ? ' <span class="num">' + esc(m.od + (m.do ? "–" + m.do : "")) + "</span>" : "") + (m.vynimka ? ' <span class="pill warn">výnimočne</span>' : "") + "</p>" +
          (m.poznamka ? '<p class="f-pozn" style="margin:0">' + esc(m.poznamka) + "</p>" : "");
        if (moze) {
          var ine = (R.data.miesta || []).filter(function (x) { return x.osoba != null && x.osoba !== m.osoba && x.id !== m.id && !minule(x.datum); });
          obsah += '<form class="f-form" data-r-akcia="cas" data-id="' + m.id + '"><h4 class="r-h4">Pracovný čas</h4>' + casy(m) +
              '<label class="field"><span class="label">Poznámka</span><input name="poznamka" value="' + esc(m.poznamka || "") + '" placeholder="napr. príde skôr, zaúča sa"></label>' +
              '<button class="btn" type="submit">Uložiť čas</button></form>' +
            '<form class="f-form" data-r-akcia="odovzdat" data-id="' + m.id + '"><h4 class="r-h4">Odovzdať smenu kolegovi</h4><div class="r-riadok">' + vyberOsoby("komu", m.osoba) +
              '<button class="btn" type="submit">Odovzdať</button></div></form>' +
            (ine.length ? '<form class="f-form" data-r-akcia="prehodit" data-id="' + m.id + '"><h4 class="r-h4">Prehodiť s kolegom</h4><div class="r-riadok"><select name="s_id" class="r-select">' +
              ine.map(function (x) { var dx = zIso(x.datum), ox = osoba(x.osoba); return '<option value="' + x.id + '">' + esc((ox ? ox.meno : "?") + " – " + DNI[(dx.getDay() + 6) % 7] + " " + kratkyDatum(dx) + " " + pozicia(x.pozicia).nazov) + "</option>"; }).join("") +
              '</select><button class="btn" type="submit">Prehodiť</button></div><p class="muted r-mala">Na výber sú smeny v zobrazenom týždni/mesiaci.</p></form>' : "") +
            '<div class="f-akcie"><button class="btn" data-r-akcia-tl="uvolnit" data-id="' + m.id + '">Uvoľniť smenu</button>' +
              (rola() === "sprava" ? '<button class="btn" data-r-akcia-tl="zmazat" data-id="' + m.id + '">Zrušiť miesto</button>' : "") + "</div>";
        }
      }
    } else if (D.typ === "pridat") {
      var dd = zIso(D.datum);
      nadpis = "Nová smena · " + DNI_DLHE[(dd.getDay() + 6) % 7].toLowerCase() + " " + kratkyDatum(dd);
      var poz = D.pozicia;
      var nerobi = poz && !miesta(D.datum, poz).length;
      obsah = '<form class="f-form" data-r-akcia="zapisat" data-datum="' + esc(D.datum) + '"' + (poz ? ' data-pozicia="' + esc(poz) + '"' : "") + ">" +
        (poz ? "" : '<label class="field"><span class="label">Pozícia</span><select name="pozicia" class="r-select">' + pozicie().map(function (p) { return '<option value="' + p.kod + '">' + esc(p.nazov) + "</option>"; }).join("") + "</select></label>") +
        (poz ? '<p style="margin:0"><b>' + esc(pozicia(poz).nazov) + "</b></p>" : "") +
        (nerobi ? '<p class="s-varovanie s-varovanie-info" style="margin:0">V tento deň sa na pozícii bežne nerobí – zapíšete sa výnimočne.</p>' : "") +
        (rola() === "osobny" ? "" : '<label class="field"><span class="label">Kto</span>' + vyberOsoby("osoba") + "</label>") + casy(null) +
        '<button class="btn btn-primary" type="submit" data-r-fokus>' + (rola() === "osobny" ? "Zapísať sa" : "Zapísať") + "</button>" +
        (rola() === "sprava" ? '<button class="btn" type="button" data-r-otvorit>Len otvoriť voľné miesto</button>' : "") + "</form>";
    }
    return '<div class="f-dialog-pozadie" data-r="zavri"></div><div class="f-dialog" role="dialog" aria-modal="true" aria-label="' + nadpis + '">' +
      '<div class="f-lista"><h3>' + nadpis + '</h3><button class="btn-link" data-r="zavri" aria-label="Zavrieť">✕</button></div>' + obsah + "</div>";
  }

  // ---------- akcie ----------
  function zmena(p) {
    R.sprava = null;
    return rpc("rozpis_zmena", { p: p }).then(function (r) {
      if (!r || r.ok === false) { R.sprava = { typ: "chyba", text: (r && r.text) || "Neuložené" }; prekresli(); return; }
      R.dialog = null; R.sprava = { typ: "ok", text: "Uložené: " + r.text }; nacitaj();
    }).catch(function (e) { R.sprava = { typ: "chyba", text: chybaText(e) }; R.dialog = null; prekresli(); });
  }
  function klik(e) {
    var t = e.target.closest("button, [data-r]"); if (!t) return;
    var d = t.dataset;
    if (d.r === "zavri") { R.dialog = null; prekresli(); return; }
    if (d.r === "zavri-spravu") { R.sprava = null; prekresli(); return; }
    if (d.r === "dnes") { R.od = dnes(); nacitaj(); return; }
    if (d.r === "spat" || d.r === "dalej") {
      var smer = d.r === "spat" ? -1 : 1;
      R.od = R.pohlad === "mesiac" ? new Date(R.od.getFullYear(), R.od.getMonth() + smer, 1, 12) : pridaj(R.od, 7 * smer);
      nacitaj(); return;
    }
    if (d.rPohlad) {
      var bol = R.pohlad; R.pohlad = d.rPohlad; R.sprava = null;
      if (R.pohlad === "historia") { R.historia = null; prekresli(); nacitajHistoriu(); return; }
      if (R.pohlad === "ludia") { prekresli(); return; }
      if ((bol === "mesiac") !== (R.pohlad === "mesiac")) nacitaj(); else prekresli();
      return;
    }
    if (d.rMiesto) { R.dialog = { typ: "miesto", id: +d.rMiesto }; prekresli(); return; }
    if (d.rPridat) { var c = d.rPridat.split("|"); R.dialog = { typ: "pridat", datum: c[0], pozicia: c[1] || null }; prekresli(); return; }
    if (d.rAkciaTl) {
      if (d.rAkciaTl === "zmazat" && !window.confirm("Zrušiť toto miesto v rozpise?")) return;
      zmena({ akcia: d.rAkciaTl, id: d.id }); return;
    }
    if (t.hasAttribute("data-r-otvorit")) {
      var f = t.closest("form");
      zmena({ akcia: "otvorit", datum: f.dataset.datum, pozicia: f.dataset.pozicia || (f.elements.pozicia && f.elements.pozicia.value),
        od: f.elements.od.value, do: f.elements.do.value });
    }
  }
  function odoslanie(e) {
    var f = e.target;
    if (f.id === "r-pozn-form") {
      e.preventDefault();
      rpc("rozpis_poznamka_uloz", { p_mesiac: f.dataset.mesiac, p_text: document.getElementById("r-pozn-text").value }).then(function (r) {
        R.sprava = r && r.ok ? { typ: "ok", text: "Poznámka uložená" } : { typ: "chyba", text: (r && r.text) || "Neuložené" }; nacitaj();
      }).catch(function (er) { R.sprava = { typ: "chyba", text: chybaText(er) }; prekresli(); });
      return;
    }
    if (f.hasAttribute("data-r-osoba")) {
      e.preventDefault();
      var el = f.elements;
      rpc("rozpis_osoba_uloz", { p: { id: f.getAttribute("data-r-osoba"), meno: el.meno.value, farba: el.farba.value, email: el.email.value,
        aktivny: el.aktivny ? el.aktivny.checked : true } }).then(function (r) {
        R.sprava = r && r.ok ? { typ: "ok", text: "Uložené: " + el.meno.value } : { typ: "chyba", text: (r && r.text) || "Neuložené" }; nacitaj();
      }).catch(function (er) { R.sprava = { typ: "chyba", text: chybaText(er) }; prekresli(); });
      return;
    }
    var akcia = f.getAttribute("data-r-akcia"); if (!akcia) return;
    e.preventDefault();
    var p = { akcia: akcia }, x = f.elements;
    if (f.dataset.id) p.id = f.dataset.id;
    if (f.dataset.datum) p.datum = f.dataset.datum;
    p.pozicia = f.dataset.pozicia || (x.pozicia && x.pozicia.value) || undefined;
    ["osoba", "komu", "s_id", "od", "do", "poznamka"].forEach(function (k) { if (x[k]) p[k] = x[k].value; });
    if (akcia === "zapisat" && !p.id && p.datum && p.pozicia && !miesta(p.datum, p.pozicia).length) p.vynimka = true;
    zmena(p);
  }
  function klaves(e) { if (e.key === "Escape" && R.dialog) { R.dialog = null; prekresli(); } }
  var poslednaSirka = null;
  window.addEventListener("resize", function () { var s = siroka(); if (koren && koren.isConnected && s !== poslednaSirka) { poslednaSirka = s; prekresli(); } });

  // ---------- verejné rozhranie pre app.js ----------
  window.LBZ_ROZPIS = {
    nastavDb: function (klient, rola) { DB = klient || null; ROLA = klient ? rola : null; if (!DB) { R.data = null; R.karta = null; } },
    mozem: function () { return !!DB && ["it", "ceo", "prevadzka", "furman", "zakaznicky_servis", "zamestnanec", "uctovnicka"].indexOf(ROLA) > -1; },
    mount: function (el) {
      koren = el; poslednaSirka = siroka();
      el.addEventListener("click", klik);
      el.addEventListener("submit", odoslanie);
      el.addEventListener("keydown", klaves);
      if (!R.od) R.od = dnes();
      prekresli(); nacitaj();
    },
    // karta na Prehľad: moje najbližšie smeny (osobný účet) alebo kto je dnes v práci
    karta: function () {
      if (!R.karta && DB) {
        R.karta = { nacitavam: true };
        var d0 = dnes();
        rpc("rozpis_data", { p_od: iso(d0), p_do: iso(pridaj(d0, 13)) }).then(function (d) { R.karta = d && d.ok ? d : { chyba: true }; window.dispatchEvent(new Event("lbz-prekresli")); })
          .catch(function () { R.karta = { chyba: true }; });
      }
      var k = R.karta || {}, obsah;
      if (!k.ok) obsah = '<p class="muted" style="margin:0">' + (k.chyba ? "Rozpis sa nenačítal." : "Načítavam…") + "</p>";
      else {
        var dn = iso(dnes()), osobaK = function (id) { return (k.osoby || []).filter(function (o) { return o.id === id; })[0]; };
        var pozK = function (kod) { return ((k.pozicie || []).filter(function (p) { return p.kod === kod; })[0] || {}).nazov || kod; };
        if (k.ja) {
          var moje = (k.miesta || []).filter(function (m) { return m.osoba === k.ja; }).slice(0, 4);
          obsah = moje.length ? '<div class="rows">' + moje.map(function (m) {
            var d = zIso(m.datum);
            return '<div class="row"><span><b>' + (m.datum === dn ? "Dnes" : DNI[(d.getDay() + 6) % 7] + " " + kratkyDatum(d)) + "</b> " + esc(pozK(m.pozicia)) + '</span><span class="num muted">' + esc(m.od ? m.od + (m.do ? "–" + m.do : "") : "") + "</span></div>";
          }).join("") + "</div>" : '<p class="muted" style="margin:0">Najbližšie 2 týždne nemáte smenu.</p>';
        } else {
          var dnesne = (k.miesta || []).filter(function (m) { return m.datum === dn && m.osoba != null; });
          obsah = dnesne.length ? '<div class="r-cipy">' + dnesne.map(function (m) {
            var o = osobaK(m.osoba) || {};
            return '<span class="r-leg" style="background:' + esc(o.farba) + ";color:" + textNa(o.farba) + '" title="' + esc(pozK(m.pozicia)) + '">' + esc(o.meno) + " · " + esc(pozK(m.pozicia)) + "</span>";
          }).join("") + "</div>" : '<p class="muted" style="margin:0">Dnes nie je nikto zapísaný.</p>';
        }
      }
      return '<section class="card"><h3>' + (k.ja ? "Moje smeny" : "Dnes v práci") + "</h3>" + obsah + '<button class="btn" data-mod="rozpis">Otvoriť rozpis</button></section>';
    }
  };
})();
