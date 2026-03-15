---
phase: 08-lots-in-foods
plan: "03"
title: Has-variations filter chip and Excel export diff columns
subsystem: admin-panel
tags: [foods, lots, ui, filter, chip, excel-export, diff]
dependency_graph:
  requires: [08-02]
  provides: [filter-variations-chip, excel-diff-columns]
  affects: [FoodsLotsPage]
tech_stack:
  added: []
  patterns: [filterVariationsOnly, foodIdsWithVariations, displayRows, computeFoodLotDiff, chip, seller-food-filter-chips]
key_files:
  modified:
    - apps/admin/src/pages/FoodsLotsPage.tsx
decisions:
  - "displayRows passes through foods with unloaded lots when filter is active (unknown = show)"
  - "foodIdsWithVariations memo depends on [rows, lotsByFoodId] so it recomputes on both page changes and lot loads"
  - "rows.length === 0 empty-state check in tbody left unchanged — it guards server-empty, not client-filtered state"
  - "selectedFood guaranteed non-null in downloadSelectedFoodDetailAsExcel via early return guard"
metrics:
  duration: ~5m
  completed: 2026-03-15
  tasks_completed: 2
  files_modified: 1
---

# Phase 8 Plan 03: Has-variations filter chip and Excel export diff columns Summary

**One-liner:** Added client-side "Has variations" chip filter above the foods table and extended the Excel lot summary export with Recipe Changed / Ingredients Changed / Allergens Changed Yes/No columns per lot row.

## What Was Done

Two tasks executed against `apps/admin/src/pages/FoodsLotsPage.tsx`:

**Task 1 — Filter chip and displayRows:**
1. Added `filterVariationsOnly` boolean state near the other `useState` declarations (after `lotsErrorByFoodId`).
2. Added `foodIdsWithVariations` useMemo that iterates `rows` and `lotsByFoodId`, calling `computeFoodLotDiff` per lot and collecting food IDs that have any diff flag or missing snapshot. Deps: `[rows, lotsByFoodId]`.
3. Added `displayRows` derived variable — when `filterVariationsOnly` is true, filters `rows` to only foods whose lots are loaded and have a variation, passing through foods with unloaded lots (unknown = show); when false, equals `rows` directly.
4. Inserted `<div className="seller-food-filter-chips">` with a `chip` / `chip is-active` button above the `<div className="table-wrap">` that wraps the main foods table.
5. Changed the table `<tbody>` iteration from `rows.map` to `displayRows.map`.

**Task 2 — Excel diff columns:**
1. Extended the lot summary header row in `downloadSelectedFoodDetailAsExcel` from 4 to 7 columns by appending "Tarif Değişti" / "Recipe Changed", "İçerik Değişti" / "Ingredients Changed", "Alerjen Değişti" / "Allergens Changed".
2. Updated each lot data row push to call `computeFoodLotDiff` (using `selectedFood` which is non-null at that call site) and append Yes/No (Evet/Hayır in Turkish) values for the three diff flags.

## Verification

`npm run build --workspace=apps/admin` exited 0 with zero TypeScript errors.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- File modified: `/Users/ismetkarakus/Work/coziyoo-v2/apps/admin/src/pages/FoodsLotsPage.tsx` — confirmed
- Build: zero errors, exit 0 — confirmed
