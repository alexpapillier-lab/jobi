-- Pokladna: zaokrouhlení storna se neotáčí
-- ============================================================================
--
-- zaokrouhleni = o kolik se částka pohybu liší od částky za zakázku
-- (1 250 zaplaceno za 1 249,50 → +0,50). Storno vrací stejnou částku i stejné
-- zaokrouhlení, jen opačným směrem; s otočeným znaménkem by storno ubralo ze
-- zakázky 1 250,50 místo 1 249,50. Jinak beze změny proti 20261104130000.
-- Ostrá data zatím žádná nejsou (modul je nový), opravovat není co.

create or replace function public.pokladna_storno(p_pohyb_id uuid, p_duvod text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.pokladna_pohyby;
  r public.pokladna_pohyby;
  v_pocet integer := 0;
begin
  select * into h from public.pokladna_pohyby where id = p_pohyb_id for update;
  if h.id is null then
    raise exception 'Pohyb nenalezen.' using errcode = 'P0002';
  end if;
  perform public.pokladna_pro_zapis(h.pokladna_id);
  if h.druh = 'storno' then
    raise exception 'Storno se nestornuje.' using errcode = '22023';
  end if;
  if h.druh = 'rozdil' then
    raise exception 'Rozdíl z uzávěrky nejde stornovat. Opravte ho vkladem nebo výběrem.' using errcode = '22023';
  end if;

  for r in
    select * from public.pokladna_pohyby
     where (id = h.id or (h.prevod_id is not null and prevod_id = h.prevod_id))
       and not exists (select 1 from public.pokladna_pohyby s where s.storno_id = pokladna_pohyby.id)
     for update
  loop
    insert into public.pokladna_pohyby (service_id, pokladna_id, smer, castka, zpusob, druh, puvodni_druh, kategorie, popis, ticket_id, invoice_id, zaokrouhleni, prevod_id, storno_id, created_by)
    values (r.service_id, r.pokladna_id, case when r.smer = 'prijem' then 'vydej' else 'prijem' end, r.castka, r.zpusob, 'storno', r.druh,
            r.kategorie, nullif(btrim(coalesce(p_duvod, '')), ''), r.ticket_id, r.invoice_id, r.zaokrouhleni, r.prevod_id, r.id, auth.uid());
    v_pocet := v_pocet + 1;

    if r.invoice_id is not null and r.druh in ('zakazka', 'faktura') then
      update public.invoices
         set status = 'issued', paid_at = null, payment_method = null
       where id = r.invoice_id and status = 'paid';
      if found then
        insert into public.invoice_events (invoice_id, type, payload, created_by)
        values (r.invoice_id, 'status_changed', jsonb_build_object('from', 'paid', 'to', 'issued', 'pokladna', 'storno platby'), auth.uid());
      end if;
    end if;
  end loop;

  if v_pocet = 0 then
    raise exception 'Pohyb už je stornovaný.' using errcode = '22023';
  end if;
  return v_pocet;
end;
$$;
revoke all on function public.pokladna_storno(uuid, text) from public, anon;
grant execute on function public.pokladna_storno(uuid, text) to authenticated;

