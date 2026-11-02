# Architecture

This file describes the architecture of grimoire: its composition, the concepts used to declare configurations, directory responsibilities, and repository mechanisms. It assumes familiarity with Nix.

Grimoire uses Denix's rewrite branch as its foundation. The notation and behavior described here are those used by this repository, including its adapters and extensions; this is not a general reference for upstream Denix.

Adapters evaluate module systems and apply their results, extensions extend Denix's declarations, and modules abstract capabilities, from an application's installation and settings to capabilities that other modules use. Hosts hold the facts and choices of each machine. See [Documentation Policy](documentation-policy.md) for what is documented where, and [the authoring reference](generated/authoring.md) for every option that modules and hosts write.

## Composition

`flake.nix` is the composition root. It selects inputs, loads adapters and extensions, discovers Denix abstractions, passes `lib/` to them as `mylib`, and publishes configurations, checks, formatting, and the development shell.

Denix receives every `default.nix` below `abstractions/`. Files in that tree declare independent Denix abstractions; they do not form manual import chains. New files must be Git-tracked before flake evaluation can discover them.

`flake.nix` publishes one nix-darwin configuration per Darwin host and one Hjem configuration per user of each host. Each configuration evaluates independently because each is activated separately.

The same composition publishes `packages.<system>`, merging feature-owned bundles selected for publication into the flake's own packages. A published name that equals an existing package name fails evaluation instead of overriding it.

## Modules, hosts, and sections

A module (`delib.module`) abstracts a capability. It declares options under `myconfig.<name>` and in each module system, and the configuration that implements them. A host (`delib.host`) holds the facts and choices of one machine.

Both write configuration in sections per module system, such as `darwin.ifEnabled` or `hjem.always`:

- `always` applies unconditionally.
- `ifEnabled` applies when the module's `enable` is true, or, for a host, when that host is the one being built.
- `ifDisabled` applies when the module's `enable` is false, or, for a host, when another host is being built.

Option declarations go in `always`; a conditional section cannot declare options.

The module systems are `darwin` (nix-darwin), `hjem` (through `adapters/hjem/default.nix`), `bundles` (feature-owned packages selected for publication, through `adapters/bundles.nix`), and `myconfig`. `myconfig` is not evaluated on its own: Denix merges it into every other module system's evaluation under the `myconfig` prefix. A `myconfig` value is therefore seen by every module system and must mean the same in each.

`myconfig` is the input layer. A capability's choices and data are written there, and each module system reads them and lowers them into its own form. A `myconfig` value is determined by inputs alone: flake inputs, host facts, and the sources' choices. A value derived from them, however indirectly, belongs there too, including a package built from the `pkgs` that each system instantiates from those inputs. A value that depends on one module system's evaluation, such as a location Hjem decides for a file or nix-darwin's `config`, belongs to that system's sections.

A module's name is its `myconfig` interface path, so choose it for the modules and hosts that reference it. Directory placement serves navigation and may differ from the name.

A module also declares its common assertions at the top level: `assertions.always` is checked whatever its `enable`, `assertions.ifEnabled` while it is enabled. Each entry is an `{ assertion, message }` attribute set, or a function of the module's Denix arguments returning one, evaluated against the final `myconfig` and enforced by every module system. Assertions about one module system's outputs stay in that system's sections.

## Rices and sources

A rice (`mylib.rice` under `abstractions/rices/`) is a named set of `myconfig` choices spanning modules, on the same level as a host. It has no options, sections or `enable`. A host selects at most one with `rice`; only that rice joins the evaluation. A host extends a value its rice defines through the `riceConfig` argument of declaration files, which holds the rice's declarations as written.

`myconfig` definitions are ordered by source: an option default < a module < the selected rice < the host. Authors write no `mkDefault` for this order. A higher source replaces only what it defines, following the declared types: below a submodule or an attribute set of values, each option or attribute keeps its own source, while a list or any other value is replaced whole. An option declared with `mylib.atomicOption` is replaced whole. A definition with an explicit priority keeps it. Sections of the other module systems keep their own merge rules.

The order applies to choices. An option that collects contributions, such as assertions or warnings, is declared with `mylib.accumulatingOption`: every source's definitions merge by its type, and a higher source cannot remove a lower one's. A module that embeds upstream options marks those that collect by applying it to a declaration without a type.

A choice among modules, such as `shell.loginShell`, is one option that its owner declares with `mylib.choice.option`; each candidate joins it with `mylib.choice.candidate`, whatever its enable. A role that follows the choice, such as `zsh.login.enable`, is derived read-only, not chosen separately.

