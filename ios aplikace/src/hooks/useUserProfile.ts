import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabaseClient";
import type { Database } from "../types/supabase";

const PROFILE_STORAGE_PREFIX = "jobsheet_user_profile_v1_";

export type UserProfile = {
  nickname: string | null;
  avatarUrl: string | null;
};

function getLocalProfileKey(userId: string): string {
  return `${PROFILE_STORAGE_PREFIX}${userId}`;
}

function loadLocalProfile(userId: string): UserProfile | null {
  try {
    const raw = localStorage.getItem(getLocalProfileKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      nickname: typeof parsed?.nickname === "string" ? parsed.nickname : null,
      avatarUrl: typeof parsed?.avatarUrl === "string" ? parsed.avatarUrl : null,
    };
  } catch {
    return null;
  }
}

function saveLocalProfile(userId: string, profile: UserProfile): void {
  localStorage.setItem(getLocalProfileKey(userId), JSON.stringify(profile));
}

export function useUserProfile() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [profile, setProfileState] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!userId) {
      setProfileState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (supabase) {
        const { data, error: e } = await (supabase as import("@supabase/supabase-js").SupabaseClient<Database>)
          .from("profiles")
          .select("nickname, avatar_url")
          .eq("id", userId)
          .maybeSingle();
        if (e) throw e;
        setProfileState(
          data
            ? {
                nickname: data.nickname ?? null,
                avatarUrl: data.avatar_url ?? null,
              }
            : null
        );
      } else {
        setProfileState(loadLocalProfile(userId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nepodařilo se načíst profil");
      setProfileState(supabase ? null : loadLocalProfile(userId));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const setProfile = useCallback(
    async (updates: { nickname?: string | null; avatarUrl?: string | null }) => {
      if (!userId) return;
      const next: UserProfile = {
        nickname: updates.nickname !== undefined ? updates.nickname : profile?.nickname ?? null,
        avatarUrl: updates.avatarUrl !== undefined ? updates.avatarUrl : profile?.avatarUrl ?? null,
      };
      if (supabase) {
        try {
          await (supabase as import("@supabase/supabase-js").SupabaseClient<Database>).from("profiles").upsert(
            {
              id: userId,
              nickname: next.nickname,
              avatar_url: next.avatarUrl,
            },
            { onConflict: "id" }
          );
          setProfileState(next);
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Nepodařilo se uložit profil");
          throw err;
        }
      } else {
        saveLocalProfile(userId, next);
        setProfileState(next);
      }
    },
    [userId, profile]
  );

  return { profile, loading, error, setProfile, reload: loadProfile };
}
