# linkedin-kit plan

## Goal

Do what I do on LinkedIn from the terminal, through agents. First scope:

- Read and edit my profile.
- Search jobs, read job details, and compare each job with my profile (my CV on LinkedIn).

Out of scope: applying to jobs, MCP.

## Approach: code mode

The agent does not call one tool per action. It writes a short TypeScript script against a typed `li` client, and `lk run` executes it. One script can search, fetch details in parallel, filter, and return only what matters, so the agent's context stays small.

```ts
// agent-written script, run with: lk run script.ts
const me = await li.profile.get();
const jobs = await li.jobs.search({ keywords: "platform engineer", location: "Spain", remote: true, postedWithin: "week" });
const details = await Promise.all(jobs.slice(0, 10).map((j) => li.jobs.get(j.id)));
return { skills: me.skills, jobs: details.map((d) => ({ id: d.id, title: d.title, company: d.company, requirements: d.skills })) };
```

The agent does the CV/job comparison itself, guided by the skill file. The kit only supplies clean, structured data.

This works with any agent that has a shell (pi, Claude Code, Codex). pi's `codemode` can call `lk run` through `bash`.

## Architecture

```
lk (CLI, Bun + TypeScript)
├── login / status      session management
├── api                 prints the li client's .d.ts for the agent
├── run <file|->        runs an agent script with `li` injected, prints the result as JSON
│     --write           allows profile writes (dry-run diff otherwise)
└── li client
    ├── session         persistent Chromium profile (Patchright), one session, sequential queue, rate limit
    ├── voyager         reads through LinkedIn's internal JSON API using the browser session
    ├── profile         get, updateHeadline, updateAbout, updateLocation, experience/education add/edit/delete, skills add/remove
    └── jobs            search, get, saved, save/unsave
```

- **Runtime:** Bun runs TS directly, with no build step for scripts.
- **Reads** go through Voyager JSON where possible (fast and stable). The DOM is the fallback.
- **Writes** go through the UI forms, because that is what LinkedIn accepts for member edits.
- **Write safety:** every write method returns a before/after diff. It only executes under `lk run --write`. Without the flag it is a dry run.
- **State:** `~/.linkedin-kit/` holds the browser profile and a cache of profile and job snapshots.
- No daemon in v1. Each `lk run` reopens the persistent context. Add a daemon only if the startup time hurts.

## Sources to take from

| Source | License | Take |
|---|---|---|
| [Sabari2005/linkedin-mcp-server](https://github.com/Sabari2005/linkedin-mcp-server) | MIT, TS | Most of the code. `src/domains/profile.ts` (headline, about, location, section add/edit/delete, skills), `src/domains/jobs.ts` (search URL builder, search, detail, saved), `src/voyager/client.ts`, `src/browser/selectors.ts`, `src/auth/*` (cookie import, session). Drop the MCP layer, sampling, and selector auto-repair. |
| [stickerdaniel/linkedin-mcp-server](https://github.com/stickerdaniel/linkedin-mcp-server) | Apache-2.0, Python | Reference only. Patchright over Playwright, one session at a time, a sequential tool queue, importing cookies from your browser, and job detail parsing. |
| [kyle-nelson-berkeley/linkedin-mcp](https://github.com/kyle-nelson-berkeley/linkedin-mcp) | MIT, Python | The propose-diff-then-approve pattern for profile edits. |
| [Cloudflare Code Mode](https://blog.cloudflare.com/code-mode/) | n/a | The idea: give the model a TS API, not tool schemas. |

Ported files keep their license header. A `NOTICE` file lists the origins.

## Phases

Each phase is one or more commits with tests.

0. **Scaffold.** Bun + TS strict, `lk` entrypoint, `lk login` (headed browser, or `--import-from-browser`), `lk status`.
1. **Read.** `li.profile.get()` (own profile, structured: headline, about, experience, education, skills) and `li.jobs.search / get / saved`. Tests run against recorded Voyager JSON and HTML fixtures.
2. **Code mode.** `lk run`, `lk api`, `skills/linkedin/SKILL.md` (how to write scripts, the compare-with-CV workflow, rate limits), and example scripts in `examples/`.
3. **Profile writes.** Headline, about, location, experience and education entries, and skills. Dry-run diff by default, `--write` to apply.
4. **Later, not planned yet:** saved jobs and job alerts, messaging, network, feed and posts.

## Risks

- **ToS:** automated access breaks LinkedIn's User Agreement, so the account can be restricted. Mitigations: your own session and IP, one session at a time, a rate limiter, low volume, and no bulk actions.
- **Markup and endpoint drift:** fixtures plus an `lk doctor` live smoke check that runs only on demand.

## Open questions

1. Is "my CV in LinkedIn" the profile itself, the resume PDF uploaded in job settings, or both?
2. Is a CLI-first design (any agent through `bash`) enough, or do you also want a pi extension that registers `li` as native codemode tools?
3. Bun is fine, or should it be Node?
