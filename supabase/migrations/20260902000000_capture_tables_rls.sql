-- Zapnutí RLS na capture tabulkách.
--
-- Obě tabulky se v celé aplikaci čtou i zapisují VÝHRADNĚ přes service_role
-- v edge funkcích (capture-create-token, capture-upload, capture-list-draft,
-- capture-claim-draft). Service role RLS obchází, takže zapnutí RLS bez policy
-- nemění funkčnost a zároveň tabulky uzavře pro role anon a authenticated.
--
-- Bez tohoto byly tabulky čitelné a zapisovatelné komukoli s anon klíčem, který
-- je vestavěný v desktop aplikaci i ve veřejné capture stránce.

ALTER TABLE public.capture_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_capture_photos ENABLE ROW LEVEL SECURITY;

-- Žádné policies záměrně: přístup má mít jen service_role.
