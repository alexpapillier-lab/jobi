import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";

type Role = "owner" | "admin" | "member" | null;

type UseActiveRoleReturn = {
  role: Role;
  isOwner: boolean;
  isAdmin: boolean; // admin OR owner
  canManageTickets: boolean; // owner/admin OR member with can_manage_ticket_archive capability
};

export function useActiveRole(activeServiceId: string | null): UseActiveRoleReturn {
  const { session } = useAuth();
  const [role, setRole] = useState<Role>(null);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!activeServiceId || !session?.user?.id || !supabase) {
      setRole(null);
      setCapabilities({});
      return;
    }

    (async () => {
      try {
        const { data, error } = await supabase
          .from("service_memberships")
          .select("role, capabilities")
          .eq("service_id", activeServiceId)
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (error || !data) {
          setRole(null);
          setCapabilities({});
          return;
        }

        const membership = data as any;
        setRole((membership.role as Role) || null);
        setCapabilities((membership.capabilities as Record<string, boolean>) || {});
      } catch (err) {
        console.error("[useActiveRole] Error fetching membership:", err);
        setRole(null);
        setCapabilities({});
      }
    })();
  }, [activeServiceId, session?.user?.id]);

  const isOwner = role === "owner";
  const isAdmin = role === "admin" || role === "owner";
  const canManageTickets = isAdmin || (role === "member" && capabilities?.can_manage_ticket_archive === true);

  return {
    role,
    isOwner,
    isAdmin,
    canManageTickets,
  };
}

