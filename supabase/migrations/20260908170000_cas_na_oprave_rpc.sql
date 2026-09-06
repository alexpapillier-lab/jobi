-- Stopky: jeden běžící úsek na člověka a start/stop jedním příkazem.
--
-- Klient dřív ukončil běžící úsek a vložil nový dvěma požadavky; když první
-- selhal nebo běžely dva klienty naráz, člověk měl dva běžící úseky a Stop
-- ukončil jen jeden – čas pak rostl donekonečna. Index to zakáže, funkce
-- dělá obojí v jedné transakci se serverovým časem.
create unique index if not exists ticket_work_sessions_jeden_bezici
  on public.ticket_work_sessions (user_id) where ended_at is null;

create or replace function public.spust_praci(p_service_id uuid, p_ticket_id uuid)
returns public.ticket_work_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_radek public.ticket_work_sessions;
begin
  if auth.uid() is null then
    raise exception 'Nepřihlášen.' using errcode = '42501';
  end if;
  update public.ticket_work_sessions set ended_at = now() where user_id = auth.uid() and ended_at is null;
  insert into public.ticket_work_sessions (service_id, ticket_id, user_id, started_at)
  values (p_service_id, p_ticket_id, auth.uid(), now())
  returning * into v_radek;
  return v_radek;
end;
$$;

create or replace function public.zastav_praci()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pocet integer;
begin
  update public.ticket_work_sessions set ended_at = now() where user_id = auth.uid() and ended_at is null;
  get diagnostics v_pocet = row_count;
  return v_pocet;
end;
$$;

revoke all on function public.spust_praci(uuid, uuid) from public, anon;
revoke all on function public.zastav_praci() from public, anon;
grant execute on function public.spust_praci(uuid, uuid) to authenticated;
grant execute on function public.zastav_praci() to authenticated;
