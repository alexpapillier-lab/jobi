# JobiDocs – Storage bucket pro logo a razítko

Od implementace 1.2 se **logo** a **razítko** ukládají do Supabase Storage místo base64 v configu. Při prvním uložení dokumentu s nahraným logem/razítkem (data URL) je obrázek nahrán do Storage a v configu zůstane jen URL.

## Vytvoření bucketu

1. Otevři **Supabase Dashboard** → projekt (stejný jako pro Jobi).
2. **Storage** → **New bucket**.
3. Název: **`service-document-assets`** (přesně takto – kód na něj odkazuje).
4. **Public bucket:** zapnout (veřejné čtení), aby se obrázky z URL zobrazily v PDF a náhledu.
5. Uložit.

Oprávnění pro zápis (upload) řídí JWT uživatele – nahrávat může jen přihlášený uživatel s oprávněním k danému servisu (stejně jako u `service_document_settings`). Pokud bude potřeba, lze v Storage nastavit RLS politiky pro složky podle `service_id`.

## Cesty v bucketu

- `{service_id}/logo.{ext}` – logo servisu (ext: png, jpg, gif, webp)
- `{service_id}/stamp.{ext}` – razítko

Při každém uložení s novým obrázkem se soubor přepíše (`upsert: true`).
