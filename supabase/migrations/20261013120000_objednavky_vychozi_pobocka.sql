-- Objednávka z webu bez pobočky patří do výchozí pobočky servisu, stejně
-- jako zakázky, reklamace a faktury (branches_fill_default). Bez toho ji
-- panel Příchozí objednávky ukazoval ve všech pobočkách najednou.

drop trigger if exists trg_web_objednavky_fill_branch on public.web_objednavky;
create trigger trg_web_objednavky_fill_branch
  before insert on public.web_objednavky
  for each row execute function public.branches_fill_default();

update public.web_objednavky o
   set branch_id = public.default_branch_id(o.service_id)
 where o.branch_id is null
   and public.default_branch_id(o.service_id) is not null;
