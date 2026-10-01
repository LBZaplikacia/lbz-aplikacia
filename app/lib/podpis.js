// LBZ – podpis prstom a podpísané PDF (cestovný príkaz, dochádzka, dovolenkový lístok, prevzatie hotovosti)
// lbzPodpis.podpisat({db, dokument, typ, rola, osoba, nazov, subor, vyhlasenie, obsah, html(podpisy)}) → Promise
//   1. okno na podpis prstom, 2. záznam podpisu v databáze (kto, kedy, odtlačok obsahu),
//   3. PDF so všetkými podpismi → úložisko zamestnanci/<osoba>/podpisane/… (nové verzie sa neprepisujú) + SHA-256 súboru.
(function () {
  "use strict";
  var H2C = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
  var JSPDF = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
  var nac = {};
  function skript(src, je) {
    if (je()) return Promise.resolve();
    if (nac[src]) return nac[src];
    nac[src] = new Promise(function (ok, zle) {
      var s = document.createElement("script"); s.src = src;
      s.onload = function () { ok(); };
      s.onerror = function () { nac[src] = null; zle(new Error("Knižnica na PDF sa nenačítala – skontroluj signál")); };
      document.head.appendChild(s);
    });
    return nac[src];
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function cas(t) { var d = new Date(t); return d.toLocaleDateString("sk-SK") + " " + d.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" }); }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }
  function sha256(data) {
    var p = typeof data === "string" ? Promise.resolve(new TextEncoder().encode(data)) : data.arrayBuffer();
    return p.then(function (b) { return crypto.subtle.digest("SHA-256", b); }).then(hex);
  }

  // ---------- okno na podpis prstom ----------
  function dialog(o) {
    return new Promise(function (ok, zle) {
      var w = document.createElement("div");
      w.className = "pdp-okno"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true");
      w.innerHTML = '<div class="pdp-box"><h3>✍️ ' + esc(o.titul || "Podpis") + "</h3>" +
        (o.vyhlasenie ? '<p class="pdp-vyhl">' + esc(o.vyhlasenie) + "</p>" : "") +
        '<div class="pdp-plocha"><canvas></canvas><span class="pdp-ciara">podpíšte sa prstom sem</span></div>' +
        '<p class="pdp-info">Podpis sa uloží s vaším menom, dátumom a časom a pripojí sa k PDF dokumentu.</p>' +
        '<div class="pdp-tl"><button type="button" class="btn" data-pdp="vymaz">Vymazať</button><button type="button" class="btn" data-pdp="zrus">Zrušiť</button>' +
        '<button type="button" class="btn btn-primary" data-pdp="ok" disabled>✅ Podpísať</button></div></div>';
      document.body.appendChild(w);
      var c = w.querySelector("canvas"), ctx = c.getContext("2d"), body = 0, kreslim = false, posl = null;
      var dpr = Math.max(1, window.devicePixelRatio || 1);
      function velkost() {
        var r = c.parentNode.getBoundingClientRect();
        c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1a237e";
        body = 0; tl();
      }
      function tl() { w.querySelector('[data-pdp="ok"]').disabled = body < 12; w.querySelector(".pdp-ciara").style.opacity = body ? "0" : "1"; }
      function bod(e) { var r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
      c.addEventListener("pointerdown", function (e) { e.preventDefault(); kreslim = true; posl = bod(e); c.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.arc(posl.x, posl.y, 1.2, 0, 7); ctx.fillStyle = "#1a237e"; ctx.fill(); body++; });
      c.addEventListener("pointermove", function (e) {
        if (!kreslim) return; e.preventDefault();
        var p = bod(e); ctx.beginPath(); ctx.moveTo(posl.x, posl.y); ctx.lineTo(p.x, p.y); ctx.stroke(); posl = p; body++; if (body === 12) tl();
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach(function (n) { c.addEventListener(n, function () { kreslim = false; tl(); }); });
      function zavri() { window.removeEventListener("resize", velkost); w.remove(); document.body.classList.remove("pdp-otvorene"); }
      w.addEventListener("click", function (e) {
        var b = e.target.closest("[data-pdp]"); if (!b) return;
        if (b.dataset.pdp === "vymaz") { ctx.clearRect(0, 0, c.width, c.height); body = 0; tl(); }
        else if (b.dataset.pdp === "zrus") { zavri(); zle(new Error("zrusene")); }
        else if (b.dataset.pdp === "ok") {
          // orezanie na podpis (menší obrázok), biele pozadie nie – priehľadný PNG
          var img = ctx.getImageData(0, 0, c.width, c.height).data, minX = c.width, minY = c.height, maxX = 0, maxY = 0;
          for (var y = 0; y < c.height; y += 2) for (var x = 0; x < c.width; x += 2) if (img[(y * c.width + x) * 4 + 3] > 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
          var pad = 8 * dpr; minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(c.width, maxX + pad); maxY = Math.min(c.height, maxY + pad);
          var sir = Math.max(1, maxX - minX), vys = Math.max(1, maxY - minY), mier = Math.min(1, 600 / sir);
          var o2 = document.createElement("canvas"); o2.width = Math.round(sir * mier); o2.height = Math.round(vys * mier);
          o2.getContext("2d").drawImage(c, minX, minY, sir, vys, 0, 0, o2.width, o2.height);
          var data = o2.toDataURL("image/png");
          zavri(); ok(data);
        }
      });
      document.body.classList.add("pdp-otvorene");
      window.addEventListener("resize", velkost);
      setTimeout(velkost, 30);
    });
  }

  // ---------- HTML pomôcky pre dokumenty ----------
  function slot(podpisy, rola, popis) {
    var p = (podpisy || []).filter(function (x) { return x.rola === rola; }).slice(-1)[0];
    if (!p) return '<span class="pdp-slot"><span class="pdp-bodky">.............................................</span><br>' + esc(popis) + "</span>";
    return '<span class="pdp-slot"><img src="' + p.obrazok + '" alt="podpis"><br><b>' + esc(p.meno || "") + "</b>, " + esc(cas(p.cas)) + "<br>" + esc(popis) + "</span>";
  }
  function pata(podpisy, obsahHash) {
    if (!(podpisy || []).length) return "";
    return '<div class="pdp-pata"><b>Elektronické podpisy (podpis prstom v aplikácii LBZ):</b><br>' + podpisy.map(function (p) {
      return esc((p.rola === "zamestnavatel" ? "Za zamestnávateľa: " : "Zamestnanec: ") + (p.meno || "") + (p.email ? " <" + p.email + ">" : "") + " – " + cas(p.cas) + " – záznam č. " + p.id +
        (p.obsah_hash ? " – odtlačok obsahu SHA-256 " + String(p.obsah_hash).slice(0, 16) + "…" : ""));
    }).join("<br>") + (obsahHash ? "<br>Odtlačok tejto verzie obsahu: " + esc(String(obsahHash).slice(0, 32)) + "…" : "") +
      "<br>Podpis je zaznamenaný s prihláseným účtom, dátumom a časom; SHA-256 tohto PDF je uložený v databáze aplikácie.</div>";
  }

  // ---------- HTML → PDF (A4, strany sa delia medzi riadkami) ----------
  var CSS = ".lbz-pdf{width:190mm;padding:0;background:#fff;color:#000;font:10.5pt/1.3 Montserrat,Arial,sans-serif}" +
    ".lbz-pdf h1{font-size:15pt;margin:0 0 2mm}.lbz-pdf h2{font-size:12pt;margin:4mm 0 2mm}.lbz-pdf h3{font-size:11pt;margin:3mm 0 1mm}" +
    ".lbz-pdf table{width:100%;border-collapse:collapse;margin:1mm 0}.lbz-pdf th,.lbz-pdf td{border:1px solid #999;padding:1.2mm 1.8mm;vertical-align:top;text-align:left}" +
    ".lbz-pdf th{background:#f1e4c6}.lbz-pdf .t-r{text-align:right}.lbz-pdf p{margin:1.5mm 0}" +
    ".lbz-pdf .pdp-slot{display:inline-block;min-width:60mm;font-size:9pt;vertical-align:bottom}.lbz-pdf .pdp-slot img{height:14mm;max-width:60mm;object-fit:contain;object-position:left bottom}" +
    ".lbz-pdf .pdp-pata{margin-top:6mm;padding-top:2mm;border-top:1px solid #999;font-size:7.5pt;color:#333;word-break:break-all}" +
    ".lbz-pdf .pdp-riadok{display:flex;justify-content:space-between;align-items:flex-end;gap:8mm;margin:6mm 0 2mm}";
  function pdf(html) {
    return skript(H2C, function () { return !!window.html2canvas; })
      .then(function () { return skript(JSPDF, function () { return !!(window.jspdf && window.jspdf.jsPDF); }); })
      .then(function () {
        var obal = document.createElement("div");
        obal.style.cssText = "position:fixed;left:-10000px;top:0;background:#fff;z-index:-1";
        obal.innerHTML = "<style>" + CSS + '</style><div class="lbz-pdf">' + html + "</div>";
        document.body.appendChild(obal);
        var el = obal.querySelector(".lbz-pdf");
        var obr = Array.prototype.map.call(el.querySelectorAll("img"), function (i) { return i.complete ? null : new Promise(function (ok) { i.onload = i.onerror = ok; }); });
        return Promise.all(obr.concat(document.fonts && document.fonts.ready ? [document.fonts.ready] : [])).then(function () {
          var r0 = el.getBoundingClientRect(), hranice = [];
          Array.prototype.forEach.call(el.querySelectorAll("tr, p, h1, h2, h3, .pdp-riadok, .pdp-pata, table"), function (x) { hranice.push(x.getBoundingClientRect().bottom - r0.top); });
          hranice.sort(function (a, b) { return a - b; });
          return window.html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false }).then(function (cv) {
            obal.remove();
            var doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", compress: true });
            var pxNaMm = r0.width / 190, stranaPx = 277 * pxNaMm, mier = cv.width / r0.width, od = 0, prva = true;
            while (od < r0.height - 1) {
              var koniec = od + stranaPx;
              if (koniec < r0.height) {
                var k = hranice.filter(function (h) { return h > od + stranaPx * 0.5 && h <= koniec; });
                if (k.length) koniec = k[k.length - 1];
              } else koniec = r0.height;
              var v = Math.max(1, Math.round((koniec - od) * mier));
              var kus = document.createElement("canvas"); kus.width = cv.width; kus.height = v;
              var kc = kus.getContext("2d"); kc.fillStyle = "#fff"; kc.fillRect(0, 0, kus.width, v);
              kc.drawImage(cv, 0, Math.round(od * mier), cv.width, v, 0, 0, cv.width, v);
              if (!prva) doc.addPage();
              doc.addImage(kus.toDataURL("image/jpeg", 0.82), "JPEG", 10, 10, 190, (koniec - od) / pxNaMm);
              prva = false; od = koniec;
            }
            return doc.output("blob");
          });
        }).catch(function (e) { obal.remove(); throw e; });
      });
  }

  function chyba(e) { return (e && (e.message || e.error_description || e.msg)) || String(e || "Chyba"); }

  // ---------- celý postup podpisu ----------
  function podpisat(o) {
    var db = o.db, podpisy = null, obsahHash = null;
    return dialog({ titul: o.titul || o.nazov, vyhlasenie: o.vyhlasenie })
      .then(function (obrazok) {
        return sha256(o.obsah || o.dokument).then(function (h) {
          obsahHash = h;
          return db.rpc("podpis_pridaj", { p: { dokument: o.dokument, typ: o.typ, rola: o.rola, obrazok: obrazok, obsah_hash: h, zariadenie: navigator.userAgent.slice(0, 180) } });
        });
      })
      .then(function (r) {
        if (r.error) throw r.error;
        if (!r.data || !r.data.ok) throw new Error((r.data && r.data.text) || "Podpis sa neuložil");
        podpisy = r.data.podpisy || [];
        if (o.poPodpise) o.poPodpise(r.data);
        return pdf(o.html(podpisy) + pata(podpisy, obsahHash));
      })
      .then(function (blob) {
        return sha256(blob).then(function (h) {
          var cesta = o.osoba + "/podpisane/" + o.subor + "_" + new Date().toISOString().replace(/[:.]/g, "-") + ".pdf";
          return db.storage.from("zamestnanci").upload(cesta, blob, { contentType: "application/pdf", upsert: false }).then(function (u) {
            if (u.error) throw u.error;
            return db.rpc("podpis_pdf", { p: { dokument: o.dokument, nazov: o.nazov, cesta: cesta, sha256: h } });
          }).then(function (r) {
            if (r.error) throw r.error;
            if (window.lbzPdf) window.lbzPdf(o.nazov + " (podpísané)", Promise.resolve(blob));
            return { ok: true, podpisy: podpisy, cesta: cesta };
          });
        });
      })
      .catch(function (e) {
        if (e && e.message === "zrusene") return { ok: false, zrusene: true };
        return { ok: false, text: chyba(e), podpisy: podpisy };
      });
  }
  function otvor(db, cesta, nazov) {
    var data = db.storage.from("zamestnanci").download(cesta).then(function (r) { if (r.error || !r.data) throw r.error || new Error("Súbor sa nenašiel"); return r.data; });
    if (window.lbzPdf) window.lbzPdf(nazov, data);
    else data.then(function (b) { window.open(URL.createObjectURL(b), "_blank"); });
  }
  function nacitaj(db, dokument) {
    return db.rpc("podpisy_dokumentu", { p_dokument: dokument }).then(function (r) { if (r.error) throw r.error; return r.data; });
  }

  // štýly okna na podpis
  var st = document.createElement("style");
  st.textContent = ".pdp-okno{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:12px}" +
    ".pdp-box{background:var(--surface,#fff);color:var(--ink,#222);border-radius:16px;padding:16px;width:min(640px,100%);max-height:96vh;overflow:auto;box-shadow:0 10px 30px rgba(0,0,0,.35)}" +
    ".pdp-box h3{margin:0 0 8px}.pdp-vyhl{margin:0 0 10px;font-size:14px}.pdp-info{font-size:12px;color:var(--muted,#666);margin:8px 0}" +
    ".pdp-plocha{position:relative;height:220px;border:2px dashed var(--gold,#CBA75B);border-radius:12px;background:#fff;touch-action:none}" +
    ".pdp-plocha canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:crosshair}" +
    ".pdp-ciara{position:absolute;left:16px;right:16px;bottom:38px;border-bottom:1px solid #bbb;color:#aaa;font-size:13px;text-align:center;pointer-events:none;transition:opacity .2s}" +
    ".pdp-tl{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}body.pdp-otvorene{overflow:hidden}";
  document.head.appendChild(st);

  window.lbzPodpis = { dialog: dialog, pdf: pdf, slot: slot, pata: pata, podpisat: podpisat, otvor: otvor, nacitaj: nacitaj, sha256: sha256 };
})();
