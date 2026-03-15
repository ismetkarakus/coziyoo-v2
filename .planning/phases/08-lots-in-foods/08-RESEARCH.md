# Phase 8: Lots in Foods - Research

**Researched:** 2026-03-15
**Domain:** React/TypeScript admin panel — internal wiring of existing utility functions into FoodsLotsPage.tsx
**Confidence:** HIGH (all findings from direct codebase reads, no web research needed)

## Summary

This phase is entirely about wiring already-built utilities into FoodsLotsPage.tsx. The functions `computeFoodLotDiff()` and `lotLifecycleClass()` exist in `apps/admin/src/lib/lots.ts` and are fully functional but are never called anywhere in FoodsLotsPage.tsx. The i18n dictionary already contains all needed keys (`lotDiffRecipe`, `lotDiffIngredients`, `lotDiffAllergens`, `lotSnapshotMissing`, `lotSnapshotOk`). The CSS class `.lot-diff-badges` already exists in styles.css. The `status-pill` CSS classes (`is-success`, `is-warning`, `is-disabled`, `is-danger`, `is-neutral`) already handle all lifecycle color states.

The work is: (1) call `lotLifecycleClass()` and add lifecycle + quantity columns to the inline lot table, (2) call `computeFoodLotDiff()` per lot row and show diff badges, (3) add a diff-status column to the modal lot table, (4) add a client-side filter chip for "has variations", and (5) extend the Excel export to include diff columns per lot row.

**Primary recommendation:** Wire all utilities at their call sites; do not build any new logic or CSS.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LOTS-01 | Inline lot rows show lifecycle status pill, quantity available/produced, and sale window | `lotLifecycleClass()` is ready; inline table columns need Lifecycle, Quantity added; sale window column already present |
| LOTS-02 | Variation badge on lot rows when `computeFoodLotDiff()` detects diff | `computeFoodLotDiff()` ready; `.lot-diff-badges` CSS exists; dict keys exist |
| LOTS-03 | Lot detail modal highlights changed fields (recipe / ingredients / allergens) | `computeFoodLotDiff()` ready; modal lot table needs a Diff Status column; `selectedFood` has all three fields needed as params |
| LOTS-04 | Main foods table "has variations" filter chip — client-side, lazily-loaded-aware | `filterVariationsOnly` state pattern; only activates for foods with loaded lots |
| LOTS-05 | Excel export includes diff columns per lot row | `downloadSelectedFoodDetailAsExcel()` lot-summary section needs three extra columns |
</phase_requirements>

---

## Standard Stack

No new libraries. All dependencies already installed.

### Existing Utilities in `apps/admin/src/lib/lots.ts`

| Function | Signature | Return | Status |
|----------|-----------|--------|--------|
| `computeFoodLotDiff` | `({ foodRecipe, foodIngredients, foodAllergens, lot })` | `FoodLotDiff` | Built, never called in FoodsLotsPage |
| `lotLifecycleClass` | `(status: AdminLotLifecycleStatus)` | `string` CSS class | Built, never called in FoodsLotsPage |
| `lotLifecycleLabel` | `(status, language)` | `string` localized label | Already used in modal (line 873) |
| `lotSnapshotMissing` | `(lot: AdminLotRow)` | `boolean` | Built, used by `computeFoodLotDiff` internally |
| `stableStringify` | `(value: unknown)` | `string` | Built, used by `computeFoodLotDiff` internally |

### Existing CSS Classes (no new CSS needed)

| Class | Purpose |
|-------|---------|
| `status-pill is-success` | green — on_sale lifecycle |
| `status-pill is-warning` | yellow — planned lifecycle |
| `status-pill is-disabled` | muted-red — expired / depleted |
| `status-pill is-danger` | red — recalled / discarded |
| `status-pill is-neutral` | grey — open lifecycle |
| `.lot-diff-badges` | flex container for diff badge chips (line 7296 in styles.css) |

### Existing i18n Keys (dict.detail.*)

All keys below already exist in both `en.json` and `tr.json`:

