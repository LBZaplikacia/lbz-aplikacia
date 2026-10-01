/* LBZ – Cestovné príkazy (furman)
   Hromadný cestovný príkaz na mesiac (§ 3 ods. 3 zákona 283/2002 Z. z.): každý deň rozvozu = jedna pracovná cesta.
   Návrh sa vytvorí sám z trasy (inak z furmanky / dochádzky). Furman ho na konci dňa skontroluje, doplní miesta
   (km sa prepočítajú cez Google), stravné sa počíta samo (§ 5). Vedenie schváli a vytlačí za mesiac. */
(function () {
  var DB = null, ROLA = null, koren = null;
  var START = "Sedlo Zbojská, 976 56 Pohronská Polhora";
  var C = { m: null, osoba: null, d: null, uprav: null, f: null, vloz: null, prace: false, km: false, sprava: null, karta: null };
  var ZAMESTNAVATEL = "V sedle u Falťanov s.r.o., Mládežnícka 3427/9, 974 04 Banská Bystrica, IČO 47206934";
  var MESIACE = ["január", "február", "marec", "apríl", "máj", "jún", "júl", "august", "september", "október", "november", "december"];
  var STAV = { navrh: ["na kontrolu", "warn"], skontrolovane: ["skontrolované", "info"], schvalene: ["schválené", "ok"] };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function rpc(n, a) { return DB.rpc(n, a || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function chyba(e) { return (e && (e.message || e.text)) || "Bez spojenia so serverom"; }
  function eur(n) { return Number(n || 0).toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
  function kmTxt(n) { return n == null || n === "" ? "–" : Number(n).toLocaleString("sk-SK", { maximumFractionDigits: 1 }) + " km"; }
  function dvoj(n) { return ("0" + n).slice(-2); }
  function iso(d) { return d.getFullYear() + "-" + dvoj(d.getMonth() + 1) + "-" + dvoj(d.getDate()); }
  function dnes() { return iso(new Date()); }
  function datumSk(s) { var p = String(s).slice(0, 10).split("-"); var d = new Date(+p[0], +p[1] - 1, +p[2], 12); return d.toLocaleDateString("sk-SK", { weekday: "short", day: "numeric", month: "numeric" }); }
  function hm(t) { return t ? new Date(t).toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" }) : ""; }
  function trvanie(c) { if (!c.zaciatok || !c.koniec) return null; return (new Date(c.koniec) - new Date(c.zaciatok)) / 3600000; }
  function hodiny(h) { if (h == null) return "–"; var m = Math.round(h * 60); return Math.floor(m / 60) + " h " + dvoj(m % 60) + " min"; }
  function stravneOdhad(c) {
    var s = C.d && C.d.sadzby, h = trvanie(c); if (!s || h == null || h <= 0) return 0;
    return h < 5 ? 0 : h <= 12 ? +s.s5 : h <= 18 ? +s.s12 : +s.s18;
  }
  function miesta(c) {
    var v = [], b = c.body || [];
    b.forEach(function (x) { var m = String(x.miesto || x.adresa || "").trim() + (x.min ? " (" + x.min + " min)" : ""); if (m && v[v.length - 1] !== m) v.push(m); });
    return v;
  }
  function mesiacNazov(m) { var p = String(m).split("-"); return MESIACE[+p[1] - 1] + " " + p[0]; }
  function mozem() { return !!DB && ["it", "ceo", "furman", "uctovnicka"].indexOf(ROLA) > -1; }
  function kresli() { if (koren && koren.isConnected) koren.innerHTML = html(); }
  function styl() {
    if (document.getElementById("cp-styl")) return;
    var s = document.createElement("style"); s.id = "cp-styl";
    s.textContent = ".cp-hl{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}.cp-mes{display:flex;gap:6px;align-items:center}.cp-mes b{min-width:140px;text-align:center}" +
      ".cp-den{border:1px solid var(--line);border-radius:14px;padding:12px;margin:8px 0;background:var(--card,#fff)}.cp-den h3{margin:0;font-size:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}" +
      ".cp-riadok{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:14px;margin-top:6px}.cp-miesta{font-size:13px;color:var(--muted,#6b5b55);margin-top:4px}" +
      ".cp-body{list-style:none;margin:8px 0;padding:0;border-left:3px solid var(--gold,#CBA75B)}.cp-body li{display:flex;gap:6px;align-items:center;padding:6px 8px;border-bottom:1px dashed var(--line)}" +
      ".cp-body li .cp-m{flex:1;min-width:0}.cp-body li small{display:block;color:var(--muted,#6b5b55);overflow-wrap:anywhere}.cp-body li.cp-dopl{background:#fff7e6}.cp-body .cp-km{white-space:nowrap;font-size:13px}" +
      ".cp-ik{border:1px solid var(--line);background:var(--bg);border-radius:8px;min-width:36px;min-height:36px;font-size:15px;cursor:pointer}.cp-vloz{display:block;width:100%;text-align:left;border:0;background:none;color:var(--hneda,#583934);font-size:13px;padding:4px 8px;cursor:pointer}" +
      ".cp-polia{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.cp-polia input,.cp-polia textarea,.cp-vlozf input{width:100%;border:1px solid var(--line);border-radius:8px;padding:10px;min-height:44px;font:inherit;background:var(--bg);color:var(--ink)}" +
      ".cp-vlozf{display:flex;gap:6px;padding:6px 8px;background:#fff7e6}.cp-min{display:flex;align-items:center;gap:2px;font-size:13px}.cp-min input{width:58px;min-height:36px;border:1px solid var(--line);border-radius:8px;padding:4px;font:inherit;background:var(--bg);color:var(--ink)}.cp-sum{display:flex;flex-wrap:wrap;gap:6px 16px;font-weight:600;margin:8px 0}.cp-akcie{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}";
    document.head.appendChild(s);
  }

  // ---------- načítanie ----------
  function nacitaj() {
    C.d = C.d && C.d.mesiac === C.m && C.d.osoba_id === C.osoba ? C.d : null; kresli();
    var a = { p_mesiac: C.m }; if (C.osoba) a.p_osoba = C.osoba;
    return rpc("cp_mesiac", a).then(function (d) {
      if (!d || !d.ok) { C.d = { chyba: (d && d.text) || "Nenačítané" }; kresli(); return; }
      C.d = d; if (!C.osoba) C.osoba = d.osoba_id; C.karta = null; kresli();
      if (C.uprav) { var c = cesta(C.uprav); if (c) { C.f = kopia(c); if (C.f.km == null) prepocitajKm(); } else { C.uprav = null; C.f = null; } kresli(); }
    }).catch(function (e) { C.d = { chyba: chyba(e) }; kresli(); });
  }
  function cesta(id) { return ((C.d && C.d.cesty) || []).filter(function (c) { return c.id === id; })[0] || null; }
  function kopia(c) { return JSON.parse(JSON.stringify(c)); }

  // ---------- km cez Google ----------
  function prepocitajKm() {
    var f = C.f; if (!f) return;
    C.km = true; kresli();
    var zac = f.miesto_zac && !/^Sedlo Zbojská/.test(f.miesto_zac) ? f.miesto_zac : START;
    var kon = f.miesto_kon && !/^Sedlo Zbojská/.test(f.miesto_kon) ? f.miesto_kon : START;
    DB.functions.invoke("cesty", { body: { akcia: "km", start: zac, ciel: kon, body: (f.body || []).map(function (b) { return { lat: b.lat, lng: b.lng, adresa: b.adresa || b.miesto }; }) } })
      .then(function (r) {
        C.km = false;
        var d = r && r.data; if (C.f !== f) return;
        if (!d || !d.ok) { C.sprava = { typ: "chyba", text: (d && d.text) || "Kilometre sa nepodarilo vypočítať – zadajte ich ručne" }; kresli(); return; }
        (f.body || []).forEach(function (b, i) { b.km = d.useky[i]; });
        f.km_spat = d.useky[d.useky.length - 1]; f.km = d.km; kresli();
      }).catch(function () { C.km = false; C.sprava = { typ: "chyba", text: "Kilometre sa nepodarilo vypočítať – zadajte ich ručne" }; kresli(); });
  }

  // ---------- zobrazenie ----------
  function html() {
    styl();
    var d = C.d;
    var hl = '<div class="cp-hl"><h2 style="margin:0">🧾 Cestovné príkazy</h2><div class="cp-mes"><button class="cp-ik" data-cp="mes-" aria-label="Predchádzajúci mesiac">‹</button><b>' + esc(mesiacNazov(C.m)) +
      '</b><button class="cp-ik" data-cp="mes+" aria-label="Ďalší mesiac">›</button></div></div>';
    if (d && d.spravca && (d.osoby || []).length) {
      hl += '<label class="field" style="margin-top:8px"><span class="label">Zamestnanec</span><select id="cp-osoba">' + (d.osoby || []).map(function (o) {
        return '<option value="' + o.id + '"' + (o.id === C.osoba ? " selected" : "") + ">" + esc(o.meno) + "</option>";
      }).join("") + "</select></label>";
    }
    var spr = C.sprava ? '<p class="login-sprava ' + (C.sprava.typ === "ok" ? "ok" : "chyba") + '" role="status">' + esc(C.sprava.text) + "</p>" : "";
    if (!d) return hl + spr + '<div class="empty"><strong>Načítavam…</strong></div>';
    if (d.chyba) return hl + spr + '<div class="empty"><strong>' + esc(d.chyba) + "</strong></div>";
    var cesty = d.cesty || [];
    var sumKm = cesty.reduce(function (s, c) { return s + Number(c.km || 0); }, 0), sumStr = cesty.reduce(function (s, c) { return s + Number(c.stravne || 0); }, 0);
    var nove = '<div class="cp-akcie" style="align-items:flex-end"><label class="field" style="margin:0"><span class="label">Pridať cestu (deň)</span><input type="date" id="cp-novy-den" value="' + dnes() + '" max="' + dnes() + '"></label>' +
      '<button class="btn" data-cp="novy">➕ Pridať cestu</button>' + (cesty.length ? '<button class="btn" data-cp="tlac">🖨️ Tlačiť za mesiac</button>' : "") + "</div>";
    var info = '<p class="muted" style="font-size:13px;margin:6px 0">Hromadný cestovný príkaz na ' + esc(mesiacNazov(C.m)) + " (§ 3 ods. 3 zákona č. 283/2002 Z. z.). Každý deň rozvozu sa vytvorí sám z trasy – na konci dňa ho skontroluj, doplň miesta, kde si ešte bol (napr. po tovar), a potvrď. Služobné auto: kilometre sa len evidujú, stravné sa počíta samo.</p>";
    return hl + info + spr + nove +
      '<div class="cp-sum"><span>Ciest: ' + cesty.length + "</span><span>Spolu: " + esc(kmTxt(Math.round(sumKm * 10) / 10)) + "</span><span>Stravné spolu: " + eur(sumStr) + "</span></div>" +
      (cesty.length ? cesty.map(denHtml).join("") : '<div class="empty"><strong>V tomto mesiaci zatiaľ nie je žiadna cesta.</strong></div>');
  }
  function stavPill(s) { var x = STAV[s] || STAV.navrh; return '<span class="pill ' + x[1] + '">' + x[0] + "</span>"; }
  function denHtml(c) {
    if (C.uprav === c.id && C.f) return editorHtml(C.f, c);
    var m = miesta(c);
    return '<section class="cp-den"><h3>' + esc(datumSk(c.datum)) + " " + stavPill(c.stav) + "</h3>" +
      '<div class="cp-riadok"><span>🚚 ' + (c.zaciatok ? esc(hm(c.zaciatok)) : "<i>čas?</i>") + " – " + (c.koniec ? esc(hm(c.koniec)) : "<i>čas?</i>") + " (" + esc(hodiny(trvanie(c))) + ")</span><span>📏 " + esc(kmTxt(c.km)) + "</span><span>🍽 " + eur(c.stravne) + "</span></div>" +
      '<div class="cp-miesta">' + (m.length ? esc(m.join(" → ")) : "<i>bez miest – doplň</i>") + "</div>" +
      (c.poznamka ? '<div class="cp-miesta">📝 ' + esc(c.poznamka) + "</div>" : "") +
      '<div class="cp-akcie"><button class="btn' + (c.stav === "navrh" ? " btn-primary" : "") + '" data-cp-uprav="' + c.id + '">' + (c.stav === "navrh" ? "✅ Skontrolovať" : "✏️ Upraviť / pozrieť") + "</button>" +
      (C.d.spravca && c.stav !== "schvalene" ? '<button class="btn" data-cp-schval="' + c.id + '" data-ano="1">✔ Schváliť</button>' : "") +
      (C.d.spravca && c.stav === "schvalene" ? '<button class="btn" data-cp-schval="' + c.id + '" data-ano="0">Zrušiť schválenie</button>' : "") + "</div></section>";
  }
  function casVal(t) { return t ? hm(t) : ""; }
  function editorHtml(f, c) {
    var zamk = c.stav === "schvalene" && !C.d.spravca;
    var b = f.body || [];
    var vloz = function (i) {
      if (zamk) return "";
      if (C.vloz === i) return '<li class="cp-vlozf"><input id="cp-vloz-txt" placeholder="Miesto, napr. Metro Banská Bystrica" autocomplete="off"><button class="btn btn-primary" data-cp="vloz-ok">Pridať</button><button class="btn" data-cp="vloz-zrus">✕</button></li>';
      return '<li style="padding:0;border:0"><button class="cp-vloz" data-cp-vloz="' + i + '">➕ vložiť miesto sem</button></li>';
    };
    var zoznam = '<ul class="cp-body"><li><span class="cp-m"><b>Štart:</b> ' + esc(f.miesto_zac) + "</span></li>" + vloz(0) +
      b.map(function (x, i) {
        return '<li class="' + (x.typ === "doplnene" ? "cp-dopl" : "") + '"><span class="cp-m"><b>' + (i + 1) + ". " + esc(x.miesto || x.adresa) + "</b>" +
          (x.adresa && x.adresa !== x.miesto ? "<small>" + esc(x.adresa) + "</small>" : "") + (x.typ === "doplnene" ? "<small>doplnené furmanom</small>" : "") + "</span>" +
          '<span class="cp-km">' + (x.km != null ? "+" + esc(kmTxt(x.km)) : "") + "</span>" +
          '<label class="cp-min" title="Ako dlho si sa tu zdržal (minúty)">⏱<input type="number" min="0" max="600" step="5" inputmode="numeric" data-cp-min="' + i + '" value="' + esc(x.min || "") + '" placeholder="min"' + (zamk ? " disabled" : "") + "></label>" +
          (zamk ? "" : '<button class="cp-ik" data-cp-hore="' + i + '" aria-label="Vyššie">↑</button><button class="cp-ik" data-cp-dole="' + i + '" aria-label="Nižšie">↓</button><button class="cp-ik" data-cp-zmaz="' + i + '" aria-label="Odstrániť">✕</button>') +
          "</li>" + vloz(i + 1);
      }).join("") +
      '<li><span class="cp-m"><b>Návrat:</b> ' + esc(f.miesto_kon) + '</span><span class="cp-km">' + (f.km_spat != null ? "+" + esc(kmTxt(f.km_spat)) : "") + "</span></li></ul>";
    var str = stravneOdhad(f);
    return '<section class="cp-den" id="cp-editor"><h3>' + esc(datumSk(c.datum)) + " " + stavPill(c.stav) + "</h3>" +
      (zamk ? '<p class="muted">Cesta je schválená – zmeny už robí len vedenie.</p>' : "") +
      '<div class="cp-polia" style="margin-top:8px">' +
        '<label class="field"><span class="label">Odchod (začiatok cesty)</span><input type="time" id="cp-zac" value="' + esc(casVal(f.zaciatok)) + '"' + (zamk ? " disabled" : "") + "></label>" +
        '<label class="field"><span class="label">Návrat (koniec cesty)</span><input type="time" id="cp-kon" value="' + esc(casVal(f.koniec)) + '"' + (zamk ? " disabled" : "") + "></label>" +
        '<label class="field"><span class="label">Kilometre spolu</span><input type="number" step="0.1" min="0" id="cp-km" value="' + esc(f.km == null ? "" : f.km) + '"' + (zamk ? " disabled" : "") + "></label>" +
      "</div>" +
      '<div class="cp-polia" style="margin-top:8px"><label class="field"><span class="label">Začiatok cesty (miesto)</span><input id="cp-mzac" value="' + esc(f.miesto_zac) + '"' + (zamk ? " disabled" : "") + "></label>" +
        '<label class="field"><span class="label">Koniec cesty (miesto)</span><input id="cp-mkon" value="' + esc(f.miesto_kon) + '"' + (zamk ? " disabled" : "") + "></label>" +
        '<label class="field"><span class="label">Účel cesty</span><input id="cp-ucel" value="' + esc(f.ucel) + '"' + (zamk ? " disabled" : "") + "></label></div>" +
      '<p class="muted" style="margin:10px 0 0;font-size:13px">Miesta (poradie jazdy) – ' + (C.km ? "počítam kilometre…" : "kilometre sa prepočítajú samy po zmene") + "</p>" + zoznam +
      '<label class="field"><span class="label">Poznámka (napr. čo si vybavoval)</span><input id="cp-pozn" value="' + esc(f.poznamka || "") + '" maxlength="300"' + (zamk ? " disabled" : "") + "></label>" +
      '<div class="cp-sum"><span>Trvanie: ' + esc(hodiny(trvanie(f))) + "</span><span>" + esc(kmTxt(f.km)) + "</span><span>Stravné: " + eur(str) + "</span></div>" +
      '<div class="cp-akcie">' + (zamk ? "" :
        (c.stav === "navrh" ? '<button class="btn btn-primary" data-cp="potvrd"' + (C.prace ? " disabled" : "") + ">✅ Skontrolované – je to správne</button>" : '<button class="btn btn-primary" data-cp="uloz"' + (C.prace ? " disabled" : "") + ">💾 Uložiť</button>") +
        (c.stav === "navrh" ? '<button class="btn" data-cp="uloz"' + (C.prace ? " disabled" : "") + ">💾 Uložiť rozpracované</button>" : "") +
        '<button class="btn" data-cp="km"' + (C.km ? " disabled" : "") + ">🔄 Prepočítať km</button>") +
        '<button class="btn" data-cp="zavri">Zavrieť</button>' +
        ((c.stav !== "schvalene" || C.d.spravca) ? '<button class="btn" data-cp="zmaz" style="margin-left:auto">🗑 Zmazať</button>' : "") + "</div></section>";
  }

  // ---------- úpravy ----------
  function nacitajFormular() {
    var f = C.f; if (!f) return;
    var g = function (id) { var e = document.getElementById(id); return e ? e.value : null; };
    var spoj = function (hhmm, zakladX) {
      if (!hhmm) return null;
      var p = String(C.f.datum).slice(0, 10).split("-"), h = hhmm.split(":");
      return new Date(+p[0], +p[1] - 1, +p[2], +h[0], +h[1], 0).toISOString();
    };
    if (g("cp-zac") !== null) f.zaciatok = spoj(g("cp-zac"));
    if (g("cp-kon") !== null) {
      var k = spoj(g("cp-kon"));
      if (k && f.zaciatok && new Date(k) <= new Date(f.zaciatok)) k = new Date(new Date(k).getTime() + 86400000).toISOString();   // cez polnoc
      f.koniec = k;
    }
    if (g("cp-km") !== null) f.km = g("cp-km") === "" ? null : Number(g("cp-km"));
    if (g("cp-mzac") !== null) f.miesto_zac = g("cp-mzac");
    if (g("cp-mkon") !== null) f.miesto_kon = g("cp-mkon");
    if (g("cp-ucel") !== null) f.ucel = g("cp-ucel");
    if (g("cp-pozn") !== null) f.poznamka = g("cp-pozn");
    [].forEach.call(document.querySelectorAll("[data-cp-min]"), function (e) { var b = f.body[+e.dataset.cpMin]; if (b) b.min = e.value === "" ? null : Math.max(0, Math.round(+e.value)); });
  }
  function uloz(potvrdit) {
    nacitajFormular();
    var f = C.f; if (!f) return;
    if (potvrdit && (!f.zaciatok || !f.koniec)) { lbzInfo("Doplň čas odchodu a návratu."); return; }
    C.prace = true; kresli();
    var body = (f.body || []).map(function (b) { return { miesto: b.miesto, adresa: b.adresa, lat: b.lat, lng: b.lng, cislo: b.cislo, typ: b.typ, km: b.km, min: b.min ? +b.min : null }; });
    rpc("cp_uloz", { p_id: f.id, p: { zaciatok: f.zaciatok, koniec: f.koniec, km: f.km, miesto_zac: f.miesto_zac, miesto_kon: f.miesto_kon, ucel: f.ucel, poznamka: f.poznamka || "", body: body, potvrdit: !!potvrdit } })
      .then(function (r) {
        C.prace = false;
        if (!r || !r.ok) { C.sprava = { typ: "chyba", text: (r && r.text) || "Neuložené" }; kresli(); return; }
        C.sprava = { typ: "ok", text: potvrdit ? "Cesta " + datumSk(f.datum) + " je skontrolovaná – stravné " + eur(r.cesta.stravne) : "Uložené" };
        if (potvrdit) { C.uprav = null; C.f = null; }
        window.dispatchEvent(new Event("lbz-prekresli"));
        nacitaj();
      }).catch(function (e) { C.prace = false; C.sprava = { typ: "chyba", text: chyba(e) }; kresli(); });
  }
  function zmenaBodov() { C.f.km = null; C.f.km_spat = null; kresli(); prepocitajKm(); }

  function klik(e) {
    var t = e.target.closest("button, [data-cp]"); if (!t || !koren.contains(t)) return;
    var ds = t.dataset;
    if (ds.cpUprav) { var c = cesta(+ds.cpUprav); if (!c) return; C.uprav = c.id; C.f = kopia(c); C.vloz = null; C.sprava = null; kresli(); if (C.f.km == null && (C.f.body || []).length) prepocitajKm(); var ed = document.getElementById("cp-editor"); if (ed) ed.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
    if (ds.cpSchval) {
      rpc("cp_schval", { p_id: +ds.cpSchval, p_ano: ds.ano === "1" }).then(function (r) { C.sprava = { typ: r && r.ok ? "ok" : "chyba", text: r && r.ok ? (ds.ano === "1" ? "Schválené" : "Schválenie zrušené") : (r && r.text) || "Chyba" }; nacitaj(); window.dispatchEvent(new Event("lbz-prekresli")); })
        .catch(function (x) { lbzInfo(chyba(x)); });
      return;
    }
    if (ds.cpVloz != null && ds.cpVloz !== "") { nacitajFormular(); C.vloz = +ds.cpVloz; kresli(); var v = document.getElementById("cp-vloz-txt"); if (v) v.focus(); return; }
    if (ds.cpHore != null && ds.cpHore !== "") { nacitajFormular(); var i = +ds.cpHore; if (i > 0) { var b = C.f.body; var x = b[i]; b[i] = b[i - 1]; b[i - 1] = x; zmenaBodov(); } return; }
    if (ds.cpDole != null && ds.cpDole !== "") { nacitajFormular(); var j = +ds.cpDole, bb = C.f.body; if (j < bb.length - 1) { var y = bb[j]; bb[j] = bb[j + 1]; bb[j + 1] = y; zmenaBodov(); } return; }
    if (ds.cpZmaz != null && ds.cpZmaz !== "") { nacitajFormular(); C.f.body.splice(+ds.cpZmaz, 1); zmenaBodov(); return; }
    var a = ds.cp;
    if (a === "mes-" || a === "mes+") {
      var p = C.m.split("-"), d = new Date(+p[0], +p[1] - 1 + (a === "mes+" ? 1 : -1), 1);
      C.m = iso(d); C.uprav = null; C.f = null; C.sprava = null; nacitaj();
    }
    else if (a === "novy") {
      var den = (document.getElementById("cp-novy-den") || {}).value; if (!den) return;
      var arg = { p_datum: den }; if (C.d && C.d.spravca && C.osoba) arg.p_osoba = C.osoba;
      rpc("cp_vytvor_den", arg).then(function (r) {
        if (!r || !r.ok) { lbzInfo((r && r.text) || "Nepodarilo sa"); return; }
        C.m = den.slice(0, 8) + "01"; C.uprav = r.id; C.f = null; C.sprava = { typ: "ok", text: "Cesta " + datumSk(den) + " – skontroluj a doplň" }; nacitaj();
      }).catch(function (x) { lbzInfo(chyba(x)); });
    }
    else if (a === "vloz-ok") {
      var txt = (document.getElementById("cp-vloz-txt") || {}).value || ""; txt = txt.trim();
      if (!txt) return;
      nacitajFormular(); C.f.body.splice(C.vloz, 0, { miesto: txt, adresa: txt, typ: "doplnene" }); C.vloz = null; zmenaBodov();
    }
    else if (a === "vloz-zrus") { C.vloz = null; kresli(); }
    else if (a === "km") { nacitajFormular(); prepocitajKm(); }
    else if (a === "uloz") uloz(false);
    else if (a === "potvrd") uloz(true);
    else if (a === "zavri") { C.uprav = null; C.f = null; C.vloz = null; kresli(); }
    else if (a === "zmaz") {
      if (!lbzPotvrd("Zmazať cestu " + datumSk(C.f.datum) + "? (Dá sa znova vytvoriť tlačidlom Pridať cestu.)")) return;
      rpc("cp_zmaz", { p_id: C.f.id }).then(function (r) { if (!r || !r.ok) { lbzInfo((r && r.text) || "Nezmazané"); return; } C.uprav = null; C.f = null; C.sprava = { typ: "ok", text: "Cesta zmazaná" }; nacitaj(); })
        .catch(function (x) { lbzInfo(chyba(x)); });
    }
    else if (a === "tlac") tlac();
  }
  function zmena(e) {
    if (e.target.id === "cp-osoba") { C.osoba = +e.target.value; C.uprav = null; C.f = null; nacitaj(); return; }
    if (["cp-zac", "cp-kon", "cp-km"].indexOf(e.target.id) > -1 && C.f) { nacitajFormular(); kresli(); }
  }
  function klaves(e) { if (e.target.id === "cp-vloz-txt" && e.key === "Enter") { e.preventDefault(); var b = koren.querySelector('[data-cp="vloz-ok"]'); if (b) b.click(); } }

  // ---------- tlač – hromadný cestovný príkaz za mesiac ----------
  function tlac() {
    var d = C.d; if (!d || !d.cesty) return;
    var o = d.osoba || {}, meno = [o.priezvisko, o.meno, o.titul].filter(Boolean).join(" ") || o.prezyvka || "";
    var cesty = d.cesty, s = d.sadzby || {}, sumStr = 0, sumKm = 0;
    var dt = function (x) { var p = String(x).slice(0, 10).split("-"); return +p[2] + ". " + +p[1] + ". " + p[0]; };
    var kratke = function (m) { return String(m || "").replace(/\s*\(.*\)$/, ""); };
    var zdrz = function (b) { return b.min ? " (" + b.min + " min)" : ""; };
    var hore = cesty.map(function (c) {
      return "<tr><td>" + esc(kratke(c.miesto_zac)) + "<br>" + esc(dt(c.datum)) + "</td><td>" + esc(miesta(c).join(", ")) + "</td><td>" + esc(c.ucel) + "</td><td>" + esc(kratke(c.miesto_kon)) + "<br>" + esc(dt(c.datum)) + "</td></tr>";
    }).join("");
    var dole = cesty.map(function (c) {
      sumStr += Number(c.stravne || 0); sumKm += Number(c.km || 0);
      var b = c.body || [], vid = {}, mm = [];
      b.forEach(function (x) { var m = String(x.miesto || x.adresa || "").trim(); var k = m + "|" + (x.min || ""); if (m && !vid[k]) { vid[k] = 1; mm.push(esc(m) + esc(zdrz(x))); } });
      return '<tr class="cp-t-zac"><td rowspan="3">' + esc(dt(c.datum)) + "</td><td>" + esc(kratke(c.miesto_zac)) + '</td><td class="t-r" rowspan="3">' + esc(hm(c.zaciatok)) + '</td><td class="t-r" rowspan="3">' + esc(hm(c.koniec)) +
        '</td><td class="t-r" rowspan="3">' + eur(c.stravne) + '</td><td class="t-r" rowspan="3">' + eur(c.stravne) + '</td><td rowspan="3">' + esc(kmTxt(c.km)) + (c.poznamka ? "<br>" + esc(c.poznamka) : "") + "</td></tr>" +
        "<tr><td>" + (mm.join(", ") || "–") + "</td></tr><tr><td>" + esc(kratke(c.miesto_kon)) + "</td></tr>";
    }).join("");
    var dopl = [];
    cesty.forEach(function (c) { (c.body || []).forEach(function (x) { if (x.typ === "doplnene") dopl.push(dt(c.datum) + " – " + (x.miesto || "") + zdrz(x)); }); });
    var h = '<div class="k-tlac cp-tlac">' +
      '<table class="cp-hl-t"><tr><th colspan="3" style="text-align:left;font-size:15pt">CESTOVNÝ PRÍKAZ</th><th style="font-size:12pt">Rozvoz buchiet</th></tr>' +
      '<tr><td colspan="2">priezvisko, meno, titul:</td><td colspan="2"><b>' + esc(meno) + "</b></td></tr>" +
      '<tr><td colspan="2">bydlisko:</td><td colspan="2">' + esc(o.bydlisko || "") + "</td></tr></table>" +
      '<table><thead><tr><th>začiatok cesty (miesto, dátum)</th><th>miesto rokovania</th><th>účel cesty</th><th>koniec cesty (miesto, dátum)</th></tr></thead><tbody>' + hore + "</tbody></table>" +
      '<table class="cp-hl-t"><tr><td style="width:30%">spolucestujúci</td><td>–</td></tr><tr><td>dopravný prostriedok</td><td>' + esc((cesty[0] && cesty[0].doprava) || "služobné vozidlo (SMV) FIAT DOBLO AA086TG") + "</td></tr></table>" +
      '<p style="margin:3mm 0 1mm">Hromadný cestovný príkaz na ' + esc(mesiacNazov(C.m)) + " – opakované pracovné cesty (§ 3 ods. 3 zákona č. 283/2002 Z. z.). Zamestnávateľ: " + esc(ZAMESTNAVATEL) + "</p>" +
      '<p style="text-align:right;margin:8mm 0 2mm">.............................................<br>podpis prac. oprávneného na povolenie cesty</p>' +
      '<table style="width:60mm"><tr><th>hod</th><th>eur</th></tr><tr><td>0–5</td><td class="t-r">0,00</td></tr><tr><td>5–12</td><td class="t-r">' + eur(s.s5) + '</td></tr><tr><td>12–18</td><td class="t-r">' + eur(s.s12) + '</td></tr><tr><td>18+</td><td class="t-r">' + eur(s.s18) + "</td></tr></table>" +
      '<h2 style="margin-top:6mm;text-align:center">VYÚČTOVANIE PRACOVNEJ CESTY</h2>' +
      "<table><thead><tr><th>dátum</th><th>odchod / príchod</th><th>začiatok cesty</th><th>koniec cesty</th><th>stravné [EUR]</th><th>spolu</th><th>poznámka</th></tr></thead><tbody>" + dole +
      '</tbody><tfoot><tr><td colspan="5">Vyplatiť:</td><td class="t-r">' + eur(sumStr) + "</td><td>" + esc(kmTxt(Math.round(sumKm * 10) / 10)) + "</td></tr></tfoot></table>" +
      '<h2 style="margin-top:6mm">SPRÁVA Z PRACOVNEJ CESTY (popis účelu a výsledkov PC)</h2><p>Rozvoz objednávok zákazníkom podľa trás (' + cesty.length + " ciest, spolu " + esc(kmTxt(Math.round(sumKm * 10) / 10)) + ")." +
      (dopl.length ? "<br>Ďalšie miesta: " + esc(dopl.join("; ")) : "") + "</p>" +
      '<p style="display:flex;justify-content:space-between;margin:10mm 0 4mm"><span>.............................................<br>dátum a podpis účastníka</span><span>.............................................<br>schválil</span></p>' +
      '<h2 style="margin-top:4mm">ŽIADOSŤ O PREPLATENIE CESTOVNÝCH NÁKLADOV</h2><p>Žiadam o preplatenie cestovných nákladov vo výške <b>' + eur(sumStr) + "</b>.</p>" +
      '<p style="display:flex;justify-content:space-between;margin:10mm 0 0"><span>.............................................<br>dátum a podpis účastníka</span><span>.............................................<br>schválil</span></p></div>';
    var obal = document.getElementById("tlac-oblast");
    if (!obal) { obal = document.createElement("div"); obal.id = "tlac-oblast"; document.body.appendChild(obal); }
    obal.className = ""; obal.innerHTML = h; document.body.classList.add("tlaci");
    var hotovo = function () { document.body.classList.remove("tlaci"); obal.innerHTML = ""; window.removeEventListener("afterprint", hotovo); };
    window.addEventListener("afterprint", hotovo);
    setTimeout(function () { window.print(); setTimeout(hotovo, 1500); }, 80);
  }

  // ---------- karta na Prehľade ----------
  function karta() {
    if (!mozem()) return "";
    if (!C.karta || Date.now() - C.karta.cas > 120000) {
      var bolo = C.karta; C.karta = { cas: Date.now(), d: bolo ? bolo.d : null };
      rpc("cp_na_kontrolu").then(function (d) { var st = JSON.stringify(C.karta.d); C.karta.d = d && d.ok ? d : null; if (JSON.stringify(C.karta.d) !== st) window.dispatchEvent(new Event("lbz-prekresli")); }).catch(function () {});
    }
    var d = C.karta.d; if (!d || !(+d.kontrola || +d.schvalit)) return "";
    return '<section class="card"><h3>🧾 Cestovný príkaz</h3>' +
      (+d.kontrola ? '<p style="margin:0 0 8px">Skontroluj ' + (+d.kontrola === 1 ? "dnešnú cestu" : d.kontrola + " cesty / ciest") + " – doplň miesta, kde si ešte bol, a potvrď.</p>" : "") +
      (+d.schvalit ? '<p style="margin:0 0 8px">Na schválenie: ' + d.schvalit + "</p>" : "") +
      '<button class="btn btn-primary" data-mod="cestovne">🧾 Otvoriť cestovný príkaz</button></section>';
  }

  window.LBZ_CESTY = {
    nastavDb: function (klient, rola) { DB = klient || null; ROLA = klient ? rola : null; C.d = null; C.osoba = null; C.uprav = null; C.f = null; C.karta = null; },
    mozem: mozem,
    karta: karta,
    mount: function (el) {
      koren = el; if (!C.m) C.m = dnes().slice(0, 8) + "01";
      el.addEventListener("click", klik); el.addEventListener("change", zmena); el.addEventListener("keydown", klaves);
      kresli(); nacitaj();
    }
  };
})();
