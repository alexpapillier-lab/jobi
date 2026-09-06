/**
 * Nastavení zákaznického portálu.
 *
 * Je to samostatný soubor, a ne <script> přímo v index.html, kvůli
 * Content-Security-Policy: díky tomu smí stránka spouštět jen skripty
 * z vlastní domény a nemusí povolovat 'unsafe-inline'.
 */
window.PORTAL_CONFIG = { supabaseUrl: 'https://ijtvcgolsdsrquqbvjrz.supabase.co' };
