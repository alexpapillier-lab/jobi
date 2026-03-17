const KEY = "jobsheet_pending_invite_token";

export function getPendingInviteToken(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    const t = (v ?? "").trim();
    return t.length ? t : null;
  } catch {
    return null;
  }
}

export function setPendingInviteToken(token: string): void {
  try {
    const t = (token ?? "").trim();
    if (!t) {
      localStorage.removeItem(KEY);
      return;
    }
    localStorage.setItem(KEY, t);
  } catch {
    // ignore
  }
}

export function clearPendingInviteToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}






