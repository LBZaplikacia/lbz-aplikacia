// LBZ – dni pracovného pokoja na Slovensku (rovnaké pravidlá ako SQL funkcia public.sviatok_nazov)
// Od roku 2026 nie sú voľné dni: 1. 9. (od 2024), 8. 5., 15. 9., 17. 11. (konsolidácia)
(function () {
  "use strict";
  var CACHE = {};
  function velkanoc(r) {            // nedeľa Veľkej noci (gregoriánsky kalendár)
    var a = r % 19, b = Math.floor(r / 100), c = r % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
        g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
        l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
        mes = Math.floor((h + l - 7 * m + 114) / 31), den = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(r, mes - 1, den, 12);
  }
  function iso(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function rok(r) {
    if (CACHE[r]) return CACHE[r];
    var s = {};
    s[r + "-01-01"] = "Deň vzniku SR"; s[r + "-01-06"] = "Zjavenie Pána"; s[r + "-05-01"] = "Sviatok práce";
    s[r + "-07-05"] = "Sv. Cyril a Metod"; s[r + "-08-29"] = "Výročie SNP"; s[r + "-11-01"] = "Sviatok všetkých svätých";
    s[r + "-12-24"] = "Štedrý deň"; s[r + "-12-25"] = "1. sviatok vianočný"; s[r + "-12-26"] = "2. sviatok vianočný";
    if (r < 2026) { s[r + "-05-08"] = "Deň víťazstva nad fašizmom"; s[r + "-09-15"] = "Sedembolestná Panna Mária"; s[r + "-11-17"] = "Deň boja za slobodu a demokraciu"; }
    if (r < 2024) s[r + "-09-01"] = "Deň Ústavy SR";
    var v = velkanoc(r);
    s[iso(new Date(v.getFullYear(), v.getMonth(), v.getDate() - 2, 12))] = "Veľký piatok";
    s[iso(new Date(v.getFullYear(), v.getMonth(), v.getDate() + 1, 12))] = "Veľkonočný pondelok";
    return (CACHE[r] = s);
  }
  window.lbzSviatok = function (d) {
    var s = String(d || "").slice(0, 10);
    if (!/^\d{4}-\d\d-\d\d$/.test(s)) return "";
    return rok(+s.slice(0, 4))[s] || "";
  };
})();
