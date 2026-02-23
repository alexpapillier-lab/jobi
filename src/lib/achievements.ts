/**
 * Systém achievementů – osobní (uživatel) a servisní (celý servis).
 * Při jednom adminovi a žádném memberovi se všechny zobrazují jako osobní.
 * Každý achievement lze získat jen jednou. Při více naráz se zobrazují s odstupem.
 */

export type TrophyTier = "bronze" | "silver" | "gold" | "diamond" | "platinum";

export type AchievementScope = "user" | "service";

export type AchievementDef = {
  id: string;
  title: string;
  description: string;
  trophy: TrophyTier;
  scope: AchievementScope;
  /** Cíl pro progress (např. 50 pro tickets_50) */
  progressTarget?: number;
  /** Odkaz na feature pro CTA (např. "orders" pro Zakázky) */
  ctaFeature?: string;
};

/** Všechny definice achievementů */
export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  // ——— Zakázky (počty) ———
  { id: "first_ticket", title: "První zakázka", description: "Začátek cesty. Teď už jen aby přišel zákazník.", trophy: "bronze", scope: "user", progressTarget: 1, ctaFeature: "orders" },
  { id: "tickets_10", title: "Deset zakázek", description: "Deset zakázek. A pořád jste nezrušili živnost. Respekt.", trophy: "bronze", scope: "user", progressTarget: 10, ctaFeature: "orders" },
  { id: "tickets_50", title: "Padesát zakázek", description: "Teď už to chce jen nervy a účetní.", trophy: "silver", scope: "user", progressTarget: 50, ctaFeature: "orders" },
  { id: "tickets_100", title: "Stovka", description: "Zvládnete to opravit i poslepu. A někdy to tak i děláte.", trophy: "gold", scope: "user", progressTarget: 100, ctaFeature: "orders" },
  { id: "tickets_500", title: "500 zakázek", description: "Gratulujeme, jste servisní NPC.", trophy: "gold", scope: "user", progressTarget: 500, ctaFeature: "orders" },
  { id: "tickets_1000", title: "1000 zakázek", description: "Už nejste člověk, jste mašina.", trophy: "diamond", scope: "user", progressTarget: 1000, ctaFeature: "orders" },

  // ——— Zákazníci ———
  { id: "first_customer", title: "První zákazník", description: "Odteď už máte komu poslat ‚jen se připomínám‘.", trophy: "bronze", scope: "user", progressTarget: 1, ctaFeature: "customers" },
  { id: "customers_10", title: "Desítka zákazníků", description: "Už vás někdo doporučil. Nevíme komu.", trophy: "silver", scope: "user", progressTarget: 10, ctaFeature: "customers" },

  // ——— Reklamace ———
  { id: "first_claim", title: "První reklamace", description: "Alespoň přišli zpět k vám. To je taky úspěch.", trophy: "bronze", scope: "user" },

  // ——— Dokumenty a tisk ———
  { id: "first_capture_photo", title: "Diagnostika má oči", description: "První fotka z mobilu. Gratulujeme.", trophy: "bronze", scope: "user" },
  { id: "first_print", title: "První tisk", description: "Teď už jen aby to někdo podepsal správně.", trophy: "bronze", scope: "user" },
  { id: "paperless", title: "Bez papíru", description: "Vygeneroval a vytiskl/uložil první dokument z JobiDocs. Papír? Co to je?", trophy: "bronze", scope: "user" },

  // ——— Streaky a rychlost ———
  { id: "streak_7", title: "Týden v kuse", description: "7 dní denního používání. Domu máte status ‚vzácná návštěva‘?", trophy: "silver", scope: "user", progressTarget: 7 },
  { id: "fast_1h", title: "Rychlý start", description: "Zakázka hotová do hodiny. Teď čekejte, že to budou chtít vždycky.", trophy: "silver", scope: "user" },
  { id: "fast_24h", title: "Do 24 hodin", description: "Teď už jen, aby to vydrželo aspoň 25.", trophy: "silver", scope: "user" },
  { id: "first_ticket_24h", title: "První zakázka do 24 h", description: "Někdo vás našel. A hned něco chce.", trophy: "bronze", scope: "user" },
  { id: "go_live", title: "Go-live", description: "7 dní po sobě alespoň 1 zakázka denně. Žádný prázdný den.", trophy: "gold", scope: "user", progressTarget: 7 },
  { id: "done_today", title: "Hotovo dnes", description: "Uzavřel 5 zakázek v den vytvoření. Produktivita? Ano.", trophy: "gold", scope: "user", progressTarget: 5 },

  // ——— Klávesové zkratky ———
  { id: "quick_fingers", title: "Rychlé prsty", description: "20× použil klávesové zkratky. Ctrl+C vám nestačí.", trophy: "silver", scope: "user", progressTarget: 20 },

  // ——— Katalog a sklad ———
  { id: "cataloguer", title: "Katalogizátor", description: "50 položek v ceníku. Už víte, co máte za kolik.", trophy: "gold", scope: "user", progressTarget: 50, ctaFeature: "inventory" },
  { id: "warehouse_keeper", title: "Skladník", description: "100× správně odepsaný díl ze skladu na zakázku. Inventura vás nemusí.", trophy: "diamond", scope: "user", progressTarget: 100, ctaFeature: "inventory" },

  // ——— Profil ———
  { id: "clean_profile", title: "Čistý profil", description: "100 % vyplněné profilové údaje. Konečně víte, kdo jste.", trophy: "gold", scope: "user", progressTarget: 100 },

  // ——— Kvalita zakázek ———
  { id: "standardization", title: "Standardizace", description: "80 %+ zakázek má povinné pole. Žádný prázdný model.", trophy: "gold", scope: "user", progressTarget: 80 },
  { id: "doc_maniac_10", title: "Dokumentační maniak", description: "10 zakázek s fotkou před + po. Diagnostika vidí světlo.", trophy: "bronze", scope: "user", progressTarget: 10 },
  { id: "doc_maniac_50", title: "Dokumentační expert", description: "50 zakázek s fotkami. Fotoalbum servisu.", trophy: "silver", scope: "user", progressTarget: 50 },
  { id: "doc_maniac_100", title: "Dokumentační guru", description: "100 zakázek s fotkami. Instagram by záviděl.", trophy: "gold", scope: "user", progressTarget: 100 },
  { id: "no_typos", title: "Bez překlepů", description: "50 zakázek bez editace po uložení. Na první pokus.", trophy: "gold", scope: "user", progressTarget: 50 },
  { id: "diagnostician", title: "Diagnostik", description: "30× vyplněný diagnostický protokol. Strukturovaně, jako profík.", trophy: "silver", scope: "user", progressTarget: 30 },
  { id: "no_discounts_week", title: "Bez slev", description: "Týden bez ručních slev. Plná cena, plná hrdost.", trophy: "silver", scope: "user" },

  // ——— Reklamace (rozšířené) ———
  { id: "no_returns", title: "Bez návratů", description: "50 zakázek bez reklamace za 30 dnů. Opravil jste to na první.", trophy: "gold", scope: "user", progressTarget: 50 },
  { id: "claim_ninja", title: "Reklamační ninja", description: "10 reklamací vyřešeno do 48 h. Rychlost i kvalita.", trophy: "gold", scope: "user", progressTarget: 10 },
  { id: "true_diagnosis", title: "Pravdivé diagnózy", description: "Míra přepracování < 2 %. Věděl jste to od začátku.", trophy: "diamond", scope: "user" },

  // ——— Časové výzvy ———
  { id: "night_owl", title: "Noční sova", description: "Uzavřel zakázku po 22:00. Kdo spí, ten nemá.", trophy: "bronze", scope: "user" },
  { id: "early_bird", title: "Ranní ptáče", description: "První ticket před 7:00. Káva ještě nebyla.", trophy: "bronze", scope: "user" },
  { id: "lightning_intake", title: "Bleskový příjem", description: "Průměrný čas vytvoření ticketu < 2:30 v posledních 20 příjmech.", trophy: "gold", scope: "user" },
  { id: "zero_backlog", title: "Zero backlog", description: "Žádná zakázka ve stavu ‚čeká‘ déle než 48 h. Žádné staré dluhy.", trophy: "diamond", scope: "user" },

  // ——— Tým ———
  { id: "team_player", title: "Týmový hráč", description: "3+ členové v servisu. Odteď se chyby dělí férově.", trophy: "gold", scope: "service" },
  { id: "team_finisher", title: "Týmový finišer", description: "Nejvíc uzavřených zakázek v týmu za týden. Leaderboard king.", trophy: "gold", scope: "user" },
  { id: "multiservice", title: "Multiservis", description: "2+ pobočky v tenantovi. Rozrůstáte se.", trophy: "silver", scope: "service", progressTarget: 2 },

  // ——— Navigace ———
  { id: "calendar_used", title: "Kalendářník", description: "Poprvé otevřel kalendář. Teď víte, co máte kdy.", trophy: "bronze", scope: "user", ctaFeature: "calendar" },
  { id: "statistics_used", title: "Statistikář", description: "Poprvé otevřel statistiky. Čísla nepustí.", trophy: "bronze", scope: "user", ctaFeature: "statistics" },

  // ——— JobiDocs ———
  { id: "jobidocs_connected", title: "JobiDocs připojen", description: "JobiDocs úspěšně propojen. Tisk je zpět v hře.", trophy: "gold", scope: "user" },

  // ——— Servisní achievementy ———
  { id: "service_tickets_10", title: "Servis: 10 zakázek", description: "Celkem 10 zakázek v servisu. Start.", trophy: "bronze", scope: "service", progressTarget: 10 },
  { id: "service_tickets_100", title: "Servis: 100 zakázek", description: "Celkem 100 zakázek. Servis žije.", trophy: "silver", scope: "service", progressTarget: 100 },
  { id: "service_tickets_500", title: "Servis: 500 zakázek", description: "Půl tisíce. A co dál?", trophy: "gold", scope: "service", progressTarget: 500 },
  { id: "quick_turnover", title: "Rychlá otočka", description: "Medián ‚příjem → předání‘ < 5 dní za poslední měsíc.", trophy: "gold", scope: "service" },
  { id: "smooth_operation", title: "Plynulý provoz", description: "30 dní bez jediného dne bez uzavřené zakázky.", trophy: "diamond", scope: "service", progressTarget: 30 },
  { id: "low_claim_rate", title: "Nízká reklamovanost", description: "Reklamace < 5 % z uzavřených zakázek. Kvalita nade vše.", trophy: "gold", scope: "service" },
  { id: "fast_claims", title: "Rychlé řešení", description: "90 % reklamací uzavřeno do 3 dnů. Žádné čekání.", trophy: "gold", scope: "service", progressTarget: 90 },
  { id: "christmas_rush", title: "Vánoční nápor", description: "50+ uzavřených zakázek v prosinci. Vánoce servisem voní.", trophy: "gold", scope: "service", progressTarget: 50 },
];

