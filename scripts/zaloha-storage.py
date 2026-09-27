#!/usr/bin/env python3
"""Pomocník zálohy souborů ze Supabase Storage (scripts/backup-storage.sh).

Bash tu dělá to, co umí rclone a psql. Porovnávání seznamů a stahování přes
REST API je v Pythonu, protože v bashi se s cestami souborů, velikostmi
a časy pracuje křehce (mezery, diakritika, tisíce řádků).

Podpříkazy:
  plan     – náhradní cesta přes REST: co stáhnout a co z R2 odklidit do koše
  stahni   – náhradní cesta přes REST: stažení souborů po dávkách
  over     – ověření zálohy: R2 proti storage.objects v databázi

Všechny vstupní seznamy jsou TSV bez hlavičky (oddělovač tabulátor).
Jen standardní knihovna, ať to běží na holém runneru i na Macu.
"""

import argparse
import concurrent.futures
import datetime as dt
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def cti_tsv(cesta, sloupcu):
    radky = []
    with open(cesta, encoding="utf-8") as f:
        for radek in f:
            radek = radek.rstrip("\n")
            if not radek:
                continue
            casti = radek.split("\t")
            if len(casti) < sloupcu:
                raise SystemExit(f"{cesta}: čekal jsem {sloupcu} sloupců, řádek: {radek!r}")
            radky.append(casti)
    return radky


def cas_rclone(text):
    """Čas z `rclone lsf --format t` (skript ho spouští s TZ=UTC)."""
    text = text.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return dt.datetime.strptime(text[:19], fmt).replace(tzinfo=dt.timezone.utc).timestamp()
        except ValueError:
            pass
    raise SystemExit(f"Nerozumím času z rclone: {text!r}")


def cele(text):
    text = (text or "").strip()
    return int(text) if text else None


# ---------------------------------------------------------------- plan (REST)

def plan(args):
    """Porovná databázi s R2 a řekne, co je potřeba stáhnout a co odklidit.

    db:  jméno \\t velikost \\t updated_at (unix čas)
    r2:  cesta \\t velikost \\t čas nahrání do R2 (rclone lsf -F pst --use-server-modtime)
    """
    db = {r[0]: (cele(r[1]), float(r[2])) for r in cti_tsv(args.db, 3)}
    r2 = {r[0]: (cele(r[1]), cas_rclone(r[2])) for r in cti_tsv(args.r2, 3)}

    stahnout = []
    for jmeno, (velikost, zmeneno) in sorted(db.items()):
        v_r2 = r2.get(jmeno)
        if v_r2 is None:
            stahnout.append((jmeno, zmeneno, "chybí"))
        elif velikost is not None and v_r2[0] != velikost:
            stahnout.append((jmeno, zmeneno, "jiná velikost"))
        elif zmeneno > v_r2[1]:
            # Soubor byl v produkci přepsaný (upsert loga, razítka) až po tom,
            # co se kopie nahrála do R2 – i se stejnou velikostí je to jiný obsah.
            stahnout.append((jmeno, zmeneno, "novější v produkci"))

    odklidit = sorted(set(r2) - set(db))

    with open(args.stahnout, "w", encoding="utf-8") as f:
        for jmeno, zmeneno, _ in stahnout:
            f.write(f"{jmeno}\t{zmeneno:.0f}\n")
    with open(args.odklidit, "w", encoding="utf-8") as f:
        for jmeno in odklidit:
            f.write(f"{jmeno}\n")

    duvody = {}
    for _, _, d in stahnout:
        duvody[d] = duvody.get(d, 0) + 1
    rozpis = ", ".join(f"{d}: {n}" for d, n in sorted(duvody.items())) or "nic"
    print(f"  v databázi {len(db)}, v R2 {len(r2)}; stáhnout {len(stahnout)} ({rozpis}), "
          f"odklidit do koše {len(odklidit)}")


# -------------------------------------------------------------- stahni (REST)

