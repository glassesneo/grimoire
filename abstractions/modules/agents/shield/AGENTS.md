# abstractions/modules/agents/shield/

## Local Contract

- An engine is a `Shield.Engine` module registered in `hub/lib/shield/engine.ex`, which documents the effects the Agent performs. `Agent`, `Manager`, `Connection`, and `Protocol` stay engine-neutral; engine-specific behavior and error codes belong in the engine.
- SHIELD's supported platforms are defined in `package.nix` and exposed through `meta.platforms`; publication, development tools, and checks derive availability from those packages. The current Darwin restriction reflects `/usr/bin/lockf` and socket path sizing. When changing availability, evaluate Linux packages and checks as well as Darwin.
- The hub (`hub/lib/shield/pi_view.ex`) alone reduces Pi records. Its snapshot and patch contract is stated there; quin (`quin/view.ts`) only applies patches. `tests/shield/view-trace.ts` checks that patches reconstruct the authoritative snapshots, not a second Pi reducer.
- `quin/ui/` began as a copy of the harness's `src/ui/`, with `codemode-result.ts` and the shapes in `pi-content.ts` from its `src/core/`. Changes to either do not reach the other; port a harness change only when quin should have it. `quin/timeline.tsx` takes the place of the harness's projection, from the hub's view instead of session events.
- Tests never touch the user's SHIELD directories, sockets, or credentials: they use temporary `XDG_CONFIG_HOME`/`XDG_STATE_HOME`, an explicit `--socket`, and the faux provider.

## Validation

- quin and the clients: in `quin/`, run `bun node_modules/typescript/bin/tsc --noEmit` and `bun test`; `nix build .#checks.aarch64-darwin.quin` covers them in the sandbox.
- Hub logic: in `hub/`, run `MIX_ENV=test mix test --no-start` and `mix format --check-formatted`.
- Process, socket, and real Pi behavior, and the view trace: `nix build .#checks.aarch64-darwin.shield`. It includes a 60-second startup-deadline case, so it is slow.
