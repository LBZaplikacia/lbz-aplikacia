// LBZ aplikácia – Edge Function „upgates-sync“
// Stiahne objednávky z Upgates, termíny furmaniek z Google Kalendára a zaradí objednávky do furmaniek
// (logika zaradenia je v databáze: public.furmanky_sync). Kapacitu trasy overí cez Google Mapy.
//
// POČAS TESTU Z UPGATES LEN ČÍTA – nič do Upgates nezapisuje (články, poznámky, statusy, e-maily).
//
// Spúšťanie:
//   • plánovač (pg_cron) s hlavičkou x-lbz-cron – beží len v časoch 6:00, 11:30, 14:00 (Bratislava)
//   • tlačidlo „Aktualizovať z Upgates“ v appke (IT, CEO, zákaznícky servis) – s prihlásením
// Tajné údaje sú v trezore Supabase (Edge Functions → Secrets): UPGATES_LOGIN, UPGATES_KEY, GCAL_ICAL_URL, GOOGLE_MAPS_KEY.

const UPGATES_URL = (Deno.env.get("UPGATES_URL") || "https://buchty.admin.s26.upgates.com/api/v2").replace(/\/+$/, "");
const START = "Sedlo Zbojská, 976 56 Pohronská Polhora";
const REGIONY = ["Stredná", "Západná", "Južná", "Prešovská", "Košická", "Severná"];
const SLOTY = [[6, 0], [11, 30], [14, 0]];          // kedy beží plánované sťahovanie (miestny čas)
const SLOT_OKNO_MIN = 25;
const PRIEBEZNE = [6, 21];                        // od–do (hod.) priebežná kontrola zmien každých 30 min
const PAUZA_MIN = 3;                               // ochrana pred opakovaným klikaním
const MAX_HODIN = 11.75;
const DNI_SPAT = 60;

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
function kluc(nazov: string, json: string): string {
  const k = Deno.env.get(nazov);
  if (k) return k;
  try { const o = JSON.parse(Deno.env.get(json) || "{}"); return String(Object.values(o)[0] || ""); } catch (_) { return ""; }
}
const SERVICE = kluc("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS");
const ANON = kluc("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function odpoved(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
}

// ---------- databáza (PostgREST) ----------
function hlavicky(kluc: string, jwt?: string): Record<string, string> {
  const h: Record<string, string> = { apikey: kluc, "Content-Type": "application/json" };
  const token = jwt || (kluc.startsWith("sb_") ? "" : kluc);
  if (token) h.Authorization = "Bearer " + token;
  return h;
}
async function rpc(fn: string, args: unknown, jwt?: string) {
  const r = await fetch(SB_URL + "/rest/v1/rpc/" + fn, {
    method: "POST", headers: hlavicky(jwt ? ANON : SERVICE, jwt), body: JSON.stringify(args || {}),
  });
  const t = await r.text();
  if (!r.ok) throw new Error("DB " + fn + ": " + r.status + " " + t.slice(0, 300));
  return t ? JSON.parse(t) : null;
}

// ---------- pomocné ----------
export function norm(s: unknown): string {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function miestne(d: Date) {                          // časti dátumu v Europe/Bratislava
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bratislava", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return { rok: +p.year, mes: +p.month, den: +p.day, hod: +p.hour % 24, min: +p.minute, sek: +p.second,
    datum: `${p.year}-${p.month}-${p.day}`, upgates: `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}:${p.second}` };
}

// ---------- Upgates (len čítanie) ----------
async function upgatesGet(cesta: string) {
  const auth = btoa((Deno.env.get("UPGATES_LOGIN") || "") + ":" + (Deno.env.get("UPGATES_KEY") || ""));
  const r = await fetch(UPGATES_URL + cesta, { headers: { Authorization: "Basic " + auth, Accept: "application/json" } });
  if (r.status === 429) { await sleep(3000); return upgatesGet(cesta); }
  const t = await r.text();
  if (!r.ok) throw new Error("Upgates " + r.status + ": " + t.slice(0, 200));
  return JSON.parse(t);
}
async function stiahniObjednavky(odZmeny: string | null) {
  const od = miestne(new Date(Date.now() - DNI_SPAT * 86400000)).upgates;
  let q = "creation_time_from=" + encodeURIComponent(od);
  if (odZmeny) q += "&last_update_time_from=" + encodeURIComponent(odZmeny);
  const vsetky: any[] = [];
  for (let page = 1; page <= 40; page++) {
    const data = await upgatesGet("/orders?" + q + "&page=" + page);
    const obj = (data && data.orders) || [];
    vsetky.push(...obj);
    const stran = Number(data && data.number_of_pages) || 0;
    if (!obj.length || (stran && page >= stran)) break;
    await sleep(500);
  }
  return vsetky;
}

