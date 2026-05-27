# Fix Tailwind Theme Token Regression

## Goal

Fix the regression where the Electron client UI falls back to a near black-and-white default because Tailwind theme token utilities such as `bg-primary`, `bg-card`, and `text-muted-foreground` are not emitted in the compiled CSS. Add a small automated guard so this class of issue fails during verification instead of being discovered visually after launch.

## What I Already Know

* The renderer uses Tailwind CSS v4 with `@import "tailwindcss"` in `packages/client/src/renderer/src/index.css`.
* Components use semantic utilities such as `bg-primary`, `text-primary-foreground`, `bg-card`, `bg-muted`, `text-muted-foreground`, and `border-border`.
* The built renderer CSS currently does not contain key semantic utility selectors such as `.bg-primary`.
* The user wants the bug fixed with simple, correct code and no new regressions.

## Requirements

* Restore Tailwind v4 semantic theme utilities for the client renderer.
* Keep the fix small and localized to theme wiring and verification.
* Preserve existing component class names where possible.
* Add an automated CSS theme contract check that catches missing semantic utility selectors.
* Ensure the UI has a visible blue brand accent again, especially active sidebar navigation.

## Acceptance Criteria

* [x] Compiled client CSS contains required semantic utility selectors including `.bg-primary`, `.text-primary-foreground`, `.bg-card`, `.bg-muted`, `.text-muted-foreground`, `.border-border`, `.border-input`, and `focus-visible:ring-ring`.
* [x] Active sidebar navigation renders with a blue background and white foreground.
* [x] App shell background is not pure white-only default styling.
* [x] `pnpm --filter @tengyu-aipod/client build` passes.
* [x] The new theme contract check passes after build and fails if required semantic utilities are missing.

## Definition of Done

* Code is minimal and follows existing Tailwind/shadcn-style component patterns.
* Type-check and relevant tests/checks pass where practical.
* No unrelated source files are refactored.
* Theme guard is documented through a package script so future agents can run it.

## Technical Approach

Use Tailwind v4 CSS-first theme registration in the renderer stylesheet via `@theme inline`, mapping existing CSS variables to Tailwind color utilities. This is preferred over scattering raw blue classes through components because it restores the existing semantic design system rather than bypassing it.

Add a small Node script under the client package that inspects the latest built renderer CSS and asserts required selectors are present. Wire it to a package script so the check is easy to run locally and in CI.

## Decision (ADR-lite)

**Context**: The app already uses semantic Tailwind utilities across many components, but Tailwind v4 is not emitting those custom token utilities.

**Decision**: Register the semantic tokens in `index.css` using Tailwind v4 `@theme inline`, then add a CSS build contract check.

**Consequences**: The fix is centralized and low-risk. Future token drift will be caught by an automated check instead of relying on manual screenshot review.

## Out of Scope

* Full visual redesign of every workbench page.
* Replacing existing component primitives.
* Adding broad screenshot snapshot tests for every route.
* Changing business logic in generation, collection, listing, detection, or Photoshop modules.

## Technical Notes

* Likely files:
  * `packages/client/src/renderer/src/index.css`
  * `packages/client/package.json`
  * `packages/client/scripts/assert-theme-css.mjs`
* Existing visual source of regression:
  * `packages/client/src/renderer/src/layout/Sidebar.tsx` expects `bg-primary text-primary-foreground` for active navigation.
