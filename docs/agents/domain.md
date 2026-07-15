# Domain Docs

This repository uses a single-context domain documentation layout.

## Required reading

Before exploring or changing the codebase, read:

- `AGENTS.md`
- `docs/CONTEXT.md`
- Relevant files under `docs/spec/`
- ADRs under `docs/adr/` that affect the work

For complete-task work, ADR-0012, ADR-0013, and ADR-0015 are mandatory.

## Domain vocabulary

Use terminology defined in `docs/CONTEXT.md` in issue titles, specifications, acceptance criteria, tests, and code. Do not substitute terms listed under `_Avoid_`.

If a required concept is absent, record the gap instead of silently inventing new domain language.

## Architecture decisions

Treat accepted ADRs as constraints. If proposed work conflicts with an ADR, identify the conflict explicitly and resolve it before implementation.

In particular:

- Do not introduce a general-purpose orchestration engine in v1.
- Do not include listing in the complete task.
- Preserve existing IPC, API Key, workspace-directory, and task-data boundaries.