def stahni_jeden(zaklad, klic, bucket, jmeno, zmeneno, cil_dir, pokusu=4):
    url = (f"{zaklad}/storage/v1/object/authenticated/"
           f"{urllib.parse.quote(bucket)}/{urllib.parse.quote(jmeno, safe='/')}")
    hlavicky = {"apikey": klic}
    # Starý service_role klíč je JWT a patří i do Authorization. Nový tajný
    # klíč (sb_secret_…) JWT není a v Authorization ho brána odmítne.
    if klic.startswith("eyJ"):
        hlavicky["Authorization"] = f"Bearer {klic}"
    cil = os.path.join(cil_dir, jmeno)
    os.makedirs(os.path.dirname(cil) or ".", exist_ok=True)
    posledni = None
    for pokus in range(pokusu):
        try:
            req = urllib.request.Request(url, headers=hlavicky)
            with urllib.request.urlopen(req, timeout=120) as odp, open(cil + ".castecne", "wb") as f:
                while True:
                    kus = odp.read(1 << 20)
                    if not kus:
                        break
                    f.write(kus)
            os.replace(cil + ".castecne", cil)
            # Čas změny z databáze: podle něj pak obnova k datu pozná,
            # která verze souboru v ten den platila.
            os.utime(cil, (zmeneno, zmeneno))
            return None, None
        except urllib.error.HTTPError as e:
            posledni = f"HTTP {e.code}"
            if e.code in (400, 404):
                # Storage hlásí chybějící soubor jako 400/404. Nejspíš ho někdo
                # smazal mezi výpisem z databáze a stažením – to není chyba
                # zálohy. Jestli v databázi pořád je (ztracený obsah), chytí
                # to ověření na konci a workflow spadne tam.
                return None, f"{jmeno}: {posledni}"
            if e.code in (401, 403):
                break  # špatný klíč, opakování nepomůže
        except Exception as e:  # síť, timeout
            posledni = str(e)
        time.sleep(2 ** pokus)
    try:
        os.remove(cil + ".castecne")
    except FileNotFoundError:
        pass
    return f"{jmeno}: {posledni}", None


def stahni(args):
    zaklad = os.environ["SUPABASE_URL"].rstrip("/")
    klic = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    seznam = [(r[0], float(r[1])) for r in cti_tsv(args.seznam, 2)]
    chyby = []
    zmizelo = []
    hotovo = 0
    # Po dávkách: pár souběžných stahování, ne stovky naráz – REST API
    # Storage má limity a nemá smysl je zkoušet.
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.soubezne) as pool:
        budouci = [pool.submit(stahni_jeden, zaklad, klic, args.bucket, j, z, args.cil) for j, z in seznam]
        for b in concurrent.futures.as_completed(budouci):
            chyba, chybi = b.result()
            if chyba:
                chyby.append(chyba)
            elif chybi:
                zmizelo.append(chybi)
            else:
                hotovo += 1
    print(f"  staženo {hotovo}, nestaženo {len(chyby)}, v úložišti už není {len(zmizelo)}")
    for c in chyby[:30]:
        print(f"    nestaženo: {c}")
    for c in zmizelo[:30]:
        print(f"    není v úložišti: {c}")
    if chyby:
        sys.exit(1)


# ------------------------------------------------------------------ over

