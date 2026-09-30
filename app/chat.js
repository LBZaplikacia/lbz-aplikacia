// LBZ aplikácia – Chat: spoločná skupina „LBZ tím“, ďalšie skupiny (zakladá vedenie) a súkromné správy medzi dvoma ľuďmi.
// Nové správy prichádzajú hneď (Supabase Realtime), do mobilu upozornenie (Edge Function „upozornenia“, akcia chat).
// Fotky a PDF sa ukladajú do súkromného úložiska „chat/<konverzácia>/…“.

(function () {
  "use strict";

  var DB = null, ROLA = null, koren = null, kanal = null;
  var C = { zoznam: null, ja: null, spravca: false, konv: null, data: null, spravy: [], viac: false, chyba: null, dialog: null, prace: false,
    neprecitane: 0, ludia: null, url: {}, hladaj: "" };
  var ROLY_CHAT = ["it", "ceo", "prevadzka", "zamestnanec", "furman", "zakaznicky_servis", "prevadzkar", "uctovnicka"];
  var FARBY = ["#583934", "#2C5167", "#8a4b12", "#2f7d4f", "#7a3b69", "#9a6a12", "#3d5a80", "#a0522d"];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function rpc(n, a) { return DB.rpc(n, a || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function chybaText(e) { return (e && (e.message || e.text)) || "Bez spojenia so serverom"; }
  function siroka() { return window.matchMedia("(min-width: 900px)").matches; }
  function farba(uid) { var h = 0; String(uid).split("").forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; }); return FARBY[h % FARBY.length]; }
  function inic(m) { return String(m || "?").trim().split(/\s+/).map(function (x) { return x[0]; }).join("").slice(0, 2).toUpperCase(); }
  function cas(s) { return new Date(s).toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" }); }
  function den(s) {
    var d = new Date(s), dn = new Date(); dn.setHours(0, 0, 0, 0);
    var x = new Date(d); x.setHours(0, 0, 0, 0);
    var r = Math.round((dn - x) / 864e5);
    if (r === 0) return "Dnes"; if (r === 1) return "Včera";
    return d.toLocaleDateString("sk-SK", { weekday: r < 7 ? "long" : undefined, day: "numeric", month: "numeric", year: d.getFullYear() !== dn.getFullYear() ? "numeric" : undefined });
  }
  function kedyKratko(s) {
    if (!s) return "";
    var d = new Date(s), dn = new Date();
    if (d.toDateString() === dn.toDateString()) return cas(s);
    if ((dn - d) < 6 * 864e5) return d.toLocaleDateString("sk-SK", { weekday: "short" });
    return d.toLocaleDateString("sk-SK", { day: "numeric", month: "numeric" });
  }
  function odkazy(t) {   // text správy: odkazy klikateľné, riadky zachované
    return esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, "<br>");
  }
  function meno(uid) {
    var c = ((C.data && C.data.clenovia) || []).filter(function (x) { return x.uid === uid; })[0];
    return c ? c.meno : "Bývalý člen";
  }

  // ---------- odznak s počtom neprečítaných (lišta na PC aj v mobile) ----------
  function odznak() {
    if (window.lbzPush && DB) { if (window.lbzOdznakObnov) lbzOdznakObnov(); if (!C.neprecitane && C.zoznam && lbzPush.zavri) lbzPush.zavri("chat-"); }
    document.querySelectorAll('[data-mod="chat"] .ri-ik').forEach(function (ik) {
      var b = ik.querySelector(".chat-odznak");
      if (!C.neprecitane) { if (b) b.remove(); return; }
      if (!b) { b = document.createElement("span"); b.className = "chat-odznak"; ik.appendChild(b); }
      b.textContent = C.neprecitane > 99 ? "99+" : C.neprecitane;
    });
  }
  function nacitajPocet() {
    if (!DB) return;
    rpc("chat_neprecitane").then(function (n) { C.neprecitane = n || 0; odznak(); }).catch(function () { /* */ });
  }

  // ---------- načítanie ----------
  function nacitajZoznam() {
    return rpc("chat_zoznam").then(function (d) {
      if (!d || !d.ok) { C.chyba = (d && d.text) || "Chat sa nenačítal"; C.zoznam = []; kresli(); return; }
      C.zoznam = d.konv || []; C.ja = d.ja; C.spravca = !!d.spravca; C.chyba = null;
      C.neprecitane = C.zoznam.reduce(function (s, k) { return s + (k.stlmene || k.archiv ? 0 : +k.neprecitane || 0); }, 0);
      kresli(); odznak();
    }).catch(function (e) { C.chyba = chybaText(e); C.zoznam = C.zoznam || []; kresli(); });
  }
  function otvor(id) {
    C.konv = id; C.data = null; C.spravy = []; C.viac = false;
    if (window.lbzPamat) lbzPamat.uloz("chat", { konv: id });
    kresli();
    rpc("chat_spravy", { p_konv: id }).then(function (d) {
      if (C.konv !== id) return;
      if (!d || !d.ok) { C.chyba = (d && d.text) || "Správy sa nenačítali"; C.konv = null; kresli(); return; }
      C.data = d; C.spravy = d.spravy || []; C.viac = !!d.viac;
      var k = (C.zoznam || []).filter(function (x) { return x.id === id; })[0];
      if (k) { C.neprecitane = Math.max(0, C.neprecitane - (k.stlmene ? 0 : +k.neprecitane || 0)); k.neprecitane = 0; }
      kresli(); dole(); odznak();
      if (window.lbzPush && lbzPush.zavri) lbzPush.zavri("chat-" + id + "-");
      var t = document.getElementById("chat-text"); if (t && siroka()) t.focus();
    }).catch(function (e) { C.chyba = chybaText(e); kresli(); });
  }
  function starsie() {
    if (!C.spravy.length) return;
    var id = C.konv, box = document.getElementById("chat-spravy"), vyska = box ? box.scrollHeight : 0;
    rpc("chat_spravy", { p_konv: id, p_pred: C.spravy[0].id }).then(function (d) {
      if (C.konv !== id || !d || !d.ok) return;
      C.spravy = (d.spravy || []).concat(C.spravy); C.viac = !!d.viac;
      kresliSpravy();
      var b = document.getElementById("chat-spravy"); if (b) b.scrollTop = b.scrollHeight - vyska;
    });
  }

  // ---------- Realtime ----------
  function pripojRealtime() {
    if (kanal || !DB || !DB.channel) return;
    kanal = DB.channel("lbz-chat")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_sprava" }, function (p) { prislo(p.new, false); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_sprava" }, function (p) { prislo(p.new, true); })
      .subscribe();
  }
  function odpojRealtime() { if (kanal && DB) { try { DB.removeChannel(kanal); } catch (e) { /* */ } } kanal = null; }
  function prislo(s, uprava) {
    if (!s) return;
    var otvorena = C.konv === s.konv_id && C.data && koren && koren.isConnected && document.visibilityState === "visible";
    if (otvorena) {
      var i = C.spravy.map(function (x) { return x.id; }).indexOf(s.id);
      var x = { id: s.id, uid: s.uid, text: s.zmazane ? null : s.text, priloha: s.zmazane ? null : s.priloha, pripnute: s.pripnute, zmazane: s.zmazane, kedy: s.vytvorene, odpoved_na: s.odpoved_na || null };
      if (i > -1 && C.spravy[i].odpoved) x.odpoved = C.spravy[i].odpoved;
      if (i > -1) C.spravy[i] = x; else if (!uprava) C.spravy.push(x);
      if (uprava) { C.data.pripnute = null; obnovPripnute(); }
      if (!uprava && !meno(s.uid).length) { /* nový člen – mená sa doplnia pri ďalšom otvorení */ }
      var box = document.getElementById("chat-spravy"), naSpodku = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 120;
      kresliSpravy(); if (naSpodku || s.uid === C.ja) dole();
      if (!uprava && s.uid !== C.ja) rpc("chat_precitane", { p_konv: s.konv_id }).catch(function () { /* */ });
    } else if (!uprava && s.uid !== C.ja) {
      var k = (C.zoznam || []).filter(function (x) { return x.id === s.konv_id; })[0];
      if (k) { k.neprecitane = (+k.neprecitane || 0) + 1; if (!k.stlmene) C.neprecitane++; }
      else C.neprecitane++;
    }
    if (!uprava) {
      var kk = (C.zoznam || []).filter(function (x) { return x.id === s.konv_id; })[0];
      if (kk) { kk.posledna = s.vytvorene; kk.sprava = { text: s.text || "📎 " + ((s.priloha || {}).nazov || "príloha"), ja: s.uid === C.ja, kedy: s.vytvorene }; }
      else if (koren && koren.isConnected) nacitajZoznam();
    }
    if (koren && koren.isConnected) kresliZoznam();
    odznak();
  }
  function obnovPripnute() {
    if (!C.konv) return;
    rpc("chat_spravy", { p_konv: C.konv }).then(function (d) { if (d && d.ok && C.data) { C.data.pripnute = d.pripnute; C.data.clenovia = d.clenovia; kresliHlavicku(); } });
  }

  // ---------- vykreslenie ----------
  function kresli() {
    if (!koren || !koren.isConnected) return;
    var w = siroka(), vo = C.konv != null;
    var zachovaj = document.getElementById("chat-text"), draft = zachovaj ? zachovaj.value : null;
    koren.innerHTML = '<div class="chat' + (w ? " chat-siroky" : "") + (vo ? " chat-vo" : "") + '">' +
      (w || !vo ? '<section class="chat-zoznam" id="chat-zoznam"></section>' : "") +
      (w || vo ? '<section class="chat-vlakno" id="chat-vlakno">' + vlaknoKostra() + "</section>" : "") + "</div>" + '<div id="chat-dialog-obal">' + dialogHtml() + "</div>";
    kresliZoznam(); kresliHlavicku(); kresliSpravy(); hlasUI(); kresliOdp();
    if (draft != null && C.konv != null) { var t = document.getElementById("chat-text"); if (t) { t.value = draft; vyska(t); } }
  }
  function kresliZoznam() {
    var el = document.getElementById("chat-zoznam"); if (!el) return;
    var l = (C.zoznam || []).filter(function (k) { return !C.hladaj || String(k.nazov || "").toLowerCase().indexOf(C.hladaj.toLowerCase()) > -1; });
    el.innerHTML = '<div class="chat-z-hl"><h2>Chat</h2><span class="chat-z-tl">' +
      '<button class="btn btn-primary" data-ch="nova" title="Nová správa">✏️<span class="chat-tl-t"> Napísať</span></button>' +
      (C.spravca ? '<button class="btn" data-ch="skupina" title="Nová skupina">👥＋</button>' : "") + "</span></div>" +
      (C.chyba && !C.konv ? '<p class="f-sprava f-chyba">' + esc(C.chyba) + "</p>" : "") +
      (C.zoznam == null ? '<p class="muted chat-pozn">Načítavam…</p>' : !l.length ? '<p class="muted chat-pozn">Zatiaľ žiadne konverzácie. Ťukni na „Napísať“.</p>' :
        '<div class="chat-konv-zoz">' + l.map(function (k) {
          var s = k.sprava, nep = +k.neprecitane || 0;
          return '<button class="chat-konv' + (k.id === C.konv ? " chat-akt" : "") + (nep ? " chat-nove" : "") + (k.archiv ? " chat-arch" : "") + '" data-ch-konv="' + k.id + '">' +
            '<span class="chat-av" style="background:' + (k.typ === "priama" ? farba(k.druhy) : "var(--gold)") + '">' + (k.typ === "priama" ? esc(inic(k.nazov)) : esc(k.ikona || "👥")) + "</span>" +
            '<span class="chat-konv-t"><span class="chat-konv-r1"><b>' + esc(k.nazov || "Konverzácia") + "</b>" + (k.stlmene ? ' <span title="Stlmené">🔕</span>' : "") +
              '<small class="muted">' + esc(kedyKratko(s ? s.kedy : null)) + "</small></span>" +
            '<span class="chat-konv-r2"><span class="muted">' + (s ? (s.ja ? "Ty: " : k.typ === "skupina" && s.meno ? esc(String(s.meno).split(" ")[0]) + ": " : "") + esc(String(s.text || "").slice(0, 80)) : k.archiv ? "archivovaná" : "Bez správ") + "</span>" +
              (nep ? '<i class="chat-pocet">' + (nep > 99 ? "99+" : nep) + "</i>" : "") + "</span></span></button>";
        }).join("") + "</div>");
  }
  function vlaknoKostra() {
    if (C.konv == null) return '<div class="chat-prazdne"><span>💬</span><p class="muted">Vyber konverzáciu vľavo alebo napíš novú správu.</p></div>';
    var k = (C.zoznam || []).filter(function (x) { return x.id === C.konv; })[0] || {};
    return '<header class="chat-v-hl" id="chat-v-hl"></header><div class="chat-pripnute" id="chat-pripnute"></div>' +
      '<div class="chat-spravy" id="chat-spravy"></div>' +
      (k.archiv ? '<p class="muted chat-pozn">Skupina je archivovaná – písať sa do nej nedá.</p>' :
      '<div class="chat-odp-bar" id="chat-odp-bar"></div><form class="chat-pis" id="chat-pis"><label class="chat-priloha-tl" title="Fotka alebo PDF"><input type="file" id="chat-subor" accept="image/*,application/pdf" hidden>📎</label>' +
      '<textarea id="chat-text" rows="1" maxlength="4000" placeholder="Správa…" enterkeyhint="send"></textarea>' +
      (hlasMozna() ? '<button type="button" class="chat-mic" data-ch="hlas" aria-label="Nahrať hlasovú správu" title="Hlasová správa">🎤</button>' : "") +
      '<div class="chat-rec" id="chat-rec"><button type="button" class="chat-rec-x" data-ch="hlas-zrus" aria-label="Zahodiť nahrávku">✕</button>' +
      '<span class="chat-rec-bod" aria-hidden="true"></span><span id="chat-rec-cas" class="num">0:00</span><span class="muted chat-rec-t">Nahrávam…</span>' +
      '<button type="button" class="btn btn-primary chat-rec-posli" data-ch="hlas-posli" aria-label="Odoslať hlasovú správu">➤</button></div>' +
      '<button class="btn btn-primary chat-posli" type="submit" aria-label="Odoslať"' + (C.prace ? " disabled" : "") + ">➤</button></form>");
  }
  function kresliHlavicku() {
    var h = document.getElementById("chat-v-hl"); if (!h) return;
    var k = (C.zoznam || []).filter(function (x) { return x.id === C.konv; })[0] || (C.data && C.data.konv) || {};
    var cl = (C.data && C.data.clenovia) || [];
    var pod = k.typ === "priama" ? "súkromná konverzácia" : cl.length ? cl.length + " " + (cl.length === 1 ? "člen" : cl.length < 5 ? "členovia" : "členov") + (k.vsetci ? " · celý tím" : "") : "";
    h.innerHTML = (siroka() ? "" : '<button class="btn-link chat-spat" data-ch="spat" aria-label="Späť na zoznam">←</button>') +
      '<span class="chat-av" style="background:' + (k.typ === "priama" ? farba(k.druhy) : "var(--gold)") + '">' + (k.typ === "priama" ? esc(inic(k.nazov)) : esc(k.ikona || "👥")) + "</span>" +
      '<div class="chat-v-nazov"><b>' + esc(k.nazov || "Konverzácia") + '</b><small class="muted">' + esc(pod) + "</small></div>" +
      '<button class="btn btn-ikona" data-ch="info" aria-label="Nastavenia konverzácie">⋯</button>';
    var p = document.getElementById("chat-pripnute"), pr = (C.data && C.data.pripnute) || [];
    if (p) p.innerHTML = pr.length ? '<button class="chat-pin" data-ch-skoc="' + pr[0].id + '">📌 <span><b>' + esc(pr[0].meno) + ":</b> " + esc(String(pr[0].text || "").slice(0, 140)) + "</span>" +
      (pr.length > 1 ? '<small class="muted">+' + (pr.length - 1) + "</small>" : "") + "</button>" : "";
  }
  function kresliSpravy() {
    var box = document.getElementById("chat-spravy"); if (!box) return;
    if (!C.data) { box.innerHTML = '<p class="muted chat-pozn">Načítavam správy…</p>'; return; }
    var skupina = C.data.konv && C.data.konv.typ === "skupina", out = [], predDen = "", predUid = null, predCas = 0;
    var cl = C.data.clenovia || [], ostatni = cl.filter(function (x) { return x.uid !== C.ja; });
    var mojePosl = null; for (var i = C.spravy.length - 1; i >= 0; i--) if (C.spravy[i].uid === C.ja && !C.spravy[i].zmazane) { mojePosl = C.spravy[i].id; break; }
    if (C.viac) out.push('<button class="btn chat-starsie" data-ch="starsie">Staršie správy</button>');
    if (!C.spravy.length) out.push('<p class="muted chat-pozn">Zatiaľ tu nie sú správy. Napíš prvú 👋</p>');
    C.spravy.forEach(function (s) {
      var d = den(s.kedy); if (d !== predDen) { out.push('<div class="chat-den"><span>' + esc(d) + "</span></div>"); predDen = d; predUid = null; }
      var ja = s.uid === C.ja, t = new Date(s.kedy).getTime(), spoj = predUid === s.uid && t - predCas < 5 * 60e3;
      predUid = s.uid; predCas = t;
      var obsah = s.zmazane ? '<i class="muted">Správa bola zmazaná</i>' : (citat(s) + priloha(s.priloha) + (s.text ? '<div class="chat-txt">' + odkazy(s.text) + "</div>" : ""));
      var videli = "";
      if (ja && s.id === mojePosl && ostatni.length) {
        var n = ostatni.filter(function (c) { return new Date(c.precitane) >= new Date(s.kedy); }).length;
        videli = skupina ? (n ? " · videli " + n : "") : (n ? " ✓✓" : " ✓");
      }
      out.push('<div class="chat-msg' + (ja ? " chat-ja" : "") + (spoj ? " chat-spoj" : "") + (s.pripnute ? " chat-pinnuta" : "") + '" id="chat-m-' + s.id + '">' +
        (!ja && skupina && !spoj ? '<span class="chat-av chat-av-m" style="background:' + farba(s.uid) + '">' + esc(inic(meno(s.uid))) + "</span>" : "") +
        '<div class="chat-bub">' + (!ja && skupina && !spoj ? '<b class="chat-od" style="color:' + farba(s.uid) + '">' + esc(meno(s.uid)) + "</b>" : "") + obsah +
        '<span class="chat-cas">' + (s.pripnute ? "📌 " : "") + esc(cas(s.kedy)) + esc(videli) + "</span></div>" +
        (!s.zmazane ? '<button class="chat-menu-tl" data-ch-menu="' + s.id + '" aria-label="Možnosti správy">⋮</button>' : "") + "</div>");
    });
    if ([].some.call(box.querySelectorAll("audio"), function (a) { return !a.paused; })) { C.odlozKresli = true; return; }   // nerušiť prehrávanie hlasovky
    if (!box._lep) { box._lep = true; box.addEventListener("scroll", function () { LEP = box.scrollHeight - box.scrollTop - box.clientHeight < 80; }, { passive: true }); }
    var predTop = box.scrollTop;
    box.innerHTML = out.join("");
    if (LEP) box.scrollTop = box.scrollHeight; else box.scrollTop = predTop;
    box.querySelectorAll("img[data-ch-img]").forEach(nacitajObrazok);
    box.querySelectorAll("audio[data-ch-aud]").forEach(function (a) { if (!a.getAttribute("src")) podpisanaUrl(a.dataset.chAud).then(function (u) { a.src = u; }).catch(function () { /* */ }); });
  }
  function priloha(p) {
    if (!p || !p.cesta) return "";
    if (/^image\//.test(p.typ || "")) return '<button class="chat-obr" data-ch-obr="' + esc(p.cesta) + '"><img data-ch-img="' + esc(p.cesta) + '" alt="' + esc(p.nazov || "fotka") + '"' + (C.url[p.cesta] ? ' src="' + esc(C.url[p.cesta].u) + '"' : "") + "></button>";
    if (/^audio\//.test(p.typ || "")) return '<div class="chat-audio"><audio controls preload="none" data-ch-aud="' + esc(p.cesta) + '"' + (C.url[p.cesta] ? ' src="' + esc(C.url[p.cesta].u) + '"' : "") + "></audio>" +
      (p.trvanie ? '<span class="chat-audio-t muted">🎤 ' + esc(mmss(p.trvanie)) + "</span>" : "") + "</div>";
    return '<button class="chat-subor" data-ch-subor="' + esc(p.cesta) + '" data-nazov="' + esc(p.nazov || "subor") + '" data-typ="' + esc(p.typ || "") + '">📄 <span>' + esc(p.nazov || "Súbor") + "</span></button>";
  }
  function podpisanaUrl(cesta) {
    var c = C.url[cesta]; if (c && c.do > Date.now()) return Promise.resolve(c.u);
    return DB.storage.from("chat").createSignedUrl(cesta, 3600).then(function (r) {
      if (r.error || !r.data) throw r.error || new Error("Súbor sa nenašiel");
      C.url[cesta] = { u: r.data.signedUrl, do: Date.now() + 3500e3 }; return r.data.signedUrl;
    });
  }
  function nacitajObrazok(img) {
    if (img.getAttribute("src")) return;
    img.addEventListener("load", naSpodok, { once: true });
    podpisanaUrl(img.dataset.chImg).then(function (u) { img.src = u; }).catch(function () { img.alt = "Fotka sa nenačítala"; });
  }
  // držať chat na spodku, kým používateľ sám neodroluje hore (fotky a hlasovky sa načítajú neskôr a zväčšia obsah)
  var LEP = true;
  function naSpodok() { var b = document.getElementById("chat-spravy"); if (b && LEP) b.scrollTop = b.scrollHeight; }
  function dole() {
    LEP = true; naSpodok();
    if (window.requestAnimationFrame) requestAnimationFrame(naSpodok);
    [150, 400, 900, 1600, 2500].forEach(function (ms) { setTimeout(naSpodok, ms); });
  }
  function vyska(t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 160) + "px"; }

  // ---------- dialógy ----------
  function dialogHtml() {
    var d = C.dialog; if (!d) return "";
    var obal = function (h) { return '<div class="f-dialog-pozadie" data-ch="zavri"></div><div class="f-dialog chat-dialog" role="dialog" aria-modal="true">' + h + "</div>"; };
    if (d.typ === "nova") {
      var l = (C.ludia || []).filter(function (x) { return !d.hladaj || x.meno.toLowerCase().indexOf(d.hladaj.toLowerCase()) > -1; });
      return obal('<h3>Nová správa</h3><input id="chat-hladaj-l" placeholder="Hľadať človeka" value="' + esc(d.hladaj || "") + '" autocomplete="off">' +
        (C.ludia == null ? '<p class="muted">Načítavam…</p>' : '<div class="chat-ludia">' + l.map(function (x) {
          return '<button class="chat-clovek" data-ch-clovek="' + esc(x.uid) + '"><span class="chat-av" style="background:' + farba(x.uid) + '">' + esc(inic(x.meno)) + "</span>" + esc(x.meno) + "</button>";
        }).join("") + (l.length ? "" : '<p class="muted">Nikto sa nenašiel.</p>') + "</div>") +
        '<div class="f-akcie"><button class="btn" data-ch="zavri">Zavrieť</button></div>');
    }
    if (d.typ === "skupina") {
      var ludia = C.ludia || [];
      return obal('<form id="chat-skupina-form" class="f-form"><h3>' + (d.id ? "Upraviť skupinu" : "Nová skupina") + "</h3>" +
        '<div class="d-riadok"><label class="field chat-f-ik"><span class="label">Ikona</span><input id="chat-sk-ikona" maxlength="4" value="' + esc(d.ikona || "👥") + '"></label>' +
        '<label class="field"><span class="label">Názov</span><input id="chat-sk-nazov" maxlength="60" required value="' + esc(d.nazov || "") + '" placeholder="napr. Furmani, Výroba"></label></div>' +
        '<label class="chat-f-vsetci"><input type="checkbox" id="chat-sk-vsetci"' + (d.vsetci ? " checked" : "") + "> Celý tím (noví ľudia sa pridajú sami)</label>" +
        (d.vsetci ? "" : '<div class="field"><span class="label">Členovia</span><div class="chips chat-f-cl">' + ludia.map(function (x) {
          return '<button type="button" class="chip" data-ch-clen="' + esc(x.uid) + '" aria-pressed="' + ((d.clenovia || []).indexOf(x.uid) > -1) + '">' + esc(x.meno) + "</button>";
        }).join("") + "</div></div>") +
        (d.id ? '<label class="chat-f-vsetci"><input type="checkbox" id="chat-sk-archiv"' + (d.archiv ? " checked" : "") + "> Archivovať (skupina sa skryje, správy ostanú)</label>" : "") +
        '<div class="f-akcie"><button class="btn btn-primary" type="submit"' + (C.prace ? " disabled" : "") + ">" + (C.prace ? "Ukladám…" : "Uložiť") + '</button><button class="btn" type="button" data-ch="zavri">Zrušiť</button></div></form>');
    }
    if (d.typ === "info") {
      var k = (C.zoznam || []).filter(function (x) { return x.id === C.konv; })[0] || {};
      var cl = (C.data && C.data.clenovia) || [], ja = cl.filter(function (x) { return x.uid === C.ja; })[0] || {};
      var pr = (C.data && C.data.pripnute) || [];
      return obal("<h3>" + esc(k.nazov || "Konverzácia") + "</h3>" +
        '<label class="chat-f-vsetci"><input type="checkbox" id="chat-stlm"' + (ja.stlmene ? " checked" : "") + "> 🔕 Stlmiť (bez upozornení do mobilu)</label>" +
        (pr.length ? '<div class="field"><span class="label">📌 Pripnuté</span><div class="rows">' + pr.map(function (x) {
          return '<div class="row"><span><b>' + esc(x.meno) + ":</b> " + esc(String(x.text || "").slice(0, 120)) + "</span>" + (C.spravca ? '<button class="btn-link" data-ch-odopni="' + x.id + '">Odopnúť</button>' : "") + "</div>";
        }).join("") + "</div></div>" : "") +
        '<div class="field"><span class="label">Členovia (' + cl.length + ')</span><div class="chips">' + cl.map(function (x) { return '<span class="chip">' + esc(x.meno) + "</span>"; }).join("") + "</div></div>" +
        '<div class="f-akcie">' + (C.spravca && k.typ === "skupina" ? '<button class="btn" data-ch="uprav-skupinu">✏️ Upraviť skupinu</button>' : "") + '<button class="btn btn-primary" data-ch="zavri">Hotovo</button></div>');
    }
    if (d.typ === "menu") {
      var s = C.spravy.filter(function (x) { return x.id === d.id; })[0] || {};
      return obal('<h3>Správa</h3><div class="chat-menu">' +
        (!s.zmazane && !(C.data && C.data.konv && C.data.konv.archiv) ? '<button class="btn" data-ch="odpovedz">↩️ Odpovedať</button>' : "") +
        (s.text ? '<button class="btn" data-ch="kopiruj">📋 Kopírovať text</button>' : "") +
        (C.spravca ? '<button class="btn" data-ch="pripni">' + (s.pripnute ? "📌 Odopnúť" : "📌 Pripnúť pre všetkých") + "</button>" : "") +
        (s.uid === C.ja || C.spravca ? '<button class="btn chat-zmaz" data-ch="zmaz">🗑 Zmazať správu</button>' : "") +
        '<button class="btn" data-ch="zavri">Zrušiť</button></div>');
    }
    if (d.typ === "obr") {
      return '<div class="chat-obr-full" data-ch="zavri"><img src="' + esc(d.url) + '" alt=""><button class="chat-obr-x" data-ch="zavri" aria-label="Zavrieť">✕</button>' +
        '<a class="btn chat-obr-st" href="' + esc(d.url) + '" target="_blank" rel="noopener" download>⬇ Stiahnuť</a></div>';
    }
    return "";
  }
  function otvorDialog(d) { C.dialog = d; kresliDialog(); }
  function kresliDialog() {
    if (!koren) return;
    var obal = document.getElementById("chat-dialog-obal");
    if (!obal) { obal = document.createElement("div"); obal.id = "chat-dialog-obal"; koren.appendChild(obal); }
    obal.innerHTML = dialogHtml();
    var h = document.getElementById("chat-hladaj-l"); if (h && C.dialog && C.dialog.fokus) { h.focus(); h.setSelectionRange(h.value.length, h.value.length); }
  }
  function nacitajLudi() {
    if (C.ludia) return Promise.resolve(C.ludia);
    return rpc("chat_ludia").then(function (l) { C.ludia = l || []; kresliDialog(); return C.ludia; });
  }

  // ---------- odoslanie ----------
  function zmensi(file) {
    return new Promise(function (ok) {
      if (!/^image\//.test(file.type) || /gif$/.test(file.type)) { ok(file); return; }
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { ok(b ? new File([b], (file.name || "fotka").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file); }, "image/jpeg", 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); ok(file); };
      img.src = url;
    });
  }
  function bezDiak(t) { return String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-60); }
  function posli(text, subor, extra) {
    var id = extra && extra.konv != null ? extra.konv : C.konv; if (id == null || C.prace) return;
    text = String(text || "").trim();
    if (!text && !subor) return;
    C.prace = true; nastavTl();
    var nahraj = subor ? zmensi(subor).then(function (f) {
      if (f.size > 15 * 1024 * 1024) throw new Error("Súbor je väčší ako 15 MB");
      var cesta = id + "/" + Date.now() + "_" + bezDiak(f.name || "subor");
      return DB.storage.from("chat").upload(cesta, f, { contentType: f.type || "application/octet-stream" }).then(function (r) {
        if (r.error) throw r.error;
        var pr = { cesta: cesta, nazov: (extra && extra.nazov) || f.name || subor.name, typ: f.type || "", velkost: f.size };
        if (extra && extra.trvanie) pr.trvanie = extra.trvanie;
        return pr;
      });
    }) : Promise.resolve(null);
    var odp = C.odpoved && C.odpoved.konv === id ? C.odpoved : null;
    nahraj.then(function (pr) { return rpc("chat_posli", { p_konv: id, p_text: text, p_priloha: pr, p_odpoved: odp ? odp.id : null }); }).then(function (r) {
      C.prace = false; nastavTl();
      if (!r || !r.ok) { lbzInfo((r && r.text) || "Správa neodišla"); return; }
      if (odp && C.odpoved === odp) { C.odpoved = null; kresliOdp(); }
      var t = document.getElementById("chat-text"); if (t && !subor) { t.value = ""; vyska(t); }
      if (C.konv === id && !C.spravy.some(function (x) { return x.id === r.id; })) {   // ak Realtime ešte neprišlo, doplníme hneď
        C.spravy.push({ id: r.id, uid: C.ja, text: text || null, priloha: null, pripnute: false, zmazane: false, kedy: new Date().toISOString(), odpoved_na: odp ? odp.id : null, odpoved: odp ? odp.nahlad : null });
        kresliSpravy(); dole();
        if (subor) rpc("chat_spravy", { p_konv: id }).then(function (d) { if (d && d.ok && C.konv === id) { C.spravy = d.spravy; kresliSpravy(); dole(); } });
      }
      var kk = (C.zoznam || []).filter(function (x) { return x.id === id; })[0];
      if (kk) { kk.posledna = new Date().toISOString(); kk.sprava = { text: text || (extra && extra.nazov) || "📎 " + (subor ? subor.name : "príloha"), ja: true, kedy: kk.posledna }; C.zoznam.sort(function (a, b) { return String(b.posledna).localeCompare(String(a.posledna)); }); kresliZoznam(); }
      DB.functions.invoke("upozornenia", { body: { akcia: "chat", id: r.id } }).catch(function () { /* */ });
    }).catch(function (e) { C.prace = false; nastavTl(); lbzInfo("Správa neodišla: " + chybaText(e)); });
  }
  function nastavTl() { var b = document.querySelector(".chat-posli"); if (b) { b.disabled = C.prace; b.textContent = C.prace ? "…" : "➤"; } }

  // ---------- udalosti ----------
  // ---------- odpoveď na konkrétnu správu ----------
  function nahladSpravy(x) {
    if (!x) return "";
    if (x.zmazane) return "Správa bola zmazaná";
    var p = x.priloha || {};
    if (x.text) return String(x.text).replace(/\s+/g, " ").slice(0, 140);
    if (/^audio\//.test(p.typ || "")) return "🎤 Hlasová správa";
    if (/^image\//.test(p.typ || "")) return "📷 Fotka";
    return "📎 " + (p.nazov || "Príloha");
  }
  function citat(s) {
    if (!s.odpoved_na) return "";
    var o = s.odpoved || C.spravy.filter(function (x) { return x.id === s.odpoved_na; })[0];
    return '<button type="button" class="chat-cit" data-ch-cit="' + s.odpoved_na + '"><b>↩️ ' + esc(o ? (o.uid === C.ja ? "Ty" : meno(o.uid)) : "Odpoveď") + "</b><span>" + esc(o ? nahladSpravy(o) : "na staršiu správu") + "</span></button>";
  }
  function nastavOdp(so) {
    C.odpoved = { id: so.id, konv: C.konv, nahlad: { id: so.id, uid: so.uid, zmazane: so.zmazane, text: so.text ? String(so.text).slice(0, 160) : null, priloha: so.priloha ? { nazov: so.priloha.nazov, typ: so.priloha.typ } : null } };
    kresliOdp();
    var t = document.getElementById("chat-text"); if (t) t.focus();
  }
  function kresliOdp() {
    var b = document.getElementById("chat-odp-bar"); if (!b) return;
    var o = C.odpoved && C.odpoved.konv === C.konv ? C.odpoved.nahlad : null;
    b.innerHTML = o ? '<div class="chat-odp"><span class="chat-odp-t"><b>↩️ Odpovedáš ' + esc(o.uid === C.ja ? "sebe" : meno(o.uid)) + "</b><span>" + esc(nahladSpravy(o)) + "</span></span>" +
      '<button type="button" class="chat-odp-x" data-ch="odp-zrus" aria-label="Zrušiť odpoveď">✕</button></div>' : "";
  }
  function skocNa(id) {
    var el = document.getElementById("chat-m-" + id);
    if (!el) { lbzInfo("Pôvodná správa je staršia – načítaj „Staršie správy“ hore."); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("chat-blik"); void el.offsetWidth; el.classList.add("chat-blik");
  }
  // potiahnutie správy doprava = odpovedať (ako v Messengeri)
  var tah = null;
  document.addEventListener("touchstart", function (e) {
    var m = e.target.closest && e.target.closest(".chat-msg"); if (!m || !koren || !koren.contains(m) || e.touches.length !== 1) { tah = null; return; }
    tah = { el: m, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0 };
  }, { passive: true });
  document.addEventListener("touchmove", function (e) {
    if (!tah) return;
    var dx = e.touches[0].clientX - tah.x, dy = e.touches[0].clientY - tah.y;
    if (Math.abs(dy) > 30 && Math.abs(dy) > Math.abs(dx)) { tah.el.style.transform = ""; tah = null; return; }
    tah.dx = Math.max(0, Math.min(dx, 80)); tah.el.style.transform = tah.dx ? "translateX(" + tah.dx + "px)" : "";
  }, { passive: true });
  document.addEventListener("touchend", function () {
    if (!tah) return;
    var t = tah; tah = null; t.el.style.transform = "";
    if (t.dx >= 60) {
      var id = +String(t.el.id || "").replace("chat-m-", "");
      var so = C.spravy.filter(function (x) { return x.id === id; })[0];
      if (so && !so.zmazane && !(C.data && C.data.konv && C.data.konv.archiv)) { if (navigator.vibrate) navigator.vibrate(15); nastavOdp(so); }
    }
  }, { passive: true });

  // ---------- hlasové správy ----------
  var NAHR = null;
  function mmss(s) { s = Math.max(0, Math.round(+s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
  function hlasMozna() { return !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
  function hlasTyp() {
    var t = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    for (var i = 0; i < t.length; i++) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t[i])) return t[i];
    return "";
  }
  function hlasUI() {
    var f = document.getElementById("chat-pis"); if (f) f.classList.toggle("chat-nahrava", !!NAHR);
    var c = document.getElementById("chat-rec-cas"); if (c && NAHR) c.textContent = mmss((Date.now() - NAHR.start) / 1000);
  }
  function hlasStart() {
    if (NAHR || C.konv == null || C.prace) return;
    if (!hlasMozna()) { lbzInfo("Tento prehliadač nevie nahrávať zvuk"); return; }
    var konv = C.konv;
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      var typ = hlasTyp(), rec;
      try { rec = typ ? new MediaRecorder(stream, { mimeType: typ, audioBitsPerSecond: 32000 }) : new MediaRecorder(stream); }
      catch (_) { rec = new MediaRecorder(stream); }
      var n = NAHR = { rec: rec, chunks: [], start: Date.now(), stream: stream, konv: konv, poslat: false };
      rec.ondataavailable = function (e) { if (e.data && e.data.size) n.chunks.push(e.data); };
      rec.onstop = function () { hlasHotovo(n); };
      rec.start(1000);
      n.timer = setInterval(hlasUI, 500);
      n.max = setTimeout(function () { hlasStop(true); }, 5 * 60e3);   // najviac 5 minút
      if (navigator.vibrate) navigator.vibrate(30);
      hlasUI();
    }).catch(function () { lbzInfo("Mikrofón nie je povolený. Povoľ ho v nastaveniach telefónu / prehliadača pre appku LBZ."); });
  }
  function hlasStop(poslat) {
    var n = NAHR; if (!n) return;
    n.poslat = poslat; n.sek = Math.round((Date.now() - n.start) / 1000);
    clearInterval(n.timer); clearTimeout(n.max);
    if (n.rec.state === "inactive") hlasHotovo(n); else { try { n.rec.stop(); } catch (_) { hlasHotovo(n); } }
  }
  function hlasHotovo(n) {
    if (n.hotovo) return; n.hotovo = true;
    n.stream.getTracks().forEach(function (t) { t.stop(); });
    if (NAHR === n) NAHR = null;
    hlasUI();
    if (!n.poslat) return;
    if (!n.chunks.length || n.sek < 1) { lbzInfo("Hlasová správa je príliš krátka – podrž aspoň sekundu"); return; }
    var typ = String(n.rec.mimeType || n.chunks[0].type || "audio/webm").split(";")[0];
    var ext = /mp4|aac|m4a/.test(typ) ? "m4a" : /ogg/.test(typ) ? "ogg" : "webm";
    var f = new File(n.chunks, "hlasovka_" + Date.now() + "." + ext, { type: typ });
    posli("", f, { konv: n.konv, nazov: "🎤 Hlasová správa " + mmss(n.sek), trvanie: n.sek });
  }
  document.addEventListener("pause", function (e) { if (e.target && e.target.tagName === "AUDIO" && C.odlozKresli) { C.odlozKresli = false; setTimeout(kresliSpravy, 50); } }, true);
  document.addEventListener("ended", function (e) { if (e.target && e.target.tagName === "AUDIO" && C.odlozKresli) { C.odlozKresli = false; setTimeout(kresliSpravy, 50); } }, true);

  function klik(e) {
    var t = e.target.closest("button, [data-ch]"); if (!t || !koren.contains(t)) return;
    var d = t.dataset;
    if (d.chKonv) { otvor(+d.chKonv); return; }
    if (d.chClovek) {
      C.dialog = null; kresliDialog();
      rpc("chat_priama", { p_uid: d.chClovek }).then(function (r) {
        if (!r || !r.ok) { lbzInfo((r && r.text) || "Nepodarilo sa"); return; }
        return nacitajZoznam().then(function () { otvor(r.id); });
      }).catch(function (x) { lbzInfo(chybaText(x)); });
      return;
    }
    if (d.chClen) {
      var cl = C.dialog.clenovia || (C.dialog.clenovia = []), ix = cl.indexOf(d.chClen);
      if (ix > -1) cl.splice(ix, 1); else cl.push(d.chClen);
      t.setAttribute("aria-pressed", ix === -1); return;
    }
    if (d.chMenu) { otvorDialog({ typ: "menu", id: +d.chMenu }); return; }
    if (d.chCit) { skocNa(+d.chCit); return; }
    if (d.chObr) { podpisanaUrl(d.chObr).then(function (u) { otvorDialog({ typ: "obr", url: u }); }).catch(function (x) { lbzInfo(chybaText(x)); }); return; }
    if (d.chSubor) {
      var data = DB.storage.from("chat").download(d.chSubor).then(function (r) { if (r.error || !r.data) throw r.error || new Error("Súbor sa nenašiel"); return r.data; });
      if (/pdf/.test(d.typ) && window.lbzPdf) window.lbzPdf(String(d.nazov).replace(/\.pdf$/i, ""), data);
      else podpisanaUrl(d.chSubor).then(function (u) { window.open(u, "_blank"); }).catch(function (x) { lbzInfo(chybaText(x)); });
      return;
    }
    if (d.chSkoc) { var m = document.getElementById("chat-m-" + d.chSkoc); if (m) { m.scrollIntoView({ block: "center", behavior: "smooth" }); m.classList.add("chat-blik"); setTimeout(function () { m.classList.remove("chat-blik"); }, 1600); } else lbzInfo("Pripnutá správa je staršia – načítaj staršie správy."); return; }
    if (d.chOdopni) { rpc("chat_sprava_uprav", { p_id: +d.chOdopni, p_akcia: "odopni" }).then(function () { obnovPripnute(); C.dialog = null; kresliDialog(); }); return; }
    switch (d.ch) {
      case "hlas": hlasStart(); return;
      case "hlas-zrus": hlasStop(false); return;
      case "hlas-posli": hlasStop(true); return;
      case "zavri": if (e.target !== t && t.classList.contains("chat-obr-full") && e.target.closest("a")) return; C.dialog = null; kresliDialog(); return;
      case "spat": C.konv = null; C.data = null; if (window.lbzPamat) lbzPamat.uloz("chat", {}); kresli(); nacitajZoznam(); return;
      case "nova": otvorDialog({ typ: "nova", fokus: true }); nacitajLudi(); return;
      case "skupina": otvorDialog({ typ: "skupina", clenovia: [], ikona: "👥" }); nacitajLudi(); return;
      case "uprav-skupinu":
        var k = (C.zoznam || []).filter(function (x) { return x.id === C.konv; })[0] || {};
        otvorDialog({ typ: "skupina", id: k.id, nazov: k.nazov, ikona: k.ikona, vsetci: k.vsetci, archiv: k.archiv, clenovia: ((C.data && C.data.clenovia) || []).map(function (x) { return x.uid; }) });
        nacitajLudi(); return;
      case "info": otvorDialog({ typ: "info" }); return;
      case "starsie": starsie(); return;
      case "odpovedz":
        var so = C.spravy.filter(function (x) { return x.id === C.dialog.id; })[0];
        C.dialog = null; kresliDialog(); if (so) nastavOdp(so); return;
      case "odp-zrus": C.odpoved = null; kresliOdp(); return;
      case "kopiruj":
        var s1 = C.spravy.filter(function (x) { return x.id === C.dialog.id; })[0];
        if (s1 && navigator.clipboard) navigator.clipboard.writeText(s1.text || "");
        C.dialog = null; kresliDialog(); return;
      case "pripni":
        var s2 = C.spravy.filter(function (x) { return x.id === C.dialog.id; })[0] || {};
        rpc("chat_sprava_uprav", { p_id: C.dialog.id, p_akcia: s2.pripnute ? "odopni" : "pripni" }).then(function (r) { if (r && !r.ok) lbzInfo(r.text); obnovPripnute(); });
        C.dialog = null; kresliDialog(); return;
      case "zmaz":
        if (!lbzPotvrd("Zmazať túto správu?\n\nUvidia ju ako „Správa bola zmazaná“.")) return;
        rpc("chat_sprava_uprav", { p_id: C.dialog.id, p_akcia: "zmaz" }).then(function (r) { if (r && !r.ok) lbzInfo(r.text); });
        C.dialog = null; kresliDialog(); return;
    }
  }
  function odoslanie(e) {
    if (e.target.id === "chat-pis") { e.preventDefault(); var t = document.getElementById("chat-text"); posli(t ? t.value : ""); return; }
    if (e.target.id === "chat-skupina-form") {
      e.preventDefault();
      var dd = C.dialog, vs = document.getElementById("chat-sk-vsetci").checked, ar = document.getElementById("chat-sk-archiv");
      C.prace = true; kresliDialog();
      rpc("chat_skupina_uloz", { p: { id: dd.id || null, nazov: document.getElementById("chat-sk-nazov").value, ikona: document.getElementById("chat-sk-ikona").value,
        vsetci: vs, clenovia: dd.clenovia || [], archiv: ar ? ar.checked : false } }).then(function (r) {
        C.prace = false;
        if (!r || !r.ok) { kresliDialog(); lbzInfo((r && r.text) || "Neuložené"); return; }
        C.dialog = null; kresliDialog();
        nacitajZoznam().then(function () { otvor(r.id); });
      }).catch(function (x) { C.prace = false; kresliDialog(); lbzInfo(chybaText(x)); });
    }
  }
  function vstup(e) {
    var t = e.target;
    if (t.id === "chat-text") { vyska(t); return; }
    if (t.id === "chat-hladaj-l") { C.dialog.hladaj = t.value; C.dialog.fokus = true; kresliDialog(); return; }
    if (t.id === "chat-sk-vsetci") { C.dialog.vsetci = t.checked; C.dialog.nazov = document.getElementById("chat-sk-nazov").value; C.dialog.ikona = document.getElementById("chat-sk-ikona").value; kresliDialog(); return; }
  }
  function zmena(e) {
    var t = e.target;
    if (t.id === "chat-subor" && t.files && t.files[0]) { var f = t.files[0]; t.value = ""; var tx = document.getElementById("chat-text"); posli(tx ? tx.value : "", f); if (tx) { tx.value = ""; vyska(tx); } return; }
    if (t.id === "chat-stlm") {
      rpc("chat_stlm", { p_konv: C.konv, p_stlm: t.checked }).then(function () {
        var k = (C.zoznam || []).filter(function (x) { return x.id === C.konv; })[0]; if (k) k.stlmene = t.checked;
        var j = ((C.data && C.data.clenovia) || []).filter(function (x) { return x.uid === C.ja; })[0]; if (j) j.stlmene = t.checked;
        kresliZoznam(); nacitajPocet();
      });
    }
  }
  function klaves(e) {
    if (e.target.id !== "chat-text" || e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    if (!siroka() && !e.ctrlKey && !e.metaKey) return;   // v mobile Enter = nový riadok, odosiela sa tlačidlom
    e.preventDefault(); posli(e.target.value);
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible" || !DB) return;
    if (koren && koren.isConnected) { nacitajZoznam(); if (C.konv != null) rpc("chat_spravy", { p_konv: C.konv }).then(function (d) { if (d && d.ok && C.konv != null) { C.data = d; C.spravy = d.spravy; C.viac = !!d.viac; kresliHlavicku(); kresliSpravy(); dole(); } }); }
    else nacitajPocet();
  });
  window.addEventListener("resize", function () { if (koren && koren.isConnected && !!document.querySelector(".chat-siroky") !== siroka()) kresli(); });

  window.LBZ_CHAT = {
    nastavDb: function (klient, rola) {
      odpojRealtime();
      DB = klient || null; ROLA = klient ? rola : null;
      C.zoznam = null; C.konv = null; C.data = null; C.spravy = []; C.ludia = null; C.dialog = null; C.neprecitane = 0; C.url = {};
      if (this.mozem()) { nacitajPocet(); pripojRealtime(); }
    },
    mozem: function () { return !!DB && ROLY_CHAT.indexOf(ROLA) > -1; },
    odznak: odznak,
    pocet: function () { return C.neprecitane; },
    otvorKonv: function (id) { if (id) { C.konv = +id; if (window.lbzPamat) lbzPamat.uloz("chat", { konv: +id }); } },
    mount: function (el) {
      var novy = koren !== el; koren = el;
      if (novy) {
        el.addEventListener("click", klik); el.addEventListener("submit", odoslanie); el.addEventListener("input", vstup);
        el.addEventListener("change", zmena); el.addEventListener("keydown", klaves);
      }
      var pam = window.lbzPamat && lbzPamat.nacitaj("chat");
      if (C.konv == null && pam && pam.konv && siroka()) C.konv = pam.konv;
      var chcem = C.konv;
      kresli();
      nacitajZoznam().then(function () {
        if (chcem != null && (C.zoznam || []).some(function (k) { return k.id === chcem; })) { if (!C.data || C.data.konv.id !== chcem) otvor(chcem); }
        else if (chcem != null) { C.konv = null; kresli(); }
      });
    }
  };
})();
