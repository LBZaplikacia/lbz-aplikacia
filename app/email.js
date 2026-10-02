// LBZ aplikácia – ✉️ Email (Gmail) – zákaznícky servis (eshop@), CEO a IT (ceo@) – s107
// Celá schránka cez Edge Function „gmail“ (servisný účet s delegovaním). Odosiela sa len kliknutím človeka.
(function () {
  "use strict";

  var DB = null, ROLA = null, koren = null;
  var S = { stitok: "INBOX", hladaj: "", d: null, dalej: null, nacitavam: false, chyba: null, vlakno: null, nacitavamV: false,
            pis: null, posielam: false, sprava: null, schranka: "" };
  var STITKY = [["INBOX", "Doručené"], ["UNREAD", "Neprečítané"], ["DRAFT", "Koncepty"], ["STARRED", "S hviezdičkou"], ["SENT", "Odoslané"], ["", "Všetky"], ["TRASH", "Kôš"]];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function chyba(e) { return (e && (e.message || e.text || e.error_description)) || String(e || "Chyba"); }
  function mozem() { return !!DB && ["it", "ceo", "zakaznicky_servis"].indexOf(ROLA) > -1; }
  function meno(od) { var m = String(od || "").match(/^\s*"?([^"<]*)"?\s*</); return (m && m[1].trim()) || String(od || "").replace(/[<>]/g, ""); }
  function adresa(od) { var m = String(od || "").match(/<([^>]+)>/); return m ? m[1] : String(od || "").trim(); }
  function kedy(ms) {
    if (!ms) return ""; var d = new Date(ms), t = new Date();
    if (d.toDateString() === t.toDateString()) return d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
    return d.getDate() + ". " + (d.getMonth() + 1) + "." + (d.getFullYear() !== t.getFullYear() ? " " + d.getFullYear() : "");
  }
  function velkost(b) { b = Number(b || 0); return b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " kB"; }
  function volaj(telo) {
    return DB.functions.invoke("gmail", { body: telo }).then(function (r) {
      var d = r && r.data;
      if (r.error && !d) throw r.error;
      if (!d || !d.ok) throw new Error((d && d.text) || "Chyba Gmailu");
      return d;
    });
  }

  // ---------- načítanie ----------
  function nacitaj(dalsie) {
    if (!DB) return;
    S.nacitavam = true; S.chyba = null; if (!dalsie) { S.d = null; S.dalej = null; } kresli();
    if (S.stitok === "DRAFT" && !S.hladaj) {
      volaj({ akcia: "koncepty" }).then(function (d) {
        S.nacitavam = false; S.schranka = d.schranka || S.schranka; S.d = (d.koncepty || []).map(function (k) { k.koncept = true; return k; }); kresli();
      }).catch(function (e) { S.nacitavam = false; S.chyba = chyba(e); kresli(); });
      return;
    }
    volaj({ akcia: "zoznam", stitok: S.stitok, hladaj: S.hladaj, dalej: dalsie ? S.dalej : null, pocet: 30 }).then(function (d) {
      S.nacitavam = false; S.schranka = d.schranka || S.schranka;
      S.d = dalsie && S.d ? S.d.concat(d.vlakna || []) : (d.vlakna || []); S.dalej = d.dalej; kresli();
    }).catch(function (e) { S.nacitavam = false; S.chyba = chyba(e); kresli(); });
  }
  function otvor(id) {
    S.vlakno = { id: id, spravy: null }; S.nacitavamV = true; S.sprava = null; kresli(); window.scrollTo(0, 0);
    volaj({ akcia: "vlakno", id: id }).then(function (d) {
      S.nacitavamV = false; if (!S.vlakno || S.vlakno.id !== id) return;
      S.vlakno.spravy = d.spravy || []; kresli();
      var nep = S.vlakno.spravy.some(function (m) { return m.stitky.indexOf("UNREAD") > -1; });
      if (nep) volaj({ akcia: "upravit", id: id, odober: ["UNREAD"] }).then(function () {
        (S.d || []).forEach(function (v) { if (v.id === id) v.neprecitane = false; });
      }).catch(function () {});
    }).catch(function (e) { S.nacitavamV = false; S.sprava = { typ: "chyba", text: chyba(e) }; kresli(); });
  }
  function uprav(telo, hlaska) {
    var id = S.vlakno && S.vlakno.id; if (!id) return;
    volaj(Object.assign({ akcia: "upravit", id: id }, telo)).then(function () {
      S.vlakno = null; S.sprava = { typ: "ok", text: hlaska }; nacitaj();
    }).catch(function (e) { S.sprava = { typ: "chyba", text: chyba(e) }; kresli(); });
  }
  function stiahni(spravaId, p) {
    volaj({ akcia: "priloha", sprava: spravaId, id: p.id }).then(function (d) {
      var bin = atob(d.data), u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([u8], { type: p.typ || "application/octet-stream" }));
      var a = document.createElement("a"); a.href = url; a.download = p.nazov || "priloha"; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
    }).catch(function (e) { S.sprava = { typ: "chyba", text: "Príloha: " + chyba(e) }; kresli(); });
  }

  // ---------- písanie ----------
  function novy(typ) {
    var posl = S.vlakno && S.vlakno.spravy && S.vlakno.spravy[S.vlakno.spravy.length - 1];
    var p = { typ: typ, komu: "", kopia: "", predmet: "", text: "", prilohy: [], vlakno: null, in_reply_to: null, references: null, koncept: null };
    if (posl && typ !== "novy") {
      var pred = String(posl.predmet || "");
      var citat = "\n\n" + kedy(posl.datum) + " " + meno(posl.od) + " napísal(a):\n" + String(posl.text || "").split("\n").map(function (r) { return "> " + r; }).join("\n");
      if (typ === "odpoved") {
        var odMna = adresa(posl.od).toLowerCase() === S.schranka.toLowerCase();
        p.komu = odMna ? posl.komu : (adresa(posl.od));
        p.predmet = /^re:/i.test(pred) ? pred : "Re: " + pred;
        p.vlakno = S.vlakno.id; p.in_reply_to = posl.message_id; p.references = ((posl.references || "") + " " + (posl.message_id || "")).trim();
        p.text = citat;
      } else {
        p.predmet = /^fwd?:/i.test(pred) ? pred : "Fwd: " + pred;
        p.text = "\n\n---------- Preposlaná správa ----------\nOd: " + posl.od + "\nPredmet: " + pred + "\n\n" + (posl.text || "");
      }
    }
    S.pis = p; S.sprava = null; kresli();
    var t = koren.querySelector("#em-text"); if (t) { t.focus(); t.setSelectionRange(0, 0); }
  }
  function citajPole() {
    if (!S.pis) return;
    ["komu", "kopia", "predmet", "text"].forEach(function (k) { var el = koren.querySelector("#em-" + k); if (el) S.pis[k] = el.value; });
  }
  function pridajPrilohy(subory) {
    citajPole();
    Array.prototype.forEach.call(subory || [], function (f) {
      if (f.size > 18 * 1048576) { S.sprava = { typ: "chyba", text: f.name + " je väčší ako 18 MB" }; kresli(); return; }
      var r = new FileReader();
      r.onload = function () { S.pis.prilohy.push({ nazov: f.name, typ: f.type || "application/octet-stream", velkost: f.size, data: String(r.result).split(",")[1] }); kresli(); };
      r.readAsDataURL(f);
    });
  }
  function odosli() {
    citajPole(); var p = S.pis; if (!p || S.posielam) return;
    if (!/@/.test(p.komu)) { S.sprava = { typ: "chyba", text: "Doplň adresu príjemcu." }; kresli(); return; }
    S.posielam = true; S.sprava = null; kresli();
    volaj({ akcia: "odosli", komu: p.komu, kopia: p.kopia, predmet: p.predmet, text: p.text, prilohy: p.prilohy,
            vlakno: p.vlakno, in_reply_to: p.in_reply_to, references: p.references }).then(function () {
      S.posielam = false; var bolo = p.vlakno; S.pis = null; S.sprava = { typ: "ok", text: "E-mail odoslaný." };
      if (p.koncept) volaj({ akcia: "koncept_zmaz", id: p.koncept }).then(function () { if (S.stitok === "DRAFT") nacitaj(); }).catch(function () {});
      if (bolo) otvor(bolo); else kresli();
    }).catch(function (e) { S.posielam = false; S.sprava = { typ: "chyba", text: "Neodoslané: " + chyba(e) }; kresli(); });
  }

  function ulozKoncept() {
    citajPole(); var p = S.pis; if (!p) return;
    volaj({ akcia: "koncept_uloz", id: p.koncept, komu: p.komu, kopia: p.kopia, predmet: p.predmet, text: p.text, prilohy: p.prilohy,
            vlakno: p.vlakno, in_reply_to: p.in_reply_to, references: p.references }).then(function (d) {
      p.koncept = d.id; S.sprava = { typ: "ok", text: "Koncept uložený – nájdeš ho v Konceptoch." }; kresli();
    }).catch(function (e) { S.sprava = { typ: "chyba", text: "Koncept sa neuložil: " + chyba(e) }; kresli(); });
  }

  // ---------- kreslenie ----------
  function hlaska() { return S.sprava ? '<div class="em-hlaska em-' + S.sprava.typ + '">' + esc(S.sprava.text) + ' <button class="em-x" data-em="zavri" aria-label="Zavrieť">×</button></div>' : ""; }
  function kresliZoznam() {
    var h = '<div class="head em-head"><h2>✉️ Email</h2><button class="btn" data-em="novy">+ Nový e-mail</button></div>' +
      '<p class="muted em-schr">' + esc(S.schranka || (ROLA === "zakaznicky_servis" ? "eshop@legendarnebuchty.sk" : "ceo@legendarnebuchty.sk")) + "</p>" + hlaska();
    h += '<div class="em-filtre">' + STITKY.map(function (s) { return '<button class="chip' + (S.stitok === s[0] && !S.hladaj ? " active" : "") + '" data-em-stitok="' + s[0] + '">' + s[1] + "</button>"; }).join("") + "</div>";
    h += '<form class="em-hladaj" data-em-form="hladaj"><input id="em-q" type="search" placeholder="Hľadať (meno, e-mail, slovo, číslo objednávky…)" value="' + esc(S.hladaj) + '"><button class="btn ghost" type="submit">Hľadať</button></form>';
    if (S.chyba) return h + '<p class="em-chyba">' + esc(S.chyba) + "</p>";
    if (!S.d) return h + '<p class="muted">Načítavam…</p>';
    if (!S.d.length) return h + '<div class="em-prazdne">Žiadne e-maily.</div>';
    h += '<div class="em-zoznam">' + S.d.map(function (v) {
      if (v.koncept) return '<button class="em-pol" data-em-koncept="' + esc(v.id) + '">' +
        '<div class="em-r1"><span class="em-od"><span class="em-kon">Koncept</span> ' + esc(v.komu ? meno(v.komu) : "(bez príjemcu)") + "</span><small>" + esc(kedy(v.datum)) + "</small></div>" +
        '<div class="em-pred">' + esc(v.predmet || "(bez predmetu)") + '</div><div class="em-uk">' + esc(String(v.text || "").slice(0, 140)) + "</div></button>";
      return '<button class="em-pol' + (v.neprecitane ? " em-nep" : "") + '" data-em-id="' + esc(v.id) + '">' +
        '<div class="em-r1"><span class="em-od">' + esc(meno(v.od)) + (v.pocet > 1 ? ' <small>(' + v.pocet + ")</small>" : "") + "</span><small>" + (v.prilohy ? "📎 " : "") + esc(kedy(v.datum)) + "</small></div>" +
        '<div class="em-pred">' + esc(v.predmet || "(bez predmetu)") + "</div><div class=\"em-uk\">" + esc(v.ukazka || "") + "</div></button>";
    }).join("") + "</div>";
    if (S.dalej) h += '<div class="em-tl"><button class="btn ghost" data-em="dalsie"' + (S.nacitavam ? " disabled" : "") + ">" + (S.nacitavam ? "Načítavam…" : "Načítať staršie") + "</button></div>";
    return h;
  }
  function kresliVlakno() {
    var v = S.vlakno;
    var h = '<div class="em-hlava"><button class="btn ghost" data-em="spat">← Späť</button><span class="em-akcie">' +
      '<button class="btn ghost" data-em="archiv" title="Archivovať">🗄️</button><button class="btn ghost" data-em="neprec" title="Označiť ako neprečítané">✉️</button>' +
      '<button class="btn ghost" data-em="kos" title="Do koša">🗑️</button></span></div>' + hlaska();
    if (!v.spravy) return h + '<p class="muted">Načítavam…</p>';
    h += '<h3 class="em-nadpis">' + esc((v.spravy[0] && v.spravy[0].predmet) || "(bez predmetu)") + "</h3>";
    h += v.spravy.map(function (m, i) {
      var telo = m.html
        ? '<iframe class="em-html" sandbox="allow-popups allow-popups-to-escape-sandbox" data-em-i="' + i + '"></iframe>'
        : '<div class="em-text">' + esc(m.text || "") + "</div>";
      return '<div class="em-msg"><div class="em-r1"><span><b>' + esc(meno(m.od)) + '</b> <small>&lt;' + esc(adresa(m.od)) + "&gt;</small></span><small>" + esc(kedy(m.datum)) + "</small></div>" +
        '<small class="muted">Komu: ' + esc(m.komu) + (m.kopia ? " · Kópia: " + esc(m.kopia) : "") + "</small>" + telo +
        (m.prilohy.length ? '<div class="em-pril">' + m.prilohy.map(function (p, j) { return '<button class="chip" data-em-pril="' + i + ":" + j + '">📎 ' + esc(p.nazov) + " · " + velkost(p.velkost) + "</button>"; }).join("") + "</div>" : "") + "</div>";
    }).join("");
    if (!S.pis) h += '<div class="em-tl"><button class="btn" data-em="odpoved">↩ Odpovedať</button><button class="btn ghost" data-em="preposlat">↪ Preposlať</button></div>';
    return h;
  }
  function kresliPis() {
    var p = S.pis;
    return '<div class="em-pis"><h3>' + (p.typ === "odpoved" ? "Odpoveď" : p.typ === "preposlat" ? "Preposlať" : "Nový e-mail") + "</h3>" +
      '<label>Komu<input id="em-komu" type="text" value="' + esc(p.komu) + '" placeholder="adresa@priklad.sk"></label>' +
      '<label>Kópia<input id="em-kopia" type="text" value="' + esc(p.kopia) + '"></label>' +
      '<label>Predmet<input id="em-predmet" type="text" value="' + esc(p.predmet) + '"></label>' +
      '<textarea id="em-text" rows="10">' + esc(p.text) + "</textarea>" +
      (p.prilohy.length ? '<div class="em-pril">' + p.prilohy.map(function (x, i) { return '<span class="chip">📎 ' + esc(x.nazov) + ' <button class="em-x" data-em-zrus="' + i + '" aria-label="Odstrániť">×</button></span>'; }).join("") + "</div>" : "") +
      '<div class="em-tl"><button class="btn" data-em="odosli"' + (S.posielam ? " disabled" : "") + ">" + (S.posielam ? "Odosielam…" : "Odoslať") + "</button>" +
      '<button class="btn ghost" data-em="koncept">💾 Uložiť koncept</button>' +
      '<label class="btn ghost em-file">📎 Príloha<input id="em-subor" type="file" multiple hidden></label>' +
      '<button class="btn ghost" data-em="zrusit">Zrušiť</button></div>' +
      '<p class="muted em-pozn">Odošle sa zo schránky ' + esc(S.schranka) + ".</p></div>";
  }
  function kresli() {
    if (!koren) return;
    if (!mozem()) { koren.innerHTML = '<div class="em"><p class="muted">Karta Email je pre zákaznícky servis, CEO a IT.</p></div>'; return; }
    var obsah = S.pis && !S.vlakno ? hlaska() + kresliPis() : S.vlakno ? kresliVlakno() + (S.pis ? kresliPis() : "") : kresliZoznam();
    koren.innerHTML = '<div class="em">' + obsah + "</div>";
    // HTML e-maily v izolovanom rámčeku
    if (S.vlakno && S.vlakno.spravy) koren.querySelectorAll("iframe[data-em-i]").forEach(function (f) {
      var m = S.vlakno.spravy[+f.dataset.emI];
      f.srcdoc = '<base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;margin:8px;word-wrap:break-word}img{max-width:100%;height:auto}</style>' + m.html;
      f.onload = function () { try { f.style.height = Math.min(f.contentDocument.body.scrollHeight + 24, 1600) + "px"; } catch (_) { f.style.height = "500px"; } };
    });
    var sub = koren.querySelector("#em-subor"); if (sub) sub.onchange = function () { pridajPrilohy(sub.files); };
  }

  // ---------- udalosti ----------
  function klik(e) {
    var t = e.target.closest("[data-em],[data-em-id],[data-em-koncept],[data-em-stitok],[data-em-pril],[data-em-zrus]"); if (!t || !koren.contains(t)) return;
    var d = t.dataset;
    if (d.emId) { S.pis = null; otvor(d.emId); return; }
    if (d.emKoncept) {
      var k = (S.d || []).filter(function (x) { return x.id === d.emKoncept; })[0]; if (!k) return;
      S.vlakno = null; S.sprava = k.prilohy ? { typ: "chyba", text: "Prílohy z konceptu sa sem nenačítajú – pri odoslaní ich pripoj znova." } : null;
      S.pis = { typ: "novy", komu: k.komu || "", kopia: k.kopia || "", predmet: k.predmet || "", text: k.text || "", prilohy: [],
                vlakno: k.vlakno || null, in_reply_to: k.in_reply_to || null, references: k.references || null, koncept: k.id };
      kresli(); return;
    }
    if (d.emStitok !== undefined) { S.stitok = d.emStitok; S.hladaj = ""; S.vlakno = null; nacitaj(); return; }
    if (d.emPril) { var x = d.emPril.split(":"), m = S.vlakno.spravy[+x[0]]; stiahni(m.id, m.prilohy[+x[1]]); return; }
    if (d.emZrus) { citajPole(); S.pis.prilohy.splice(+d.emZrus, 1); kresli(); return; }
    switch (d.em) {
      case "spat": S.vlakno = null; S.pis = null; S.sprava = null; kresli(); if (!S.d) nacitaj(); return;
      case "zavri": S.sprava = null; kresli(); return;
      case "dalsie": nacitaj(true); return;
      case "novy": S.vlakno = null; novy("novy"); return;
      case "odpoved": novy("odpoved"); return;
      case "preposlat": novy("preposlat"); return;
      case "zrusit": S.pis = null; S.sprava = null; kresli(); return;
      case "odosli": odosli(); return;
      case "koncept": ulozKoncept(); return;
      case "archiv": uprav({ odober: ["INBOX"] }, "Archivované."); return;
      case "neprec": uprav({ pridaj: ["UNREAD"] }, "Označené ako neprečítané."); return;
      case "kos": uprav({ kos: true }, "Presunuté do koša."); return;
    }
  }
  function odoslanieFormu(e) {
    var f = e.target.closest("[data-em-form]"); if (!f) return;
    e.preventDefault(); var q = koren.querySelector("#em-q"); S.hladaj = q ? q.value.trim() : ""; S.vlakno = null; nacitaj();
  }

  var st = document.createElement("style");
  st.textContent =
    ".em-head{display:flex;justify-content:space-between;align-items:center;gap:8px}.em-schr{margin:0 0 8px;font-size:.85em}" +
    ".em-filtre{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.em-hladaj{display:flex;gap:6px;margin-bottom:10px}" +
    ".em-hladaj input,.em-pis input,.em-pis textarea{flex:1;width:100%;box-sizing:border-box;font:inherit;padding:9px 10px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:inherit}" +
    ".em-zoznam{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}" +
    ".em-pol{all:unset;cursor:pointer;display:block;padding:9px 12px;border-bottom:1px solid var(--line)}.em-pol:last-child{border-bottom:0}.em-pol:focus-visible{outline:2px solid var(--accent)}" +
    ".em-nep .em-od,.em-nep .em-pred{font-weight:700}.em-r1{display:flex;justify-content:space-between;gap:8px;align-items:baseline}.em-r1 small{color:var(--muted);font-size:.8em;white-space:nowrap}" +
    ".em-pred{margin-top:2px}.em-uk{color:var(--muted);font-size:.86em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".em-prazdne{padding:30px;text-align:center;color:var(--muted)}.em-chyba{color:var(--bad)}.em-tl{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}" +
    ".em-hlava{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.em-akcie{display:flex;gap:4px}.em-nadpis{margin:6px 0 10px}" +
    ".em-msg{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:10px}" +
    ".em-text{white-space:pre-wrap;margin-top:8px;overflow-wrap:anywhere}.em-html{width:100%;border:0;margin-top:8px;min-height:120px;background:#fff;border-radius:8px}" +
    ".em-pril{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.em-pis{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px}" +
    ".em-pis h3{margin:0 0 8px}.em-pis label{display:block;font-size:.85em;color:var(--muted);margin-bottom:6px}.em-pis label input{margin-top:2px;color:var(--text,inherit)}" +
    ".em-file{cursor:pointer}.em-pozn{font-size:.82em}.em-hlaska{padding:8px 10px;border-radius:8px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center}" +
    ".em-kon{color:var(--warn);font-weight:700;font-size:.85em}.em-ok{background:var(--accent-soft)}.em-chyba.em-hlaska{background:var(--warn-soft);color:inherit}.em-x{all:unset;cursor:pointer;font-size:1.1em;padding:0 4px}";
  document.head.appendChild(st);

  window.LBZ_EMAIL = {
    nastavDb: function (klient, rola) { DB = klient || null; ROLA = klient ? rola : null; S.d = null; S.vlakno = null; S.pis = null; S.sprava = null; },
    mozem: mozem,
    mount: function (el) {
      if (koren !== el) { koren = el; el.addEventListener("click", klik); el.addEventListener("submit", odoslanieFormu); }
      if (S.d && !S.nacitavam) kresli(); else nacitaj();
    }
  };
})();
