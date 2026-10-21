# abstractions/modules/agents/shield/keel/

This directory holds keel's TypeScript: the driver, the screen, and the extensions. keel's model is `Shield.Keel` in the hub (`../hub/lib/shield/keel.ex` and `../hub/lib/shield/keel/`); the parent shield module owns the Bun project and packages.

## Local Contract

- keel's model, in the hub, owns every piece of state screens show: items, requests, drafts, assists, actions, keys, and kinds. It numbers state changes and decides who may run what. The driver (`driver/`) owns the Pi session, the run's control, Pi's meaning as entries, and the functions and promises extensions hold; it reports to the model and carries out what the model tells it. Screens (`screen/`) only mirror the model's state (`protocol/apply.ts`) and keep focus, selection, cursors, and disclosure of their own. Neither the driver nor a screen keeps an authoritative copy of the model's state.
- `../contracts/keel.tsp` states every record the three exchange; `protocol/contract.ts` gives its types and validators, and `protocol/wire.ts` and `protocol/items.ts` name the types the code uses. Declare a cross-language shape there, never in TypeScript alone.
- Extensions are loaded only from `extensions.json` in the configuration directory, besides the driver's required ones (`driver/driver.ts`). The extensions keel ships are in `extensions/` and are listed by name in `extensions/index.ts`; each one's actions, presentations, and assists exist only while it is listed. What an extension declares or changes in the model is asynchronous (`api.ts`); its functions run in the driver. `fixtures/` holds test extensions, loaded only by path.
- A renderer in `screen/ui/renderers.tsx` reads only its item's `data`, in the shapes `protocol/items.ts` gives; any item can be shown as its `text`.
- Where keel depends on Pi behavior that Pi does not export or document, the code fails explicitly when that behavior changes, and a comment beside it names the dependency. `driver/control.ts` holds the pause and queue mechanics and their dependencies; `driver/control.test.ts` checks them against the pinned Pi.
- keel's own extensions do not use Pi's standard UI (`ctx.ui`); `check-ui.ts` finds such uses with the TypeScript checker.
- Tests never touch the user's sessions, settings, or credentials: they work in temporary directories with Pi's faux provider. Driver tests answer the driver's operations with the contract's records but keep no model state; screen tests use minimal state fixtures; the model's decisions are tested in Elixir, and the whole path through the hub in the process case.

## Validation

- See `../AGENTS.md` for project-wide type, lint, UI, package, and process checks.
