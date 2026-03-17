# Návrh klávesových zkratek – Jobi

Použití: **Ctrl** na Windows/Linux, **⌘ Cmd** na macOS (kde je uvedeno Ctrl/Cmd).

---

## Již implementované

| Zkratka | Funkce |
|--------|--------|
| **Escape** | Zavřít detail zakázky, panel „Nová zakázka“, modál historie, dropdowny (status, servis, výběr dokumentu atd.) |
| **Ctrl/Cmd + P** | Tisk zakázkového listu (pouze když je otevřený detail zakázky) |
| **Enter** | Odeslání formuláře / potvrzení v dropdownu (např. výběr modelu, přidání kategorie) |
| **Ctrl/Cmd + Enter** | Odeslání komentáře v detailu zakázky |
| **Šipky ↑/↓ + Enter** | Navigace a výběr v dropdownu (např. výběr modelu zařízení) |

---

## Navrhované – globální

| Zkratka | Funkce |
|--------|--------|
| **?** (Shift+/) | Otevřít nápovědu klávesových zkratek (modál nebo panel) |
| **Ctrl/Cmd + Q** | Přepnout na **Zakázky** |
| **Ctrl/Cmd + S** | Přepnout na **Sklad** |
| **Ctrl/Cmd + D** | Přepnout na **Zařízení** |
| **Ctrl/Cmd + C** | Přepnout na **Zákazníci** |
| **Ctrl/Cmd + ř** | Přepnout na **Statistiky** |
| **Ctrl/Cmd + ,** | Přepnout na **Nastavení** (obvyklá konvence v aplikacích) |

---

## Navrhované – Zakázky (Orders)

| Zkratka | Funkce |
|--------|--------|
| **Ctrl/Cmd + N** | Otevřít panel **Nová zakázka** (pouze na stránce Zakázky) |
| **Ctrl/Cmd + F** | Přesunout fokus do pole **Vyhledávání** (pouze na stránce Zakázky) |
| **Ctrl/Cmd + K** | Alternativa k Cmd+F pro vyhledávání (někdy používaná v appkách) |

---

## Navrhované – Detail zakázky

| Zkratka | Funkce |
|--------|--------|
| **E** | Přepnout do režimu **Úpravy** (když je detail otevřený a nejste v editaci) |
| **Enter** | **Uložit a zavřít** (v režimu úprav; v textarea zůstává odřádkování) |
| **Ctrl/Cmd + S** | **Uložit** změny (pouze v režimu úprav) |
| **Esc** | Zavřít detail / zrušit úpravy |

---

## Volitelné – další

| Zkratka | Funkce |
|--------|--------|
| **Ctrl/Cmd + /** | Přepínání zobrazení Zakázek (list / grid / compact), pokud je to v UI |
| **J / K** | V seznamu zakázek: přechod na předchozí / další položku (vim‑style, volitelné) |

---

## Priorita implementace

1. **?** – nápověda zkratek (uživatel vidí, co všechno platí).
2. **Ctrl/Cmd + Q, S, D, C, ř, ,** – rychlá navigace mezi stránkami.
3. **Ctrl/Cmd + N** – nová zakázka.
4. **Ctrl/Cmd + F** (nebo K) – fokus do vyhledávání.
5. **E** a **Ctrl/Cmd + S** v detailu zakázky.

Globální posluchače je vhodné centralizovat (např. v `App.tsx` nebo v layoutu) a podle aktuální stránky volat stránkově specifické handlery (Orders, Settings atd.).
