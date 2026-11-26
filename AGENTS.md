# linkedin-kit

`src/li.ts` is the contract between modules and for agent scripts; change it only when your task needs it, and say so in the PR.

## Stack

- Bun + TypeScript (strict). Run TS directly; no build step.
- `bun test` for tests, `bun run typecheck` for types. Both pass before every commit.
- Browser automation: `patchright` (Playwright API). Never log in or hit LinkedIn from tests; tests use recorded fixtures under `test/fixtures/`.

## Layout

- Repo root is a `.bare` worktree root. Each branch lives in its own folder next to `main/`. Work only inside your own worktree.

## Workflow

- One work unit per commit: behaviour, its tests, its docs. Short imperative subject. No AI attribution trailers.
- Push after every commit: `git push -u origin HEAD`.
- When the branch is done, open a PR to `main` with `gh pr create --fill`. Do not merge it yourself.
- If `main` moved, rebase onto `origin/main` before opening the PR.

## Porting code

- Code taken from another repo keeps its license header, and gets a line in `NOTICE` (repo, path, license).
- Main source: https://github.com/Sabari2005/linkedin-mcp-server (MIT). Drop its MCP, sampling, and selector auto-repair layers.

## Safety

- No job applications, ever.
- Profile writes return `WriteResult` and only send when `lk run --write` was given.
- One browser session at a time; all LinkedIn calls go through one sequential queue with a rate limit.
