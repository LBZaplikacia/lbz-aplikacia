// Nastavenia pripojenia. Kým sú prázdne, appka beží v UKÁŽKOVOM režime (bez databázy).
// Hodnoty sa doplnia po založení projektu v Supabase (Project Settings → API).
// Publishable (anon) kľúč je verejný (je určený do prehliadača); tajný "service_role" kľúč sem NIKDY nepatrí.
window.LBZ_CONFIG = {
  supabaseUrl: "https://ykwiqsneroxzpkwpadie.supabase.co",
  supabaseAnonKey: "sb_publishable_kz5IYgvire5jHh-qZGacjw_OLVcj85G",
  // Tlačidlo „Prihlásiť sa cez Google“ – zapnúť (true) až po nastavení Google v Supabase (Authentication → Sign In / Providers).
  googleLogin: false,
  // Adresa webovej aplikácie „LBZ appka v2“ zo skladového Apps Scriptu (SKLAD LBZ → Nasadiť).
  // Kým je prázdna, moduly Sklad a Furmanky ukazujú „čoskoro“.
  skladApiUrl: "https://script.google.com/macros/s/AKfycbzx3P0Jk0nHCWanpfACXVjvIR8_ntBb_gRBeFox8lGczH4CqT1BuTar0jf3lM9kfns2/exec"
};