export type EarnedAchievement = {
  userId: string;
  serviceId: string | null;
  achievementId: string;
  earnedAt: string;
};

const STORAGE_KEY = "jobi_achievements_earned_v2";
const TOAST_DELAY_MS = 2500;

type PendingToast = { title: string; description: string; trophy: TrophyTier };
let toastQueue: PendingToast[] = [];
let toastProcessing = false;

function processToastQueue() {
  if (toastProcessing || toastQueue.length === 0) return;
  toastProcessing = true;
  const item = toastQueue.shift()!;
  import("../components/Toast").then(({ showAchievementToast }) => {
    showAchievementToast(item.title, item.description, item.trophy);
    toastProcessing = false;
    if (toastQueue.length > 0) {
      setTimeout(processToastQueue, TOAST_DELAY_MS);
    }
  });
}

function scheduleAchievementToast(title: string, description: string, trophy: TrophyTier) {
  toastQueue.push({ title, description, trophy });
  if (!toastProcessing) {
    processToastQueue();
  } else {
    setTimeout(processToastQueue, TOAST_DELAY_MS);
  }
}

export function loadEarnedAchievements(): EarnedAchievement[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem("jobi_achievements_earned_v1");
      if (legacy) {
        try {
          const parsed = JSON.parse(legacy);
          if (Array.isArray(parsed)) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
            return parsed;
          }
        } catch {
          /* ignore */
        }
      }
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveEarnedAchievements(list: EarnedAchievement[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("jobsheet:achievements-updated"));
}

