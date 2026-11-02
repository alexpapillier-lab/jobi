-- Provize: kolik čeká na zakázkách, které ještě nejsou vydané
-- ============================================================================
--
-- Provize se zapisují až ve sledovaném stavu (Vydáno), takže majitel neviděl,
-- kolik peněz mu ještě přibude z rozpracovaných zakázek. Tahle funkce to jen
-- spočítá, nic nezapisuje: zakázky servisu, které odpovídají filtru zařízení
-- a datu „od“, nejsou ve sledovaném ani konečném stavu a ještě nemají žádný
-- řádek provizí. Základ je cena dosud zadaných oprav (stejný vzorec jako
-- u skutečných provizí, včetně vyloučených oprav), takže je to odhad:
-- zakázka bez oprav se počítá za nulu a cena se do vydání může změnit.

create or replace function public.provize_cekajici(p_service_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  n public.provize_nastaveni;
  v_vysledek jsonb;
begin
  if not public.je_root_owner() then
    raise exception 'Jen majitel aplikace.' using errcode = '42501';
  end if;
  select * into n from public.provize_nastaveni where service_id = p_service_id;
  if not found or not n.zapnuto then
    return jsonb_build_object('pocet', 0, 's_cenou', 0, 'zaklad', 0, 'provize', 0, 'podle_stavu', '[]'::jsonb);
  end if;

  with k as (
    select s.label, s.order_index,
           public.provize_cena(t.performed_repairs, t.discount_type, t.discount_value, n.vylouceny_opravy) as zaklad
    from public.tickets t
    join public.service_statuses s on s.service_id = t.service_id and s.key = t.status
    where t.service_id = p_service_id
      and t.deleted_at is null
      and t.code is not null and btrim(t.code) <> ''
      and not s.is_final
      and not (s.label = any (n.statusy))
      and public.provize_odpovida_filtru(n.filtr, t.title, t.device_label, t.device_brand, t.device_model)
      and (n.od is null or t.created_at >= n.od)
      and not exists (select 1 from public.provize_polozky p where p.service_id = t.service_id and p.zakazka_kod = t.code)
  ),
  stavy as (
    select label, min(order_index) as poradi, count(*) as pocet,
           count(*) filter (where zaklad > 0) as s_cenou,
           coalesce(sum(zaklad), 0) as zaklad,
           coalesce(sum(round(zaklad * n.sazba, 2)), 0) as provize
    from k group by label
  )
  select jsonb_build_object(
    'pocet', coalesce(sum(pocet), 0),
    's_cenou', coalesce(sum(s_cenou), 0),
    'zaklad', coalesce(sum(zaklad), 0),
    'provize', coalesce(sum(provize), 0),
    'podle_stavu', coalesce(jsonb_agg(jsonb_build_object('stav', label, 'pocet', pocet, 'provize', provize) order by poradi), '[]'::jsonb)
  ) into v_vysledek
  from stavy;
  return v_vysledek;
end;
$$;

revoke all on function public.provize_cekajici(uuid) from public, anon;
grant execute on function public.provize_cekajici(uuid) to authenticated;

comment on function public.provize_cekajici(uuid) is
  'Odhad provize ze zakázek, které ještě nejsou ve sledovaném stavu (Vydáno). Jen čte, jen root owner.';