def over(args):
    """Ověří zálohu v R2 proti evidenci souborů v databázi.

    db:  bucket \\t jméno \\t velikost \\t povinný (t/f)
         povinný = soubor se v produkci naposledy změnil před začátkem zálohy,
         takže v R2 být MUSÍ, a to se stejnou velikostí
    r2:  bucket \\t cesta \\t velikost
    """
    db = {}
    for b, jmeno, velikost, povinny in cti_tsv(args.db, 4):
        db[(b, jmeno)] = (cele(velikost), povinny == "t")
    r2 = {}
    for b, cesta, velikost in cti_tsv(args.r2, 3):
        r2[(b, cesta)] = cele(velikost)

    buckety = sorted({k[0] for k in db} | {k[0] for k in r2} | set(args.bucket or []))
    spatne = False

    print(f"{'bucket':<22} {'soubory DB':>11} {'soubory R2':>11} {'bajty DB':>13} {'bajty R2':>13}")
    for b in buckety:
        db_b = {k: v for k, v in db.items() if k[0] == b}
        r2_b = {k: v for k, v in r2.items() if k[0] == b}
        pocet_db, pocet_r2 = len(db_b), len(r2_b)
        bajty_db = sum(v[0] or 0 for v in db_b.values())
        bajty_r2 = sum(v or 0 for v in r2_b.values())
        print(f"{b:<22} {pocet_db:>11} {pocet_r2:>11} {bajty_db:>13} {bajty_r2:>13}")

        # 1) Tvrdá kontrola bez tolerance: co existovalo před začátkem zálohy,
        #    musí být v R2 celé. Tady se nic nemůže „nestihnout" – soubory
        #    nahrané nebo přepsané během zálohy se sem nepočítají.
        chybi, jina = [], []
        for (bb, jmeno), (velikost, povinny) in db_b.items():
            if not povinny:
                continue
            if (bb, jmeno) not in r2_b:
                chybi.append(jmeno)
            elif velikost is not None and r2_b[(bb, jmeno)] != velikost:
                jina.append(f"{jmeno} (DB {velikost} B, R2 {r2_b[(bb, jmeno)]} B)")
        if chybi or jina:
            spatne = True
            print(f"  CHYBA: v R2 chybí {len(chybi)} a jinou velikost má {len(jina)} souborů, "
                  f"které v produkci existovaly už před zálohou:")
            for x in (chybi + jina)[:20]:
                print(f"    {x}")

        # 2) Součty s tolerancí: mezi synchronizací a touhle kontrolou se
        #    v produkci dál fotí a maže, přesná shoda by padala náhodně.
        tol_pocet = max(args.tolerance_pocet, pocet_db * args.tolerance_procent / 100)
        tol_bajty = max(args.tolerance_bajty, bajty_db * args.tolerance_procent / 100)
        if abs(pocet_db - pocet_r2) > tol_pocet:
            spatne = True
            print(f"  CHYBA: počet souborů se liší o {abs(pocet_db - pocet_r2)}, tolerance {tol_pocet:.0f}")
        if abs(bajty_db - bajty_r2) > tol_bajty:
            spatne = True
            print(f"  CHYBA: součet velikostí se liší o {abs(bajty_db - bajty_r2)} B, tolerance {tol_bajty:.0f} B")

    celkem_db = sum(v[0] or 0 for v in db.values())
    celkem_r2 = sum(v or 0 for v in r2.values())
    print(f"{'celkem':<22} {len(db):>11} {len(r2):>11} {celkem_db:>13} {celkem_r2:>13}")
    if spatne:
        sys.exit(1)
    print("Záloha v R2 sedí na evidenci souborů v databázi.")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="prikaz", required=True)

    a = sub.add_parser("plan")
    a.add_argument("--db", required=True)
    a.add_argument("--r2", required=True)
    a.add_argument("--stahnout", required=True)
    a.add_argument("--odklidit", required=True)
    a.set_defaults(fn=plan)

    a = sub.add_parser("stahni")
    a.add_argument("--bucket", required=True)
    a.add_argument("--seznam", required=True)
    a.add_argument("--cil", required=True)
    a.add_argument("--soubezne", type=int, default=6)
    a.set_defaults(fn=stahni)

    a = sub.add_parser("over")
    a.add_argument("--db", required=True)
    a.add_argument("--r2", required=True)
    a.add_argument("--bucket", action="append", help="bucket, který se má vypsat, i když je prázdný")
    a.add_argument("--tolerance-pocet", type=int, default=5)
    a.add_argument("--tolerance-bajty", type=int, default=20 * 1024 * 1024)
    a.add_argument("--tolerance-procent", type=float, default=1.0)
    a.set_defaults(fn=over)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
