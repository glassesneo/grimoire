# abstractions/modules/agents/shield/keel/

This directory holds keel's code; the parent shield module owns the Bun project and packages.

## Local Contract

- The runtime (`runtime/`) owns the Pi session and every piece of state screens show: items, requests, drafts, assists, actions, keys, and the run's control. It numbers state changes; screens (`screen/`) only mirror them (`protocol/apply.ts`) and keep focus, selection, cursors, and disclosure of their own. `protocol/wire.ts` states the wire.
- Extensions are loaded only from `extensions.json` in the configuration directory, besides the runtime's required ones (`runtime/host.ts`). The extensions keel ships are in `extensions/` and are listed by name in `extensions/index.ts`; each one's actions, presentations, and assists exist only while it is listed. `fixtures/` holds test extensions, loaded only by path.
- A renderer in `screen/ui/renderers.tsx` reads only its item's `data`, in the shapes `protocol/items.ts` gives; any item can be shown as its `text`.
- Where keel depends on Pi behavior that Pi does not export or document, the code fails explicitly when that behavior changes, and a comment beside it names the dependency. `runtime/control.ts` holds the pause and queue mechanics and their dependencies; `runtime/control.test.ts` checks them against the pinned Pi.
- keel's own extensions do not use Pi's standard UI (`ctx.ui`); `check-ui.ts` finds such uses with the TypeScript checker.
- Tests never touch the user's sessions, settings, or credentials: they work in temporary directories with Pi's faux provider.

## Validation

- See `../AGENTS.md` for project-wide type, lint, UI, package, and process checks.
