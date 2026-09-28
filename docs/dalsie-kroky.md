# Ďalšie kroky (stav 28. 9. 2026)

Každý krok robí Terézia sama (účty a heslá), Claude naviguje po jednom kroku.

1. **GitHub** – založiť účet (ceo@legendarnebuchty.sk), vytvoriť súkromný repozitár `lbz-aplikacia`, nahrať tento kód.
2. **Supabase** – založiť účet a projekt v regióne EÚ (Frankfurt), v SQL Editore spustiť `supabase/schema.sql`.
3. **Prihlásenie Google** – v Supabase zapnúť Google poskytovateľa (Google Cloud → OAuth klient).
4. **Hosting** – Cloudflare Pages alebo Vercel, prepojiť s GitHub repozitárom, priečinok `app`.
5. **Doména** – u registrátora domény pridať záznam CNAME `app` → adresa z Cloudflare/Vercel.
6. Doplniť `app/config.js` (URL + anon kľúč), Terézii nastaviť rolu `manazer`.
7. **Prvý ostrý modul:** Sklad a skener (beží paralelne so skenerom v Upgates).

## Rozhodnuté
- PWA + Supabase, Apps Script zostáva na pozadí.
- Účtovníctvo až po zavedení e-faktúry.
- Starý webový modul beží, kým nie je v appke preklopené všetko, čo sa dnes používa.