export function isAchievementEarned(
  userId: string,
  serviceId: string | null,
  achievementId: string,
  scope: AchievementScope
): boolean {
  const earned = loadEarnedAchievements();
  if (scope === "user") {
    return earned.some((e) => e.userId === userId && e.achievementId === achievementId);
  }
  return earned.some((e) => e.serviceId === serviceId && e.achievementId === achievementId);
}

export function getEarnedForUser(userId: string, serviceId: string | null): EarnedAchievement[] {
  const earned = loadEarnedAchievements();
  return earned.filter((e) => {
    const def = getAchievementDef(e.achievementId);
    if (!def) return false;
    if (def.scope === "user") return e.userId === userId;
    return e.serviceId === serviceId;
  });
}

export function grantAchievement(
  userId: string,
  serviceId: string | null,
  achievementId: string,
  scope: AchievementScope
): boolean {
  if (isAchievementEarned(userId, serviceId, achievementId, scope)) return false;
  const def = ACHIEVEMENT_DEFS.find((a) => a.id === achievementId);
  if (!def) return false;

  const list = loadEarnedAchievements();
  list.push({
    userId,
    serviceId: scope === "service" ? serviceId : null,
    achievementId,
    earnedAt: new Date().toISOString(),
  });
  saveEarnedAchievements(list);
  scheduleAchievementToast(def.title, def.description, def.trophy);
  return true;
}

