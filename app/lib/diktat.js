// LBZ – diktovanie hlasom (prepis reči na text) pre polia s tlačidlom 🎤 [data-diktat="id-poľa"]
// Web Speech API (Chrome/Android, Safari/iOS); kde prehliadač diktovanie nepodporuje, tlačidlo sa skryje.
(function () {
  "use strict";
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  window.lbzDiktatPodpora = !!SR;
  var akt = null;
  function stop() { if (akt) { try { akt.rec.stop(); } catch (e) {} } }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-diktat]"); if (!b) return;
    e.preventDefault();
    if (!SR) { if (window.lbzInfo) lbzInfo("Tento prehliadač diktovanie nepodporuje – použite mikrofón na klávesnici telefónu."); return; }
    if (akt && akt.btn === b) { stop(); return; }
    stop();
    var pole = document.getElementById(b.getAttribute("data-diktat")); if (!pole) return;
    var rec = new SR(), zaklad = pole.value ? pole.value.replace(/\s*$/, " ") : "";
    rec.lang = "sk-SK"; rec.interimResults = true; rec.continuous = true;
    akt = { rec: rec, btn: b };
    b.classList.add("diktat-on"); b.setAttribute("aria-pressed", "true");
    rec.onresult = function (ev) {
      var hotove = "", priebezne = "";
      for (var i = 0; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) hotove += ev.results[i][0].transcript; else priebezne += ev.results[i][0].transcript;
      }
      var t = (hotove + priebezne).trim();
      pole.value = zaklad + (t ? t.charAt(0).toUpperCase() + t.slice(1) : "");
      pole.dispatchEvent(new Event("input", { bubbles: true }));
    };
    var koniec = function () { b.classList.remove("diktat-on"); b.setAttribute("aria-pressed", "false"); if (akt && akt.btn === b) akt = null; try { pole.focus(); } catch (e) {} };
    rec.onend = koniec;
    rec.onerror = function (ev) {
      koniec();
      if (ev && (ev.error === "not-allowed" || ev.error === "service-not-allowed") && window.lbzInfo) lbzInfo("Povoľte appke mikrofón (v nastaveniach prehliadača / telefónu) a skúste znova.");
    };
    try { rec.start(); } catch (x) { koniec(); }
  });
  // pri odoslaní formulára diktovanie zastaviť
  document.addEventListener("submit", stop, true);
})();
