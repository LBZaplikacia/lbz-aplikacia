// LBZ – prehliadač PDF priamo v appke (bez otvárania Disku alebo novej karty).
// lbzPdf(nazov, Promise<Blob|ArrayBuffer>) – ukáže okno cez celú obrazovku, strany vykreslí PDF.js.
(function () {
  "use strict";
  var PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/";
  var nacitanie = null;
  function kniznica() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (nacitanie) return nacitanie;
    nacitanie = new Promise(function (ok, zle) {
      var s = document.createElement("script");
      s.src = PDFJS + "pdf.min.js";
      s.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; ok(window.pdfjsLib); };
      s.onerror = function () { nacitanie = null; zle(new Error("Prehliadač PDF sa nenačítal – skontroluj signál")); };
      document.head.appendChild(s);
    });
    return nacitanie;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  window.lbzPdf = function (nazov, data) {
    var o = document.createElement("div");
    o.className = "pdfv"; o.setAttribute("role", "dialog"); o.setAttribute("aria-modal", "true");
    o.innerHTML = '<div class="pdfv-hl"><button type="button" class="pdfv-x" aria-label="Zavrieť">←</button><b class="pdfv-n">' + esc(nazov) + "</b>" +
      '<a class="btn pdfv-st" aria-disabled="true">⬇</a></div><div class="pdfv-telo"><p class="pdfv-info">Načítavam…</p></div>';
    document.body.appendChild(o); document.body.classList.add("pdfv-otvorene");
    var url = null, zavrete = false;
    function zavri() {
      zavrete = true; o.remove(); document.body.classList.remove("pdfv-otvorene");
      if (url) URL.revokeObjectURL(url);
      window.removeEventListener("popstate", zavri); document.removeEventListener("keydown", kl, true);
    }
    function kl(e) { if (e.key === "Escape") { e.preventDefault(); if (history.state && history.state.pdfv) history.back(); else zavri(); } }
    // tlačidlo Späť v mobile zatvorí prehliadač, nie appku
    try { history.pushState({ pdfv: 1 }, ""); window.addEventListener("popstate", zavri); } catch (x) { /* */ }
    document.addEventListener("keydown", kl, true);
    o.querySelector(".pdfv-x").onclick = function () { if (history.state && history.state.pdfv) history.back(); else zavri(); };
    var telo = o.querySelector(".pdfv-telo");

    Promise.all([kniznica(), Promise.resolve(data)]).then(function (v) {
      var lib = v[0], d = v[1];
      return (d && d.arrayBuffer ? d.arrayBuffer() : Promise.resolve(d)).then(function (buf) {
        if (zavrete) return;
        url = URL.createObjectURL(new Blob([buf], { type: "application/pdf" }));
        var st = o.querySelector(".pdfv-st"); st.href = url; st.download = String(nazov).replace(/[\\/:*?"<>|]+/g, "_") + ".pdf"; st.removeAttribute("aria-disabled"); st.title = "Stiahnuť do zariadenia";
        return lib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise.then(function (pdf) {
          telo.innerHTML = "";
          var sirka = Math.min(telo.clientWidth - 16, 900), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
          var strana = function (i) {
            if (zavrete || i > pdf.numPages) return;
            return pdf.getPage(i).then(function (p) {
              var z = p.getViewport({ scale: 1 }), mier = sirka / z.width, vp = p.getViewport({ scale: mier * dpr });
              var c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
              c.style.width = Math.floor(vp.width / dpr) + "px"; c.style.height = Math.floor(vp.height / dpr) + "px";
              c.className = "pdfv-str"; telo.appendChild(c);
              return p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise.then(function () { return strana(i + 1); });
            });
          };
          return strana(1);
        });
      });
    }).catch(function (e) {
      if (!zavrete) telo.innerHTML = '<p class="pdfv-info">⚠️ ' + esc((e && e.message) || "Dokument sa nepodarilo otvoriť") + "</p>";
    });
  };
})();