// Objednávka z Upgates → riadok pre databázu (rovnaké pravidlá ako skript „Objednavky eshop“)
export function prevedObjednavku(o: any) {
  const c = o.customer || {};
  const doprava = String((o.shipment && o.shipment.name) || o.shipping_name || "").trim();
  const firma = String(c.company_postal || c.company_invoice || "").trim();
  const osoba = ((c.firstname_postal || c.firstname_invoice || "") + " " + (c.surname_postal || c.surname_invoice || "")).trim();
  const meno = (norm(doprava).includes("velko") && firma) ? firma : (osoba || firma);
  const pozn = [o.customer_note, o.internal_note].map((x) => String(x || "").trim()).filter(Boolean).join(" | ");
  const poznZak = String(c.customer_note || "").trim();
  const poznamka = [pozn, poznZak].filter((v, i, a) => v && a.indexOf(v) === i).join(" | ");
  const st = norm(o.status);
  const platbaNazov = String((o.payment && o.payment.name) || "").trim();
  let platba = st.includes("platba uspesna") ? "ZAPLATENÉ" : "DOBIERKA";
  if (norm(platbaNazov).includes("faktur") || st.includes("faktur")) platba = "NA FAKTÚRU";
  const polozky = (o.products || []).map((p: any) => ({
    kod: String(p.code || "").trim(),
    nazov: p.title || p.name || "",
    mnozstvo: parseFloat(String(p.quantity).replace(",", ".")) || 0,
    cena: p.price_per_unit_with_vat ?? p.price_with_vat ?? null,
  })).filter((p: any) => p.kod);
  return {
    cislo: String(o.order_number || "").trim(), status: o.status || "", meno, firma, telefon: c.phone || "", email: c.email || "",
    ulica: c.street_postal || c.street_invoice || "", psc: c.zip_postal || c.zip_invoice || "", mesto: c.city_postal || c.city_invoice || "",
    doprava, platba_nazov: platbaNazov, platba, suma: o.order_total ?? o.price_with_vat ?? null, faktura: o.invoice_number || "",
    poznamka, vytvorena: o.creation_time || null, zmenena: o.last_update_time || null, polozky,
  };
}

// ---------- Google Kalendár (tajná iCal adresa) ----------
type Den = { r: number; m: number; d: number };
const DNI_TYZDNA = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
function denZ(s: string): Den { return { r: +s.slice(0, 4), m: +s.slice(4, 6), d: +s.slice(6, 8) }; }
function utc(d: Den) { return Date.UTC(d.r, d.m - 1, d.d); }
function zUtc(ms: number): Den { const x = new Date(ms); return { r: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }; }
function iso(d: Den) { return `${d.r}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`; }
function datumUdalosti(hodnota: string, param: string): Den {
  if (/Z$/.test(hodnota) && hodnota.length > 8) {                 // čas v UTC → miestny dátum
    const t = Date.UTC(+hodnota.slice(0, 4), +hodnota.slice(4, 6) - 1, +hodnota.slice(6, 8), +hodnota.slice(9, 11), +hodnota.slice(11, 13));
    const m = miestne(new Date(t)); return { r: m.rok, m: m.mes, d: m.den };
  }
  void param;
  return denZ(hodnota);
}
export function terminyZIcal(ics: string, odMs: number, doMs: number) {
  const riadky = ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const udalosti: any[] = [];
  let u: any = null;
  for (const l of riadky) {
    if (l === "BEGIN:VEVENT") { u = { exdate: [] as string[] }; continue; }
    if (l === "END:VEVENT") { if (u) udalosti.push(u); u = null; continue; }
    if (!u) continue;
    const i = l.indexOf(":"); if (i < 0) continue;
    const kl = l.slice(0, i), hod = l.slice(i + 1);
    const meno = kl.split(";")[0].toUpperCase();
    if (meno === "SUMMARY") u.nazov = hod.replace(/\\,/g, ",").replace(/\\n/gi, " ");
    else if (meno === "DTSTART") u.start = datumUdalosti(hod, kl);
    else if (meno === "RRULE") u.rrule = hod;
    else if (meno === "EXDATE") for (const x of hod.split(",")) u.exdate.push(iso(datumUdalosti(x, kl)));
    else if (meno === "RECURRENCE-ID") u.recId = iso(datumUdalosti(hod, kl));
    else if (meno === "UID") u.uid = hod;
    else if (meno === "STATUS") u.zrusena = hod.toUpperCase() === "CANCELLED";
  }
  // presunuté/zrušené výskyty opakovanej udalosti
  const zmenene = new Set(udalosti.filter((x) => x.recId).map((x) => x.uid + "|" + x.recId));
  const vysledok: { region: string; datum: string }[] = [];
  const pridaj = (nazov: string, d: Den) => {
    const t = utc(d); if (t < odMs || t > doMs) return;
    const n = norm(nazov);
    for (const r of REGIONY) if (n.includes(norm(r))) vysledok.push({ region: r, datum: iso(d) });
  };
  for (const e of udalosti) {
    if (!e.start || !e.nazov) continue;
    if (e.recId) { if (!e.zrusena) pridaj(e.nazov, e.start); continue; }
    if (e.zrusena) continue;
    if (!e.rrule) { pridaj(e.nazov, e.start); continue; }
    for (const d of rozvinRrule(e.start, e.rrule, doMs)) {
      const s = iso(d);
      if (e.exdate.includes(s) || zmenene.has(e.uid + "|" + s)) continue;
      pridaj(e.nazov, d);
    }
  }
  const videne = new Set<string>();
  return vysledok.filter((x) => { const k = x.region + x.datum; if (videne.has(k)) return false; videne.add(k); return true; });
}
export function rozvinRrule(start: Den, rrule: string, doMs: number): Den[] {
  const p: Record<string, string> = {};
  for (const x of rrule.split(";")) { const [k, v] = x.split("="); if (k) p[k.toUpperCase()] = v || ""; }
  const freq = p.FREQ, krok = Math.max(1, +(p.INTERVAL || 1)), pocet = p.COUNT ? +p.COUNT : Infinity;
  const until = p.UNTIL ? utc(datumUdalosti(p.UNTIL, "")) : Infinity;
  const koniec = Math.min(doMs, until);
  const out: Den[] = [];
  const s0 = utc(start);
  let n = 0;
  const pridaj = (t: number) => { if (t < s0 || t > koniec || n >= pocet) return false; out.push(zUtc(t)); n++; return true; };
  const byday = (p.BYDAY || "").split(",").filter(Boolean);
  for (let k = 0; k < 2000 && n < pocet; k++) {
    if (freq === "DAILY") { const t = s0 + k * krok * 86400000; if (t > koniec) break; pridaj(t); }
    else if (freq === "WEEKLY") {
      const zac = s0 - ((new Date(s0).getUTCDay() + 6) % 7) * 86400000 + k * krok * 7 * 86400000; // pondelok týždňa
      if (zac > koniec) break;
      const dni = byday.length ? byday.map((b) => DNI_TYZDNA.indexOf(b.slice(-2))) : [new Date(s0).getUTCDay()];
      dni.map((dw) => zac + ((dw + 6) % 7) * 86400000).sort((a, b) => a - b).forEach(pridaj);
    } else if (freq === "MONTHLY") {
      const m0 = start.m - 1 + k * krok, r = start.r + Math.floor(m0 / 12), m = (m0 % 12) + 1;
      if (Date.UTC(r, m - 1, 1) > koniec) break;
      const dniVMes = new Date(Date.UTC(r, m, 0)).getUTCDate();
      const kandidati: number[] = [];
      if (byday.length) {
        for (const b of byday) {
          const mm = b.match(/^([+-]?\d+)?([A-Z]{2})$/); if (!mm) continue;
          const dw = DNI_TYZDNA.indexOf(mm[2]), poradie = mm[1] ? +mm[1] : 0;
          const vsetky: number[] = [];
          for (let d = 1; d <= dniVMes; d++) if (new Date(Date.UTC(r, m - 1, d)).getUTCDay() === dw) vsetky.push(d);
          if (!poradie) kandidati.push(...vsetky); else { const d = poradie > 0 ? vsetky[poradie - 1] : vsetky[vsetky.length + poradie]; if (d) kandidati.push(d); }
        }
      } else {
        const dm = p.BYMONTHDAY ? p.BYMONTHDAY.split(",").map(Number) : [start.d];
        for (const d of dm) { const dd = d < 0 ? dniVMes + d + 1 : d; if (dd >= 1 && dd <= dniVMes) kandidati.push(dd); }
      }
      kandidati.sort((a, b) => a - b).forEach((d) => pridaj(Date.UTC(r, m - 1, d)));
    } else if (freq === "YEARLY") {
      const t = Date.UTC(start.r + k * krok, start.m - 1, start.d); if (t > koniec) break; pridaj(t);
    } else { pridaj(s0); break; }
  }
  return out;
}

