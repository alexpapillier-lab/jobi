-- Stopky: rozdělaný úsek v jiném servisu nesmí zablokovat práci
-- ============================================================================
--
-- Běžící úsek smí mít člověk jen jeden (unikátní index přes `user_id`), a
-- `spust_praci` proto před vložením nového ukončí ten předchozí. Funkce ale
-- běžela pod právy volajícího, takže na úsek, ke kterému volající nemá zápis,
-- nedosáhla: `UPDATE` neaktualizoval nic (a nic nenahlásil, PostgREST i SQL
-- na to koukají jako na úspěch) a teprve `INSERT` spadl na unikátním indexu.
--
-- Stane se to pokaždé, když technik nechá běžet práci v servisu, kterému
-- mezitím skončilo předplatné nebo ho majitel aplikace vypnul – od 11. 9.
-- do takového servisu nikdo nezapíše. Technik pak **nemůže spustit práci
-- nikde**, i když jeho druhá dílna platí. Přesně na tohle spadl E2E test
-- „stopky na zakázce spustí a zastaví práci“ po tom, co po přerušeném běhu
-- zůstal viset úsek v dočasném servisu.
--
-- Řešení: funkce se dělá `security definer`, aby vlastní úseky uzavřít mohla.
-- Členství v cílovém servisu se kontroluje výslovně (definer obchází RLS,
-- takže se nesmí spolehnout na politiku), a zavírá se jen to, co patří
-- volajícímu – cizí úseky zůstávají nedotčené.
create or replace function public.spust_praci(p_service_id uuid, p_ticket_id uuid)
returns public.ticket_work_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_radek public.ticket_work_sessions;
begin
  if auth.uid() is null then
    raise exception 'Nepřihlášen.' using errcode = '42501';
  end if;

  -- Definer obchází RLS, takže se členství i viditelnost zakázky ověřují tady.
  if not exists (
    select 1 from public.service_memberships m
     where m.service_id = p_service_id and m.user_id = auth.uid()
  ) then
    raise exception 'Nemáte přístup k tomuto servisu.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.tickets t
     where t.id = p_ticket_id and t.service_id = p_service_id and t.deleted_at is null
  ) then
    raise exception 'Zakázka nenalezena.' using errcode = 'P0002';
  end if;

  if not public.pobocka_povolena(p_service_id, (select branch_id from public.tickets where id = p_ticket_id)) then
    raise exception 'Zakázka patří jiné pobočce.' using errcode = '42501';
  end if;

  -- Vlastní běžící úseky kdekoli – i tam, kam už volající nesmí zapisovat.
  update public.ticket_work_sessions
     set ended_at = now()
   where user_id = auth.uid() and ended_at is null;

  insert into public.ticket_work_sessions (service_id, ticket_id, user_id, started_at)
  values (p_service_id, p_ticket_id, auth.uid(), now())
  returning * into v_radek;
  return v_radek;
end;
$$;

revoke all on function public.spust_praci(uuid, uuid) from public, anon;
grant execute on function public.spust_praci(uuid, uuid) to authenticated;

-- `zastav_praci` má stejný problém: rozdělaný úsek v zamčeném servisu by
-- nešlo zastavit vůbec, takže by tam čas běžel dál a KPI technika lhalo.
-- Návratový typ zůstává `integer` (kolik úseků se zavřelo) – měnit ho nejde
-- bez zahození funkce a aplikace ho stejně ignoruje.
create or replace function public.zastav_praci()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pocet integer;
begin
  if auth.uid() is null then
    raise exception 'Nepřihlášen.' using errcode = '42501';
  end if;
  update public.ticket_work_sessions
     set ended_at = now()
   where user_id = auth.uid() and ended_at is null;
  get diagnostics v_pocet = row_count;
  return v_pocet;
end;
$$;

revoke all on function public.zastav_praci() from public, anon;
grant execute on function public.zastav_praci() to authenticated;
