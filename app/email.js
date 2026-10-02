// LBZ aplikácia – ✉️ Email (Gmail) – zákaznícky servis (eshop@), CEO a IT (ceo@) – s107, vzhľad ako Gmail v0.30.73 (priečinky v menu, potiahnutie do koša)
// Celá schránka cez Edge Function „gmail“ (servisný účet s delegovaním). Odosiela sa len kliknutím človeka.
(function () {
  "use strict";

  var DB = null, ROLA = null, koren = null;
  var S = { stitok: "INBOX", hladaj: "", d: null, dalej: null, nacitavam: false, chyba: null, vlakno: null, nacitavamV: false,
            pis: null, posielam: false, sprava: null, schranka: "", kat: "", obj: {}, navrhujem: false, pocty: null, menu: false };
  var KAT = { objednavka: ["Objednávka", "#2e7d32"], reklamacia: ["Reklamácia", "#c62828"], otazka: ["Otázka", "#1565c0"], faktura: ["Faktúra", "#6d4c41"],
             spolupraca: ["Spolupráca", "#8e24aa"], newsletter: ["Newsletter", "#757575"], spam: ["Spam", "#9e9e9e"], ine: ["Iné", "#9e9e9e"] };
  // [štítok, názov, ikona, ktorý počet ukázať (ako Gmail: pri Doručených neprečítané, inde celkový počet)]
  var STITKY = [["INBOX", "Doručené", "📥", "neprec"], ["UNREAD", "Neprečítané", "✉️", "spolu"], ["STARRED", "S hviezdičkou", "⭐", "spolu"], ["DRAFT", "Koncepty", "📝", "spolu"],
                ["SENT", "Odoslané", "📤", ""], ["", "Všetky", "🗂️", ""], ["SPAM", "Spam", "⚠️", "neprec"], ["TRASH", "Kôš", "🗑️", ""]];
  var FARBY = ["#c0392b", "#8e44ad", "#2471a3", "#138d75", "#b9770e", "#6d4c41", "#ad1457", "#00838f"];
  function farba(t) { var h = 0; t = String(t || ""); for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return FARBY[Math.abs(h) % FARBY.length]; }
  function inicial(od) { var m = meno(od).replace(/[^A-Za-zÀ-ž0-9]/g, ""); return (m.charAt(0) || "?").toUpperCase(); }
  function cislo(n) { return Number(n || 0).toLocaleString("sk-SK"); }
  // počet pri priečinku: pri Doručených a Spame tučne neprečítané / všetky, inde všetky vlákna
  function pocetHtml(s, kratko) {
    var p = S.pocty && S.pocty[s[0]]; if (!p) return "";
    var nep = (s[0] === "INBOX" || s[0] === "SPAM") && p.neprec ? p.neprec : 0;
    if (kratko) return ' <b class="em-poc">' + cislo(nep || p.spolu) + "</b>";
    return (nep ? "<b>" + cislo(nep) + "</b> / " : "") + cislo(p.spolu);
  }
  var RE_OBJ = /\b[Ff][Oo0]\d{6}\b/g;   // čísla objednávok FO003654 (aj fo… / F0…)

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
  function nacitajPocty() {
    volaj({ akcia: "pocty" }).then(function (d) { S.pocty = d.pocty || null; S.schranka = d.schranka || S.schranka; kresli(); }).catch(function () { /* počty sú bonus */ });
  }
  function nacitaj(dalsie) {
    if (!DB) return;
    S.nacitavam = true; S.chyba = null; if (!dalsie) { S.d = null; S.dalej = null; nacitajPocty(); } kresli();
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
        nacitajPocty();
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
  function hlaska() { return S.sprava ? '<div class="em-hlaska em-' + S.sprava.typ + '"><span>' + esc(S.sprava.text) + (S.sprava.spat ? ' <button class="btn ghost em-spat" data-em="vratkos">↩ Späť</button>' : "") + '</span> <button class="em-x" data-em="zavri" aria-label="Zavrieť">×</button></div>' : ""; }

  // ---------- potiahnutie e-mailu prstom do strany = do koša (s „Späť“) ----------
  var tah = null, poTahu = 0;
  function tahStart(e) {
    var r = e.target.closest(".em-pol[data-em-id]"); if (!r || S.vlakno || S.stitok === "TRASH" || e.touches.length !== 1) { tah = null; return; }
    tah = { r: r, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, smer: null };
  }
  function tahPohyb(e) {
    if (!tah) return; var t = e.touches[0], dx = t.clientX - tah.x, dy = t.clientY - tah.y;
    if (!tah.smer) { if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return; tah.smer = Math.abs(dx) > Math.abs(dy) ? "h" : "v"; if (tah.smer === "h") tah.r.parentNode.classList.add("em-tahanie"); }
    if (tah.smer !== "h") return;
    if (e.cancelable) e.preventDefault();
    tah.r.parentNode.style.backgroundPosition = (dx > 0 ? "left 18px" : "right 18px") + " top " + Math.round(tah.r.offsetTop + tah.r.offsetHeight / 2 - 11) + "px";
    tah.dx = dx; tah.r.style.transition = "none"; tah.r.style.transform = "translateX(" + dx + "px)"; tah.r.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / tah.r.offsetWidth));
  }
  function tahKoniec() {
    if (!tah) return; var t = tah; tah = null; if (t.smer !== "h") return; poTahu = Date.now();
    var w = t.r.offsetWidth; t.r.style.transition = "transform .2s, opacity .2s";
    if (Math.abs(t.dx) > w * 0.35) {
      t.r.style.transform = "translateX(" + (t.dx > 0 ? w : -w) + "px)"; t.r.style.opacity = "0";
      setTimeout(function () { doKosa(t.r.getAttribute("data-em-id")); }, 200);
    } else {
      t.r.style.transform = ""; t.r.style.opacity = "";
      setTimeout(function () { if (t.r.parentNode) { t.r.parentNode.classList.remove("em-tahanie"); t.r.parentNode.style.backgroundPosition = ""; } }, 200);
    }
  }
  function doKosa(id) {
    var v = (S.d || []).filter(function (x) { return x.id === id; })[0];
    S.d = (S.d || []).filter(function (x) { return x.id !== id; });
    S.kos = { id: id, v: v, odkial: S.stitok === "SPAM" ? "SPAM" : S.stitok === "STARRED" ? "STARRED" : (S.stitok === "INBOX" || S.stitok === "UNREAD") ? "INBOX" : "" }; S.sprava = { typ: "ok", text: "🗑️ Presunuté do koša.", spat: true }; kresli();
    volaj({ akcia: "upravit", id: id, kos: true }).then(function () { nacitajPocty(); }).catch(function (er) {
      if (v) S.d.unshift(v); S.kos = null; S.sprava = { typ: "chyba", text: "Nepresunuté: " + chyba(er) }; kresli();
    });
  }
  function vratZKosa() {
    var k = S.kos; if (!k) return; S.kos = null; S.sprava = null;
    if (k.v && S.d) { S.d.push(k.v); S.d.sort(function (x, y) { return (Number(y.neprecitane) - Number(x.neprecitane)) || (y.datum - x.datum); }); }
    kresli();
    volaj({ akcia: "upravit", id: k.id, obnov: true, pridaj: k.odkial ? [k.odkial] : [] }).then(function () { nacitajPocty(); }).catch(function (er) { S.sprava = { typ: "chyba", text: "Nevrátené: " + chyba(er) }; nacitaj(); });
  }
  function kresliZoznam() {
    var schr = S.schranka || (ROLA === "zakaznicky_servis" ? "eshop@legendarnebuchty.sk" : "ceo@legendarnebuchty.sk");
    var akt = STITKY.filter(function (s) { return s[0] === S.stitok; })[0] || STITKY[0];
    var h = '<div class="em-lista"><div class="em-menu-w"><button class="em-menu-b" type="button" data-em="menu" aria-haspopup="menu" aria-expanded="' + (S.menu ? "true" : "false") + '">' +
      (S.hladaj ? "🔍 Výsledky" : akt[2] + " " + akt[1] + pocetHtml(akt, true)) + ' <span aria-hidden="true">▾</span></button>' +
      (S.menu ? '<div class="em-menu" role="menu"><div class="em-menu-s">' + esc(schr) + "</div>" + STITKY.map(function (s) {
        return '<button role="menuitem" class="em-mi' + (S.stitok === s[0] && !S.hladaj ? " active" : "") + '" data-em-stitok="' + s[0] + '"><span>' + s[2] + " " + s[1] + '</span><span class="em-mi-p">' + pocetHtml(s) + "</span></button>";
      }).join("") + "</div>" : "") + "</div>" +
      '<form class="em-hladaj" data-em-form="hladaj" role="search"><span class="em-lupa" aria-hidden="true">🔍</span>' +
      '<input id="em-q" type="search" aria-label="Hľadať v pošte ' + esc(schr) + '" placeholder="Hľadať v pošte" value="' + esc(S.hladaj) + '">' +
      (S.hladaj ? '<button class="em-x" type="button" data-em="zrushladaj" aria-label="Zrušiť hľadanie">×</button>' : "") + "</form></div>" + hlaska();
    if (S.chyba) return h + '<p class="em-chyba">' + esc(S.chyba) + "</p>";
    if (!S.d) return h + '<p class="muted">Načítavam…</p>';
    if (!S.d.length) return h + '<div class="em-prazdne">Žiadne e-maily.</div>';
    var pocty = {}; S.d.forEach(function (v) { if (v.kategoria) pocty[v.kategoria] = (pocty[v.kategoria] || 0) + 1; });
    if (Object.keys(pocty).length) h += '<div class="em-filtre em-pas em-kat"><button class="chip' + (!S.kat ? " active" : "") + '" data-em-kat="">Všetko <b class="em-poc">' + S.d.length + "</b></button>" +
      Object.keys(KAT).filter(function (k) { return pocty[k]; }).map(function (k) { return '<button class="chip' + (S.kat === k ? " active" : "") + '" data-em-kat="' + k + '"><i class="em-bod" style="background:' + KAT[k][1] + '"></i>' + KAT[k][0] + ' <b class="em-poc">' + pocty[k] + "</b></button>"; }).join("") + "</div>";
    var lst = S.kat ? S.d.filter(function (v) { return v.kategoria === S.kat; }) : S.d;
    h += '<div class="em-zoznam">' + lst.map(function (v) {
      if (v.koncept) return '<button class="em-pol" data-em-koncept="' + esc(v.id) + '"><span class="em-av" style="background:#9e9e9e">📝</span><span class="em-telo">' +
        '<div class="em-r1"><span class="em-od"><span class="em-kon">Koncept</span> ' + esc(v.komu ? meno(v.komu) : "(bez príjemcu)") + "</span><small>" + esc(kedy(v.datum)) + "</small></div>" +
        '<div class="em-pred">' + esc(v.predmet || "(bez predmetu)") + '</div><div class="em-uk">' + esc(String(v.text || "").slice(0, 140)) + "</div></span></button>";
      return '<button class="em-pol' + (v.neprecitane ? " em-nep" : "") + '" data-em-id="' + esc(v.id) + '">' +
        '<span class="em-av" style="background:' + farba(adresa(v.od)) + '">' + esc(inicial(v.od)) + '</span><span class="em-telo">' +
        '<div class="em-r1"><span class="em-od">' + esc(meno(v.od)) + (v.pocet > 1 ? ' <small>(' + v.pocet + ")</small>" : "") + "</span><small>" + (v.prilohy ? "📎 " : "") + esc(kedy(v.datum)) + "</small></div>" +
        '<div class="em-pred">' + (v.kategoria && KAT[v.kategoria] ? '<span class="em-stit" style="background:' + KAT[v.kategoria][1] + '">' + KAT[v.kategoria][0] + "</span> " : "") +
        ((v.objednavky || []).length ? '<span class="em-objc">📦 ' + esc(v.objednavky.join(", ")) + "</span> " : "") + esc(v.predmet || "(bez predmetu)") + "</div><div class=\"em-uk\">" + esc(v.ukazka || "") + "</div></span></button>";
    }).join("") + "</div>";
    h += '<button class="em-fab" data-em="novy" aria-label="Napísať nový e-mail">✏️ Napísať</button>';
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
    var cisla = []; v.spravy.forEach(function (m) { (String(m.predmet || "") + " " + String(m.text || "")).replace(RE_OBJ, function (c) { c = "FO" + c.slice(2); if (cisla.indexOf(c) < 0) cisla.push(c); }); });
    if (cisla.length) h += '<div class="em-obj">' + cisla.slice(0, 5).map(function (c) {
      var o = S.obj[c];
      return '<div class="em-objk"><button class="chip" data-em-obj="' + c + '">📦 ' + c + "</button>" +
        (o === "…" ? ' <small class="muted">načítavam…</small>' : o ? (o.ok ? ' <span><b>' + esc(o.stav || "?") + "</b>" + (o.termin ? " · rozvoz " + esc(o.termin) : "") + (o.meno ? " · " + esc(o.meno) : "") + (o.doprava ? " · " + esc(o.doprava) : "") + "</span>" : ' <small class="em-chyba">' + esc(o.text) + "</small>") : "") + "</div>";
    }).join("") + "</div>";
    if (!S.pis) h += '<div class="em-tl"><button class="btn" data-em="ainavrh"' + (S.navrhujem ? " disabled" : "") + ">" + (S.navrhujem ? "✨ Píšem návrh…" : "✨ Návrh odpovede (AI)") + "</button>" +
      '<button class="btn ghost" data-em="odpoved">↩ Odpovedať</button><button class="btn ghost" data-em="preposlat">↪ Preposlať</button></div>';
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
    if (Date.now() - poTahu < 450) { e.preventDefault(); return; }   // klik hneď po potiahnutí neotvára e-mail
    if (S.menu && !e.target.closest(".em-menu-w")) { S.menu = false; kresli(); }
    var t = e.target.closest("[data-em],[data-em-id],[data-em-koncept],[data-em-stitok],[data-em-pril],[data-em-zrus],[data-em-kat],[data-em-obj]"); if (!t || !koren.contains(t)) return;
    var d = t.dataset;
    if (S.menu && d.em !== "menu") S.menu = false;
    if (d.emKat !== undefined) { S.kat = d.emKat; kresli(); return; }
    if (d.emObj) { var c = d.emObj; S.obj[c] = "…"; kresli();
      volaj({ akcia: "objednavka", cislo: c }).then(function (o) { S.obj[c] = o; kresli(); }).catch(function (er) { S.obj[c] = { ok: false, text: chyba(er) }; kresli(); }); return; }
    if (d.emId) { S.pis = null; otvor(d.emId); return; }
    if (d.emKoncept) {
      var k = (S.d || []).filter(function (x) { return x.id === d.emKoncept; })[0]; if (!k) return;
      S.vlakno = null; S.sprava = k.prilohy ? { typ: "chyba", text: "Prílohy z konceptu sa sem nenačítajú – pri odoslaní ich pripoj znova." } : null;
      S.pis = { typ: "novy", komu: k.komu || "", kopia: k.kopia || "", predmet: k.predmet || "", text: k.text || "", prilohy: [],
                vlakno: k.vlakno || null, in_reply_to: k.in_reply_to || null, references: k.references || null, koncept: k.id };
      kresli(); return;
    }
    if (d.emStitok !== undefined) { S.stitok = d.emStitok; S.hladaj = ""; S.kat = ""; S.vlakno = null; nacitaj(); return; }
    if (d.emPril) { var x = d.emPril.split(":"), m = S.vlakno.spravy[+x[0]]; stiahni(m.id, m.prilohy[+x[1]]); return; }
    if (d.emZrus) { citajPole(); S.pis.prilohy.splice(+d.emZrus, 1); kresli(); return; }
    switch (d.em) {
      case "spat": S.vlakno = null; S.pis = null; S.sprava = null; kresli(); if (!S.d) nacitaj(); return;
      case "zavri": S.sprava = null; S.kos = null; kresli(); return;
      case "vratkos": vratZKosa(); return;
      case "menu": S.menu = !S.menu; kresli(); return;
      case "zrushladaj": S.hladaj = ""; S.kat = ""; nacitaj(); return;
      case "dalsie": nacitaj(true); return;
      case "novy": S.vlakno = null; novy("novy"); return;
      case "odpoved": novy("odpoved"); return;
      case "ainavrh": if (!S.vlakno || S.navrhujem) return; S.navrhujem = true; S.sprava = null; kresli();
        volaj({ akcia: "ai_navrh", id: S.vlakno.id }).then(function (d) {
          S.navrhujem = false; novy("odpoved"); if (S.pis) { S.pis.text = (d.navrh || "") + S.pis.text; kresli(); }
          S.sprava = { typ: "ok", text: "Návrh od AI je v odpovedi – skontroluj a uprav pred odoslaním." }; kresli();
        }).catch(function (er) { S.navrhujem = false; S.sprava = { typ: "chyba", text: "Návrh sa nepodaril: " + chyba(er) }; kresli(); }); return;
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
    ".em-hladaj{position:relative;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:28px;padding:2px 8px 2px 14px;box-shadow:0 1px 3px rgba(0,0,0,.06)}" +
    ".em-hladaj input{border:0!important;background:transparent!important;padding:10px 6px!important;outline:none}.em-lupa{opacity:.6}" +
    ".em-pas{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding-bottom:2px}.em-pas::-webkit-scrollbar{display:none}.em-pas .chip{white-space:nowrap;flex:0 0 auto}" +
    ".em-poc{font-weight:700;margin-left:2px}.em-st.active .em-poc{color:inherit}.em-bod{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle}" +
    ".em-pol{display:flex!important;gap:12px;align-items:flex-start}.em-telo{flex:1;min-width:0;display:block}" +
    ".em-av{flex:0 0 38px;width:38px;height:38px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;margin-top:2px}" +
    ".em-pol:hover{background:var(--accent-soft)}.em-nep{background:var(--surface)}.em-pol:not(.em-nep){background:color-mix(in srgb,var(--surface) 92%,var(--line))}" +
    ".em-od,.em-pred{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.em-r1 .em-od{min-width:0}" +
    ".em-fab{position:fixed;right:18px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:6;border:0;border-radius:16px;padding:14px 20px;font:inherit;font-weight:700;cursor:pointer;" +
    "background:var(--accent-soft,#f5ecd9);color:inherit;box-shadow:0 3px 10px rgba(0,0,0,.25)}@media (min-width:761px){.em-fab{bottom:28px;right:32px}}" +
    ".em{padding-bottom:80px}" +
    ".em-zoznam{position:relative}.em-zoznam .em-pol{touch-action:pan-y;position:relative;background:var(--surface)}.em-zoznam .em-pol:not(.em-nep){background:color-mix(in srgb,var(--surface) 92%,var(--line))}.em-zoznam.em-tahanie{background:#c62828 url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2'%3E%3Cpath d='M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14'/%3E%3C/svg%3E\") no-repeat;background-position:right 18px top 50%}" +
    ".em-hlaska span{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.em-spat{padding:4px 10px;font-size:.9em}" +
    ".em-lista{display:flex;gap:8px;align-items:center;margin-bottom:8px}.em-lista .em-hladaj{flex:1;margin:0;min-width:0}" +
    ".em-menu-w{position:relative;flex:0 0 auto}.em-menu-b{border:1px solid var(--line);background:var(--surface);color:inherit;border-radius:24px;padding:10px 12px;font:inherit;font-weight:600;cursor:pointer;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.06)}" +
    ".em-menu{position:absolute;left:0;top:calc(100% + 4px);z-index:20;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.18);min-width:250px;padding:6px}" +
    ".em-menu-s{font-size:.8em;color:var(--muted);padding:4px 12px 6px}.em-mi{all:unset;box-sizing:border-box;display:flex;justify-content:space-between;gap:16px;width:100%;padding:9px 12px;border-radius:8px;cursor:pointer}" +
    ".em-mi:hover,.em-mi.active{background:var(--accent-soft)}.em-mi.active{font-weight:700}.em-mi-p{color:var(--muted);white-space:nowrap}.em-mi-p b{color:var(--text,inherit)}" +
    ".em-kat{margin-bottom:6px}.em-kat .chip{padding:3px 10px;font-size:.8em;min-height:0;line-height:1.6}" +
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
    ".em-kon{color:var(--warn);font-weight:700;font-size:.85em}.em-stit{display:inline-block;color:#fff;font-size:.72em;font-weight:700;border-radius:6px;padding:1px 6px;vertical-align:middle}" +
    ".em-objc{font-size:.8em;color:var(--muted)}.em-kat{margin-top:-2px}.em-obj{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:8px 10px;margin-bottom:10px;display:flex;flex-direction:column;gap:6px}.em-objk{font-size:.9em}.em-ok{background:var(--accent-soft)}.em-chyba.em-hlaska{background:var(--warn-soft);color:inherit}.em-x{all:unset;cursor:pointer;font-size:1.1em;padding:0 4px}";
  document.head.appendChild(st);

  window.LBZ_EMAIL = {
    nastavDb: function (klient, rola) { DB = klient || null; ROLA = klient ? rola : null; S.d = null; S.vlakno = null; S.pis = null; S.sprava = null; },
    mozem: mozem,
    mount: function (el) {
      if (koren !== el) {
        koren = el; el.addEventListener("click", klik); el.addEventListener("submit", odoslanieFormu);
        el.addEventListener("touchstart", tahStart, { passive: true }); el.addEventListener("touchmove", tahPohyb, { passive: false });
        el.addEventListener("touchend", tahKoniec); el.addEventListener("touchcancel", tahKoniec);
      }
      if (S.d && !S.nacitavam) kresli(); else nacitaj();
    }
  };
})();