// ---------- kapacita trasy (Google Geocoding + Routes, ako skript „calculateTimeline“) ----------
async function geokoduj(adresy: string[]) {
  const key = Deno.env.get("GOOGLE_MAPS_KEY") || "";
  const cache: Record<string, any> = await rpc("geokody_daj", { p_adresy: adresy });
  const nove: Record<string, any> = {};
  const hladaj = async (dotaz: string) => {
    const q = /slovensko/i.test(dotaz) ? dotaz : dotaz.replace(/,\s*$/, "").trim() + ", Slovensko";
    const r = await fetch("https://maps.googleapis.com/maps/api/geocode/json?address=" + encodeURIComponent(q) + "&key=" + key);
    const j = await r.json();
    if (j.status !== "OK" || !j.results || !j.results.length) return null;
    const res = j.results[0];
    if (!res.address_components.some((c: any) => c.short_name === "SK")) return null;
    let obec = "", psc = "";
    for (const c of res.address_components) {
      if (c.types.includes("locality") || c.types.includes("administrative_area_level_3")) obec = norm(c.long_name);
      if (c.types.includes("postal_code")) psc = c.long_name.replace(/\s/g, "");
    }
    const nq = norm(dotaz);
    if (obec && !nq.includes(obec) && !(psc && nq.replace(/\D/g, "").includes(psc))) return null;
    return res.geometry.location;
  };
  for (const a of adresy) {
    if (cache[a] && cache[a].ok) continue;
    let g = await hladaj(a);
    const casti = a.split(",");
    if (!g && casti.length) {
      const ulica = casti[0].trim().replace(/\s+\d+(?:[/-]\d+)?$/, "").trim();
      if (ulica !== casti[0].trim() && ulica.length > 2) g = await hladaj([ulica, ...casti.slice(1)].join(", "));
    }
    if (!g && a.includes("/")) g = (await hladaj(a.replace(/(\d+)\/(\d+)/, "$2"))) || (await hladaj(a.replace(/(\d+)\/(\d+)/, "$1")));
    if (!g && casti.length > 1) g = await hladaj(casti.slice(1).join(", ").trim());
    nove[a] = g ? { lat: g.lat, lng: g.lng, ok: true } : { ok: false };
    cache[a] = nove[a];
  }
  if (Object.keys(nove).length) await rpc("geokody_uloz", { p: nove });
  return cache;
}
async function trasa(zastavky: any[]) {
  const u = await usporiadaj(zastavky);
  return u.poradie.length ? trvanieHodin(u.poradie) : 0;
}
// poradie zastávok (najprv PORADIE: n / PRIORITA, potom optimalizácia Google) + jazda a čakanie pri každej
async function usporiadaj(zastavky: any[]): Promise<{ poradie: any[]; neplatne: any[] }> {
  const key = Deno.env.get("GOOGLE_MAPS_KEY") || "";
  const gps = await geokoduj([START, ...zastavky.map((z) => z.adresa)]);
  const start = gps[START];
  if (!start || !start.ok) throw new Error("Google nenašiel štart");
  const body = (z: any) => ({ location: { latLng: { latitude: z.lat, longitude: z.lng } } });
  const platne = zastavky.map((z) => ({ ...z, gps: gps[z.adresa] })).filter((z) => z.gps && z.gps.ok).slice(0, 23);
  const neplatne = zastavky.filter((z) => !platne.some((p) => p.cislo === z.cislo && p.adresa === z.adresa));
  if (!platne.length) return { poradie: [], neplatne };
  for (const z of platne) {
    const p = norm(z.poznamka).toUpperCase();
    const c = p.match(/CAS:\s*(\d+)/), por = p.match(/PORADIE:\s*(\d+)/);
    // vykládka a poradie z appky (Furmanky), inak kľúčové slová v poznámke, inak podľa skriptu
    z.cakanie = z.vykladka != null && z.vykladka !== "" ? +z.vykladka : c ? +c[1] : (z.dobierka ? 10 : 5);
    z.poradie = z.poradie_pevne != null ? +z.poradie_pevne : por ? +por[1] : ((z.priorita || p.includes("PRIORITA")) ? 1 : 999);
  }
  const rucne = platne.filter((z) => z.poradie < 999).sort((a, b) => a.poradie - b.poradie);
  const auto = platne.filter((z) => z.poradie >= 999);
  const volaj = async (payload: any, maska: string) => {
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": maska }, body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (j.error) throw new Error("Google: " + j.error.message);
    return j.routes && j.routes[0];
  };
  const sek = (s: string) => parseInt(String(s || "0s").replace("s", "")) / 60;
  const poradie: any[] = [];
  let odkial = start;
  if (rucne.length) {
    const posledna = auto.length ? rucne[rucne.length - 1].gps : start;
    const medzi = auto.length ? rucne.slice(0, -1) : rucne;
    const r1 = await volaj({ origin: body(odkial), destination: body(posledna), intermediates: medzi.map((z) => body(z.gps)),
      travelMode: "DRIVE", optimizeWaypointOrder: false, routingPreference: "TRAFFIC_AWARE" }, "routes.legs.duration");
    const legs = (r1 && r1.legs) || [];
    rucne.forEach((z, i) => { z.jazda = sek(legs[i] && legs[i].duration); z.spat = (!auto.length && i === rucne.length - 1) ? sek(legs[legs.length - 1] && legs[legs.length - 1].duration) : 0; poradie.push(z); });
    odkial = rucne[rucne.length - 1].gps;
  }
  if (auto.length) {
    const r2 = await volaj({ origin: body(odkial), destination: body(start), intermediates: auto.map((z) => body(z.gps)),
      travelMode: "DRIVE", optimizeWaypointOrder: true, routingPreference: "TRAFFIC_AWARE" }, "routes.optimizedIntermediateWaypointIndex,routes.legs.duration");
    const idx: number[] = (r2 && r2.optimizedIntermediateWaypointIndex) || auto.map((_, i) => i);
    const legs = (r2 && r2.legs) || [];
    idx.forEach((oi, i) => { const z = auto[oi]; if (!z) return; z.jazda = sek(legs[i] && legs[i].duration); z.spat = i === idx.length - 1 ? sek(legs[legs.length - 1] && legs[legs.length - 1].duration) : 0; poradie.push(z); });
  }
  return { poradie, neplatne };
}
// časy príchodov od odchodu (minúty) – rovnaké prestávky ako trvanieHodin (2× 15 min alebo 30 min v strede)
export function casyTrasy(z: { jazda: number; cakanie: number; spat?: number }[]) {
  let min = 0;
  const i1 = 2, i2 = z.length - 2, spolu = i1 >= i2, stred = Math.floor(z.length / 2);
  const prichod: number[] = [];
  z.forEach((s, i) => {
    if (spolu) { if (i === stred && z.length >= 3) min += 30; } else if (i === i1 || i === i2) min += 15;
    min += s.jazda; prichod.push(Math.round(min)); min += s.cakanie;
  });
  min += z.length ? (z[z.length - 1].spat || 15) : 15;
  return { prichod, navrat: Math.round(min) };
}
export function trvanieHodin(z: { jazda: number; cakanie: number; spat?: number }[]) {
  let min = 0;
  const i1 = 2, i2 = z.length - 2, spolu = i1 >= i2, stred = Math.floor(z.length / 2);
  z.forEach((s, i) => {
    if (spolu) { if (i === stred && z.length >= 3) min += 30; } else if (i === i1 || i === i2) min += 15;
    min += s.jazda + s.cakanie;
  });
  min += z.length ? (z[z.length - 1].spat || 15) : 15;
  return Math.round(min / 60 * 100) / 100;
}
async function skontrolujKapacitu() {
  if (!Deno.env.get("GOOGLE_MAPS_KEY")) return [];
  const furm: any[] = (await rpc("furmanky_na_kontrolu", {})) || [];
  const vysl: any[] = [];
  for (const f of furm) {
    const z = (f.zastavky || []).filter((x: any) => x.adresa && x.adresa !== "-");
    if (!z.length) continue;
    const hash = z.map((x: any) => x.adresa + "|" + x.dobierka + "|" + (x.poznamka || "") + "|" + (x.priorita ? 1 : 0) + "|" + (x.vykladka ?? "") + "|" + (x.poradie_pevne ?? "")).join("#");
    const h = String(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(hash)).then((b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("")));
    if (h === f.hash) continue;                        // nič sa nezmenilo → netreba volať Google
    try {
      const hod = await trasa(z);
      const plna = hod > MAX_HODIN;
      await rpc("furmanky_kapacita", { p_id: f.id, p_hodiny: hod, p_uzavriet: plna, p_hash: h });
      vysl.push({ furmanka: f.nazov, hodiny: hod, uzavreta: plna });
    } catch (e) { vysl.push({ furmanka: f.nazov, chyba: String((e as Error).message || e) }); }
  }
  return vysl;
}

