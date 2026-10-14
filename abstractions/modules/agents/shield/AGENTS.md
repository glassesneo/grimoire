# abstractions/modules/agents/shield/

## Local Contract

- The Pi view is reduced twice, by the hub (`hub/lib/shield/pi_view.ex`) and by quin (`quin/view.ts`), and both must produce the same view. Change them together, and extend `hub/test/view-trace.json` when a change adds an event the trace does not exercise.
- `quin/ui/` began as a copy of the harness's `src/ui/`, with `codemode-result.ts` and the shapes in `pi-content.ts` from its `src/core/`. Changes to either do not reach the other; port a harness change only when quin should have it. `quin/timeline.tsx` takes the place of the harness's projection, from the hub's view instead of session events.
- Tests never touch the user's SHIELD directories, sockets, or credentials: they use temporary `XDG_CONFIG_HOME`/`XDG_STATE_HOME`, an explicit `--socket`, and the faux provider.

## Validation

- quin and the clients: in `quin/`, run `bun node_modules/typescript/bin/tsc --noEmit` and `bun test`; `nix build .#checks.aarch64-darwin.quin` covers them in the sandbox.
- Hub logic: in `hub/`, run `MIX_ENV=test mix test --no-start` and `mix format --check-formatted`.
- Process, socket, and real Pi behavior, and the view trace: `nix build .#checks.aarch64-darwin.shield`. It includes a 60-second startup-deadline case, so it is slow.
