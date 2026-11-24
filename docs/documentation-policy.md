# Documentation Policy

For each statement, identify who needs it and what they are trying to do. Put it where that reader meets the subject. If the reader already has the answer there, leave the statement unwritten. Leave concrete configuration values in code.

Each statement has one owner; other places point to it. If a needed statement has no owner, propose a place to the maintainer before adding it; a new nested `AGENTS.md` for the directory concerned is one candidate. A statement about the change itself, such as what it could not verify, belongs in the report of the change, not in the repository. If the statement would introduce a new requirement, propose the requirement rather than writing it as settled.

## At the point of use

- **Running a program or recipe.** Put recipe instructions and argument help on the recipe in `justfile` or `just/*.just`. Put a program's usage in its own help: `--help` output, or the help and descriptions of its commands. If the user needs information when something happens, put it in the message or error at that point, including what the user can do next when there is a remedy.
- **Writing a declaration.** Express restrictions in option types and constraints. For a module option, add a description only for meaning or conditions its name, type, and default leave unclear; use the trailing string of the Denix option function. Supply `defaultText` only when the reference cannot faithfully show the default. Describe each option an adapter or extension adds for the author who uses it. Internal option descriptions address the mechanism's maintainers.
- **Finding a module.** Put its responsibility in `meta.description`, including where it ends when the user must finish something by hand, not a list of its current settings.
- **Calling a library function.** Document a `mylib` or `delib` function that modules call at its definition with `mylib.documented`. The [authoring reference](generated/authoring.md) lists these functions and renders module responsibilities and options from their declarations. Edit the sources and regenerate the reference with `just docs`.

## Tests and comments

Express behavior a user or another component relies on in tests within the repository's [validation boundary](architecture.md#validation-boundary). Name the case for the behavior and state in `protects` what it preserves. Test the result the consumer relies on, not the steps that produce it.

Use a comment only for something the code beside it cannot show: why a workaround is needed, why an order or evaluation constraint matters, or what fact about an external program the code depends on. A comment can explain why a configuration value was chosen without repeating the value.

## Repository documents

A document holds what applies across features: how the repository fits together and the judgments that apply to every module. A feature's usage, limits and procedures go to the places above.

- [`README.org`](../README.org) introduces grimoire to someone encountering the repository on GitHub.
- [Architecture](architecture.md) explains how the repository fits together: its concepts, directory responsibilities, and the index of mechanisms, the adapters, extensions, `lib/` files and scripts that modules and hosts are built on.
- [Module Authoring](module-authoring.md) guides decisions about designing a module's interface and validating it.
- Root [`AGENTS.md`](../AGENTS.md) owns repository-wide agent work rules and reading triggers not owned elsewhere. An existing nested `AGENTS.md` owns agent rules limited to its directory.

## Keeping statements current

When behavior changes, update its owner in the same change, including a mechanism's entry in the architecture index. Check existing documents for obsolete statements and pointers; correct the concept summary in root `AGENTS.md` if what it summarizes changed. Describe the current revision only: no migration, fallback or deprecation note is kept, and the history of a change is left to Git. A clarification needs no implementation change when the behavior is unchanged.
