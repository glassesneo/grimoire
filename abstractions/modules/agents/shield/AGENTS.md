# abstractions/modules/agents/shield/

## Local Contract

- An engine is a `Shield.Engine` module registered in `hub/lib/shield/engine.ex`, which documents the effects the Agent performs. The only engine is `Shield.Keel`, which relays the keel runtime's records. `Agent`, `Manager`, `Connection`, and `Protocol` stay engine-neutral; engine-specific behavior and error codes belong in the engine. `hub/test/engine_neutrality_test.exs` checks that their compiled code names no module other than each other, `Shield.Engine`, and `Shield.Listener`; it cannot see engine-specific strings such as error codes.
- The hub owns process lifetime, connections, and the writer of each agent; it never interprets or numbers the runtime's state. Pi's meaning belongs to the keel runtime (`keel/`).
- SHIELD's supported platforms are defined in `platforms.nix`; packages and build cases read that declaration without evaluating one another. The current Darwin restriction reflects `/usr/bin/lockf` and socket path sizing. When changing availability, evaluate Linux packages and checks as well as Darwin.
- Tests never touch the user's SHIELD or keel directories, sockets, or credentials: they use temporary `XDG_CONFIG_HOME`/`XDG_STATE_HOME`, an explicit `--socket`, and the faux provider.

## Validation

- Hub logic: in `hub/`, run `MIX_ENV=test mix test --no-start`. `nix fmt` formats the hub with treefmt's `mix format`.
- From this directory, run `bun node_modules/typescript/bin/tsc -p .` and `bun test`. From the repository root, run the development shell's `oxlint --config .oxlintrc.json --deny-warnings abstractions/modules/agents/shield`. The type check and lint cover this entire Bun project, including `build.ts`, clients, and process fixtures.
- In `keel/`, `node check-ui.ts --project ../tsconfig.json extensions/*.ts fixtures/*.ts` checks for unsupported `ctx.ui` use; it needs Node, not Bun.
- `nix build .#checks.aarch64-darwin.module-shield` runs the inline fixture checks, including type/lint/UI validation and process, socket, and real runtime behavior. The process case includes a 60-second startup deadline, so it is slow. Package builds retain Bun/Mix tests.
