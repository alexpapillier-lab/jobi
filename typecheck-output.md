# TypeCheck Output

## Command: `npm run typecheck`

```
> jobsheet@0.1.0 typecheck
> tsc --noEmit

src/pages/Customers.tsx(186,40): error TS18047: 'supabase' is possibly 'null'.
src/pages/Customers.tsx(201,45): error TS7006: Parameter 'c' implicitly has an 'any' type.
src/pages/Customers.tsx(202,71): error TS18047: 'supabase' is possibly 'null'.
src/pages/Customers.tsx(265,50): error TS18047: 'supabase' is possibly 'null'.
src/pages/Customers.tsx(329,40): error TS18047: 'supabase' is possibly 'null'.
src/pages/Preview.tsx(42,52): error TS18047: 'supabase' is possibly 'null'.
src/pages/Settings.tsx(577,40): error TS18047: 'supabase' is possibly 'null'.
src/pages/Settings.tsx(2277,51): error TS18047: 'supabase' is possibly 'null'.
src/pages/Settings.tsx(2391,36): error TS18047: 'supabase' is possibly 'null'.
src/pages/Settings.tsx(2435,34): error TS18047: 'supabase' is possibly 'null'.
src/pages/Settings.tsx(2517,34): error TS18047: 'supabase' is possibly 'null'.
src/pages/Settings.tsx(2989,61): error TS2304: Cannot find name 'supabaseClient'.
src/pages/Settings.tsx(3166,62): error TS2345: Argument of type '{ p_ticket_id: string; }' is not assignable to parameter of type 'undefined'.
```

## Summary

- **Total errors**: 13
- **Error types**:
  - `TS18047`: 'supabase' is possibly 'null' (10 occurrences)
  - `TS7006`: Parameter implicitly has 'any' type (1 occurrence)
  - `TS2304`: Cannot find name 'supabaseClient' (1 occurrence)
  - `TS2345`: Argument type mismatch (1 occurrence)

## Files with errors

1. `src/pages/Customers.tsx` - 5 errors
2. `src/pages/Preview.tsx` - 1 error
3. `src/pages/Settings.tsx` - 7 errors

