// LBZ – upozornenia do mobilu (web push)
// akcie:
//   kluc      – verejný VAPID kľúč pre appku (bez prihlásenia)
//   ziadost   – nová žiadosť v dochádzke → upozornenie IT a CEO (volá appka zamestnanca po odoslaní žiadosti)
//   test      – skúšobné upozornenie prihlásenému používateľovi
//   kontrola  – plánovač (pg_cron, hlavička x-lbz-cron): šichty dlhšie ako 14 h → zamestnanec + vedenie;
//               ráno 8:00 – 8:30: zdravotný preukaz končí o 30 alebo 7 dní → zamestnanec + vedenie
//   chat      – nová správa v chate → ostatní členovia konverzácie (okrem stlmených)
// Kľúče: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY v trezore Supabase (Edge Function Secrets).
import webpush from "npm:web-push@3.6.7";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
function kluc(...mena: string[]) {
  for (const m of mena) {
    const v = Deno.env.get(m); if (!v) continue;
    if (v.trim().startsWith("{")) { try { const o = JSON.parse(v); const x = o.default || Object.values(o)[0]; if (x) return String(x); } catch (_) { /* */ } }
    return v;
  }
  return "";
}
const SERVICE = kluc("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS");
const ANON = kluc("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS");
const VAPID_PUB = (Deno.env.get("VAPID_PUBLIC_KEY") || "").trim();
const VAPID_PRIV = (Deno.env.get("VAPID_PRIVATE_KEY") || "").trim();
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const odpoved = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const TYPY: Record<string, string> = { dovolenka: "Dovolenka", pn: "PN", ocr: "OČR", lekar: "Lekár", oprava: "Oprava záznamu" };

