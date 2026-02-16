import { useAuth } from "../auth/AuthProvider";

const ROOT_OWNER_ID = import.meta.env.VITE_ROOT_OWNER_ID?.trim() || null;

export function useIsRootOwner(): boolean {
  const { session } = useAuth();
  if (!ROOT_OWNER_ID || !session?.user?.id) return false;
  return session.user.id === ROOT_OWNER_ID;
}

export function getRootOwnerId(): string | null {
  return ROOT_OWNER_ID;
}
