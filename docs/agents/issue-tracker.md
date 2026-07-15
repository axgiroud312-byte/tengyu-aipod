# Issue tracker: GitHub

Issues, specifications, PRDs, and implementation tickets for this repository live in GitHub Issues:

- Repository: `axgiroud312-byte/tengyu-aipod`
- URL: `https://github.com/axgiroud312-byte/tengyu-aipod`
- CLI: `gh`

## Conventions

- Create an issue with `gh issue create --repo axgiroud312-byte/tengyu-aipod`.
- Read an issue and its discussion with `gh issue view <number> --comments`.
- List issues with `gh issue list`, including labels and comments when required.
- Comment with `gh issue comment <number> --body "..."`.
- Apply or remove labels with `gh issue edit`.
- Close an issue with `gh issue close`.
- Use a temporary body file for multiline issue content to preserve Markdown exactly.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Publishing

When a skill says to publish a spec, PRD, ticket, or issue to the issue tracker, create a GitHub issue in `axgiroud312-byte/tengyu-aipod`.

When a skill says to fetch a relevant ticket, read the complete issue body, labels, and comments.

## Dependencies

Use GitHub native issue dependencies when available. The blocker database ID must come from:

`gh api repos/axgiroud312-byte/tengyu-aipod/issues/<number> --jq .id`

If native dependencies are unavailable, put `Blocked by: #<number>` at the top of the dependent issue body. A ticket is unblocked only when all listed blockers are closed.
