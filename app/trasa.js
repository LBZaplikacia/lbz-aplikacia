// LBZ aplikácia – modul Trasa (pre furmana, spoločný účet furman@)
// Trasu vytvorí zákaznícky servis vo Furmankách (čas odchodu → poradie a časy príchodov cez Google Mapy).
// Furman: navigácia (po 9 zastávkach), volanie, QR pre kasu pri dobierke, Doručené / Nedoručené, poznámka, fotka,
// Ukončiť rozvoz → furmanka ide do Archívu, nedoručené do ďalšej furmanky alebo na zadaný termín.

(function () {
  "use strict";

  var DB = null, ROLA = null, koren = null;
  var T = { id: null, zoznam: null, data: null, sprava: null, nacitavam: false, dialog: null, fotky: {}, prace: 0 };
  var START = "Sedlo Zbojská, 976 56 Pohronská Polhora";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function rpc(nazov, args) { return DB.rpc(nazov, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function chybaText(e) { return (e && (e.message || e.text)) || "Bez spojenia so serverom"; }
  function cas(t) { return t ? new Date(t).toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" }) : ""; }
  function datumSk(s) { if (!s) return ""; var p = String(s).slice(0, 10).split("-"); var d = new Date(+p[0], +p[1] - 1, +p[2], 12); return d.toLocaleDateString("sk-SK", { weekday: "short", day: "numeric", month: "numeric" }); }
  function eur(n) { return Number(n || 0).toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
  function dobierka(z) { return z.platba !== "ZAPLATENÉ" && z.platba !== "NA FAKTÚRU"; }
  function mapa(adresa) { return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(adresa); }
  function tel(t) { return "tel:" + String(t || "").replace(/[^\d+]/g, ""); }

  // ---------- načítanie ----------
  function nacitajZoznam() {
    T.nacitavam = true; prekresli();
    return rpc("trasa_zoznam").then(function (d) {
      T.nacitavam = false;
      if (!d || d.ok === false) T.sprava = { typ: "chyba", text: (d && d.text) || "Nenačítané" }; else T.zoznam = d.trasy || [];
      prekresli();
    }).catch(function (e) { T.nacitavam = false; T.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }
  function nacitajTrasu(tiho) {
    if (T.id == null) return Promise.resolve();
    if (!tiho) { T.nacitavam = true; prekresli(); }
    return rpc("trasa_data", { p_id: T.id }).then(function (d) {
      T.nacitavam = false;
      if (!d || d.ok === false || !d.trasa) T.sprava = { typ: "chyba", text: (d && d.text) || "Trasa sa nenačítala" }; else T.data = d;
      prekresli();
    }).catch(function (e) { T.nacitavam = false; if (!tiho) T.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }

  // ---------- kreslenie ----------
  function spravaHtml() {
    if (!T.sprava) return "";
    return '<p class="f-sprava f-' + (T.sprava.typ === "ok" ? "ok" : "chyba") + '" role="status">' + esc(T.sprava.text) + ' <button class="btn-link" data-t="zavri-spravu" aria-label="Zavrieť">✕</button></p>';
  }
  var STAV = { naplanovana: ["naplánovaná", ""], na_ceste: ["na ceste", "b-st-rozp"], ukoncena: ["ukončená", "b-st-ok"] };
  function stavPill(s) { var x = STAV[s] || STAV.naplanovana; return '<span class="b-st ' + x[1] + '">' + x[0] + "</span>"; }

  function pohladZoznam() {
    var head = '<div class="head"><div><h2>Trasa</h2><div class="sub">Rozvozy pripravené zákazníckym servisom' + (T.nacitavam ? " · načítavam…" : "") + '</div></div>' +
      '<span class="head-tl"><button class="btn btn-ikona" data-t="obnov" aria-label="Obnoviť">↻</button></span></div>';
    var z = T.zoznam;
    if (!z) return head + spravaHtml() + '<div class="empty"><strong>' + (T.nacitavam ? "Načítavam…" : "Nenačítané") + "</strong></div>";
    if (!z.length) return head + spravaHtml() + '<div class="empty"><strong>Zatiaľ nie je naplánovaná žiadna trasa</strong><span class="muted">Trasu vytvára zákaznícky servis vo Furmankách.</span></div>';
    return head + spravaHtml() + '<div class="b-furmanky">' + z.map(function (t) {
      return '<button class="card t-karta" data-t-otvor="' + t.id + '"><span class="t-k-hore"><b>' + esc(datumSk(t.datum)) + "</b>" + stavPill(t.stav) + "</span>" +
        '<span class="t-k-nazov">' + esc(t.nazov) + "</span>" +
        '<span class="muted">odchod <b class="num">' + esc(cas(t.odchod)) + '</b> · návrat ~<span class="num">' + esc(cas(t.navrat)) + "</span></span>" +
        '<span class="muted"><span class="num">' + t.hotovo + " / " + t.pocet + "</span> zastávok vybavených</span></button>";
    }).join("") + "</div>";
  }

  // odkazy na Google Mapy po 9 zastávkach (ako starý skript): /maps/dir/<odkiaľ>/<zastávka>/…; prázdny začiatok = moja poloha
  function navOdkazy(zast, odStartu) {
    var body = zast.filter(function (z) { return !z.bez_gps && z.adresa; });
    var out = [];
    for (var i = 0; i < body.length; i += 9) {
      var kus = body.slice(i, i + 9), posl = i + 9 >= body.length;
      var zac = i === 0 ? (odStartu ? START : "") : body[i - 1].adresa;
      var body2 = kus.map(function (z) { return z.adresa; }); if (posl) body2.push(START);
      out.push({ od: i + 1, po: Math.min(i + 9, body.length), url: "https://www.google.com/maps/dir/" + [zac].concat(body2).map(function (a) { return encodeURIComponent(a).replace(/%20/g, "+"); }).join("/") });
    }
    return out;
  }
  function navigacia(zast) {
    var caka = zast.filter(function (z) { return z.stav === "caka"; });
    var odk = navOdkazy(caka, false); if (!odk.length) return "";
    return '<div class="t-navlista">' + odk.map(function (x) {
      return '<a class="btn t-nav" href="' + x.url + '" target="_blank" rel="noopener">🧭 Navigovať ' + (odk.length > 1 ? "zastávky " + x.od + "–" + x.po : "celú trasu") + "</a>";
    }).join("") + "</div>";
  }

  function zastavkaHtml(z, i) {
    var dob = dobierka(z), vybav = z.stav !== "caka";
    var qr = dob && z.faktura && window.LBZ_QR ? '<details class="t-qr"><summary>QR pre kasu (' + esc(eur(z.suma)) + ")</summary>" +
      window.LBZ_QR.svg(z.faktura + ";" + Math.round(Number(z.suma || 0) * 100), 160) + "</details>" : "";
    var foto = z.foto ? (T.fotky[z.foto] ? '<img class="t-foto" src="' + esc(T.fotky[z.foto]) + '" alt="Fotka zo zastávky">' : '<span class="muted">📷 fotka uložená</span>') : "";
    if (z.foto && !T.fotky[z.foto]) nacitajFotku(z.foto);
    return '<section class="card t-zast t-' + z.stav + '" id="t-z-' + esc(z.cislo) + '">' +
      '<div class="t-z-hore"><span class="t-z-cislo num">' + (z.poradie || i + 1) + "</span>" +
        '<span class="t-z-cas num">' + (z.eta ? esc(cas(z.eta)) : "—") + "</span>" +
        (z.stav === "dorucene" ? '<span class="b-st b-st-ok">✓ doručené ' + esc(cas(z.cas)) + "</span>" : z.stav === "nedorucene" ? '<span class="b-st b-st-odl">✗ nedoručené</span>' : "") +
        (z.bez_gps ? '<span class="b-st b-st-odl">adresa nenájdená</span>' : "") + "</div>" +
      '<h3 class="t-z-meno">' + esc(z.meno || z.firma || "-") + "</h3>" +
      '<a class="t-z-adresa" href="' + mapa(z.adresa) + '" target="_blank" rel="noopener">📍 ' + esc(z.adresa || "-") + "</a>" +
      (z.telefon ? '<a class="t-z-tel" href="' + tel(z.telefon) + '">📞 ' + esc(z.telefon) + "</a>" : "") +
      '<div class="t-z-platba ' + (dob ? "t-dob" : "") + '">' + (dob ? "💶 DOBIERKA " + esc(eur(z.suma)) : z.platba === "NA FAKTÚRU" ? "🧾 NA FAKTÚRU" : "✅ ZAPLATENÉ") +
        '<span class="muted"> · ' + esc(z.kusy) + " ks" + (z.faktura ? " · fa " + esc(z.faktura) : "") + " · obj. " + esc(z.cislo) + "</span></div>" +
      (z.pozn_obj ? '<p class="s-varovanie s-varovanie-info t-z-pozn">' + esc(z.pozn_obj) + "</p>" : "") +
      (z.poznamka ? '<p class="t-z-moja">📝 ' + esc(z.poznamka) + (z.presun_datum ? " · nový termín " + esc(datumSk(z.presun_datum)) : "") + "</p>" : "") +
      foto + qr +
      (T.data.trasa.stav === "ukoncena" ? "" : '<div class="t-z-tl">' +
        (vybav ? '<button class="btn" data-t-akcia="spat" data-c="' + esc(z.cislo) + '">↩️ Späť</button>'
          : '<button class="btn t-tl-ok" data-t-akcia="dorucene" data-c="' + esc(z.cislo) + '">✅ Doručené</button>' +
            '<button class="btn t-tl-nie" data-t-akcia="nedorucene" data-c="' + esc(z.cislo) + '">❌ Nedoručené</button>') +
        '<button class="btn" data-t-akcia="poznamka" data-c="' + esc(z.cislo) + '">📝</button>' +
        '<label class="btn t-foto-tl" title="Fotka">📷<input type="file" accept="image/*" capture="environment" data-t-foto="' + esc(z.cislo) + '" hidden></label></div>') +
      "</section>";
  }

  function pohladTrasa() {
    var d = T.data, t = d && d.trasa;
    var head = '<div class="head"><div><button class="btn-link spat" data-t="spat">← Trasy</button><h2>' + esc(t ? t.nazov : "Trasa") + "</h2>" +
      (t ? '<div class="sub">odchod <b class="num">' + esc(cas(t.odchod)) + '</b> · návrat ~<span class="num">' + esc(cas(t.navrat)) + "</span>" + (t.hodiny ? " · " + String(t.hodiny).replace(".", ",") + " h" : "") + (T.nacitavam ? " · načítavam…" : "") + "</div>" : "") +
      "</div>" + (t ? '<span class="head-tl">' + stavPill(t.stav) + '<button class="btn btn-ikona" data-t="tlac" aria-label="Tlačiť">🖨️</button><button class="btn btn-ikona" data-t="obnov" aria-label="Obnoviť">↻</button></span>' : "") + "</div>";
    if (!d) return head + spravaHtml() + '<div class="empty"><strong>Načítavam…</strong></div>';
    var z = d.zastavky || [];
    var caka = z.filter(function (x) { return x.stav === "caka"; }).length;
    var dalsia = z.filter(function (x) { return x.stav === "caka"; })[0];
    var hotovo = z.length - caka;
    return head + spravaHtml() +
      '<div class="b-prog" aria-label="Vybavené ' + hotovo + " z " + z.length + '"><span style="width:' + (z.length ? Math.round(100 * hotovo / z.length) : 0) + '%"></span></div>' +
      (t.stav !== "ukoncena" ? navigacia(z) : "") +
      (dalsia ? '<p class="muted t-dalsia">Ďalšia zastávka: <a href="#t-z-' + esc(dalsia.cislo) + '"><b>' + esc(dalsia.meno || dalsia.firma || dalsia.cislo) + "</b></a></p>" : "") +
      z.map(zastavkaHtml).join("") +
      (t.stav === "ukoncena" ? '<p class="f-sprava f-ok">Rozvoz ukončený ' + esc(cas(t.ukoncena)) + ".</p>"
        : '<button class="btn btn-primary t-koniec" data-t="ukoncit"' + (caka ? " disabled" : "") + ">🏁 Ukončiť rozvoz" + (caka ? " (zostáva " + caka + ")" : "") + "</button>");
  }

  function dialogHtml() {
    var D = T.dialog; if (!D) return "";
    var z = ((T.data && T.data.zastavky) || []).filter(function (x) { return x.cislo === D.cislo; })[0] || {};
    var nedor = D.typ === "nedorucene";
    return '<div class="f-dialog-pozadie" data-t="zavri"></div><div class="f-dialog" role="dialog" aria-modal="true">' +
      '<div class="f-lista"><h3>' + (nedor ? "❌ Nedoručené – " : "📝 Poznámka – ") + esc(z.meno || z.firma || D.cislo) + '</h3><button class="btn-link" data-t="zavri" aria-label="Zavrieť">✕</button></div>' +
      '<form class="f-form" id="t-dialog-form"><label class="field"><span class="label">' + (nedor ? "Prečo (napr. nikto doma, nedvíha)" : "Poznámka (napr. nechané u suseda)") + "</span>" +
      '<textarea id="t-pozn" rows="3"' + (nedor ? " required" : "") + ">" + esc(z.poznamka || "") + "</textarea></label>" +
      (nedor ? '<label class="field"><span class="label">Nový termín (nechajte prázdne = ďalšia furmanka regiónu)</span><input type="date" id="t-datum" value="' + esc(z.presun_datum || "") + '"></label>' : "") +
      '<button class="btn ' + (nedor ? "t-tl-nie" : "btn-primary") + '" type="submit">' + (nedor ? "Označiť ako nedoručené" : "Uložiť poznámku") + "</button></form></div>";
  }

  function prekresli() {
    if (!koren || !koren.isConnected) return;
    var y = window.scrollY;
    koren.innerHTML = (T.id == null ? pohladZoznam() : pohladTrasa()) + dialogHtml();
    window.scrollTo(0, y);
    var ta = document.getElementById("t-pozn"); if (ta && T.dialog && T.dialog.fokus) { T.dialog.fokus = false; ta.focus(); }
  }

  // ---------- fotky ----------
  function nacitajFotku(cesta) {
    if (T.fotky[cesta] !== undefined) return;
    T.fotky[cesta] = "";
    DB.storage.from("trasa").createSignedUrl(cesta, 3600).then(function (r) { if (r.data && r.data.signedUrl) { T.fotky[cesta] = r.data.signedUrl; prekresli(); } });
  }
  function zmensi(subor) {
    return new Promise(function (ok, zle) {
      var img = new Image(), url = URL.createObjectURL(subor);
      img.onload = function () {
        var m = 1280, k = Math.min(1, m / Math.max(img.width, img.height));
        var c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? ok(b) : zle(new Error("Fotku sa nepodarilo spracovať")); }, "image/jpeg", 0.8);
      };
      img.onerror = function () { zle(new Error("Fotku sa nepodarilo načítať")); };
      img.src = url;
    });
  }
  function nahrajFotku(cislo, subor) {
    T.prace++; T.sprava = { typ: "ok", text: "Nahrávam fotku…" }; prekresli();
    var cesta = T.id + "/" + cislo.replace(/[^\w-]/g, "_") + "-" + Date.now() + ".jpg";
    zmensi(subor).then(function (blob) {
      return DB.storage.from("trasa").upload(cesta, blob, { contentType: "image/jpeg" });
    }).then(function (r) {
      if (r.error) throw r.error;
      return rpc("trasa_zastavka", { p_id: T.id, p_cislo: cislo, p_foto: cesta });
    }).then(function (r) {
      T.prace--;
      T.sprava = r && r.ok ? { typ: "ok", text: "Fotka uložená" } : { typ: "chyba", text: (r && r.text) || "Fotka sa neuložila" };
      nacitajTrasu(true);
    }).catch(function (e) { T.prace--; T.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }

  // ---------- akcie ----------
  function zastavka(args, okText) {
    T.prace++;
    return rpc("trasa_zastavka", Object.assign({ p_id: T.id }, args)).then(function (r) {
      T.prace--;
      if (!r || r.ok === false) { T.sprava = { typ: "chyba", text: (r && r.text) || "Neuložené" }; prekresli(); return r; }
      T.sprava = okText ? { typ: "ok", text: okText } : null; T.dialog = null;
      return nacitajTrasu(true).then(function () { return r; });
    }).catch(function (e) { T.prace--; T.sprava = { typ: "chyba", text: chybaText(e) }; prekresli(); });
  }
  // tlač ako starý skript (hárok trasy): Č. | Meno/Firma | Telefón | Č. faktúry | Suma | Adresa | Čas (+ prestávky) | Platba a poznámka | QR pre kasu
  function tlacTrasu() {
    var d = T.data, t = d.trasa, z = d.zastavky || [];
    var n = z.filter(function (x) { return !x.bez_gps; }).length, i1 = 2, i2 = n - 2, spolu = i1 >= i2, stred = Math.floor(n / 2);
    var qr = function (text, px) { return window.LBZ_QR ? window.LBZ_QR.svg(text, px) : ""; };
    var riadky = [], k = 0;
    z.forEach(function (x, i) {
      if (!x.bez_gps) {
        var pauza = spolu ? (k === stred && n >= 3 ? 30 : 0) : (k === i1 || k === i2 ? 15 : 0);
        if (pauza) riadky.push('<tr class="t-p-pauza"><td></td><td colspan="8">☕ Prestávka ' + pauza + " min</td></tr>");
        k++;
      }
      var dob = dobierka(x);
      riadky.push("<tr><td class=\"t-p-c\">" + (x.poradie || i + 1) + "</td><td><b>" + esc(x.meno || x.firma || "") + "</b></td><td>" + esc(x.telefon || "") + "</td><td>" + esc(x.faktura || "") +
        "</td><td class=\"t-p-suma\">" + esc(eur(x.suma)) + '</td><td><a href="' + mapa(x.adresa) + '">' + esc(x.adresa || "") + "</a>" + (x.bez_gps ? " <b>(adresa nenájdená)</b>" : "") +
        '</td><td class="t-p-cas">' + esc(cas(x.eta)) + '</td><td class="' + (dob ? "t-p-dob" : "") + '">' + (dob ? "DOBIERKA" : esc(x.platba)) + (x.pozn_obj ? "<br>" + esc(x.pozn_obj) : "") +
        '</td><td class="t-p-qr">' + (dob && x.faktura ? qr(x.faktura + ";" + Math.round(Number(x.suma || 0) * 100), 70) : "") + "</td></tr>");
    });
    var nav = navOdkazy(z, true);
    var html = '<div class="t-tlac"><h1>Trasa ' + esc(t.nazov) + '</h1><p class="t-datum">Odchod ' + esc(cas(t.odchod)) + " · návrat ~" + esc(cas(t.navrat)) + (t.hodiny ? " · " + String(t.hodiny).replace(".", ",") + " h" : "") + " · štart a cieľ: " + esc(START) + "</p>" +
      '<table class="t-p-tab"><thead><tr><th>Č.</th><th>Meno/Firma</th><th>Telefón</th><th>Č. faktúry</th><th>Suma</th><th>Adresa</th><th>Čas</th><th>Platba a poznámka</th><th>QR</th></tr></thead><tbody>' +
      riadky.join("") + '<tr class="t-p-pauza"><td></td><td colspan="8">🏠 Návrat ' + esc(cas(t.navrat)) + "</td></tr></tbody></table>" +
      '<div class="t-p-nav">' + nav.map(function (x) { return '<div class="t-p-navbox">' + qr(x.url, 110) + "<div>Navigácia " + x.od + "–" + x.po + "</div></div>"; }).join("") + "</div></div>";
    var obal = document.getElementById("tlac-oblast");
    if (!obal) { obal = document.createElement("div"); obal.id = "tlac-oblast"; document.body.appendChild(obal); }
    obal.className = "t-tlac-obal"; obal.innerHTML = html; document.body.classList.add("tlaci");
    var hotovo = function () { document.body.classList.remove("tlaci"); obal.innerHTML = ""; obal.className = ""; window.removeEventListener("afterprint", hotovo); };
    window.addEventListener("afterprint", hotovo);
    setTimeout(function () { window.print(); setTimeout(hotovo, 1500); }, 80);
  }
  function klik(e) {
    var t = e.target.closest("button, [data-t]"); if (!t || !koren.contains(t)) return;
    var d = t.dataset;
    if (d.tOtvor) { T.id = +d.tOtvor; T.data = null; T.sprava = null; prekresli(); window.scrollTo(0, 0); nacitajTrasu(); return; }
    if (d.tAkcia) {
      var c = d.c;
      if (d.tAkcia === "dorucene") {
        var zd = ((T.data && T.data.zastavky) || []).filter(function (x) { return x.cislo === c; })[0] || {};
        if (!window.confirm("Označiť ako DORUČENÉ?\n\n" + (zd.meno || zd.firma || c) + (dobierka(zd) ? "\nDobierka " + eur(zd.suma) : ""))) return;
        zastavka({ p_cislo: c, p_stav: "dorucene" }, "Doručené: " + (zd.meno || zd.firma || c)); return;
      }
      if (d.tAkcia === "spat") { if (!window.confirm("Vrátiť zastávku medzi nevybavené?")) return; zastavka({ p_cislo: c, p_stav: "caka" }); return; }
      if (d.tAkcia === "nedorucene" || d.tAkcia === "poznamka") { T.dialog = { typ: d.tAkcia, cislo: c, fokus: true }; prekresli(); return; }
    }
    switch (d.t) {
      case "zavri-spravu": T.sprava = null; prekresli(); break;
      case "zavri": T.dialog = null; prekresli(); break;
      case "obnov": T.sprava = null; if (T.id == null) nacitajZoznam(); else nacitajTrasu(); break;
      case "spat": T.id = null; T.data = null; T.sprava = null; nacitajZoznam(); break;
      case "tlac": if (T.data) tlacTrasu(); break;
      case "ukoncit":
        if (!window.confirm("Ukončiť rozvoz? Furmanka sa presunie do Archívu a nedoručené objednávky do ďalšej furmanky.")) return;
        T.prace++;
        rpc("trasa_ukoncit", { p_id: T.id }).then(function (r) {
          T.prace--;
          T.sprava = { typ: r && r.ok ? "ok" : "chyba", text: (r && r.text) || "Neuložené" };
          nacitajTrasu(true);
        }).catch(function (er) { T.prace--; T.sprava = { typ: "chyba", text: chybaText(er) }; prekresli(); });
        break;
    }
  }
  function zmena(e) {
    var f = e.target;
    if (f.dataset && f.dataset.tFoto && f.files && f.files[0]) nahrajFotku(f.dataset.tFoto, f.files[0]);
  }
  function odoslanie(e) {
    if (e.target.id !== "t-dialog-form") return;
    e.preventDefault();
    var D = T.dialog, pozn = document.getElementById("t-pozn").value;
    if (D.typ === "nedorucene") {
      var dat = document.getElementById("t-datum").value || null;
      zastavka({ p_cislo: D.cislo, p_stav: "nedorucene", p_poznamka: pozn, p_presun_datum: dat }, "Označené ako nedoručené");
    } else zastavka({ p_cislo: D.cislo, p_poznamka: pozn }, "Poznámka uložená");
  }
  function klaves(e) { if (e.key === "Escape" && T.dialog) { T.dialog = null; prekresli(); } }

  // obnova každú minútu (zákaznícky servis môže sledovať, kde furman je)
  setInterval(function () {
    if (!DB || !koren || !koren.isConnected || document.hidden || T.prace || T.dialog) return;
    if (T.id != null) nacitajTrasu(true); else nacitajZoznam();
  }, 60000);

  // ---------- verejné rozhranie pre app.js ----------
  window.LBZ_TRASA = {
    nastavDb: function (klient, rola) { DB = klient || null; ROLA = klient ? rola : null; if (!DB) { T.zoznam = null; T.data = null; T.id = null; } },
    mozem: function () { return !!DB && ["it", "ceo", "zakaznicky_servis", "furman"].indexOf(ROLA) > -1; },
    mount: function (el) {
      koren = el;
      el.addEventListener("click", klik);
      el.addEventListener("change", zmena);
      el.addEventListener("submit", odoslanie);
      el.addEventListener("keydown", klaves);
      prekresli();
      if (T.id == null) nacitajZoznam(); else nacitajTrasu(true);
    },
    otvor: function (id) { T.id = id; T.data = null; },
    karta: function () {
      if (!T.zoznam && DB && !T._karta) { T._karta = true; rpc("trasa_zoznam").then(function (d) { if (d && d.ok) { T.zoznam = d.trasy || []; window.dispatchEvent(new Event("lbz-prekresli")); } }).catch(function () {}); }
      var z = (T.zoznam || []).filter(function (t) { return t.stav !== "ukoncena"; }).slice(0, 3);
      return '<section class="card"><h3>Trasa</h3>' + (z.length ? '<div class="rows">' + z.map(function (t) {
        return '<div class="row"><span>' + esc(t.nazov) + '</span><span class="num">' + esc(cas(t.odchod)) + " · " + t.hotovo + "/" + t.pocet + "</span></div>";
      }).join("") + "</div>" : '<p class="muted" style="margin:0">Žiadna naplánovaná trasa.</p>') +
        '<button class="btn" data-mod="trasa">Otvoriť trasu</button></section>';
    }
  };
})();