| Key | EN value | TR value |
|-----|----------|----------|
| `dict.detail.lotDiffRecipe` | "Recipe changed" | "Tarif değişti" |
| `dict.detail.lotDiffIngredients` | "Ingredients changed" | "İçerik değişti" |
| `dict.detail.lotDiffAllergens` | "Allergens changed" | "Alerjen değişti" |
| `dict.detail.lotSnapshotMissing` | "Snapshot missing" | "Snapshot eksik" |
| `dict.detail.lotSnapshotOk` | "Snapshot matched" | "Snapshot aynı" |
| `dict.detail.lotLifecycle` | "Lifecycle" | "Yaşam Döngüsü" |
| `dict.detail.lotQuantity` | "Qty (Available/Produced)" | "Adet (Mevcut/Üretilen)" |
| `dict.detail.lotSaleWindow` | "Sale Window" | "Satış Aralığı" |

---

## Architecture Patterns

### Current State vs Required State

#### Inline Lot Table (inside `foodExpanded` block, lines 680-705)

**Current columns:** Lot Number | Produced At | Sale Window | Actions

**Required columns (LOTS-01, LOTS-02):** Lot Number | Lifecycle | Qty | Produced At | Sale Window | Diff | Actions

The inline table `colSpan={10}` on the outer `<tr>` (line 650) already accounts for any number of inner columns since it spans the full main table. No colSpan changes needed on the outer wrapper.

For each lot row, compute diff by calling:
```typescript
computeFoodLotDiff({
  foodRecipe: food.recipe,
  foodIngredients: food.ingredientsJson,
  foodAllergens: food.allergensJson,
  lot,
})
```
Note: `food` is in scope as the outer `rows.map((food) => ...)` closure variable. `selectedFood` is NOT needed here — the outer `food` object from the main table row has `recipe`, `ingredientsJson`, and `allergensJson`.

For lifecycle pill: `<span className={`status-pill ${lotLifecycleClass(lot.lifecycle_status)}`}>`

For diff badge cell: wrap in `.lot-diff-badges` div, render a `status-pill` per changed field.

#### Modal Lot Table (lines 859-882)

**Current columns:** Lot Number | Lifecycle | Qty | Produced At | Sale Window

**Required columns (LOTS-03):** Lot Number | Lifecycle | Qty | Produced At | Sale Window | Diff Status

For each modal lot row, compute diff using `selectedFood` (already in scope at `selectedFoodLots` derivation, line 313):
```typescript
computeFoodLotDiff({
  foodRecipe: selectedFood.recipe,
  foodIngredients: selectedFood.ingredientsJson,
  foodAllergens: selectedFood.allergensJson,
  lot,
})
```

The diff result per lot can be computed inline in the JSX or via a `useMemo` over `selectedFoodLots`.

#### "Has Variations" Filter (LOTS-04)

**Pattern:** Add a `filterVariationsOnly` boolean state (default `false`). A chip button appears above or below the main table header. When active, apply a filter to `rows` before rendering:

- A food row is hidden if `filterVariationsOnly` is true AND lots have been loaded for that food AND none of its loaded lots have any diff.
- A food row is shown (unfiltered/pass-through) if `filterVariationsOnly` is true but lots have NOT been loaded yet for that food. This avoids hiding foods whose lots simply haven't been fetched.

Implementation:
```typescript
const [filterVariationsOnly, setFilterVariationsOnly] = useState(false);

// Derived: which food ids have at least one lot with a diff
const foodIdsWithVariations = useMemo(() => {
  const set = new Set<string>();
  for (const food of rows) {
    const lots = lotsByFoodId[food.id];
    if (!lots) continue; // not loaded yet — not filtered out
    for (const lot of lots) {
      const diff = computeFoodLotDiff({
        foodRecipe: food.recipe,
        foodIngredients: food.ingredientsJson,
        foodAllergens: food.allergensJson,
        lot,
      });
      if (diff.recipeChanged || diff.ingredientsChanged || diff.allergensChanged || diff.hasMissingSnapshot) {
        set.add(food.id);
        break;
      }
    }
  }
  return set;
}, [rows, lotsByFoodId]);

// Filtered rows for render
const displayRows = filterVariationsOnly
  ? rows.filter((food) => {
      const lotsLoaded = Boolean(lotsByFoodId[food.id]);
      if (!lotsLoaded) return true; // not loaded = show (cannot determine)
      return foodIdsWithVariations.has(food.id);
    })
  : rows;
```