/** Volá se po vytvoření zakázky – kontroluje ticket count achievementy (anticheat: jen platné, ne smazané) */
export function checkAchievementsOnTicketsChanged(
  userId: string,
  serviceId: string | null,
  totalTicketsInService: number
) {
  const thresholds = [
    { id: "first_ticket", count: 1, scope: "user" as const },
    { id: "tickets_10", count: 10, scope: "user" as const },
    { id: "tickets_50", count: 50, scope: "user" as const },
    { id: "tickets_100", count: 100, scope: "user" as const },
    { id: "tickets_500", count: 500, scope: "user" as const },
    { id: "tickets_1000", count: 1000, scope: "user" as const },
    { id: "service_tickets_10", count: 10, scope: "service" as const },
    { id: "service_tickets_100", count: 100, scope: "service" as const },
    { id: "service_tickets_500", count: 500, scope: "service" as const },
  ];
  for (const t of thresholds) {
    if (totalTicketsInService >= t.count) {
      grantAchievement(userId, serviceId, t.id, t.scope);
    }
  }
}

export function checkAchievementsOnCustomersChanged(
  userId: string,
  _serviceId: string | null,
  totalCustomers: number
) {
  if (totalCustomers >= 1) grantAchievement(userId, null, "first_customer", "user");
  if (totalCustomers >= 10) grantAchievement(userId, null, "customers_10", "user");
}

export function checkAchievementOnFirstClaim(userId: string) {
  grantAchievement(userId, null, "first_claim", "user");
}

export function checkAchievementOnCalendarOpen(userId: string) {
  grantAchievement(userId, null, "calendar_used", "user");
}

export function checkAchievementOnStatisticsOpen(userId: string) {
  grantAchievement(userId, null, "statistics_used", "user");
}

export function checkAchievementOnFirstPrint(userId: string) {
  grantAchievement(userId, null, "first_print", "user");
}

/** Bez papíru = první dokument z JobiDocs (tisk/export) – sdílí trigger s first_print */
export function checkAchievementOnPaperless(userId: string) {
  grantAchievement(userId, null, "paperless", "user");
}

export function checkAchievementOnFirstCapturePhoto(userId: string) {
  grantAchievement(userId, null, "first_capture_photo", "user");
}

export function checkAchievementOnJobiDocsConnected(userId: string) {
  grantAchievement(userId, null, "jobidocs_connected", "user");
}

export function checkAchievementOnTeamSize(userId: string, serviceId: string | null, memberCount: number) {
  if (memberCount >= 3) grantAchievement(userId, serviceId, "team_player", "service");
}

export function checkAchievementOnMultiservice(userId: string, serviceId: string | null, serviceCount: number) {
  if (serviceCount >= 2) grantAchievement(userId, serviceId, "multiservice", "service");
}

/** Volá se při použití klávesové zkratky (konkrétní akce) – Rychlé prsty */
export function checkAchievementOnShortcutUsed(userId: string): void {
  const key = `jobi_shortcut_uses_${userId}`;
  try {
    const raw = localStorage.getItem(key);
    const count = (parseInt(raw || "0", 10) || 0) + 1;
    localStorage.setItem(key, String(count));
    if (count >= 20) grantAchievement(userId, null, "quick_fingers", "user");
  } catch {
    /* ignore */
  }
}

export function getAchievementDef(id: string): AchievementDef | undefined {
  return ACHIEVEMENT_DEFS.find((a) => a.id === id);
}
