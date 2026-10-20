# Architecture

This file describes the architecture of ark: its composition, the concepts used to declare configurations, directory responsibilities, and repository mechanisms. It assumes familiarity with Nix.

Ark uses Denix's rewrite branch as its foundation. The notation and behavior described here are those used by this repository, including its adapters and extensions; this is not a general reference for upstream Denix.

The framework composes, extends, verifies, and applies the configuration. Modules and hosts express the concrete environment built with it. See [Documentation Policy](documentation-policy.md) for how specifications and choices are documented.

## Composition

`flake.nix` is the composition root. It selects inputs, loads adapters and extensions, discovers Denix abstractions, passes `lib/` to them as `mylib`, and publishes configurations, checks, formatting, and the development shell.

Denix receives every `default.nix` below `abstractions/`. Files in that tree declare independent Denix abstractions; they do not form manual import chains. New files must be Git-tracked before flake evaluation can discover them.

`flake.nix` publishes one nix-darwin configuration per Darwin host and one Hjem configuration per user of each host. Each configuration evaluates independently because each is activated separately.

The same composition publishes `packages.<system>`, merging feature-owned bundles selected for publication into the flake's own packages. A published name that equals an existing package name fails evaluation instead of overriding it.

## Modules, hosts, and sections

A module (`delib.module`) is a feature. It declares options under `myconfig.<name>` and configuration for each module system. A host (`delib.host`) holds the facts and choices of one machine.

Both write configuration in sections per module system, such as `darwin.ifEnabled` or `hjem.always`:

- `always` applies unconditionally.
- `ifEnabled` applies when the module's `enable` is true, or, for a host, when that host is the one being built.
- `ifDisabled` applies when the module's `enable` is false, or, for a host, when another host is being built.

Option declarations go in `always`; a conditional section cannot declare options.

The module systems are `darwin` (nix-darwin), `hjem` (through `adapters/hjem/default.nix`), `bundles` (feature-owned packages selected for publication, through `adapters/bundles.nix`), and `myconfig`. `myconfig` is not evaluated on its own: Denix merges it into every other module system's evaluation under the `myconfig` prefix. A `myconfig` value is therefore seen by every module system and must mean the same in each. A value that only means something inside one system, such as a path or derivation that system computes, belongs to that system's sections.

A module's name is its `myconfig` interface path, so choose it for the modules and hosts that reference it. Directory placement serves navigation and may differ from the name.

## Directory ownership

- `abstractions/hosts/` owns machine-specific facts and choices.
- `abstractions/modules/` owns reusable features. A feature keeps its Darwin, Hjem, and other module-system outputs together.
- `adapters/` owns integrations for module systems that Denix does not provide. An adapter translates Denix modules into the external system's configuration result; it does not own user configuration policy.
- `extensions/` owns extensions of Denix itself: host attributes and behavior applied to every module or host. Features that consume them live in `abstractions/modules/`.
- `lib/` owns pure Nix helpers passed to abstractions as `mylib`. Helpers define types and transformations; they do not own configuration.
- `checks/` owns sandboxed checks of repository mechanisms and of the published configurations as a whole, exported through `checks.<system>`. Each immediate `checks/<name>/default.nix` is discovered automatically. The contract of a single module is checked inside that module instead; see Validation boundary.
- `scripts/`, `justfile`, and `just/` own repository operations. Recipe documentation and argument help are available through `just --list --list-submodules` and `just --usage <recipe>`. [Operations](operations.md) covers operational prerequisites and procedures outside individual recipes.

A concern has one owner. Shared outputs have one final writer, and adapters translate values without taking ownership of the feature that produced them.

A module owns its declaration's directory, independently of its dotted interface name. It does not directly reference feature files outside that directory. Other modules enter its check fixtures through `uses`; shared tools, inputs and common configuration enter through the mechanisms. Incremental selection maps changed paths to the deepest module directory and follows reverse `uses` dependencies. It does not infer arbitrary Nix or file dependencies; only forced missing references are detected by fixture evaluation.

Nix owns evaluation and realization. Build recipes call Nix directly without activating the configuration. Operator procedures and external-command orchestration default to Nushell under `scripts/`. An internal runtime implementation may use another language for a concrete standard-library or safety benefit; explain that reason beside the implementation.

