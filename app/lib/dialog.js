// LBZ – potvrdzovacie okná v dizajne appky (namiesto systémového confirm/alert).
// lbzPotvrd(text) sa volá rovnako ako confirm(): prvýkrát ukáže okno a vráti false;
// po „Áno“ znova klikne na to isté tlačidlo a vtedy vráti true.
(function () {
  "use strict";
  var cakajuce = null;   // { kluc } – po „Áno“ sa ďalšie volanie s rovnakým kľúčom pustí

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // prvok, na ktorý sa kliklo (alebo formulár), a spôsob, ako ho po potvrdení nájsť znova (medzitým sa mohol prekresliť)
  function zdroj() {
    var ev = window.event, t = ev && ev.target;
    if (!t || !t.closest) return null;
    if (ev.type === "submit") return { el: t, submit: true, sel: t.id ? "#" + CSS.escape(t.id) : null };
    var el = t.closest("button, a, label, [data-t], [data-f], [data-r], [data-s], [data-b]") || t;
    var sel = el.id ? "#" + CSS.escape(el.id) : null;
    if (!sel) {
      var casti = [];
      Array.prototype.forEach.call(el.attributes, function (a) { if (/^data-/.test(a.name)) casti.push("[" + a.name + '="' + CSS.escape(a.value) + '"]'); });
      if (casti.length) sel = el.tagName.toLowerCase() + casti.join("");
    }
    return { el: el, sel: sel };
  }

  function nebezpecne(text) { return /zmaza|odstr[aá]n|zru[sš]i|odobra|zahodi|archivova|ukon[cč]i/i.test(text); }

  function okno(text, tlacidla, naKoniec) {
    var casti = String(text).split(/\n\n/), nadpis = casti.shift(), telo = casti.join("\n\n");
    var poz = document.createElement("div"); poz.className = "lbz-dlg-pozadie";
    var d = document.createElement("div"); d.className = "lbz-dlg"; d.setAttribute("role", "alertdialog"); d.setAttribute("aria-modal", "true");
    d.innerHTML = '<p class="lbz-dlg-nadpis">' + esc(nadpis).replace(/\n/g, "<br>") + "</p>" +
      (telo ? '<p class="lbz-dlg-text">' + esc(telo).replace(/\n/g, "<br>") + "</p>" : "") +
      '<div class="lbz-dlg-tl">' + tlacidla.map(function (b, i) { return '<button type="button" class="btn ' + b.trieda + '" data-i="' + i + '">' + esc(b.text) + "</button>"; }).join("") + "</div>";
    function zavri(i) { poz.remove(); d.remove(); document.removeEventListener("keydown", kl, true); naKoniec(i); }
    function kl(e) { if (e.key === "Escape") { e.preventDefault(); zavri(-1); } }
    d.addEventListener("click", function (e) { var b = e.target.closest("button[data-i]"); if (b) zavri(+b.dataset.i); });
    poz.addEventListener("click", function () { zavri(-1); });
    document.addEventListener("keydown", kl, true);
    document.body.appendChild(poz); document.body.appendChild(d);
    var hl = d.querySelector(".lbz-dlg-tl .btn:last-child"); if (hl) hl.focus();
  }

  window.lbzPotvrd = function (text) {
    var z = zdroj(), kluc = String(text) + "|" + (z && z.sel || "");
    if (cakajuce && cakajuce.kluc === kluc) { cakajuce = null; return true; }
    cakajuce = null;
    var zle = nebezpecne(String(text).split(/\n/)[0]);
    okno(text, [{ text: "Späť", trieda: "lbz-dlg-nie" }, { text: zle ? "Áno, pokračovať" : "Áno", trieda: zle ? "lbz-dlg-zle" : "btn-primary" }], function (i) {
      if (i !== 1 || !z) return;
      var el = z.el && z.el.isConnected ? z.el : (z.sel ? document.querySelector(z.sel) : null);
      if (!el) return;
      cakajuce = { kluc: kluc };
      if (z.submit) { if (el.requestSubmit) el.requestSubmit(); else el.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }
      else el.click();
      cakajuce = null;
    });
    return false;
  };

  window.lbzInfo = function (text) { okno(text, [{ text: "OK", trieda: "btn-primary" }], function () {}); };
})();
