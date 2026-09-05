-- Počet poboček jako součást placeného modulu.
--
-- Nárok na modul byl dosud jen ano/ne. Pobočky se ale prodávají po kusech
-- (tarif zahrnuje jednu, každá další za příplatek), takže nárok potřebuje
-- i číslo. `quota` = kolik kusů má servis zaplaceno; NULL = bez omezení.
-- U modulů, které se nepočítají (SMS, Faktury), zůstává NULL a nic neřeší.
--
-- Kontrola je v triggeru, ne jen v UI: kdo si otevře vývojářské nástroje,
-- zapíše do `branches` přímo přes REST.

alter table public.service_entitlements
  add column if not exists quota integer check (quota is null or quota > 0);

comment on column public.service_entitlements.quota is
  'Kolik kusů modulu má servis zaplaceno (dnes počet poboček). NULL = bez omezení.';

-- Kolik poboček smí servis mít. Bez modulu jedna (ta výchozí).
create or replace function public.branches_allowed(p_service_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case when e.quota is null then 2147483647 else e.quota end
        from public.service_entitlements e
       where e.service_id = p_service_id
         and e.module = 'branches'
         and e.active
         and (e.valid_until is null or e.valid_until > now())
       limit 1
    ),
    1
  );
$$;

grant execute on function public.branches_allowed(uuid) to authenticated;

comment on function public.branches_allowed(uuid) is
  'Kolik poboček smí servis mít: quota z nároku na modul branches, bez nároku 1.';

create or replace function public.branches_enforce_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_limit integer;
begin
  select count(*) into v_count from public.branches where service_id = new.service_id;
  -- První (výchozí) pobočku zakládá databáze sama při vzniku servisu – tu nikdy neblokovat.
  if v_count = 0 then
    return new;
  end if;
  v_limit := public.branches_allowed(new.service_id);
  if v_count >= v_limit then
    if v_limit <= 1 then
      raise exception 'Servis nemá zaplacený modul Pobočky, další pobočku nelze přidat.'
        using errcode = 'check_violation';
    else
      raise exception 'Servis má zaplacené pobočky v počtu %. Další pobočku nelze přidat.', v_limit
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_branches_enforce_quota on public.branches;
create trigger trg_branches_enforce_quota
  before insert on public.branches
  for each row execute function public.branches_enforce_quota();
