-- Servisy v projektu (spustit v Supabase Dashboard → SQL Editor)

-- 1) Všechny servisy
SELECT id, name, created_at
FROM public.services
ORDER BY name;

-- 2) Vyhledat např. "jabko"
-- SELECT id, name, created_at
-- FROM public.services
-- WHERE name ILIKE '%jabko%';

| id                                   | name         | created_at                    |
| ------------------------------------ | ------------ | ----------------------------- |
| a8ff4ef3-ae7d-4342-9712-e809a0365cb1 | AAA          | 2026-01-01 19:38:32.926926+00 |
| 92a1ae1c-2b33-41d3-9b80-5416aaab05a1 | Jabko        | 2026-01-01 15:34:44.830333+00 |
| 9c852109-3299-4561-aea6-2aadb28cf35a | Jabko        | 2026-01-01 15:37:28.524777+00 |
| 98032d1e-4be5-488e-ab01-30b1294e4fac | Test Service | 2025-12-28 15:47:23.113078+00 |
| bbc926bd-25ba-4da1-b528-92b6f1dee24d | TEST2        | 2025-12-29 08:49:24.818692+00 |