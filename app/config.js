// Nastavenia pripojenia. Kým sú prázdne, appka beží v UKÁŽKOVOM režime (bez databázy).
// Hodnoty sa doplnia po založení projektu v Supabase (Project Settings → API).
// Anon kľúč je verejný (je určený do prehliadača); tajný "service_role" kľúč sem NIKDY nepatrí.
window.LBZ_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  // Adresa webovej aplikácie „LBZ appka v2“ zo skladového Apps Scriptu (SKLAD LBZ → Nasadiť).
  // Kým je prázdna, moduly Sklad a Furmanky ukazujú „čoskoro“.
  skladApiUrl: ""
};
