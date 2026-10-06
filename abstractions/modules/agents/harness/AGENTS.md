# abstractions/modules/agents/harness/

## Local Contract

- The harness uses pi through its SDK. Where it depends on pi behavior that pi does not export or document, it fails with an explicit error when that behavior changes instead of degrading silently, and a comment beside the code names the dependency.
- Tests never touch the user's sessions, settings, or files: they work in temporary directories with in-memory or temporary sessions.

## Validation

- In this directory, run `bun node_modules/typescript/bin/tsc --noEmit` and `bun test`. The package build runs both, so `nix build .#checks.<system>.harness` covers them in the sandbox.
- Test behavior that spans the session and the model with `createFauxSession` from `src/core/faux.ts` instead of a live provider; it can also return given tool results instead of running tools.
