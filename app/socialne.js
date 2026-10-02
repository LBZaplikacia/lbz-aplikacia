// LBZ aplikácia – 💬 Sociálne siete (FB + IG komentáre a správy) – zákaznícky servis, CEO, IT – s99–s101
// Dáta sťahuje Edge Function „meta“ každých 15 min, AI (Gemini) pripraví návrh. Tu ich Natália vybaví:
// upraví návrh a odošle jedným tlačidlom, alebo preskočí / označí ako vybavené mimo appky.
(function () {
  "use strict";

  var DB = null, ROLA = null, koren = null;
  var S = { filter: "caka", d: null, nacitavam: false, chyba: null, detail: null, vlakno: null, posielam: false, sprava: null };
  var FILTRE = [["caka", "Čaká na teba", "caka_natalia"], ["ai", "Návrhy AI", "ai_navrh"], ["nove", "Nové", "nove"], ["hotove", "Vybavené", null]];
  var STAV = { nove: "Nové", ai_navrh: "Návrh AI", caka_natalia: "Čaká na teba", odoslane: "Odoslané", vybavene: "Vybavené", preskocit: "Preskočené" };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function chyba(e) { return (e && (e.message || e.text || e.error_description)) || String(e || "Chyba"); }
  function rpc(f, a) { return DB.rpc(f, a || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function mozem() { return !!DB && ["it", "ceo", "zakaznicky_servis"].indexOf(ROLA) > -1; }
  function kedy(t) {
    if (!t) return "";
    var d = new Date(t), teraz = new Date(), min = Math.round((teraz - d) / 6e4);
    if (min < 60) return "pred " + Math.max(min, 1) + " min";
    if (min < 24 * 60) return "pred " + Math.round(min / 60) + " h";
    return d.getDate() + ". " + (d.getMonth() + 1) + ". " + (d.getFullYear() !== teraz.getFullYear() ? d.getFullYear() + " " : "") +
      d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
  }
  function kanal(p) { return (p.platforma === "ig" ? "Instagram" : "Facebook") + " · " + (p.typ === "sprava" ? "správa" : "komentár"); }
  function ikona(p) { return p.typ === "sprava" ? "✉️" : "💬"; }
  function bezRobota(t) { return String(t || "").replace(/\s*🤖\s*$/, "").trim(); }
  function najdi(id) { return ((S.d && S.d.polozky) || []).filter(function (x) { return x.id === id; })[0] || null; }

  // ---------- načítanie ----------
  function nacitaj() {
    if (!DB) return;
    S.nacitavam = true; S.chyba = null; kresli();
    rpc("meta_zoznam", { p_filter: S.filter }).then(function (d) {
      S.nacitavam = false;
      if (!d || !d.ok) { S.chyba = (d && d.text) || "Nepodarilo sa načítať"; S.d = null; }
      else S.d = d;
      kresli();
    }).catch(function (e) { S.nacitavam = false; S.chyba = chyba(e); kresli(); });
  }
  function otvor(id) {
    var p = najdi(id); if (!p) return;
    S.detail = p; S.vlakno = null; S.sprava = null; kresli(); window.scrollTo(0, 0);
    rpc("meta_vlakno", { p_vlakno: p.vlakno_id }).then(function (d) { if (S.detail && S.detail.id === id) { S.vlakno = (d && d.spravy) || []; kresli(); } })
      .catch(function () { S.vlakno = []; kresli(); });
  }

  // ---------- akcie ----------
  function odosli() {
    var p = S.detail, pole = koren.querySelector("#soc-text"); if (!p || !pole || S.posielam) return;
    var text = pole.value.trim();
    if (!text) { S.sprava = { typ: "chyba", text: "Napíš text odpovede." }; kresli(); return; }
    S.posielam = true; S.sprava = null; kresli();
    DB.functions.invoke("meta", { body: { akcia: "odosli", id: p.id, text: text } }).then(function (r) {
      S.posielam = false;
      var d = r && r.data;
      if (r.error || !d || !d.ok) { S.sprava = { typ: "chyba", text: "Neodoslané: " + ((d && d.text) || chyba(r.error)) }; kresli(); return; }
      S.detail = null; S.sprava = { typ: "ok", text: "Odpoveď odoslaná na " + (p.platforma === "ig" ? "Instagram" : "Facebook") + "." };
      nacitaj();
    }).catch(function (e) { S.posielam = false; S.sprava = { typ: "chyba", text: "Neodoslané: " + chyba(e) }; kresli(); });
  }
  function oznac(stav) {
    var p = S.detail; if (!p) return;
    rpc("meta_oznac", { p_id: p.id, p_stav: stav }).then(function (d) {
      if (!d || !d.ok) { S.sprava = { typ: "chyba", text: (d && d.text) || "Nepodarilo sa" }; kresli(); return; }
      S.detail = null; S.sprava = { typ: "ok", text: stav === "preskocit" ? "Preskočené." : stav === "vybavene" ? "Označené ako vybavené." : "Vrátené medzi čakajúce." };
      nacitaj();
    }).catch(function (e) { S.sprava = { typ: "chyba", text: chyba(e) }; kresli(); });
  }

  // ---------- kreslenie ----------
  function hlaska() {
    if (!S.sprava) return "";
    return '<div class="soc-hlaska soc-' + S.sprava.typ + '">' + esc(S.sprava.text) + ' <button class="soc-x" data-soc="zavri" aria-label="Zavrieť">×</button></div>';
  }
  function kresliZoznam() {
    var pocty = (S.d && S.d.pocty) || {};
    var h = '<div class="head"><h2>💬 Sociálne siete</h2><p class="muted">Komentáre a správy z FB a IG. Nové sa sťahujú každých 15 minút, AI ku každej pripraví návrh.</p></div>' + hlaska();
    h += '<div class="soc-filtre">' + FILTRE.map(function (f) {
      var n = f[2] ? (pocty[f[2]] || 0) : 0;
      return '<button class="chip' + (S.filter === f[0] ? " active" : "") + '" data-soc-filter="' + f[0] + '">' + esc(f[1]) + (n ? ' <span class="soc-n">' + n + "</span>" : "") + "</button>";
    }).join("") + '<button class="chip" data-soc="obnov" title="Obnoviť">↻</button></div>';
    if (S.nacitavam && !S.d) return h + '<p class="muted">Načítavam…</p>';
    if (S.chyba) return h + '<p class="soc-chyba">' + esc(S.chyba) + "</p>";
    var pol = (S.d && S.d.polozky) || [];
    if (!pol.length) return h + '<div class="soc-prazdne">' + (S.filter === "caka" ? "Nič na teba nečaká 🎉" : "Tu zatiaľ nič nie je.") + "</div>";
    h += '<div class="soc-zoznam">' + pol.map(function (p) {
      return '<button class="soc-pol soc-s-' + esc(p.stav) + '" data-soc-id="' + esc(p.id) + '">' +
        '<div class="soc-r1"><span>' + ikona(p) + " <b>" + esc(p.autor || "Neznámy") + "</b></span><small>" + esc(kedy(p.vytvorene)) + "</small></div>" +
        '<div class="soc-txt">' + esc(p.text || "(príloha bez textu)") + "</div>" +
        '<div class="soc-r3"><small>' + esc(kanal(p)) + (p.ai_kategoria ? " · " + esc(p.ai_kategoria) : "") + "</small>" +
        (S.filter === "hotove" ? '<small class="soc-stav">' + esc(STAV[p.stav] || p.stav) + (p.odpovedal ? " · " + esc(p.odpovedal) : "") + "</small>" : "") + "</div></button>";
    }).join("") + "</div>";
    return h;
  }
  function kresliDetail() {
    var p = S.detail;
    var h = '<div class="soc-hlava"><button class="btn ghost" data-soc="spat">← Späť</button><span class="soc-stav">' + esc(STAV[p.stav] || p.stav) + "</span></div>" + hlaska();
    h += '<div class="soc-karta"><div class="soc-r1"><span>' + ikona(p) + " <b>" + esc(p.autor || "Neznámy") + "</b></span><small>" + esc(kedy(p.vytvorene)) + "</small></div>" +
      '<small class="muted">' + esc(kanal(p)) + (p.ai_kategoria ? " · AI: " + esc(p.ai_kategoria) : "") + "</small>";
    if (p.prispevok_text || p.prispevok_link) h += '<div class="soc-post">Príspevok: ' + esc(p.prispevok_text || "") + (p.prispevok_link ? ' <a href="' + esc(p.prispevok_link) + '" target="_blank" rel="noopener">otvoriť ↗</a>' : "") + "</div>";
    // vlákno / konverzácia
    if (S.vlakno === null) h += '<p class="muted">Načítavam konverzáciu…</p>';
    else {
      var sp = S.vlakno.length ? S.vlakno : [{ od_nas: false, autor: p.autor, text: p.text, vytvorene: p.vytvorene }];
      if (p.typ === "komentar") sp = sp.filter(function (x) { return x.id === p.id || x.rodic_id === p.id || x.id === (p.rodic_id || "") || (p.rodic_id && x.rodic_id === p.rodic_id); });
      if (!sp.length) sp = [{ od_nas: false, autor: p.autor, text: p.text, vytvorene: p.vytvorene }];
      h += '<div class="soc-vlakno">' + sp.map(function (x) {
        return '<div class="soc-bub' + (x.od_nas ? " soc-my" : "") + '"><small>' + esc(x.od_nas ? "Legendárne buchty" : (x.autor || "Zákazník")) + " · " + esc(kedy(x.vytvorene)) + "</small>" + esc(x.text || "(príloha)") + "</div>";
      }).join("") + "</div>";
    }
    h += "</div>";
    if (["odoslane", "vybavene", "preskocit"].indexOf(p.stav) > -1) {
      if (p.odpoved_text) h += '<div class="soc-karta"><small class="muted">Odpoveď (' + esc(p.odpovedal || "") + ", " + esc(kedy(p.odpovedane_kedy)) + ")</small><div>" + esc(p.odpoved_text) + "</div></div>";
      h += '<div class="soc-tl"><button class="btn ghost" data-soc="vrat">Vrátiť medzi čakajúce</button></div>';
      return h;
    }
    var navrh = bezRobota(p.ai_navrh);
    if (p.typ === "sprava" && (Date.now() - new Date(p.vytvorene).getTime()) > 7 * 864e5) {
      return h + '<p class="soc-upoz">Správa je staršia ako 7 dní – Meta už nedovolí odpovedať z appky. Ak treba, odpíš v Business Suite a potom označ Vybavené inde.</p>' +
        '<div class="soc-tl"><a class="btn" href="https://business.facebook.com/latest/inbox/all" target="_blank" rel="noopener">Otvoriť v Business Suite ↗</a>' +
        '<button class="btn ghost" data-soc="vybavene">Vybavené inde</button><button class="btn ghost" data-soc="preskocit">Preskočiť</button></div>';
    }
    h += '<label class="soc-lbl" for="soc-text">' + (navrh ? "Návrh odpovede od AI – uprav podľa seba" : "Tvoja odpoveď") + "</label>" +
      '<textarea id="soc-text" rows="5" placeholder="Napíš odpoveď…">' + esc(navrh) + "</textarea>" +
      '<div class="soc-tl"><button class="btn" data-soc="odosli"' + (S.posielam ? " disabled" : "") + ">" + (S.posielam ? "Odosielam…" : "Odoslať na " + (p.platforma === "ig" ? "Instagram" : "Facebook")) + "</button>" +
      '<button class="btn ghost" data-soc="vybavene">Vybavené inde</button><button class="btn ghost" data-soc="preskocit">Preskočiť</button></div>' +
      '<p class="muted soc-pozn">Odpoveď odoslaná odtiaľto ide pod menom stránky Legendárne buchty. Pri komentári sa zverejní pod komentár.</p>';
    return h;
  }
  function kresli() {
    if (!koren) return;
    if (!mozem()) { koren.innerHTML = '<div class="soc"><p class="muted">Táto karta je pre zákaznícky servis, CEO a IT.</p></div>'; return; }
    koren.innerHTML = '<div class="soc">' + (S.detail ? kresliDetail() : kresliZoznam()) + "</div>";
  }

  // ---------- udalosti ----------
  function klik(e) {
    var t = e.target.closest("[data-soc],[data-soc-id],[data-soc-filter]"); if (!t || !koren.contains(t)) return;
    var d = t.dataset;
    if (d.socId) { otvor(d.socId); return; }
    if (d.socFilter) { S.filter = d.socFilter; S.d = null; S.sprava = null; nacitaj(); return; }
    switch (d.soc) {
      case "spat": S.detail = null; S.sprava = null; kresli(); return;
      case "zavri": S.sprava = null; kresli(); return;
      case "obnov": nacitaj(); return;
      case "odosli": odosli(); return;
      case "preskocit": oznac("preskocit"); return;
      case "vybavene": oznac("vybavene"); return;
      case "vrat": oznac("caka_natalia"); return;
    }
  }

  var st = document.createElement("style");
  st.textContent =
    ".soc .head{margin-bottom:6px}.soc-filtre{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 12px}.soc-n{display:inline-block;min-width:18px;padding:0 5px;border-radius:9px;background:var(--warn);color:#fff;font-size:.78em;text-align:center}" +
    ".soc-zoznam{display:flex;flex-direction:column;gap:8px}.soc-pol{all:unset;cursor:pointer;display:block;background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:12px;padding:10px 12px}" +
    ".soc-pol:focus-visible{outline:2px solid var(--accent)}.soc-s-caka_natalia{border-left-color:var(--warn)}.soc-s-ai_navrh{border-left-color:#2e7d32}.soc-s-nove{border-left-color:var(--accent)}" +
    ".soc-r1,.soc-r3{display:flex;justify-content:space-between;gap:8px;align-items:baseline}.soc-r1 small,.soc-r3 small{color:var(--muted);font-size:.8em}" +
    ".soc-txt{margin:4px 0;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.soc-stav{font-size:.82em;color:var(--muted)}" +
    ".soc-prazdne{padding:30px 10px;text-align:center;color:var(--muted)}.soc-chyba{color:var(--bad)}" +
    ".soc-hlava{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.soc-karta{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:10px}" +
    ".soc-post{margin-top:6px;padding:6px 8px;border-radius:8px;background:var(--accent-soft);font-size:.86em}" +
    ".soc-vlakno{display:flex;flex-direction:column;gap:6px;margin-top:10px}.soc-bub{max-width:85%;padding:7px 10px;border-radius:12px;background:var(--accent-soft);white-space:pre-wrap}" +
    ".soc-bub small{display:block;color:var(--muted);font-size:.75em;margin-bottom:2px}.soc-bub.soc-my{align-self:flex-end;background:var(--surface);border:1px solid var(--line)}" +
    ".soc-lbl{display:block;font-weight:600;margin:8px 0 4px}.soc textarea{width:100%;box-sizing:border-box;font:inherit;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:inherit}" +
    ".soc-tl{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.soc-pozn{font-size:.82em}.soc-upoz{background:var(--warn-soft);padding:8px 10px;border-radius:8px;font-size:.88em}" +
    ".soc-hlaska{padding:8px 10px;border-radius:8px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center}.soc-ok{background:var(--accent-soft)}.soc-chyba.soc-hlaska{background:var(--warn-soft);color:inherit}" +
    ".soc-x{all:unset;cursor:pointer;font-size:1.2em;padding:0 4px}";
  document.head.appendChild(st);

  window.LBZ_SOCIALNE = {
    nastavDb: function (klient, rola) { DB = klient || null; ROLA = klient ? rola : null; S.d = null; S.detail = null; S.sprava = null; },
    mozem: mozem,
    // počet čakajúcich pre kartu na Prehľade / odznak
    pocetCaka: function () { return mozem() ? rpc("meta_prehlad").then(function (d) { return (d && d.ok && d.pocty && d.pocty.caka_natalia) || 0; }) : Promise.resolve(0); },
    mount: function (el) {
      if (koren !== el) { koren = el; el.addEventListener("click", klik); }
      if (S.d && !S.nacitavam) kresli(); else nacitaj();
    }
  };
})();
