# Stuby Tauri modulů pro webovou verzi

Webová verze běží v prohlížeči, kde Tauri neexistuje. `vite.config.web.ts`
tyhle soubory podstrčí místo skutečných `@tauri-apps/*` balíčků, takže se
do web buildu vůbec nedostanou.

Kód v `src/` je na to připravený – volání Tauri jsou v `try/catch`
s fallbackem na prohlížeč. Stuby proto **záměrně vyhazují chybu**:
tím se spustí ta `catch` větev a použije se webová cesta.

Výjimkou je `getVersion()`, kde chyba nedává smysl a vrací se placeholder.
