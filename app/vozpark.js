// LBZ aplikácia – modul Vozový park (IT, CEO, furman – úpravy; účtovníčka – len čítanie)
// Vozidlá, diaľničné známky (s dokladom), upozornenie na Prehľade pre CEO/IT/furmana a pre ľudí v rozpise na najbližšej akcii Buchtomobilu.
(function () {
  "use strict";

  var DB = null, ROLA = null, koren = null;
  var EZNAMKA = "https://eznamka.sk";
  var V = { upoz: null, data: null, chyba: null, form: null, nacitava: false };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function rpc(n, a) { return DB.rpc(n, a || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function chybaText(e) { return (e && (e.message || e.text)) || "Bez spojenia so serverom"; }
  function info(t) { if (window.lbzInfo) lbzInfo(t); else alert(t); }
  function datum(s) { if (!s) return ""; var p = String(s).slice(0, 10).split("-"); return +p[2] + ". " + +p[1] + ". " + p[0]; }
  function dni(s, dnes) { return Math.round((new Date(String(s).slice(0, 10)) - new Date(String(dnes).slice(0, 10))) / 86400000); }
  function eur(n) { return n == null || n === "" ? "" : Number(n).toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
  function kresli() { if (koren && koren.isConnected) prekresli(); window.dispatchEvent(new Event("lbz-prekresli")); }
  function smiemUpravit() { return !!(V.data && V.data.uprava); }
  function spravca() { return ROLA === "it" || ROLA === "ceo"; }

  function nacitajUpoz() {
    if (!DB) return;
    rpc("vp_upozornenie").then(function (d) { V.upoz = d; kresli(); }).catch(function () { V.upoz = null; });
  }
  function obnov() {
    if (!DB) return;
    V.nacitava = true;
    rpc("vp_zoznam").then(function (d) { V.nacitava = false; if (!d || d.ok === false) { V.chyba = (d && d.text) || "Chyba"; } else { V.chyba = null; V.data = d; } kresli(); })
      .catch(function (e) { V.nacitava = false; V.chyba = chybaText(e); kresli(); });
    nacitajUpoz();
  }

  // stav známky voči dnešku
  function stavZnamky(z, dnes) {
    var d = dni(z.platne_do, dnes);
    if (dni(z.platne_od, dnes) > 0) return { t: "od " + datum(z.platne_od), c: "info" };
    if (d < 0) return { t: "neplatná", c: "bad" };
    if (d < 30) return { t: "vyprší o " + d + " d", c: "warn" };
    return { t: "platná", c: "ok" };
  }

  // ---------- karta upozornenia na Prehľade ----------
  function kartaZnamka() {
    var u = V.upoz;
    if (!u || !u.polozky || !u.polozky.length) return "";
    var h = "", najhorsie = "skoro";
    u.polozky.forEach(function (p) {
      if (p.stav === "neplatna") najhorsie = "neplatna";
      else if (p.stav === "chyba" && najhorsie !== "neplatna") najhorsie = "chyba";
      var txt = p.stav === "neplatna" ? "platnosť skončila " + datum(p.platne_do)
        : p.stav === "skoro" ? "platí len do " + datum(p.platne_do)
        : "nemá zaevidovanú diaľničnú známku";
      h += '<div style="font-size:13px;line-height:1.35;margin-top:3px"><b>' + esc(p.nazov) + "</b>" + (p.spz ? ' <span class="muted">' + esc(p.spz) + "</span>" : "") + " – " + esc(txt) + (p.akcia ? ' <span class="muted">(akcia ' + datum(p.akcia) + ")</span>" : "") + "</div>";
    });
    var nadpis = najhorsie === "neplatna" ? "⚠️ Skontrolujte diaľničnú známku – vypršala platnosť"
      : najhorsie === "chyba" ? "⚠️ Skontrolujte diaľničnú známku" : "⚠️ Diaľničná známka čoskoro vyprší";
    return '<section class="card vp-upoz" style="border:1px solid #b3261e;border-left:5px solid #b3261e;background:rgba(179,38,30,.06);padding:8px 12px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<b style="color:#b3261e;font-size:14px">' + nadpis + "</b>" +
      '<span style="display:flex;gap:6px">' +
      '<a class="btn" style="padding:1px 7px;font-size:11px;min-height:0;height:auto;line-height:1.4;border-radius:6px" href="' + EZNAMKA + '" target="_blank" rel="noopener">🛒 Kúpiť</a>' +
      (u.modul ? '<button class="btn" style="padding:1px 7px;font-size:11px;min-height:0;height:auto;line-height:1.4;border-radius:6px" data-mod="vozovy_park">🚐 Detail</button>' : "") +
      "</span></div>" + h + "</section>";
  }

  // ---------- modul ----------
  function formZnamka(f) {
    return '<form class="card vp-form" data-vp-form="znamka" style="margin-top:10px">' +
      "<h3>" + (f.id ? "Upraviť známku" : "Nová diaľničná známka") + "</h3>" +
      '<div class="rows">' +
      pole("Krajina", '<input name="krajina" value="' + esc(f.krajina || "SK") + '" maxlength="3" style="width:70px">') +
      pole("Druh", '<input name="druh" value="' + esc(f.druh || "") + '" placeholder="ročná / 365-dňová / 30-dňová / 10-dňová">') +
      pole("Platná od", '<input type="date" name="platne_od" value="' + esc(f.platne_od || "") + '" required>') +
      pole("Platná do", '<input type="date" name="platne_do" value="' + esc(f.platne_do || "") + '" required>') +
      pole("Uhradená", '<input type="date" name="uhradene" value="' + esc(f.uhradene || "") + '">') +
      pole("Cena €", '<input name="cena" inputmode="decimal" value="' + esc(f.cena == null ? "" : f.cena) + '">') +
      pole("Číslo dokladu", '<input name="doklad" value="' + esc(f.doklad || "") + '">') +
      pole("Kúpená cez", '<input name="predajca" value="' + esc(f.predajca || "eznamka.sk") + '">') +
      pole("Doklad (PDF/foto)", '<input type="file" name="subor" accept="application/pdf,image/*">' + (f.subor ? ' <span class="muted">nahratý</span>' : "")) +
      pole("Poznámka", '<input name="poznamka" value="' + esc(f.poznamka || "") + '">') +
      "</div>" +
      '<p class="muted">Tip: kupujte priamo na <a href="' + EZNAMKA + '" target="_blank" rel="noopener">eznamka.sk</a> – sprostredkovatelia (napr. vintrica) si účtujú poplatok.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" type="submit">💾 Uložiť</button>' +
      '<button class="btn" type="button" data-vp="zrus">Zrušiť</button>' +
      (f.id && spravca() ? '<button class="btn" type="button" data-vp="zmaz-znamku" data-id="' + f.id + '">🗑 Zmazať</button>' : "") +
      "</div></form>";
  }
  function formVozidlo(f) {
    return '<form class="card vp-form" data-vp-form="vozidlo" style="margin-top:10px">' +
      "<h3>" + (f.id ? "Upraviť vozidlo" : "Nové vozidlo") + "</h3>" +
      '<div class="rows">' +
      pole("Názov", '<input name="nazov" value="' + esc(f.nazov || "") + '" required>') +
      pole("EČV", '<input name="spz" value="' + esc(f.spz || "") + '" style="text-transform:uppercase">') +
      pole("Typ", '<input name="typ" value="' + esc(f.typAuta || "") + '" placeholder="osobné auto / dodávka / foodtruck">') +
      pole("VIN", '<input name="vin" value="' + esc(f.vin || "") + '">') +
      pole("Kto ho používa", '<input name="pouziva" value="' + esc(f.pouziva || "") + '">') +
      pole("Pozícia v rozpise", '<input name="pozicia" value="' + esc(f.pozicia || "") + '" placeholder="napr. buchtac">') +
      pole("Kniha jázd", '<select name="kniha"><option value="appka"' + (f.kniha !== "gps" ? " selected" : "") + '>v appke</option><option value="gps"' + (f.kniha === "gps" ? " selected" : "") + ">GPS (x-track)</option></select>") +
      pole("Poznámka", '<input name="poznamka" value="' + esc(f.poznamka || "") + '">') +
      (f.id ? pole("Aktívne", '<input type="checkbox" name="aktivne"' + (f.aktivne !== false ? " checked" : "") + ">") : "") +
      "</div>" +
      '<div style="display:flex;gap:8px"><button class="btn btn-primary" type="submit">💾 Uložiť</button><button class="btn" type="button" data-vp="zrus">Zrušiť</button></div></form>';
  }
  function pole(n, inp) { return '<label class="row"><span>' + n + "</span><span>" + inp + "</span></label>"; }

  function kartaVozidla(v, dnes) {
    var f = V.form;
    var zn = v.znamky || [];
    var sk = zn.filter(function (z) { return z.krajina === "SK"; });
    var akt = sk.length ? stavZnamky(sk[0], dnes) : { t: "bez známky", c: "bad" };
    var h = '<section class="card vp-voz"><h3>' + esc(v.nazov) + ' <span class="pill ' + akt.c + '">SK známka: ' + esc(akt.t) + "</span>" +
      (v.aktivne === false ? ' <span class="pill info">vyradené</span>' : "") + "</h3>" +
      '<div class="rows">' +
      '<div class="row"><span>EČV</span><span class="num"><b>' + esc(v.spz || "—") + "</b></span></div>" +
      (v.typ ? '<div class="row"><span>Typ</span><span>' + esc(v.typ) + "</span></div>" : "") +
      (v.pouziva ? '<div class="row"><span>Používa</span><span>' + esc(v.pouziva) + "</span></div>" : "") +
      (v.vin ? '<div class="row"><span>VIN</span><span class="num">' + esc(v.vin) + "</span></div>" : "") +
      '<div class="row"><span>Kniha jázd</span><span>' + (v.kniha === "gps" ? '<a href="https://portal.x-track.sk/summary" target="_blank" rel="noopener">GPS – x-track ↗</a>' : "v appke") + "</span></div>" +
      (v.poznamka ? '<div class="row"><span>Poznámka</span><span>' + esc(v.poznamka) + "</span></div>" : "") +
      "</div>" +
      '<h4 style="margin:12px 0 6px">🛣️ Diaľničné známky</h4>';
    if (!zn.length) h += '<p class="muted">Zatiaľ žiadna zaevidovaná známka.</p>';
    else {
      h += '<div class="rows">';
      zn.forEach(function (z) {
        var s = stavZnamky(z, dnes);
        h += '<div class="row" style="flex-wrap:wrap"><span><b>' + esc(z.krajina) + "</b> " + esc(z.druh || "") + '<br><span class="muted">' + datum(z.platne_od) + " – " + datum(z.platne_do) +
          (z.uhradene ? " · uhradená " + datum(z.uhradene) : "") + (z.cena != null ? " · " + eur(z.cena) : "") + "</span>" +
          (z.doklad || z.predajca ? '<br><span class="muted">' + esc([z.doklad ? "doklad " + z.doklad : "", z.predajca || ""].filter(Boolean).join(" · ")) + "</span>" : "") +
          (z.poznamka ? '<br><span class="muted">' + esc(z.poznamka) + "</span>" : "") + "</span>" +
          '<span style="display:flex;gap:6px;align-items:center"><span class="pill ' + s.c + '">' + esc(s.t) + "</span>" +
          (z.subor ? '<button class="btn" type="button" data-vp="doklad" data-subor="' + esc(z.subor) + '">📄</button>' : "") +
          (smiemUpravit() ? '<button class="btn" type="button" data-vp="upr-znamku" data-id="' + z.id + '" data-voz="' + v.id + '">✏️</button>' : "") +
          "</span></div>";
      });
      h += "</div>";
    }
    if (f && f.typ === "znamka" && String(f.vozidlo_id) === String(v.id)) h += formZnamka(f);
    else if (f && f.typ === "vozidlo" && String(f.id) === String(v.id)) h += formVozidlo(f);
    else {
      h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">';
      if (smiemUpravit()) h += '<button class="btn btn-primary" type="button" data-vp="nova-znamka" data-voz="' + v.id + '">➕ Zapísať známku</button>';
      h += '<a class="btn" href="' + EZNAMKA + '" target="_blank" rel="noopener">🛒 eznamka.sk</a>';
      if (spravca()) h += '<button class="btn" type="button" data-vp="upr-vozidlo" data-voz="' + v.id + '">✏️ Vozidlo</button>';
      h += "</div>";
    }
    return h + "</section>";
  }

  function prekresli() {
    if (!koren) return;
    var h = '<div class="vp">';
    h += '<header class="page-head"><h2>🚐 Vozový park</h2><p class="muted">Autá firmy, diaľničné známky a doklady. Ďalej pribudne STK, EK, poistky a servis.</p></header>';
    var k = kartaZnamka(); if (k) h += k;
    if (V.chyba) h += '<div class="empty">' + esc(V.chyba) + "</div>";
    else if (!V.data) h += '<div class="empty">Načítavam…</div>';
    else {
      var dnes = V.data.dnes;
      h += '<div class="grid">' + (V.data.vozidla || []).map(function (v) { return kartaVozidla(v, dnes); }).join("") + "</div>";
      if (spravca()) {
        if (V.form && V.form.typ === "vozidlo" && !V.form.id) h += formVozidlo(V.form);
        else h += '<p><button class="btn" type="button" data-vp="nove-vozidlo">➕ Pridať vozidlo</button></p>';
      }
    }
    koren.innerHTML = h + "</div>";
  }

  function najdiVoz(id) { return ((V.data && V.data.vozidla) || []).filter(function (v) { return String(v.id) === String(id); })[0]; }

  function klik(e) {
    var t = e.target.closest("[data-vp]"); if (!t) return;
    var a = t.dataset.vp;
    if (a === "zrus") { V.form = null; prekresli(); }
    else if (a === "nova-znamka") { V.form = { typ: "znamka", vozidlo_id: t.dataset.voz, krajina: "SK", druh: "365-dňová", predajca: "eznamka.sk" }; prekresli(); }
    else if (a === "upr-znamku") {
      var v = najdiVoz(t.dataset.voz); var z = v && v.znamky.filter(function (x) { return String(x.id) === t.dataset.id; })[0];
      if (z) { V.form = Object.assign({ typ: "znamka", vozidlo_id: v.id }, z); prekresli(); }
    }
    else if (a === "zmaz-znamku") {
      if (!window.lbzPotvrd || lbzPotvrd("Naozaj zmazať túto známku?")) {
        rpc("vp_znamka_zmaz", { p_id: +t.dataset.id }).then(function (d) { if (d && d.ok === false) return info(d.text); V.form = null; obnov(); }).catch(function (x) { info(chybaText(x)); });
      }
    }
    else if (a === "upr-vozidlo") { var vv = najdiVoz(t.dataset.voz); if (vv) { V.form = Object.assign({}, vv, { typ: "vozidlo", typAuta: vv.typ }); prekresli(); } }
    else if (a === "nove-vozidlo") { V.form = { typ: "vozidlo" }; prekresli(); }
    else if (a === "doklad") {
      DB.storage.from("vozidla").createSignedUrl(t.dataset.subor, 300).then(function (r) {
        if (r.error) return info(chybaText(r.error)); window.open(r.data.signedUrl, "_blank", "noopener");
      });
    }
  }

  function odoslanie(e) {
    var f = e.target.closest("form[data-vp-form]"); if (!f) return;
    e.preventDefault();
    var fd = new FormData(f), p = {};
    fd.forEach(function (val, k) { if (k !== "subor") p[k] = val; });
    var btn = f.querySelector("button[type=submit]"); if (btn) btn.disabled = true;
    function hotovo(d) { if (btn) btn.disabled = false; if (d && d.ok === false) return info(d.text); V.form = null; obnov(); }
    function chyba(x) { if (btn) btn.disabled = false; info(chybaText(x)); }
    if (f.dataset.vpForm === "vozidlo") {
      if (V.form && V.form.id) p.id = V.form.id;
      if (V.form && V.form.id) p.aktivne = !!f.querySelector("[name=aktivne]:checked");
      rpc("vp_vozidlo_uloz", { p: p }).then(hotovo).catch(chyba);
      return;
    }
    p.vozidlo_id = V.form.vozidlo_id; if (V.form.id) p.id = V.form.id;
    var subor = f.querySelector("input[name=subor]").files[0];
    var nahraj = subor ? DB.storage.from("vozidla").upload(p.vozidlo_id + "/znamky/" + Date.now() + "_" + subor.name.replace(/[^\w.\-]+/g, "_"), subor, { upsert: false })
      .then(function (r) { if (r.error) throw r.error; p.subor = r.data.path; }) : Promise.resolve();
    nahraj.then(function () { return rpc("vp_znamka_uloz", { p: p }); }).then(hotovo).catch(chyba);
  }

  window.LBZ_VOZPARK = {
    nastavDb: function (klient, rola) {
      DB = klient || null; ROLA = klient ? rola : null; V.data = null; V.upoz = null; V.form = null; V.chyba = null;
      if (DB && ROLA && ROLA !== "zakaznik") nacitajUpoz();
    },
    mozem: function () { return !!DB && ["it", "ceo", "uctovnicka", "furman"].indexOf(ROLA) >= 0; },
    mount: function (el) {
      koren = el;
      el.addEventListener("click", klik); el.addEventListener("submit", odoslanie);
      prekresli(); obnov();
    },
    kartaZnamka: function () { return kartaZnamka(); }
  };
})();
