# Contributing to plumbline

Issues, discussions and pull requests are all welcome — this project aims
to stay small, zero-dependency at runtime, and honest about what each
client actually does with its config.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/plumbline.git
cd plumbline
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 89 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/
```

`scripts/smoke.sh` exercises the real CLI (check across all three client
dialects, exit codes, --fail-on, JSON output, stdin, path/shape
detection, clients, explain, determinism) against the bundled example
configs and must print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (parsing, detection, analysis and rendering all take values,
   not file handles — only the CLI touches the filesystem).
5. New diagnostics need a stable code that is never reused, a catalog
   entry in `src/rules.ts` (which feeds `explain` and `docs/rules.md`),
   and at least one positive and one negative test.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core
  feature; adding one needs justification in the PR and will usually be
  declined.
- No network calls, ever — the tool reads arguments, files and stdin,
  then prints. That is the whole I/O surface.
- Rule codes (`E1xx`/`W2xx`/`I3xx`) are stable API: never renumber or
  repurpose an existing code; add new ones instead.
- Client behavior claims must be verifiable: every fact a rule leans on
  lives as data in `src/clients.ts`, and changing one needs a pointer to
  the client's documentation or reproducible behavior.
- Heuristics (the W2xx pitfalls) must ship with negative tests — being
  quiet on correct configs matters as much as catching broken ones.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `plumbline --version` output, the exact command line, the
client you targeted (`--client` or the detection line from the report
header), and the smallest config that reproduces the problem — one server
entry is usually enough. If you believe a finding is wrong (or missing),
say what the client actually does with that config; client-observable
behavior is the tiebreaker.

## Security

Do not open public issues for security problems; use GitHub private
vulnerability reporting on this repository instead.
