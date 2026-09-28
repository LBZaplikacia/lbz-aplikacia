# LBZ aplikácia

Jedna aplikácia pre tím aj zákazníkov Legendárnych buchiet Zbojská – na mobile (Android, iPhone), tablete na prevádzke aj na PC.
Je to **PWA**: otvára sa v prehliadači a dá sa „nainštalovať“ ako ikona na plochu. Netreba App Store.

## Z čoho sa skladá

| Časť | Čo to je | Kde beží |
|---|---|---|
| `app/` | Samotná aplikácia (HTML, CSS, JavaScript – bez zložitej kompilácie) | Cloudflare Pages alebo Vercel, adresa napr. app.legendarnebuchty.sk |
| `supabase/schema.sql` | Databáza: roly, moduly, prístupy, profily používateľov | Supabase (EÚ región) |
| `apps-script/` | Doterajšie Google Apps Script nástroje (záloha + „roboti“ na pozadí) | Google |
| `docs/` | Rozhodnutia a postupy | – |

## Roly (v0.1)

| Rola | Vidí |
|---|---|
| Manažér | všetko |
| Zamestnanec prevádzky | Furmanky, Sklad, Balenie, Dochádzka, Kniha jázd |
| Vodič furmaniek | Furmanky, Dochádzka, Kniha jázd |
| Zákaznícky servis | Objednávky, Komentáre FB/IG |
| Mzdárka / účtovníčka | Dochádzka, Personálna agenda, Exporty (len čítanie) |
| Zákazník | Moje objednávky, Kde je moja furmanka, Predplatné, Vernostné body |

Prihlásenie: Google účet alebo e-mail (odkaz do e-mailu), interní zamestnanci na spoločnom tablete PINom.

## Ukážkový režim

Kým v `app/config.js` nie je vyplnená adresa Supabase, appka beží s vymyslenými údajmi a na prihlasovacej obrazovke sa dá vybrať rola.

## Pravidlá

- Nič, čo dnes funguje (skener v Upgates, tabuľky), sa nevypína, kým ho nový modul plne nenahradí. Moduly sa preklápajú po jednom.
- Heslá a tajné kľúče nikdy nepatria do kódu ani do GitHubu. Do `config.js` ide len verejný „anon“ kľúč.
- Zmeny kódu robí Claude, každá zmena je v GitHube uložená ako samostatná verzia s popisom.
