# Phase 8: Lots in Foods - Validation

**Phase:** 8 — Lots in Foods
**Date:** 2026-03-15

## Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (API unit tests) / TypeScript compiler (frontend) |
| Frontend test files | None — no admin panel unit tests exist in this codebase |
| API test command | `npm run test:api` |
| Frontend compile command | `npm run build:admin` |
| Automated gate for this phase | `npm run build:admin` (TypeScript compile, zero errors) |

## Why TypeScript Compile Is the Gate

No frontend unit tests exist for the admin panel. The `apps/api/tests/` directory contains API-level Vitest tests only. All five requirements in this phase are purely UI wiring changes inside a single React component. The TypeScript compiler provides the following guarantees relevant to this phase:

- `computeFoodLotDiff()` is called with the correct parameter shape (`foodRecipe`, `foodIngredients`, `foodAllergens`, `lot`)
- `lotLifecycleClass()` receives an `AdminLotLifecycleStatus` value (not a raw string)
- `FoodLotDiff` fields (`recipeChanged`, `ingredientsChanged`, `allergensChanged`, `hasMissingSnapshot`) are accessed by name, not by index
- The `filterVariationsOnly` state and `foodIdsWithVariations` memo are correctly typed and consumed
- The new import line includes `computeFoodLotDiff` and `lotLifecycleClass`

## Per-Requirement Validation

### LOTS-01: Lifecycle status pill and quantity in inline lot table

**Behavior:** Each row in the expanded inline lot table shows a color-coded lifecycle pill and `quantity_available / quantity_produced`.

**Automated check:** `npm run build:admin` — compiler confirms `lotLifecycleClass(lot.lifecycle_status)` receives `AdminLotLifecycleStatus`.

**Manual verification:**
1. Open admin panel, navigate to Foods & Lots page
2. Click "+" to expand any food row that has lots
3. Confirm each lot row shows a colored pill (green = on_sale, yellow = planned, muted = expired/depleted, red = recalled/discarded)
4. Confirm each lot row shows "available/produced" quantity

---

### LOTS-02: Variation badge on inline lot rows

**Behavior:** A badge or set of badges appears in a "Diff" column on inline lot rows when `computeFoodLotDiff()` returns any changed field.

**Automated check:** `npm run build:admin` — compiler confirms `computeFoodLotDiff` is called with correct params and return fields are accessed correctly.

**Manual verification:**
1. Expand a food row that has lots with snapshot data
2. If a lot was produced when the food had a different recipe/ingredients/allergens, the diff badge(s) appear
3. A lot with a matching snapshot shows the "Snapshot matched" pill
4. A lot with no snapshot shows the "Snapshot missing" pill

---

### LOTS-03: Modal diff status column

**Behavior:** The lot summary table inside the food detail modal has a "Diff Status" column showing per-lot diff results computed from `selectedFood`.

**Automated check:** `npm run build:admin` — compiler confirms `selectedFood.recipe`, `selectedFood.ingredientsJson`, `selectedFood.allergensJson` are passed to `computeFoodLotDiff`.

**Manual verification:**
1. Click any food row to open the detail modal
2. Scroll to the lot summary table at the bottom of the modal
3. Confirm a "Diff Status" column exists
4. Rows with changes show labeled badges; rows without changes show "Snapshot matched"

---

### LOTS-04: "Has variations" filter chip

**Behavior:** A chip above the main foods table, when activated, hides food rows whose loaded lots have no diffs. Foods with unloaded lots remain visible.

**Automated check:** `npm run build:admin` — compiler confirms `filterVariationsOnly` state is boolean, `foodIdsWithVariations` is `Set<string>`, and `displayRows` is derived correctly.

**Manual verification:**
1. Expand one or more food rows so their lots load
2. Click the "Has variations" chip
3. Foods with no loaded lots remain visible
4. Foods with loaded lots that have no diffs are hidden
5. Foods with at least one differing lot remain visible
6. Click the chip again to deactivate — all foods return

---

### LOTS-05: Excel export diff columns

**Behavior:** The food detail Excel export includes three boolean columns per lot row: Recipe Changed, Ingredients Changed, Allergens Changed.

**Automated check:** `npm run build:admin` — compiler confirms `computeFoodLotDiff` is called inside `downloadSelectedFoodDetailAsExcel` and the return values are appended to the lot row array.

**Manual verification:**
1. Open a food detail modal
2. Click the Excel export button
3. Open the downloaded CSV file
4. The lot summary section header row must include "Recipe Changed", "Ingredients Changed", "Allergens Changed" (or Turkish equivalents)
5. Each lot data row must show "Yes"/"No" (or "Evet"/"Hayır") in those columns

---

## Phase Gate Command

```bash
npm run build:admin
```

Zero TypeScript errors = phase gate passed.

Run this command after every task and before submitting for verification.
