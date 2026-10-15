# Repository Agent Guidance

This file owns the agent rules no other document covers and summarizes the concepts of `docs/architecture.md` that conversations assume.

## Concepts

- The configuration is built with Denix. Modules (`delib.module`) are features under `abstractions/modules/`; hosts (`delib.host`) are machines under `abstractions/hosts/`. The repository discovers them automatically; they do not import each other.
- A module declares options under `myconfig.<name>`, and its name is that interface path. A dotted module such as `zsh.interactive` is enabled only when its parent is.
- Modules and hosts write configuration in sections per module system: `always`, `ifEnabled`, and `ifDisabled`. The module systems are `darwin` (nix-darwin), `hjem` (user files, through `adapters/hjem/default.nix`), `bundles` (published packages, through `adapters/bundles.nix`), and `myconfig`.
- `myconfig` is merged into every module system's evaluation, so it carries choices that mean the same everywhere. Values one system computes stay in that system's sections.
- A feature keeps all of its module-system outputs together, and every shared output has one owner. Files several features contribute to are owned by one module and receive the others' contributions as ordered fragments.
- Option types reject an invalid single value; assertions reject invalid combinations of a configuration's choices; a module's `tests` cases, beside its definition, show that its implementation is correct; `tests/` holds checks of repository mechanisms and of the published configurations as a whole.

## Reading Path

1. Read `docs/architecture.md` before adding a module or host, changing how modules relate, or changing `flake.nix`, `adapters/`, `extensions/`, `lib/`, or `tests/`. Follow its links to the contract of the mechanism being changed. Changing a value inside an existing module needs only the concepts above.
2. Read `docs/documentation-policy.md` before changing documentation, descriptions, or comments, and before completing a change to a repository mechanism or operation.
3. Use `just --list --list-submodules` and `just --usage <recipe>` to inspect repository commands before using or changing them.
4. Read the relevant part of `docs/operations.md` before entering the development shell, committing, or performing live verification. It describes operational effects not owned by an individual recipe.

## Validation

For repository changes:

1. Stage new files before flake evaluation; flakes read Git-tracked files.
2. Run `nix fmt`, then the narrowest relevant check: `nix build .#checks.<system>.<name>` for `tests/<name>`, or the `module-<name>` check for a module's tests.
3. Before completion, run `nix flake check`, unless you are committing: the commit hook runs it on the committed snapshot (`docs/operations.md`).

For read-only work, report what was inspected and which behavior remains unverified; do not run a formatter as part of the inspection.

Report any required check or live behavior that was not exercised, with the reason.