## Repository mechanisms

Each mechanism is specified at the top of its file and by its option descriptions.

- `extensions/hosts.nix`: host attributes (system and sole user), exposed as read-only `myconfig.host` by the host module.
- `extensions/module-dependencies.nix`: a dotted module's `enable` depends on its immediate parent.
- `extensions/module-metadata.nix`: required responsibility descriptions and optional classification tags for modules.
- `extensions/module-checks.nix`: module-owned inline cases, declaration locations and reverse `uses` closure; `lib/module-checks.nix` evaluates fixtures and aggregates their evaluated values and builds into `checks.<system>.module-<name>`.
- `lib/checks.nix` and `checks/default.nix`: descriptor-based discovery that reads platform declarations without forcing check bodies; `lib.checks.<system>` publishes JSON-safe ownership and selection metadata.
- `extensions/provenance.nix`: every module and host section is labelled with its origin as the location of its definitions.
- `adapters/hjem/default.nix`: the Hjem module system, including files that only one location may define.
- `adapters/hjem/services.nix`: Hjem-owned portable/native service declarations and Darwin lowering, with lifecycle reconciliation in `adapters/hjem/services/reconciler.cr`.
- `adapters/hjem/nix-secrets.nix`: standalone compatibility for upstream nix-secrets options and manifest-based Darwin user activation.
- `adapters/bundles.nix`: the bundles module system, through which a feature declares itself as a standalone package; which bundles are published is chosen separately.
- `lib/fragments.nix`: named fragments ordered by dependency, for a file that several features contribute to.
- `lib/module-docs.nix`: a module catalogue rendered from Denix metadata and declaration locations without generating a host configuration.
- `scripts/bun.nu`: npm dependencies of a Bun project pinned for Nix in a `bun.nix` generated from its `bun.lock`, kept current by `checks/bun-lock`.
- `git-hooks.nix`: development-shell installation of commit and push gates. `scripts/commit.nu` owns the index transaction, `scripts/checks.nu` selects checks from metadata, and `scripts/pre-push.nu` verifies outgoing tip trees.

## Validation boundary

A check belongs under `checks/` only when it can run as a sandboxed flake check. Use Nix option validation, evaluation, or a consumer validator before adding a behavioral test at a higher layer. A check covers the contract of the code it belongs to and trusts the contracts that code depends on: an upstream project's as published, and repository-owned code's because that code's own checks cover it.

Each kind of validation answers a different question:

- An option type rejects a single invalid value where it is defined.
- An assertion rejects a configuration whose choices are invalid together. It runs on every evaluation of a real configuration and addresses whoever wrote those choices.
- An inline check shows that a module's implementation is correct on chosen inputs. It runs only as a check and addresses the module's author. A condition that no configuration choice can break, only a defect in the module, belongs here rather than in an assertion.
- A check under `checks/` covers a repository mechanism, the composition, or a property spanning the published configurations.

A module's own contract — what its options produce and reject — is checked by the module's `checks`, beside its definition. Each case uses the adapters and extensions of `flake.nix` with only that module, the modules explicitly named in `uses`, infrastructure, and fixture contributors. A case either compares an evaluated value, expects an evaluation/assertion failure, or builds a derivation from the fixture result. Platform filtering precedes fixture generation; supported cases aggregate into one check per module. Build cases stay with their owning feature rather than reading published packages to bypass the fixture.

Commit automation builds selected checks on the final index snapshot, excluding formatting and catalogue freshness already handled by automatic generation. Infrastructure and unknown code paths select all remaining current-system checks. Host-only and designated documentation changes select none. Pre-push and `just check-full` run the full current-system gate, including formatting and catalogue freshness; see [Operations](operations.md) for snapshot and bypass boundaries.

Mechanism checks use the smallest input boundary they own, without importing unrelated feature modules or extensions. Checks of feature wiring receive the real Denix `configuration` from `flake.nix` instead of reconstructing its module list.

Live activation and platform behavior require an explicit operator command; evaluation and derivation builds do not exercise them.
