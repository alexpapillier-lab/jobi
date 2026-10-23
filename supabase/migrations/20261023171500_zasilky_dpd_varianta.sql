-- Přeprava DPD: varianta zásilky (Standard s Shop to Home z registrované adresy
-- účtu, nebo Return/Collection z jiné pobočky) – podle ní se nabízí tisk štítku.
alter table public.ticket_shipment_dpd
  add column if not exists varianta text check (varianta in ('standard_shop', 'standard', 'return', 'collection'));
comment on column public.ticket_shipment_dpd.varianta is
  'standard_shop = Standard + Shop to Home (výdejna i kurýr), standard = Standard (kurýr), return = Return + dpdReturn (výdejna), collection = svoz z adresy pobočky (štítek přiveze kurýr). Starší řádky null.';