The chip itself should use the existing filter-chip pattern already in the codebase. Check what pattern other pages use; a simple `<button className={`chip ${filterVariationsOnly ? "is-active" : ""}`}` approach is sufficient.

#### Excel Export Extension (LOTS-05)

**Target function:** `downloadSelectedFoodDetailAsExcel()` (lines 420-489)

The lot summary section (lines 465-479) currently emits: Lot Number | Lifecycle | Qty | Produced At

**Required:** Add three boolean columns after existing columns: Recipe Changed | Ingredients Changed | Allergens Changed

The export header row (line 469) needs three new entries:
- EN: "Recipe Changed" / "Ingredients Changed" / "Allergens Changed"
- TR: "Tarif Değişti" / "İçerik Değişti" / "Alerjen Değişti"

Each lot data row needs to call `computeFoodLotDiff` and append `"Yes"/"No"` (or `"Evet"/"Hayır"` for TR) values.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Lifecycle color logic | Custom switch/if | `lotLifecycleClass(status)` | Already built, tested |
| Snapshot diff detection | Custom string comparison | `computeFoodLotDiff(...)` | Already handles edge cases (null, undefined, deep object comparison via `stableStringify`) |
| Missing snapshot detection | Manual null checks | `hasMissingSnapshot` from `computeFoodLotDiff` return | Already delegated to `lotSnapshotMissing()` internally |
| Localized lifecycle labels | Inline ternaries | `lotLifecycleLabel(status, language)` | Already implemented |

**Key insight:** Every piece of logic for this phase already exists in `lib/lots.ts`. The planner must wire, not build.

---

## Common Pitfalls

### Pitfall 1: Using `selectedFood` instead of outer `food` closure in inline table
**What goes wrong:** The inline lot table is rendered inside `rows.map((food) => ...)`. Calling `computeFoodLotDiff` with `selectedFood` (which could be null or a different food) instead of the `food` loop variable will produce wrong diffs.
**How to avoid:** Always use the `food` variable from the outer map closure for inline lot table diff computations.

### Pitfall 2: `colSpan` mismatch after adding columns to inline lot table
**What goes wrong:** The inner `seller-food-lots-table` is independent — it has its own `<thead>/<tbody>`. Its `colSpan` is internal to that table. The outer `<tr className="foods-lots-expanded-row">` uses `colSpan={10}` which spans the main table. These are separate tables; no mismatch risk.
**How to avoid:** Do not confuse the inner inline lot table's column count with the outer main table's colSpan.

### Pitfall 3: Filter chip hiding foods with unloaded lots
**What goes wrong:** If `filterVariationsOnly` filters out rows where `lotsByFoodId[food.id]` is undefined (treating undefined as "no variations"), the admin will never see foods that haven't been expanded yet.
**How to avoid:** Pass-through foods with unloaded lots (treat undefined lots as unknown, not clean).

### Pitfall 4: `computeFoodLotDiff` with `undefined` vs `null` ingredients
**What goes wrong:** The function distinguishes `undefined` (skip comparison, returns false) from `null` or a value (compare). Passing `undefined` for `foodIngredients` when it is actually `null` will silently suppress diff detection.
**How to avoid:** Pass the actual field value — `food.ingredientsJson` not a fallback. The type is `unknown` which accepts `null`.

### Pitfall 5: Modal lot table renders before lots are loaded
**What goes wrong:** `selectedFoodLots` is `[]` when lots haven't loaded yet. The diff computation in the modal will run over an empty array — this is fine (no rows rendered), but the modal table header will show a "Diff Status" column with no rows beneath it.
**How to avoid:** This is acceptable behavior. The loading state is already handled by the parent modal's lot display flow. No special guard needed.

---

## Code Examples

### Lifecycle Pill in Inline Table
```typescript
// Source: apps/admin/src/lib/lots.ts — lotLifecycleClass()
<span className={`status-pill ${lotLifecycleClass(lot.lifecycle_status)}`}>
  {lotLifecycleLabel(lot.lifecycle_status, language)}
</span>
```

