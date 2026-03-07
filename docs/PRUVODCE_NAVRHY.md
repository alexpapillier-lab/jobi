# Návrhy úprav průvodce aplikací

Doporučené změny textů kroků, přidání/odebrání kroků a úpravy pořadí.

---

## 1. Úpravy textů stávajících kroků

| Krok | Aktuální text (zkráceno) | Návrh úpravy |
|------|---------------------------|--------------|
| **Vítejte v Jobi** | …Můžete ho kdykoli přeskočit nebo znovu spustit v Nastavení → O aplikaci. | **Přidat:** „Na každé stránce můžete stisknout **?** pro nápovědu klávesových zkratek.“ |
| **Zakládání nové zakázky** | …Vyplňte zákazníka (telefon, jméno), zařízení a popis… | **Zkrátit:** „Vyplňte zákazníka (telefon, jméno), zařízení a popis. Při zadaném telefonu aplikace nabídne existujícího zákazníka k přiřazení.“ |
| **Zakázky – záložky** | …Usnadní to orientaci při velkém počtu zakázek. | **Ponechat** nebo zkrátit na: „Přepínání mezi všemi, aktivními a dokončenými zakázkami.“ |
| **Zakázky – filtry** | …Stavů můžete mít více a měnit je v Nastavení. | **Doplnit:** „…v Nastavení → Zakázky → Statusy zakázek.“ |
| **Nová reklamace** | …Reklamace se evidují odděleně a lze je filtrovat. | **Přidat:** „Reklamace můžete zobrazit v záložce Reklamace nebo v záložce Vše/Aktivní (zapnout v Nastavení → Zakázky → Reklamace).“ |
| **Plovoucí tlačítko +** | …Lze vypnout v Nastavení → Vzhled a chování → Rozhraní. | **Sjednotit:** „Lze vypnout v Nastavení → Vzhled a chování → Rozhraní.“ (bez změny) |
| **Nastavení – O aplikaci** | …tlačítko „Spustit průvodce“… | **Přidat:** „Zde také najdete odkaz na stažení JobiDocs, pokud ho ještě nemáte.“ |

---

## 2. Kroky k přidání

- **Povinná pole u zakázky** (Nastavení → Zakázky)  
  - **Název:** Nastavení – Povinná pole u zakázky  
  - **Popis:** „Která pole musí být u nové zakázky a při úpravě vyplněna. Zatím lze nastavit povinnost telefonu zákazníka.“  
  - **Selector:** `[data-tour="settings-sub-orders_required_fields"]`  
  - **settingsSection:** `{ category: "orders", subsection: "orders_required_fields" }`  
  - **Umístění:** za „Statusy zakázek“, před „Dokumenty a tisk“.

- **Stránkování zakázek** (volitelné – jen pokud chcete průvodcem upozornit na paginaci)  
  - **Název:** Zakázky – stránkování  
  - **Popis:** „Při velkém počtu zakázek slouží stránkování dole k přechodu na další stránky. Počet položek na stránku lze změnit v Nastavení → Vzhled a chování → Rozhraní.“  
  - **Selector:** např. první tlačítko stránkování nebo `[data-tour="orders-list"]` (bez konkrétního prvku jen zmínka v textu).

---

## 3. Kroky k odebrání / sloučení

- **Nepropojovat:** Žádný krok není nutné úplně odstranit; průvodce zůstane přehledný.
- **Sloučení:** Kroky „Zákazníci – vyhledávání“ a „Zákazníci – seznam a detail“ lze sloučit do jednoho kroku s delším popisem (vyhledávání + seznam vlevo, detail vpravo), aby se zkrátil počet kroků. *Volitelné.*

---

## 4. Pořadí kroků

- **Současné pořadí** je logické: úvod → sidebar → zakázky (akce, filtry, seznam, JobiDocs, FAB) → zákazníci → sklad → zařízení → statistiky → nastavení (záložky, servis, tým, zakázky, vzhled, téma, zkratky, profil, o aplikaci).
- **Návrh úpravy:**  
  - Za krok „Nastavení – Statusy zakázek“ vložit nový krok **„Nastavení – Povinná pole u zakázky“** (viz bod 2).  
  - Ponechat pořadí ostatních kroků.

---

## 5. Shrnutí – co implementovat jako první

1. **Přidat krok** „Nastavení – Povinná pole u zakázky“ (s `orders_required_fields`).
2. **Doplnit text** u úvodního kroku o zmínku klávesy pro nápovědu zkratek (viz níže).
3. **Dle chuti:** doladit délku/přesnost textů u Zakládání nové zakázky, Filtry, Reklamace a O aplikaci podle tabulky v bodu 1.

Soubor slouží jako podklad pro úpravy v `App.tsx` (pole `TOUR_STEPS`).

---

## 6. Jak funguje nápověda klávesových zkratek (?)

- **Spuštění:** Stiskněte **Shift+?** (na české klávesnici tedy **Shift+/** nebo zkratka nastavená v Nastavení → Klávesové zkratky pro „Nápověda zkratek“). Funguje jen když nemáte fokus v poli pro psaní (vyhledávání, poznámka atd.) – v tom případě zkratka nic neudělá, aby se dalo napsat otazník.
- **Obsah:** Otevře se překryvné okno s přehledem všech klávesových zkratek: navigace (Zakázky, Sklad, Zařízení, Zákazníci, Statistiky, Nastavení), Nová zakázka, Vyhledávání a další. U každé je název a aktuální kombinace kláves.
- **Zavření:** Kliknutí mimo okno, tlačítko „Zavřít“ nebo klávesa **Escape**.
- Zkratky lze měnit v Nastavení → Vzhled a chování → Klávesové zkratky.
