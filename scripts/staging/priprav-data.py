#!/usr/bin/env python3
"""
Pomocník pro obnov-do-stagingu.sh.

  filtr <data.sql> <vystup.sql> <ocekavano.txt>
      Z data.sql zálohy (supabase db dump --data-only --use-copy) nechá jen
      to, co na staging patří:
        * všechny tabulky schématu public,
        * auth.users a auth.identities (bez uživatelů by nedávaly smysl cizí
          klíče z public a nikdo by se nepřihlásil).
      Všechno ostatní ze schémat auth a storage se zahodí JEŠTĚ PŘED nahráním:
      relace, obnovovací tokeny, audit přihlášení (IP adresy), MFA, evidence
      souborů ve Storage (soubory samotné na stagingu nejsou). Co se nenahraje,
      nemusí se pak ani mazat.
      Do ocekavano.txt zapíše „schema.tabulka|počet řádků“ pro každý
      ponechaný blok COPY – podle toho se po obnově kontrolují počty.

  porovnej <ocekavano.txt> <skutecne.txt> <vyprazdnene>
      Porovná očekávané počty se skutečnými. <vyprazdnene> je seznam tabulek
      oddělený čárkou, které anonymizace záměrně vyprázdní (čeká se u nich 0).
      Tabulka, která v záloze nemá data, se čeká prázdná.

Soubor se čte po bajtech: v datech může být cokoli a nesmí se nic přepsat.
"""
import re
import sys

COPY_RE = re.compile(rb'^COPY "?([A-Za-z0-9_]+)"?\."?([A-Za-z0-9_]+)"? \(.*\) FROM stdin;')
SETVAL_RE = re.compile(rb"^SELECT pg_catalog\.setval\('\"?([A-Za-z0-9_]+)\"?\.")

PONECHAT_AUTH = {"users", "identities"}


def ponechat(schema: str, tabulka: str) -> bool:
    if schema == "public":
        return True
    if schema == "auth" and tabulka in PONECHAT_AUTH:
        return True
    return False


def filtr(zdroj: str, vystup: str, ocekavano: str) -> int:
    pocty = []
    zahozeno = {}
    v_bloku = None  # (schema, tabulka, ponechat)
    n = 0
    with open(zdroj, "rb") as f, open(vystup, "wb") as out:
        for radek in f:
            if v_bloku is not None:
                schema, tabulka, drz = v_bloku
                if radek.rstrip(b"\r\n") == b"\\.":
                    if drz:
                        out.write(radek)
                        pocty.append((schema, tabulka, n))
                    else:
                        zahozeno[f"{schema}.{tabulka}"] = n
                    v_bloku, n = None, 0
                    continue
                n += 1
                if drz:
                    out.write(radek)
                continue
            m = COPY_RE.match(radek)
            if m:
                schema, tabulka = m.group(1).decode(), m.group(2).decode()
                drz = ponechat(schema, tabulka)
                v_bloku, n = (schema, tabulka, drz), 0
                if drz:
                    out.write(radek)
                continue
            s = SETVAL_RE.match(radek)
            if s and s.group(1).decode() != "public":
                continue
            out.write(radek)
    if v_bloku is not None:
        print("CHYBA: data.sql končí uprostřed bloku COPY – záloha je useknutá.", file=sys.stderr)
        return 1
    with open(ocekavano, "w", encoding="utf-8") as f:
        for schema, tabulka, pocet in sorted(pocty):
            f.write(f"{schema}.{tabulka}|{pocet}\n")
    verejne = [p for p in pocty if p[0] == "public"]
    print(f"  tabulek public v záloze: {len(verejne)}, řádků celkem: {sum(p[2] for p in verejne)}")
    for schema, tabulka, pocet in pocty:
        if schema == "auth":
            print(f"  {schema}.{tabulka}: {pocet} řádků")
    if not any(p[0] == "auth" and p[1] == "users" for p in pocty):
        print("  POZOR: v záloze nejsou data auth.users – po obnově se nikdo nepřihlásí.", file=sys.stderr)
    if zahozeno:
        print("  nenahraje se (na staging nepatří): " + ", ".join(
            f"{k} ({v})" for k, v in sorted(zahozeno.items())))
    return 0


def nacti(soubor: str) -> dict:
    vysledek = {}
    with open(soubor, encoding="utf-8") as f:
        for radek in f:
            radek = radek.strip()
            if not radek:
                continue
            klic, _, hodnota = radek.rpartition("|")
            vysledek[klic] = int(hodnota)
    return vysledek


def porovnej(ocekavano: str, skutecne: str, vyprazdnene: str) -> int:
    ocek = nacti(ocekavano)
    skut = nacti(skutecne)
    prazdne = {f"public.{t.strip()}" for t in vyprazdnene.split(",") if t.strip()}
    spatne = []
    for tabulka in sorted(set(ocek) | set(skut)):
        cekam = 0 if tabulka in prazdne else ocek.get(tabulka, 0)
        je = skut.get(tabulka)
        if je is None:
            spatne.append(f"{tabulka}: v záloze {ocek.get(tabulka, 0)} řádků, na stagingu tabulka není")
        elif je != cekam:
            spatne.append(f"{tabulka}: čekalo se {cekam}, na stagingu je {je}")
    if spatne:
        print("CHYBA: počty řádků po obnově nesedí:", file=sys.stderr)
        for s in spatne:
            print("  " + s, file=sys.stderr)
        return 1
    print(f"  počty řádků sedí ve všech {len(skut)} tabulkách"
          f" (záměrně vyprázdněno: {len(prazdne & set(skut))})")
    return 0


def main(argv: list) -> int:
    if len(argv) == 5 and argv[1] == "filtr":
        return filtr(argv[2], argv[3], argv[4])
    if len(argv) == 5 and argv[1] == "porovnej":
        return porovnej(argv[2], argv[3], argv[4])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