### Diff Badges in Inline Table Cell
```typescript
// Source: apps/admin/src/lib/lots.ts — computeFoodLotDiff()
// CSS: .lot-diff-badges already in styles.css line 7296
const diff = computeFoodLotDiff({
  foodRecipe: food.recipe,
  foodIngredients: food.ingredientsJson,
  foodAllergens: food.allergensJson,
  lot,
});

// In JSX:
<td>
  {diff.hasMissingSnapshot || diff.recipeChanged || diff.ingredientsChanged || diff.allergensChanged ? (
    <div className="lot-diff-badges">
      {diff.hasMissingSnapshot && (
        <span className="status-pill is-neutral">{dict.detail.lotSnapshotMissing}</span>
      )}
      {diff.recipeChanged && (
        <span className="status-pill is-warning">{dict.detail.lotDiffRecipe}</span>
      )}
      {diff.ingredientsChanged && (
        <span className="status-pill is-warning">{dict.detail.lotDiffIngredients}</span>
      )}
      {diff.allergensChanged && (
        <span className="status-pill is-danger">{dict.detail.lotDiffAllergens}</span>
      )}
    </div>
  ) : (
    <span className="status-pill is-success">{dict.detail.lotSnapshotOk}</span>
  )}
</td>
```

### Import Line Change Required
```typescript
// Current line 7 of FoodsLotsPage.tsx:
import { fetchAllAdminLots, lotLifecycleLabel } from "../lib/lots";

// Required — add computeFoodLotDiff and lotLifecycleClass:
import { fetchAllAdminLots, lotLifecycleLabel, lotLifecycleClass, computeFoodLotDiff } from "../lib/lots";
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (API only) — no frontend unit tests exist |
| Config file | `apps/api/vitest.config.ts` |
| Quick run command | `npm run build:admin` (TypeScript compile check) |
| Full suite command | `npm run build:admin` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LOTS-01 | Lifecycle pill + qty shown in inline table | TypeScript compile | `npm run build:admin` | N/A — compile check |
| LOTS-02 | Diff badge rendered when computeFoodLotDiff returns changed fields | TypeScript compile | `npm run build:admin` | N/A — compile check |
| LOTS-03 | Modal lot table has diff status column using selectedFood fields | TypeScript compile | `npm run build:admin` | N/A — compile check |
| LOTS-04 | filterVariationsOnly state + foodIdsWithVariations memo correctly typed | TypeScript compile | `npm run build:admin` | N/A — compile check |
| LOTS-05 | Excel export diff columns — correct string concatenation | TypeScript compile | `npm run build:admin` | N/A — compile check |

### Sampling Rate
- **Per task commit:** `npm run build:admin`
- **Per wave merge:** `npm run build:admin`
- **Phase gate:** `npm run build:admin` green before `/gsd:verify-work`

### Wave 0 Gaps
None — no new test files required. TypeScript compile is the sole automated gate for all frontend changes in this phase. The `computeFoodLotDiff` function is already called indirectly in API-level tests; no new API tests are needed.

---

## Sources

### Primary (HIGH confidence)
- Direct read: `apps/admin/src/lib/lots.ts` — all function signatures, return types, implementation details
- Direct read: `apps/admin/src/types/lots.ts` — AdminLotRow, FoodLotDiff, AdminLotLifecycleStatus types
- Direct read: `apps/admin/src/pages/FoodsLotsPage.tsx` — current state of inline table (lines 680-705), modal table (lines 859-882), export function (lines 420-489), import line (line 7), state variables
- Direct read: `apps/admin/src/i18n/en.json` + `tr.json` — confirmed all diff/lifecycle i18n keys exist
- Direct read: `apps/admin/src/styles.css` — confirmed `.lot-diff-badges`, `status-pill` variants, `seller-food-code-chip` classes

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — read directly from source files
- Architecture: HIGH — exact line numbers verified in FoodsLotsPage.tsx
- Pitfalls: HIGH — derived from code analysis of actual types and call sites
- i18n keys: HIGH — grep-verified in both dictionaries
- CSS classes: HIGH — line-number verified in styles.css

**Research date:** 2026-03-15
**Valid until:** Until FoodsLotsPage.tsx is modified (stable internal codebase)
