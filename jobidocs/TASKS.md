# JobiDocs – Task List (Delta)

## Backlog / další kroky

### API & tisk

- [ ] **/v1/print**: Render PDF → `lp` tisk na uloženou tiskárnu pro `service_id` (fallback na default)
- [ ] **/v1/printers**: Seznam tiskáren z `lpstat -p -d`, včetně statusu (enabled/disabled)

### Layout refactor

- [ ] Vyhodit A4 px, přejít na `@page` + `mm` + `preferCSSPageSize` (a `printBackground: true`)

### Regresní testy

- [ ] 1-stránka vs 2+ stránky
- [ ] Dlouhé texty
- [ ] Diakritika / fonty
- [ ] Obrázky (logo, razítko)
- [ ] Podpisy na hraně stránky
