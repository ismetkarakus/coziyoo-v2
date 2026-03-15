---
phase: 08-lots-in-foods
plan: "02"
title: Variation badges in inline lot rows and diff highlights in lot detail modal
subsystem: admin-panel
tags: [foods, lots, ui, diff, status-pill]
dependency_graph:
  requires: [08-01]
  provides: [inline-lot-diff-column, modal-lot-diff-column]
  affects: [FoodsLotsPage]
tech_stack:
  added: []
  patterns: [computeFoodLotDiff, lot-diff-badges, status-pill]
key_files:
  modified:
    - apps/admin/src/pages/FoodsLotsPage.tsx
decisions:
  - "Used outer food closure variable (not selectedFood) for inline lot table diff computation"
  - "Used selectedFood (guaranteed non-null inside conditional block) for modal lot table diff"
  - "No new CSS required — lot-diff-badges and status-pill variants already existed"
metrics:
  duration: ~5m
  completed: 2026-03-15
  tasks_completed: 2
  files_modified: 1
---

# Phase 8 Plan 02: Variation Badges in Inline Lot Rows and Diff Highlights in Lot Detail Modal Summary

**One-liner:** Wired computeFoodLotDiff into both the inline expanded lot table and the modal lot table, adding a Diff column with color-coded snapshot comparison badges to each lot row.

## What Was Done

Two tasks executed against `apps/admin/src/pages/FoodsLotsPage.tsx`:

**Task 1 — Inline lot table Diff column:**
1. Added `computeFoodLotDiff` to the import from `../lib/lots`.
2. Added a "Diff" (`<th>`) column header between Sale Window and Actions in the inline lot table thead (7 columns total).
3. Converted the `lots.map((lot) => (<tr>...))` concise arrow to a block-body arrow, computing `diff` from the outer `food` closure variable (`food.recipe`, `food.ingredientsJson`, `food.allergensJson`).
4. Added a diff `<td>` between Sale Window and Actions cells: renders `.lot-diff-badges` with `is-neutral` (snapshot missing), `is-warning` (recipe/ingredients changed), or `is-danger` (allergens changed) pills when any flag is true; renders a single `is-success` pill when the snapshot matches.

**Task 2 — Modal lot table Diff Status column:**
1. Added a "Fark Durumu" / "Diff Status" `<th>` after Sale Window in the modal lot table thead (6 columns total).
2. Converted the `selectedFoodLots.map((lot) => (<tr>...))` arrow to a block-body arrow, computing `diff` from `selectedFood` (guaranteed non-null inside the `{selectedFood ? (...) : null}` block).
3. Added the same diff badge `<td>` pattern after the Sale Window cell.

The selected lot detail section (raw snapshot text blocks, lines 809-852) was left untouched per plan instructions.

## Verification

`npm run build --workspace=apps/admin` exited 0 with zero TypeScript errors.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- File modified: `/Users/ismetkarakus/Work/coziyoo-v2/apps/admin/src/pages/FoodsLotsPage.tsx` — confirmed
- Commit: 10d086e — confirmed
- Build: zero errors, exit 0 — confirmed
