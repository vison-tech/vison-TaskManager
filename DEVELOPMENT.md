# Development Rules

This repository is organized as a modular TypeScript monolith. Preserve the
following boundaries when adding or changing code.

## Module boundaries

- Give each module one primary responsibility. Keep presentation, state
  orchestration, domain operations, transport, parsing, and formatting separate.
- Entry files only assemble dependencies, configure the runtime, and start the
  process. Put command behavior, route behavior, and tool behavior in modules.
- Keep files below roughly 200-250 lines. Split a file before adding a second
  unrelated responsibility; a larger file needs a clear justification.
- Keep contracts and shared domain types centralized in `packages/contracts`.
  Do not duplicate API shapes in the Web, CLI, MCP, or server layers.
- Keep HTTP transport in `packages/client`. CLI and MCP must use the shared
  client and must not access SQLite directly.
- Keep SQLite access inside `apps/server`. Preserve the existing transaction
  boundary around writes and publish revision events only after commit.
- Browser code must not read `process.env`; use an explicit client base URL,
  normally the browser-relative URL.
- Avoid circular imports. Dependencies should point from entry points to
  feature modules, and from feature modules to shared contracts or utilities.

## Change discipline

- Add or update tests next to the behavior being changed. Run the smallest
  focused test set while iterating, then the full verification commands before
  handoff.
- Refactor at module boundaries instead of copying logic into a second entry
  point. If two callers need the same behavior, extract the behavior once.
- Preserve public API paths, CLI commands, MCP tool names, and optimistic
  version semantics unless the change explicitly includes a contract update.
- Keep adapters thin: route handlers parse and dispatch, command handlers map
  arguments, and MCP tools validate and format results.

## Required verification

```bash
npm run typecheck
npm run build
node --import tsx --test tests/*.test.ts
git diff --check
```