// ---------- okres obce (Google Geocoding) → zaradenie do furmanky podľa schválenej mapy okresov ----------
// Každá obec (mesto + PSČ) sa hľadá len raz, výsledok ostáva v databáze (obce_okres).
const MAX_OBCI = 150;                               // najviac nových obcí za jeden beh
async function doplnOkresy(obj: any[]) {
  const key = Deno.env.get("GOOGLE_MAPS_KEY") || "";
  if (!key) return 0;
  const chyba: { mesto: string; psc: string }[] = (await rpc("obce_bez_okresu", {
    p: obj.map((o) => ({ mesto: o.mesto, psc: o.psc, doprava: o.doprava })),
  })) || [];
  const nove: any[] = [];
  for (const c of chyba.slice(0, MAX_OBCI)) {
    const q = [c.psc, c.mesto].filter(Boolean).join(" ") + ", Slovensko";
    let okres = "";
    try {
      const r = await fetch("https://maps.googleapis.com/maps/api/geocode/json?address=" + encodeURIComponent(q) +
        "&components=country:SK&language=sk&key=" + key);
      const j = await r.json();
      const res = j.status === "OK" && j.results && j.results[0];
      const k = res && res.address_components.find((x: any) => x.types.includes("administrative_area_level_2"));
      if (k) okres = String(k.long_name || "");
    } catch (_) { /* skúsi sa pri ďalšom behu */ continue; }
    nove.push({ mesto: c.mesto, psc: c.psc, okres });
  }
  if (nove.length) await rpc("obce_okres_uloz", { p: nove });
  return nove.length;
}

