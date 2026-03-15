---
phase: 08-lots-in-foods
plan: "01"
title: Lifecycle pill and quantity columns in inline lot rows
subsystem: admin-panel
tags: [foods, lots, ui, status-pill]
dependency_graph:
  requires: []
  provides: [inline-lot-lifecycle-pill, inline-lot-qty-column]
  affects: [FoodsLotsPage]
tech_stack:
  added: []
  patterns: [status-pill, lotLifecycleClass]
key_files:
  modified:
    - apps/admin/src/pages/FoodsLotsPage.tsx
decisions:
  - "Added lotLifecycleClass to existing import rather than duplicating logic"
metrics:
  duration: ~3m
  completed: 2026-03-15
  tasks_completed: 1
  files_modified: 1
---

# Phase 8 Plan 01: Lifecycle Pill and Quantity Columns in Inline Lot Rows Summary

**One-liner:** Added color-coded lifecycle status pill and quantity_available/quantity_produced columns to the inline lot table inside expanded food rows in FoodsLotsPage.tsx.

## What Was Done

Two targeted edits to `apps/admin/src/pages/FoodsLotsPage.tsx`:

1. **Import update (line 7):** Added `lotLifecycleClass` to the existing import from `../lib/lots`.

2. **Inline lot table update:** The `seller-food-lots-table` inside the expanded food row now has 6 columns instead of 3:
   - Lot Number
   - Lifecycle (color-coded `status-pill` using `lotLifecycleClass`)
   - Qty (`quantity_available/quantity_produced`)
   - Produced At
   - Sale Window
   - Actions (Show Detail button)

## Verification

`npm run build --workspace=apps/admin` exited 0 with zero TypeScript errors.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- File modified: `/Users/ismetkarakus/Work/coziyoo-v2/apps/admin/src/pages/FoodsLotsPage.tsx` — confirmed
- Build: zero errors, exit 0 — confirmed
