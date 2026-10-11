# Documentation Policy

This file owns what the repository documents, where each kind of statement belongs, and when documentation changes.

## Specifications and choices

This repository contains the framework used to compose and apply an environment, and the concrete choices made with it. Framework specifications guide implementation and use. Configuration values and the concepts grouped into individual Denix modules are choices expressed by their declarations; they do not require separate specifications.

Whether a statement belongs in documentation depends on the reader's task, not on how rarely it changes. Document the specifications needed to use or change a mechanism without deriving them from its implementation. Leave concrete configuration choices in code.

A module's `meta.description` states its responsibility in one sentence, assuming familiarity with modules in this repository. It lets readers understand that responsibility without reading the implementation and judge whether a future feature belongs there. It is not an inventory of current settings. The generated module catalogue presents that same description with its source location.

Option descriptions explain what a value means and the constraints needed to specify it. Internal option descriptions address the mechanism's maintainers.

The absence of a written contract alone does not justify adding one. When a new criterion appears necessary, discuss that specific criterion with the maintainer rather than treating it as an existing requirement.

## Owners

- `README.org` introduces ark to third-party readers on GitHub. Working in the repository does not depend on reading it.
- `docs/architecture.md` describes this repository's composition, concepts, directory responsibilities, and mechanism index. It assumes Nix knowledge and is not a general guide to Denix rewrite.
- A mechanism's contract belongs beside its implementation: its contract comment and option descriptions. Its checks exercise that contract.
- `justfile` and `just/*.just` own recipe documentation and argument help, read through `just --list` and `just --usage`.
- `docs/operations.md` owns operational information that does not belong to an individual recipe, including development-shell setup, commit automation, and live verification procedures.
- `docs/generated/` holds generated references. Regenerate `modules.md` with `just docs`; edit its source metadata, not the generated file.
- The root `AGENTS.md` owns agent-specific work rules and reading triggers not owned elsewhere. It may summarize the architecture concepts assumed in conversation.
- A nested `AGENTS.md` owns agent-specific work rules limited to its directory.

A contract comment states a mechanism's supported behavior. An implementation comment explains a non-obvious decision beside the code, such as a workaround, ordering constraint, or upstream dependency. It may concern a concrete configuration choice. It does not restate a contract owned elsewhere.

## Updates

Update a specification and its implementation together when the specified behavior changes. A change to a concrete choice does not require documenting that choice separately. Generated references follow their source metadata.

Documentation and comments may also be corrected or clarified without changing code. Such edits do not by themselves establish a new contract.

Each statement has one owner; other documents point to that owner. The architecture summary in the root `AGENTS.md` changes with the statements it summarizes. Documents and specifying source files make their scope clear at the beginning. If a proposed statement has no owner, propose one to the maintainer before adding it.