// ---------- hlavný beh ----------
function jeSlot(teraz: Date) {
  const m = miestne(teraz), min = m.hod * 60 + m.min;
  return SLOTY.find(([h, mm]) => min >= h * 60 + mm && min < h * 60 + mm + SLOT_OKNO_MIN) || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: any = {};
  try { body = await req.json(); } catch (_) { body = {}; }
  const akcia = body.akcia || "sync";
  let kto: string | null = null, typ = "rucne", jwt = "";

  // --- kto volá ---
  const cron = req.headers.get("x-lbz-cron");
  if (cron) {
    if (!(await rpc("furmanky_cron_ok", { p_token: cron }))) return odpoved({ ok: false, text: "Neplatný token" }, 401);
    typ = "auto";
  } else {
    jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return odpoved({ ok: false, text: "Treba sa prihlásiť" }, 401);
    const u = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: "Bearer " + jwt } });
    if (!u.ok) return odpoved({ ok: false, text: "Prihlásenie vypršalo – prihláste sa znova" }, 401);
    kto = (await u.json()).id || null;
    if (!(await rpc("som_furmankar", {}, jwt))) return odpoved({ ok: false, text: "Aktualizovať môže len IT, CEO a zákaznícky servis" }, 403);
  }

  try {
    // --- trasa pre furmana: zákaznícky servis zadá čas odchodu → poradie a časy príchodov → uloží sa, furman ju uvidí ---
    if (akcia === "trasa") {
      if (!jwt) return odpoved({ ok: false, text: "Treba sa prihlásiť" }, 401);
      if (!Deno.env.get("GOOGLE_MAPS_KEY")) return odpoved({ ok: false, text: "Chýba kľúč Google Máp" });
      const id = Number(body.id), odchod = String(body.odchod || "").trim();
      if (!id || !/^\d{1,2}:\d{2}$/.test(odchod)) return odpoved({ ok: false, text: "Zadajte čas odchodu (napr. 7:30)" });
      const pod = await rpc("trasa_podklady", { p_id: id }, jwt);
      if (!pod || pod.ok === false) return odpoved({ ok: false, text: (pod && pod.text) || "Furmanka sa nenašla" });
      if (pod.stav_trasy === "na_ceste" || pod.stav_trasy === "ukoncena") return odpoved({ ok: false, text: "Furman už je na ceste – trasu nemožno prepočítať" });
      const z = (pod.zastavky || []).filter((x: any) => x.adresa && x.adresa !== "-");
      const bezAdresy = (pod.zastavky || []).filter((x: any) => !x.adresa || x.adresa === "-");
      if (!z.length) return odpoved({ ok: false, text: "Vo furmanke nie sú objednávky s adresou" });
      const u = await usporiadaj(z);
      // adresu, ktorú Google nenašiel (alebo chýba), musí ZS opraviť – trasa sa bez nej nevytvorí
      const zleAdresy = [...u.neplatne, ...bezAdresy].map((x: any) => ({ cislo: x.cislo, adresa: x.adresa || "" }));
      if (zleAdresy.length) {
        return odpoved({ ok: false, zle: zleAdresy, text: "Trasa sa nevytvorila – Google nenašiel " + zleAdresy.length +
          (zleAdresy.length === 1 ? " adresu" : zleAdresy.length < 5 ? " adresy" : " adries") + ". Skontrolujte a opravte ich (Upraviť objednávku), potom dajte Vytvoriť trasu znova." });
      }
      const c = casyTrasy(u.poradie);
      const hod = Math.round(c.navrat / 60 * 100) / 100;
      const out = u.poradie.map((x: any, i: number) => ({ cislo: x.cislo, poradie: i + 1, prichod_min: c.prichod[i], jazda_min: Math.round(x.jazda * 10) / 10, cakanie_min: x.cakanie }));
      const res = await rpc("trasa_uloz", { p_id: id, p_odchod: odchod, p_zastavky: out, p_navrat_min: c.navrat, p_hodiny: hod }, jwt);
      if (!res || res.ok === false) return odpoved({ ok: false, text: (res && res.text) || "Trasa sa neuložila" });
      return odpoved({ ok: true, hodiny: hod, text: "Trasa vytvorená: " + u.poradie.length + " zastávok, " + hod.toString().replace(".", ",") + " h" });
    }

    // --- jedna objednávka (pridať podľa čísla / obnoviť z Upgates) ---
    if (akcia === "objednavka") {
      const cislo = String(body.cislo || "").trim();
      if (!cislo) return odpoved({ ok: false, text: "Chýba číslo objednávky" });
      const data = await upgatesGet("/orders?order_number=" + encodeURIComponent(cislo));
      const o = ((data && data.orders) || []).find((x: any) => String(x.order_number).trim() === cislo);
      if (!o) return odpoved({ ok: false, text: "Objednávka " + cislo + " sa v Upgates nenašla" });
      const riadok = prevedObjednavku(o);
      try { await doplnOkresy([riadok]); } catch (_) { /* zaradí sa podľa mesta/PSČ */ }
      const res = await rpc("furmanky_sync", { p_obj: [riadok], p_terminy: null, p_typ: "objednavka", p_kto: kto, p_reset: body.obnovit ? [cislo] : [] });
      return odpoved({ ok: true, cislo, text: "Objednávka " + cislo + " načítaná z Upgates", vysledok: res });
    }

    // ================= OBJEDNÁVKY V APPKE (v0.27) =================
    // číselníky z Upgates: stavy, dopravy, platby (3 požiadavky)
    if (akcia === "ciselniky") {
      const nazov = (x: any) => String(x.name || x.title || (x.descriptions && x.descriptions[0] && (x.descriptions[0].name || x.descriptions[0].title)) || "").trim();
      const stavy = ((await upgatesGet("/order-statuses")).order_statuses || []).map((x: any) => ({ kod: String(x.id), nazov: nazov(x), data: { type: x.type, farba: x.color || null, mark_paid_yn: x.mark_paid_yn, mark_delivered_yn: x.mark_delivered_yn } }));
      const dopravy = ((await upgatesGet("/shipments")).shipments || []).map((x: any) => ({ kod: String(x.code || x.id), nazov: nazov(x), data: { id: x.id, type: x.type } }));
      const platby = ((await upgatesGet("/payments")).payments || []).map((x: any) => ({ kod: String(x.code || x.id), nazov: nazov(x), data: { id: x.id, type: x.type } }));
      const n = [await rpc("obj_ciselnik_uloz", { p_typ: "stav", p: stavy }), await rpc("obj_ciselnik_uloz", { p_typ: "doprava", p: dopravy }), await rpc("obj_ciselnik_uloz", { p_typ: "platba", p: platby })];
      return odpoved({ ok: true, text: "Z Upgates načítané: " + n[0] + " stavov, " + n[1] + " dopráv, " + n[2] + " platieb" });
    }
    // jednorazovo: staršie objednávky (napr. celý rok 2026) – len doplní chýbajúce, furmanky nemení
    if (akcia === "historia") {
      const od = String(body.od || "2026-01-01").slice(0, 10) + "T00:00:00";
      const po = miestne(new Date(Date.now() - (DNI_SPAT - 1) * 86400000)).datum + "T00:00:00";
      const maxStran = Math.min(Number(body.stran) || 25, 30);
      const vsetky: any[] = []; let stran = 0, strana = Number(body.strana) || 1;
      for (; strana <= 200; strana++) {
        const data = await upgatesGet("/orders?creation_time_from=" + encodeURIComponent(od) + "&creation_time_to=" + encodeURIComponent(po) + "&page=" + strana);
        const obj = (data && data.orders) || [];
        vsetky.push(...obj); stran++;
        const spolu = Number(data && data.number_of_pages) || 0;
        if (!obj.length || (spolu && strana >= spolu) || stran >= maxStran) { if (obj.length && spolu && strana < spolu) { strana++; break; } strana = 0; break; }
        await sleep(600);
      }
      const res = await rpc("obj_import_historia", { p_obj: vsetky.map(prevedObjednavku) });
      return odpoved({ ok: true, text: "Z Upgates prenesené staršie objednávky: " + (res && res.nove) + " nových (stiahnutých " + vsetky.length + ")" + (strana ? " – pokračuje sa od strany " + strana : ""), dalsia_strana: strana || null });
    }
    // je k objednávke vystavený dobropis? (1 požiadavka)
    if (akcia === "dobropis") {
      const cislo = String(body.cislo || "").trim();
      if (!cislo) return odpoved({ ok: false, text: "Chýba číslo objednávky" });
      const data = await upgatesGet("/invoices?type=creditNote&order_number=" + encodeURIComponent(cislo));
      const d = ((data && data.invoices) || []).find((x: any) => String(x.order_number || "").trim() === cislo && /credit/i.test(String(x.type || "creditNote")));
      const cisloDob = d ? String(d.invoice_number || d.number || "").trim() : "";
      await rpc("obj_dobropis_uloz", { p_cislo: cislo, p_dobropis: cisloDob });
      return odpoved({ ok: true, dobropis: cisloDob, text: cisloDob ? "Dobropis " + cisloDob + " nájdený – môžete dať Storno" : "K objednávke " + cislo + " zatiaľ nie je v Upgates dobropis" });
    }
    // odoslanie fronty zmien do Upgates (v testovacom režime len náhľad, bez zápisu)
    if (akcia === "zapis") {
      const f = await rpc("obj_fronta_na_odoslanie", {});
      const pol: any[] = (f && f.polozky) || [];
      if (!pol.length) return odpoved({ ok: true, text: "Nič nečaká na odoslanie" });
      const podla: Record<string, any[]> = {};
      for (const x of pol) (podla[x.cislo] = podla[x.cislo] || []).push(x);
      const rozdel = (meno: string) => { const c = String(meno || "").trim().split(/\s+/); return { first: c.slice(0, -1).join(" ") || c[0] || "", last: c.length > 1 ? c[c.length - 1] : "" }; };
      const zakaznik = (o: any, d: any) => {
        const z: any = {};
        if ("email" in d) z.email = d.email;
        if ("telefon" in d) z.phone = d.telefon;
        if ("meno" in d) { const m = rozdel(d.meno); z.firstname_invoice = m.first; z.surname_invoice = m.last; }
        if ("firma" in d) z.company = d.firma;
        if ("ulica" in d) z.street_invoice = d.ulica;
        if ("mesto" in d) z.city_invoice = d.mesto;
        if ("psc" in d) z.zip_invoice = d.psc;
        void o; return z;
      };
      const produkty = (list: any[]) => list.filter((p: any) => Number(p.mnozstvo) > 0).map((p: any) => {
        const x: any = { code: p.kod, quantity: Number(p.mnozstvo) }; if (p.nazov) x.title = p.nazov; if (p.cena != null && p.cena !== "") x.price_per_unit = Number(p.cena); return x; });
      const nove: any[] = [], put: any[] = [], putProd: any[] = [], mapaNove: Record<string, number[]> = {}, mapaPut: Record<string, number[]> = {};
      for (const cislo of Object.keys(podla)) {
        const zoz = podla[cislo], o = zoz[0].objednavka || {};
        const ids = zoz.map((x: any) => x.id);
        if (zoz.some((x: any) => x.typ === "nova")) {
          const d = Object.assign({}, ...zoz.filter((x: any) => x.typ === "nova").map((x: any) => x.data));
          const m = rozdel(o.meno || d.meno || "");
          const obj: any = { external_order_number: cislo, language_id: "sk",
            customer: { email: o.email || "", phone: o.telefon || "", firstname_invoice: m.first, surname_invoice: m.last, company: o.firma || "",
              street_invoice: o.ulica || "", city_invoice: o.mesto || "", zip_invoice: o.psc || "", country_id_invoice: "SK" },
            products: produkty(zoz[0].produkty || []), shipment: { code: d.doprava_kod }, payment: { code: d.platba_kod } };
          if (o.poznamka) obj.internal_note = o.poznamka;
          const st = zoz.filter((x: any) => x.typ === "stav").pop(); if (st) obj.status_id = Number(st.data.status_id);
          nove.push(obj); mapaNove[cislo] = ids;
        } else {
          const d = Object.assign({}, ...zoz.filter((x: any) => x.typ === "uprava").map((x: any) => x.data));
          const obj: any = { order_number: cislo };
          const z = zakaznik(o, d); if (Object.keys(z).length) obj.customer = z;
          if ("poznamka" in d) obj.internal_note = d.poznamka;
          if (d.doprava_kod) obj.shipment = { code: d.doprava_kod };
          if (d.platba_kod) obj.payment = { code: d.platba_kod };
          const st = zoz.filter((x: any) => x.typ === "stav").pop(); if (st) obj.status_id = Number(st.data.status_id);
          if (d.polozky) { obj.products = produkty(zoz[0].produkty || []); putProd.push(obj); } else put.push(obj);
          mapaPut[cislo] = ids;
        }
      }
      const vysledky: any[] = [];
      if (!f.ostry) {
        for (const o of [...nove, ...put, ...putProd]) {
          const c = o.order_number || o.external_order_number;
          for (const id of (mapaNove[c] || mapaPut[c] || [])) vysledky.push({ id, stav: "test", nahlad: o });
        }
        await rpc("obj_fronta_vysledok", { p: vysledky });
        return odpoved({ ok: true, test: true, text: "Testovací režim: " + vysledky.length + " zmien pripravených, do Upgates sa nič nezapísalo", nahlad: { nove, put, putProd } });
      }
      const posli = async (metoda: string, telo: any) => {
        const auth = btoa((Deno.env.get("UPGATES_LOGIN") || "") + ":" + (Deno.env.get("UPGATES_KEY") || ""));
        const r = await fetch(UPGATES_URL + "/orders", { method: metoda, headers: { Authorization: "Basic " + auth, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(telo) });
        const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch (_) { /* text */ }
        if (!r.ok) throw new Error("Upgates " + r.status + ": " + t.slice(0, 300));
        const o = j && j.orders; return Array.isArray(o) ? o : (o ? [o] : []);
      };
      const vyhodnot = (odp: any[], mapa: Record<string, number[]>, kluc: string, nova: boolean) => {
        for (const c of Object.keys(mapa)) {
          const x = odp.find((y: any) => String(y[kluc] || "") === c);
          const ok = x && (nova ? x.created_yn : x.updated_yn);
          const chyba = x ? (x.messages || []).map((m: any) => m.message || m.text || JSON.stringify(m)).join("; ") : "Upgates nevrátil výsledok";
          for (const id of mapa[c]) vysledky.push({ id, stav: ok ? "odoslane" : "chyba", chyba: ok ? null : chyba });
        }
      };
      const novePrec: Record<string, string> = {};
      try {
        if (nove.length) {
          const odp = await posli("POST", { send_emails_yn: false, send_sms_yn: false, orders: nove });
          vyhodnot(odp, mapaNove, "external_order_number", true);
          for (const x of odp) if (x.created_yn && x.order_number) novePrec[String(x.external_order_number)] = String(x.order_number);
        }
        const putMapa = (zoz: any[]) => Object.fromEntries(zoz.map((o) => [o.order_number, mapaPut[o.order_number]]));
        if (put.length) vyhodnot(await posli("PUT", { send_emails_yn: true, send_sms_yn: false, orders: put }), putMapa(put), "order_number", false);
        if (putProd.length) vyhodnot(await posli("PUT", { send_emails_yn: true, send_sms_yn: false, delete_missing_products_yn: true, orders: putProd }), putMapa(putProd), "order_number", false);
      } catch (e) {
        const t = String((e as Error).message || e);
        const hotove = new Set(vysledky.map((v) => v.id));
        for (const x of pol) if (!hotove.has(x.id)) vysledky.push({ id: x.id, stav: "chyba", chyba: t.slice(0, 300) });
      }
      await rpc("obj_fronta_vysledok", { p: vysledky });
      for (const [stare, nove2] of Object.entries(novePrec)) await rpc("obj_prepis_cislo", { p_stare: stare, p_nove: nove2 });
      const ok = vysledky.filter((v) => v.stav === "odoslane").length, zle = vysledky.length - ok;
      return odpoved({ ok: zle === 0, text: "Do Upgates zapísané: " + ok + (zle ? ", s chybou: " + zle + " (pozri detail objednávky)" : ""), nove: novePrec });
    }

    // --- celé sťahovanie ---
    const teraz = new Date();
    const slot = jeSlot(teraz);
    const beh = await rpc("furmanky_posledny_beh", {});
    const posledny = beh && beh.posledny_ok ? new Date(beh.posledny_ok) : null;
    if (typ === "auto") {
      // medzi plánovanými časmi beží každých 30 min len rýchla kontrola ZMENENÝCH objednávok (šetrí API limit Upgates)
      const hod = miestne(teraz).hod;
      if (!slot && !body.vzdy && (hod < PRIEBEZNE[0] || hod >= PRIEBEZNE[1])) return odpoved({ ok: true, text: "Mimo času sťahovania – nič sa nerobí" });
      if (posledny && teraz.getTime() - posledny.getTime() < SLOT_OKNO_MIN * 60000 && beh.posledny && beh.posledny.typ === "auto") {
        return odpoved({ ok: true, text: "V tomto čase už stiahnuté" });
      }
    } else if (posledny && teraz.getTime() - posledny.getTime() < PAUZA_MIN * 60000 && !body.vzdy) {
      return odpoved({ ok: false, text: "Objednávky sa sťahovali pred chvíľou (" + miestne(posledny).upgates.slice(11, 16) + "). Skúste o pár minút." });
    }
    const cele = !posledny || !!body.cele || (slot && slot[0] === 6) || teraz.getTime() - posledny.getTime() > 20 * 3600000;
    const odZmeny = cele ? null : miestne(new Date(posledny!.getTime() - 15 * 60000)).upgates;

    const [objednavky, terminy] = await Promise.all([
      stiahniObjednavky(odZmeny),
      (async () => {
        const url = Deno.env.get("GCAL_ICAL_URL");
        if (!url) return null;
        try {
          const r = await fetch(url);
          if (!r.ok) return null;
          const dnes = miestne(teraz);
          const od = Date.UTC(dnes.rok, dnes.mes - 1, dnes.den);
          return terminyZIcal(await r.text(), od, od + DNI_SPAT * 86400000);
        } catch (_) { return null; }
      })(),
    ]);
    const riadky = objednavky.map(prevedObjednavku);
    let okresy = 0;
    try { okresy = await doplnOkresy(riadky); } catch (_) { /* zaradí sa podľa mesta/PSČ */ }
    const res = await rpc("furmanky_sync", { p_obj: riadky, p_terminy: terminy, p_typ: typ, p_kto: kto, p_reset: [] });
    let kapacita: any[] = [];
    try { kapacita = await skontrolujKapacitu(); } catch (e) { kapacita = [{ chyba: String((e as Error).message || e) }]; }
    const zatvorene = [...(res.uzavrete || []), ...kapacita.filter((k) => k.uzavreta).map((k) => k.furmanka + " (kapacita)")];
    return odpoved({
      ok: true, cele, kalendar: terminy !== null,
      text: "Stiahnutých " + objednavky.length + " objednávok" + (cele ? " (všetky za " + DNI_SPAT + " dní)" : " (zmenené od posledného stiahnutia)") +
        (terminy === null ? " · kalendár sa nepodarilo načítať, termíny ostali" : "") +
        (zatvorene.length ? " · uzavreté: " + zatvorene.join(", ") : ""),
      vysledok: res, kapacita, okresy,
    });
  } catch (e) {
    const text = String((e as Error).message || e);
    try { await rpc("furmanky_zapis_log", { p_typ: typ, p_ok: false, p_text: "Chyba: " + text, p_kto: kto }); } catch (_) { /* nič */ }
    return odpoved({ ok: false, text: "Sťahovanie zlyhalo: " + text.slice(0, 300) }, 500);
  }
});
