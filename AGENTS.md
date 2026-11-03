# Repository Agent Guidance

This file owns the agent rules no other document covers and summarizes the concepts of `docs/architecture.md` that conversations assume.

## Concepts

- The configuration is built with Denix. Modules (`delib.module`) are features under `abstractions/modules/`; hosts (`delib.host`) are machines under `abstractions/hosts/`. The repository discovers them automatically; they do not import each other.
- A module declares options under `myconfig.<name>`, and its name is that interface path. A dotted module such as `zsh.interactive` is enabled only when its parent is.
- Modules and hosts write configuration in sections per module system: `always`, `ifEnabled`, and `ifDisabled`. The module systems are `darwin` (nix-darwin), `hjem` (user files, through `adapters/hjem/default.nix`), `bundles` (published packages, through `adapters/bundles.nix`), and `myconfig`.
- Adapters evaluate module systems and own the common contract of their results and application; extensions extend Denix's module and host declarations and evaluation rules; modules abstract capabilities, including those other modules use, such as user services, user defaults and single-definer files.
- `myconfig` is the input layer, merged into every module system's evaluation: it carries choices, data, and values derived from inputs alone, which each module system lowers into its own form. Values that depend on one system's evaluation stay in that system's sections.
- A rice (`mylib.rice`, under `abstractions/rices/`) is a named set of `myconfig` choices that a host selects with `rice`. `myconfig` definitions are ordered option default < module < rice < host along the declared types, without `mkDefault`; a higher source replaces a list whole, and a host extends its rice's value through `riceConfig`. Options declared with `mylib.accumulatingOption`, such as assertions and warnings, collect every source's contributions outside this order.
- A value is declared when its behavior was chosen, even if it equals the default. User preferences go through Hjem; settings applied with root privileges are limited to what the user's domain cannot achieve.
- A feature keeps all of its module-system outputs together, and every shared output has one owner. Files several features contribute to are owned by one module and receive the others' contributions as ordered fragments.
- Option types reject an invalid single value; constraints, declared by modules as `constraints.always` and `constraints.ifEnabled`, state a module's preconditions that types cannot express, such as options that cannot be used together; a module's `tests` cases, beside its definition, verify in fixtures what declarations meeting them produce. Tests cover only what this repository wrote or changed and trust the programs it configures, whatever flake provides them; `tests/` holds tests of repository mechanisms and of the published configurations as a whole, and `checks/` the remaining flake checks of the repository's state.
- A module owns files inside its directory and does not directly reference another feature's files. Shared mechanism inputs are injected; fixture dependencies are declared with `uses`. Incremental check selection relies on these boundaries.

## Reading Path

1. Read `docs/generated/authoring.md` before writing a module or host declaration: it lists every module's responsibility and every option that modules and hosts can write.
2. Read `docs/module-authoring.md` before writing or changing a module's options, constraints, or tests.
3. Read `docs/architecture.md` before adding a module or host, changing how modules relate, or changing `flake.nix`, `adapters/`, `extensions/`, `lib/`, `tests/`, or `checks/`. Follow its links to the contract of the mechanism being changed. Changing a value inside an existing module needs only the concepts above.
4. Read `docs/documentation-policy.md` before changing documentation, descriptions, or comments, and before completing a change to a repository mechanism or operation.
5. Use `just --list --list-submodules` and `just --usage <recipe>` to inspect repository commands before using or changing them.
6. Read the relevant part of `docs/operations.md` before entering the development shell, committing, or performing live verification. It describes operational effects not owned by an individual recipe.

## Validation

For repository changes:

1. Stage new files before flake evaluation; flakes read Git-tracked files.
2. Run `nix fmt`, then the narrowest relevant check: `nix build .#checks.<system>.<name>` for `tests/<name>` or `checks/<name>`, or the `module-<name>` check for a module's tests.
3. When adding or changing a test case, confirm that it fails against an implementation that violates the statement it covers, such as the code before a fix or a deliberate breakage restored afterwards, and report the result.
4. Before completion, run `nix flake check` (or `just check-full`). Commit runs only selected checks; pre-push runs the full gate on outgoing tip trees (`docs/operations.md`).

For read-only work, report what was inspected and which behavior remains unverified; do not run a formatter as part of the inspection.

Report any required check or live behavior that was not exercised, with the reason.
