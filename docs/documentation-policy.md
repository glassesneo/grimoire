# Documentation Policy

This file owns what the repository documents, where each kind of statement belongs, and when documentation changes.

## What is documented

Whether a statement belongs in documentation depends on the reader's task, not on how rarely it changes. Document what is needed to write or change a declaration, or to use or change an adapter, extension, or module, without deriving it from the implementation. Leave concrete configuration values in code. Where each of them belongs follows the responsibilities in `docs/architecture.md`.

The syntax that modules and hosts write is declared as options. A type states what a single value may be, so a constraint a type can express is not left to prose. A module's option declarations are code first: their names, types, and defaults state what a value means, and the reference renders them as written. A module option has a description only where those leave its meaning or a constraint unstated, like a comment; write it as the trailing string of the Denix option function. The options that adapters and extensions add are contracts that module and host authors use without reading the mechanism, so each has a description. Defaults are rendered from the declarations without a real host, so a module declares `defaultText` only for a default the reference cannot render faithfully. Internal option descriptions address the mechanism's maintainers.

A module's `meta.description` states its responsibility in one sentence, assuming familiarity with modules in this repository. It lets readers understand that responsibility without reading the implementation and judge whether a future capability belongs there. It is not an inventory of current settings.

`docs/generated/authoring.md` is generated from those declarations. It lists every module's responsibility, source, and options, and the options that adapters and extensions add, so writing a module or host needs no reading beyond those declarations. The evaluation rules a mechanism applies to existing syntax, and what its maintainers rely on, are contracts that options cannot carry; they stay beside the implementation.

The absence of a written contract alone does not justify adding one. When a new criterion appears necessary, discuss that specific criterion with the maintainer rather than treating it as an existing requirement.

## Owners

- `README.org` introduces grimoire to third-party readers on GitHub. Working in the repository does not depend on reading it.
- `docs/architecture.md` describes this repository's composition, concepts, directory responsibilities, and mechanism index. It assumes Nix knowledge and is not a general guide to Denix rewrite.
- `docs/module-authoring.md` owns the judgments made when designing a module's interface and validating it. It applies the concepts of `docs/architecture.md` without restating their definitions.
- A mechanism's contract belongs beside its implementation: its contract comment and option descriptions. Its checks exercise that contract.
- `justfile` and `just/*.just` own recipe documentation and argument help, read through `just --list` and `just --usage`.
- `docs/operations.md` owns operational information that does not belong to an individual recipe, including development-shell setup, commit automation, and live verification procedures.
- `docs/generated/` holds generated references. Regenerate `authoring.md` with `just docs`; edit its source declarations, not the generated file.
- The root `AGENTS.md` owns agent-specific work rules and reading triggers not owned elsewhere. It may summarize the architecture concepts assumed in conversation.
- A nested `AGENTS.md` owns agent-specific work rules limited to its directory.

A contract comment states a mechanism's supported behavior. An implementation comment explains a non-obvious decision beside the code, such as a workaround, ordering constraint, or upstream dependency. It may concern a concrete configuration choice. It does not restate a contract owned elsewhere.

## Updates

Update a specification and its implementation together when the specified behavior changes. A change to a concrete value does not require documenting that value separately. Generated references follow their source declarations.

Documentation and comments may also be corrected or clarified without changing code. Such edits do not by themselves establish a new contract.

Each statement has one owner; other documents point to that owner. The architecture summary in the root `AGENTS.md` changes with the statements it summarizes. Documents and specifying source files make their scope clear at the beginning. If a proposed statement has no owner, propose one to the maintainer before adding it.
