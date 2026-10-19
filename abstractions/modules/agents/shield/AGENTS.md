# abstractions/modules/agents/shield/

## Local Contract

- An engine is a `Shield.Engine` module registered in `hub/lib/shield/engine.ex`, which documents the effects the Agent performs. The only engine is `Shield.Keel`, which relays the keel runtime's records. `Agent`, `Manager`, `Connection`, and `Protocol` stay engine-neutral; engine-specific behavior and error codes belong in the engine. `hub/test/engine_neutrality_test.exs` checks that their compiled code names no module other than each other, `Shield.Engine`, and `Shield.Listener`; it cannot see engine-specific strings such as error codes.
- The hub owns process lifetime, connections, and the writer of each agent; it never interprets or numbers the runtime's state. Pi's meaning belongs to the keel runtime (`../keel/`).
- SHIELD's supported platforms are defined in `package.nix` and exposed through `meta.platforms`; publication, development tools, and checks derive availability from those packages. The current Darwin restriction reflects `/usr/bin/lockf` and socket path sizing. When changing availability, evaluate Linux packages and checks as well as Darwin.
- Tests never touch the user's SHIELD or keel directories, sockets, or credentials: they use temporary `XDG_CONFIG_HOME`/`XDG_STATE_HOME`, an explicit `--socket`, and the faux provider.

## Validation

- Hub logic: in `hub/`, run `MIX_ENV=test mix test --no-start`. `nix fmt` formats the hub with treefmt's `mix format`.
- The clients in `client/` are type-checked and linted with keel; see `../keel/AGENTS.md`.
- Process, socket, and real runtime behavior: `nix build .#checks.aarch64-darwin.shield-process`. It includes a 60-second startup-deadline case, so it is slow.