## Declaring choices

Whether a value is declared depends on whether its behavior was chosen, not on whether it differs from the default. A chosen behavior is declared even when its value equals the default.

A setting affects only the scope that needs it. User preferences are declared in the user's domain through Hjem; a setting applied with root privileges is limited to what the user's domain cannot achieve.

## Directory ownership

- `abstractions/hosts/` owns machine-specific facts and choices.
- `abstractions/rices/` owns rices: choices that span modules and that hosts select.
- `abstractions/modules/` owns modules: application features and the capabilities other modules use, such as user services, user defaults and single-definer files. A module keeps its options and its Darwin, Hjem, and other module-system outputs together.
- `adapters/` owns module systems that Denix does not provide: their evaluation, the input schema that makes up the system, and the common contract of their results and application. A capability reaches the result through that contract, such as Hjem's apply steps, and stays in its module.
- `extensions/` owns extensions of Denix's module and host declarations and of their evaluation rules, such as host attributes and behavior applied to every module or host.
- `lib/` owns pure Nix helpers passed to abstractions as `mylib`. Helpers define types and transformations; they do not own configuration.
- `checks/` owns sandboxed checks of repository mechanisms and of the published configurations as a whole, exported through `checks.<system>`. Each immediate `checks/<name>/default.nix` is discovered automatically. The contract of a single module is checked inside that module instead; see Validation boundary.
- `scripts/`, `justfile`, and `just/` own repository operations. Recipe documentation and argument help are available through `just --list --list-submodules` and `just --usage <recipe>`. [Operations](operations.md) covers operational prerequisites and procedures outside individual recipes.

A concern has one owner. Shared outputs have one final writer, and adapters translate values without taking ownership of the feature that produced them.

An application-specific translation belongs to the application's module, and more generally a translation into a format belongs to the module that owns that format. An application module maps shared data, such as the colorscheme palette or the user's identity, into its own configuration; a capability module, such as user services, lowers the declarations it receives into each platform's form. Other modules write only in the vocabulary of the options that the owner declares.

A module owns its declaration's directory, independently of its dotted interface name. It does not directly reference feature files outside that directory. Other modules enter its check fixtures through `uses`; shared tools, inputs and common configuration enter through the mechanisms. Incremental selection maps changed paths to the deepest module directory and follows reverse `uses` dependencies. It does not infer arbitrary Nix or file dependencies; only forced missing references are detected by fixture evaluation.

Nix owns evaluation and realization. Build recipes call Nix directly without activating the configuration. Repository mechanisms use the language of the layer they own:

- Operator procedures and external-command composition stay thin and use Nushell.
- Build-time generation is expressed in Nix.
- Activation-time execution logic uses Crystal.
- Checks use the language of the layer they observe: Nix for evaluated configuration, Crystal for runtime state machines, and Nushell for external-command integration.
- Logic that grows beyond command composition belongs in Nix transformations or the execution implementation, not in the orchestration layer.

These rules govern repository mechanisms, not feature applications or upstream implementations. Minimal generated shell glue remains where build tools or platform startup require it, such as waiting for the Nix store before launching a program.

## Repository mechanisms

Each mechanism is specified at the top of its file and by its option descriptions.

