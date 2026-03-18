# Old Mobile UI Design Notes (from `old design ` folder)

Date: 2026-03-18
Scope: Analyze legacy mobile routing/UI snapshot under `old design ` and capture what is still useful.

## 1) High-level assessment

- The folder name is `old design ` (note trailing space).
- It contains an Expo Router route tree snapshot (77 files).
- Most files are thin route wrappers that forward to current feature screens under `src/features/*`.
- A smaller set of files still contain large, standalone legacy UI implementations and mock/demo flows.

Practical meaning:
- Treat this folder primarily as historical route wiring plus a few old prototype/reference screens.
- For production changes, prefer current implementations in `src/features/*`.

## 2) Route architecture in old snapshot

### Root routing
- Root stack configured in `old design /_layout.tsx`.
- Initial route set to `(auth)`.
- Uses global providers around app nav:
  - `ThemePreferenceProvider`
  - `CountryProvider`
  - `LanguageProvider`
  - `AuthProvider`
  - `NotificationProvider`
  - `AuthGuard`
  - `WalletProvider`
  - `CartProvider`
- Toast configured globally.
- Explicit stack entries for buyer/seller/auth groups and many card-style secondary screens.

### Group routing
- `(auth)/_layout.tsx`: stack for sign-in/register/forgot-password/user-type screens.
- `(buyer)/_layout.tsx`: custom tab bar with role-aware center action and profile shortcut logic.
- `(seller)/_layout.tsx`: stack-based seller navigation with slide transitions on some screens.

## 3) Where old UI logic still lives

### Mostly wrappers (historical aliases)
Many files are direct re-exports/import wrappers to `src/features/*`, for example:
- `old design /food-detail.tsx` -> buyer feature screen
- `old design /(seller)/seller-panel.tsx` -> seller feature screen
- `old design /(auth)/sign-in.tsx` -> auth feature screen

These are low design value by themselves.

### Legacy custom-heavy screens still inside `old design `
Largest/custom files include:
- `old design /seller-public-profile.tsx`
- `old design /admin-panel.tsx`
- `old design /hygiene-rating.tsx`
- `old design /insurance-details.tsx`
- `old design /hygiene-certificate.tsx`
- `old design /allergen-declaration.tsx`
- `old design /council-registration.tsx`
- `old design /gida-guvenligi-egitimi.tsx`
- `old design /vergi-levhasi.tsx`
- `old design /(buyer)/explore.tsx`

These are the main places to inspect when looking for previous UX patterns/content structure.

## 4) Reusable UI conventions observed

### Design system usage
Common imports/patterns:
- `Colors`, `Spacing` from `src/theme`
- shared UI primitives from `src/components/ui` (e.g. `Text`, `Card`, `Button`, `FormField`)
- `TopBar` or Expo Router header patterns for top navigation
- `useColorScheme` for light/dark theme binding

### Interaction patterns
- Cards as primary info blocks (`Card variant="default"`).
- Status badges with traffic-light semantics (`green/yellow/red`).
- Explicit edit mode toggles (`isEditing`) with save/cancel actions.
- Form state grouped into object `formData` + `handleInputChange(field)` factory.
- Demo/mock-first behavior in several screens (hardcoded initial data + alert placeholders).

### Localization/copy
- Bilingual copy strategy appears in several files (`tr` and `en`) using `useTranslation`.
- Legacy screens often embed copy dictionaries inline in component files.

## 5) Design quality/risk notes

- Mixed maturity: some screens are production-integrated wrappers, others are prototypes/demos.
- Several legacy screens include hardcoded strings, example data, and placeholder actions.
- Some route files are duplicated aliases across root and grouped routes.
- Because many old routes defer to `src/features`, old design intent may now live in feature modules, not route files.

## 6) Guidance for future implementation

1. Use `src/features/*` as the source of truth for new UI changes.
2. Use `old design ` only as reference for:
   - information architecture
   - wording/content block ideas
   - legacy interaction flow
3. If migrating a custom-heavy legacy screen, extract:
   - copy map
   - section ordering
   - status/state rules
   then rebuild in the target feature module instead of editing old route files.
4. Keep localization and theme tokens centralized (avoid inline large copy dictionaries in screen files when possible).

## 7) Quick lookup map

- Global nav/providers: `old design /_layout.tsx`
- Buyer tabs behavior: `old design /(buyer)/_layout.tsx`
- Seller stack behavior: `old design /(seller)/_layout.tsx`
- Legacy public seller profile: `old design /seller-public-profile.tsx`
- Legacy admin dashboard: `old design /admin-panel.tsx`
- Legacy compliance/registration flows: root-level compliance files in `old design `