function hl(k: string, extra: Record<string, string> = {}) { return { apikey: k, Authorization: "Bearer " + k, "Content-Type": "application/json", ...extra }; }
async function rest(cesta: string, init: RequestInit = {}) {
  const r = await fetch(SB_URL + "/rest/v1/" + cesta, { ...init, headers: { ...hl(SERVICE), ...(init.headers || {}) } });
  if (!r.ok) throw new Error("DB " + r.status + ": " + (await r.text()).slice(0, 200));
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
async function rpc(fn: string, args: unknown) { return rest("rpc/" + fn, { method: "POST", body: JSON.stringify(args || {}) }); }
function datumSk(s: string) { const p = String(s).slice(0, 10).split("-"); return +p[2] + ". " + +p[1] + "."; }

// pošle upozornenie všetkým zariadeniam daných používateľov; neplatné odbery zmaže
async function posli(uids: string[], sprava: { title: string; body: string; url?: string; tag?: string }) {
  if (!uids.length) return 0;
  webpush.setVapidDetails("mailto:ceo@legendarnebuchty.sk", VAPID_PUB, VAPID_PRIV);
  const odbery = await rest("push_odbery?select=endpoint,p256dh,auth&uid=in.(" + uids.join(",") + ")");
  let n = 0;
  for (const o of odbery || []) {
    try {
      await webpush.sendNotification({ endpoint: o.endpoint, keys: { p256dh: o.p256dh, auth: o.auth } }, JSON.stringify(sprava), { TTL: 86400, urgency: "high" });   // high = doručí aj keď telefón spí a appka je zavretá
      n++;
    } catch (e: any) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) await rest("push_odbery?endpoint=eq." + encodeURIComponent(o.endpoint), { method: "DELETE" });
    }
  }
  return n;
}
async function vedenie(): Promise<string[]> {
  const p = await rest("profily?select=id&aktivny=eq.true&rola=in.(it,ceo)");
  return (p || []).map((x: any) => x.id);
}
async function uidyOsoby(osobaId: number): Promise<string[]> {
  const o = await rest("rozpis_osoby?select=email,email2&id=eq." + osobaId);
  const em = [o?.[0]?.email, o?.[0]?.email2].filter(Boolean).map((x: string) => x.toLowerCase());
  if (!em.length) return [];
  const p = await rest("profily?select=id,email&aktivny=eq.true");
  return (p || []).filter((x: any) => em.includes(String(x.email || "").toLowerCase())).map((x: any) => x.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const akcia = String(body.akcia || "");
    if (akcia === "kluc") return odpoved({ ok: !!VAPID_PUB, kluc: VAPID_PUB });
    if (!VAPID_PUB || !VAPID_PRIV) return odpoved({ ok: false, text: "Chýbajú kľúče VAPID v trezore" });

    const cron = req.headers.get("x-lbz-cron");
    if (cron) {
      if (!(await rpc("furmanky_cron_ok", { p_token: cron }))) return odpoved({ ok: false, text: "Neplatný token" }, 401);
      if (akcia !== "kontrola") return odpoved({ ok: false, text: "Neznáma akcia" }, 400);
      const hranica = new Date(Date.now() - 14 * 3600 * 1000).toISOString();
      const dlhe = await rest("dochadzka?select=id,osoba_id,prichod,miesto,rozpis_osoby(meno)&typ=eq.praca&odchod=is.null&upozornene=is.null&zdroj=neq.import&prichod=lt." + encodeURIComponent(hranica));
      const ved = await vedenie();
      let n = 0;
      for (const d of dlhe || []) {
        const meno = d.rozpis_osoby?.meno || "Zamestnanec";
        n += await posli(await uidyOsoby(d.osoba_id), { title: "⏰ Si stále v práci?", body: "Príchod si zapísal(a) pred viac ako 14 hodinami. Nezabudni zapísať ODCHOD.", url: "/", tag: "doch-" + d.id });
        n += await posli(ved, { title: "⏰ " + meno + " – 14 h v práci", body: "Stále nemá zapísaný odchod (" + (d.miesto || "") + "). Skontroluj v Dochádzke → Tím.", url: "/?m=dochadzka&z=tim", tag: "doch-v-" + d.id });
        await rest("dochadzka?id=eq." + d.id, { method: "PATCH", body: JSON.stringify({ upozornene: new Date().toISOString() }), headers: { Prefer: "return=minimal" } });
      }
      // zdravotné preukazy – raz denne ráno (plánovač beží každých 30 min)
      const teraz = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Bratislava" }));
      let preukazy = 0;
      if (teraz.getHours() === 8 && teraz.getMinutes() < 30) {
        const iso = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        for (const dni of [30, 7]) {
          const d = new Date(teraz); d.setDate(d.getDate() + dni);
          const z = await rest("zamestnanci?select=osoba_id,pozicia,zdrav_preukaz_do,rozpis_osoby(meno,aktivny)&zdrav_preukaz_do=eq." + iso(d));
          for (const x of z || []) {
            if (!x.rozpis_osoby?.aktivny || /^Rozvozár/.test(x.pozicia || "")) continue;   // rozvoz balených potravín preukaz nepotrebuje
            const meno = x.rozpis_osoby?.meno || "Zamestnanec";
            preukazy += await posli(await uidyOsoby(x.osoba_id), { title: "🩺 Zdravotný preukaz končí o " + dni + " dní", body: "Platí do " + datumSk(x.zdrav_preukaz_do) + ". Vybav si obnovu a nahraj nový preukaz v appke (Moje údaje).", url: "/?m=zamestnanci", tag: "zdrav-" + x.osoba_id + "-" + dni });
            preukazy += await posli(ved, { title: "🩺 " + meno + ": preukaz končí o " + dni + " dní", body: "Zdravotný preukaz platí do " + datumSk(x.zdrav_preukaz_do) + ".", url: "/?m=zamestnanci", tag: "zdrav-v-" + x.osoba_id + "-" + dni });
          }
        }
      }
      return odpoved({ ok: true, dlhe: (dlhe || []).length, poslane: n, preukazy });
    }

    // ostatné akcie – prihlásený používateľ
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const u = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: "Bearer " + jwt } });
    if (!u.ok) return odpoved({ ok: false, text: "Treba sa prihlásiť" }, 401);
    const pouz = await u.json();

    if (akcia === "test") {
      const n = await posli([pouz.id], { title: "🔔 Legendárne buchty", body: "Upozornenia fungujú. Takto ti budú chodiť správy z appky.", url: "/" });
      return odpoved({ ok: n > 0, text: n ? "Skúšobné upozornenie odoslané" : "Toto zariadenie nemá zapnuté upozornenia" });
    }
    if (akcia === "chat") {
      const s = (await rest("chat_sprava?select=id,konv_id,uid,text,priloha,chat_konv(typ,nazov,ikona)&id=eq." + Number(body.id)))?.[0];
      if (!s || s.uid !== pouz.id) return odpoved({ ok: false, text: "Správa sa nenašla" });
      const cl = await rest("chat_clen?select=uid&konv_id=eq." + s.konv_id + "&stlmene=eq.false&uid=neq." + pouz.id);
      const od = (await rest("profily?select=meno,email&id=eq." + pouz.id))?.[0];
      const meno = (od?.meno || String(od?.email || "").split("@")[0] || "Niekto").trim();
      const text = s.text ? String(s.text).slice(0, 180) : "📎 " + (s.priloha?.nazov || "príloha");
      const skupina = s.chat_konv?.typ === "skupina";
      const n = await posli((cl || []).map((x: any) => x.uid), {
        title: skupina ? (s.chat_konv?.ikona || "💬") + " " + (s.chat_konv?.nazov || "Skupina") : "💬 " + meno,
        body: skupina ? meno.split(" ")[0] + ": " + text : text, url: "/?m=chat&k=" + s.konv_id, tag: "chat-" + s.konv_id + "-" + s.id });   // každá správa zvlášť → Android ukáže na ikone počet správ
      return odpoved({ ok: true, poslane: n });
    }
    if (akcia === "rozpis") {
      // žiadosť o zmenu smeny: nová → kolega (namiesto / výmena) alebo vedenie (nová smena / odhlásenie); rozhodnutie → žiadateľ a kolega
      const z = (await rest("rozpis_ziadosti?select=id,typ,stav,ziadatel,osoba_b,miesto_a,miesto_b,datum,pozicia,potvrdzuje,kto,vybavil&id=eq." + Number(body.id)))?.[0];
      if (!z) return odpoved({ ok: false, text: "Žiadosť sa nenašla" });
      const meno = async (id: number) => (await rest("rozpis_osoby?select=meno&id=eq." + id))?.[0]?.meno || "?";
      const smena = async (id: number | null) => id ? await rpc("rozpis_miesto_popis", { p_id: id }) : "";
      const zm = await meno(z.ziadatel), km = z.osoba_b ? await meno(z.osoba_b) : "";
      const popis = z.typ === "prevziat" ? zm + " chce ísť namiesto " + km + " (" + await smena(z.miesto_b) + ")"
        : z.typ === "pridat" ? zm + " sa chce zapísať na smenu (" + (z.miesto_b ? await smena(z.miesto_b) : datumSk(z.datum) + " " + z.pozicia) + ")"
        : z.typ === "odhlasit" ? zm + " sa chce odhlásiť zo smeny (" + await smena(z.miesto_a) + ")"
        : z.typ === "odovzdat" ? zm + " odovzdáva smenu " + km + " (" + await smena(z.miesto_a) + ")"
        : zm + " (" + await smena(z.miesto_a) + ") ↔ " + km + " (" + await smena(z.miesto_b) + ")";
      let n = 0;
      if (body.udalost === "nova" && z.kto === pouz.id && z.stav === "caka") {
        if (z.potvrdzuje === "kolega" && z.osoba_b) {
          n = await posli(await uidyOsoby(z.osoba_b), { title: "🔄 " + zm + " – zmena smeny", body: popis + " – ťukni a potvrď", url: "/?m=rozpis", tag: "roz-z-" + z.id + "-" });
        } else {
          const p = await rest("profily?select=id&aktivny=eq.true&rola=in.(it,ceo,prevadzkar)");
          n = await posli((p || []).map((x: any) => x.id), { title: "🔄 Žiadosť o zmenu smeny", body: popis + " – ťukni a potvrď", url: "/?m=rozpis", tag: "roz-z-" + z.id + "-" });
        }
      } else if (body.udalost === "rozhodnutie" && z.vybavil === pouz.id && z.stav !== "caka") {
        const vys = z.stav === "schvalena" ? "✅ potvrdená" : z.stav === "zamietnuta" ? "❌ zamietnutá" : "⚠️ neplatná (smeny sa zmenili)";
        const uids = [...await uidyOsoby(z.ziadatel), ...(z.osoba_b ? await uidyOsoby(z.osoba_b) : [])];
        n = await posli(uids, { title: "🔄 Zmena smeny " + vys, body: popis, url: "/?m=rozpis", tag: "roz-z-" + z.id + "-" });
      }
      return odpoved({ ok: true, poslane: n });
    }
    if (akcia === "uloha") {
      // nová úloha → prijímatelia (alebo všetci so smenou v ten deň pri úlohe „na deň“)
      const t = (await rest("ulohy?select=id,text,datum,termin,na_den,vytvoril&id=eq." + Number(body.id)))?.[0];
      if (!t || t.vytvoril !== pouz.id) return odpoved({ ok: false, text: "Úloha sa nenašla" });
      let osoby: number[] = [];
      if (t.na_den) osoby = ((await rest("rozpis_miesta?select=osoba_id&datum=eq." + t.datum + "&osoba_id=not.is.null")) || []).map((x: any) => x.osoba_id);
      else osoby = ((await rest("ulohy_prijemci?select=osoba_id&uloha_id=eq." + t.id)) || []).map((x: any) => x.osoba_id);
      const uids = new Set<string>();
      for (const o of [...new Set(osoby)]) for (const u of await uidyOsoby(o)) if (u !== pouz.id) uids.add(u);
      const n = await posli([...uids], { title: "📋 Nová úloha" + (t.termin ? " – do " + datumSk(t.termin) : ""), body: String(t.text).slice(0, 180), url: "/", tag: "uloha-" + t.id + "-" });
      return odpoved({ ok: true, poslane: n });
    }
    if (akcia === "udaje") {
      // zamestnanec žiada o zmenu osobných údajov → IT a CEO
      const z = (await rest("zamestnanci_ziadosti?select=id,rozpis_osoby(meno)&stav=eq.ziadost&kto=eq." + pouz.id + "&order=id.desc&limit=1"))?.[0];
      if (!z) return odpoved({ ok: false, text: "Žiadosť sa nenašla" });
      const n = await posli(await vedenie(), { title: "👤 " + (z.rozpis_osoby?.meno || "Zamestnanec") + " – zmena údajov", body: "Žiada o zmenu osobných údajov – ťukni a schváľ v appke", url: "/?m=zamestnanci", tag: "udaje-" + z.id });
      return odpoved({ ok: true, poslane: n });
    }
    if (akcia === "ziadost") {
      // posledná čakajúca žiadosť, ktorú tento používateľ práve poslal
      const z = await rest("dochadzka_absencie?select=id,typ,od_dna,do_dna,cas_od,cas_do,poznamka,rozpis_osoby(meno)&stav=eq.ziadost&kto=eq." + pouz.id + "&order=id.desc&limit=1");
      const x = z?.[0]; if (!x) return odpoved({ ok: false, text: "Žiadosť sa nenašla" });
      const kedy = datumSk(x.od_dna) + (x.do_dna !== x.od_dna ? " – " + datumSk(x.do_dna) : "") + (x.cas_od ? " " + String(x.cas_od).slice(0, 5) + "–" + String(x.cas_do || "").slice(0, 5) : "");
      const n = await posli(await vedenie(), { title: "📝 " + (x.rozpis_osoby?.meno || "Zamestnanec") + ": " + (TYPY[x.typ] || x.typ), body: kedy + (x.poznamka ? " · " + x.poznamka : "") + " – ťukni a schváľ v appke", url: "/?m=dochadzka&z=tim", tag: "ziadost-" + x.id });
      return odpoved({ ok: true, poslane: n });
    }
    return odpoved({ ok: false, text: "Neznáma akcia" }, 400);
  } catch (e) {
    return odpoved({ ok: false, text: String((e as Error).message || e) }, 500);
  }
});