- `extensions/hosts.nix`: host attributes (system and sole user), exposed as read-only `myconfig.host` by the host module.
- `extensions/rices.nix`: rice registration, a host's `rice` selection, and `riceConfig`.
- `extensions/module-assertions.nix`: modules' common assertions, enforced in every module system.
- `extensions/module-dependencies.nix`: a dotted module's `enable` depends on its immediate parent.
- `extensions/module-metadata.nix`: required responsibility descriptions and optional classification tags for modules.
- `extensions/module-checks.nix`: module-owned inline cases, typed as options, declaration locations and reverse `uses` closure; `lib/module-checks.nix` evaluates fixtures and aggregates their evaluated values and builds into `checks.<system>.module-<name>`. Modules that provide capabilities other modules use enter every fixture as infrastructure, listed in `checks/default.nix`.
- `lib/checks.nix` and `checks/default.nix`: descriptor-based discovery that reads platform declarations without forcing check bodies; `lib.checks.<system>` publishes JSON-safe ownership and selection metadata.
- `extensions/provenance.nix`: every module and host section is labelled with its origin as the location of its definitions, and `myconfig` definitions receive their source's priority from `lib/sources.nix`.
- `lib/sources.nix`: source priorities, their descent along option types, and atomic and accumulating options.
- `lib/choice.nix`: single-choice options that candidates join by declaration.
- `adapters/hjem/default.nix`: the Hjem module system, the unfree packages its `pkgs` may evaluate, and the apply steps that modules register and the switch runs after Hjem activation, in the order they declare against each other.
- `adapters/bundles.nix`: the bundles module system, through which a feature declares itself as a standalone package. The feature registers each bundle with its `publish` condition, independently of any host or rice; the adapter publishes only those, without evaluating the others' packages.
- `abstractions/modules/services/`: portable/native user service declarations and Darwin lowering, with lifecycle reconciliation in `reconciler/reconciler.cr`.
- `abstractions/modules/defaults/`: user defaults declarations and Darwin lowering, with ownership, restoration and change actions in `reconciler/reconciler.cr`. Service names resolve through the services module's read-only targets.
- `abstractions/modules/colorscheme/`: registered color schemes (data files in `schemes/`, with or without variants), the shared `colorscheme.selection`, and its validation and resolution to a palette. Each application owns its mapping from the palette, or a scheme-specific theme, and a `useColorscheme` switch that leaves its colors unmanaged.
- `abstractions/modules/exclusive/`: files that only one location may define, in Hjem's file sets and nix-darwin's `environment.etc`.
- `abstractions/modules/nix-secrets/`: standalone compatibility for upstream nix-secrets options and manifest-based Darwin user activation.
- `lib/plist.nix`: the plist values that services and defaults accept and their serialization.
- `lib/fragments.nix`: named fragments ordered by dependency, for a file that several features contribute to.
- `lib/authoring.nix`: the authoring reference, `docs/generated/authoring.md`, rendered from declarations without generating a host configuration.
- `scripts/bun.nu`: npm dependencies of a Bun project pinned for Nix in a `bun.nix` generated from its `bun.lock`, kept current by `checks/bun-lock`.
- `git-hooks.nix`: development-shell installation of commit and push gates. `scripts/commit.nu` owns the index transaction, `scripts/checks.nu` selects checks from metadata, and `scripts/pre-push.nu` verifies outgoing tip trees.

## Validation boundary

A check belongs under `checks/` only when it can run as a sandboxed flake check. Use Nix option validation, evaluation, or a consumer validator before adding a behavioral test at a higher layer. A check covers the contract of the code it belongs to and trusts the contracts that code depends on: an upstream project's as published, and repository-owned code's because that code's own checks cover it.

Each kind of validation answers a different question:

- An option type rejects a single invalid value where it is defined.
- An assertion rejects a configuration whose choices are invalid together. It runs on every evaluation of a real configuration and addresses whoever wrote those choices.
- An inline check shows that a module's implementation is correct on chosen inputs. It runs only as a check and addresses the module's author. A condition that no configuration choice can break, only a defect in the module, belongs here rather than in an assertion.
- A check under `checks/` covers a repository mechanism, the composition, or a property spanning the published configurations.

A case is written from the contract, not from the defect that revealed it. When a defect appears, identify the statement of the contract it violates, and write that statement first if none exists. Choose cases that cover the range of inputs the statement governs, not only the reported input. Observe only published results, such as evaluated values, failures, and published names, never priorities, wrapper shapes, or internal names, so that any implementation satisfying the contract passes. Name a case after the statement it shows, such as `host-list-replaces-rice`, not after the defect.

A module's own contract — what its options produce and reject — is checked by the module's `checks`, beside its definition. Each case uses the adapters and extensions of `flake.nix` with only that module, the modules explicitly named in `uses`, infrastructure, and fixture contributors. A case either compares an evaluated value, expects an evaluation/assertion failure, or builds a derivation from the fixture result. Platform filtering precedes fixture generation; supported cases aggregate into one check per module. Build cases stay with their owning feature rather than reading published packages to bypass the fixture.

Commit automation builds selected checks on the final index snapshot, excluding formatting and reference freshness already handled by automatic generation. Infrastructure and unknown code paths select all remaining current-system checks. Host-only and designated documentation changes select none. Pre-push and `just check-full` run the full current-system gate, including formatting and reference freshness; see [Operations](operations.md) for snapshot and bypass boundaries.

Mechanism checks use the smallest input boundary they own, without importing unrelated feature modules or extensions. Checks of feature wiring receive the real Denix `configuration` from `flake.nix` instead of reconstructing its module list.

Live activation and platform behavior require an explicit operator command; evaluation and derivation builds do not exercise them.
