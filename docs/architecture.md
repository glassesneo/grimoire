# Architecture

Grimoire uses Denix's rewrite branch as its foundation. The notation and behavior described here are those used by this repository, including its adapters and extensions; this is not a general reference for upstream Denix.

## Composition

`flake.nix` is the composition root. It selects inputs, loads adapters and extensions, discovers Denix abstractions, passes `lib/` to them as `mylib`, and publishes configurations, checks, formatting, and the development shell.

Its inputs are the dependencies of the composition and its mechanisms, and those a module receives with another flake's `nixpkgs` through `follows`. A dependency that one module uses is an anchor of that module instead: pinned in the module's `anchors.json` and read with `mylib.anchors`. It has one owning module; another module that needs it receives it through the owner's options, as `casks.packages` provides casks. A flake anchor keeps the `nixpkgs` its own lock file pins, so a module that needs the dependency built with its own `nixpkgs` uses an entry point taking `pkgs`, such as a package file, a library, or an overlay.

Denix receives every `default.nix` below `abstractions/`. Files in that tree declare independent Denix abstractions; they do not import each other.

`flake.nix` publishes one nix-darwin configuration per Darwin host and one Hjem configuration per user of each host. Each configuration evaluates independently because each is activated separately.

The same composition publishes `packages.<system>`, merging feature-owned bundles selected for publication into the flake's own packages.

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

A module also declares its constraints at the top level: `constraints.always` is checked whatever its `enable`, `constraints.ifEnabled` while it is enabled. Each entry is an `{ assertion, message }` attribute set, or a function of the module's Denix arguments returning one, evaluated against the final `myconfig` and enforced by every module system through its own `assertions`.

## Rices and sources

A rice (`mylib.rice` under `abstractions/rices/`) is a named set of `myconfig` choices spanning modules, on the same level as a host. It has no options, sections or `enable`. A host selects at most one with `rice`; only that rice joins the evaluation. A host extends a value its rice defines through the `riceConfig` argument of declaration files, which holds the rice's declarations as written.

`myconfig` definitions are ordered by source: an option default < a module < the selected rice < the host. Authors write no `mkDefault` for this order. A higher source replaces only what it defines, following the declared types: below a submodule or an attribute set of values, each option or attribute keeps its own source, while a list or any other value is replaced whole. An option declared with `mylib.atomicOption` is replaced whole. A definition with an explicit priority keeps it. Sections of the other module systems keep their own merge rules.

The order applies to choices. An option that collects contributions, such as assertions or warnings, is declared with `mylib.accumulatingOption`: every source's definitions merge by its type, and a higher source cannot remove a lower one's.

## Roles

A role (`delib.role` under `abstractions/modules/roles/`) is a seat on the host that one module takes, such as the application launcher. It is the module `roles.<name>`: its `enable` states whether the host has the seat, and its `holder` selects the module that takes it among the candidates, the modules declaring `meta.role = "<name>"`. A candidate joins whatever its enable and may define the default holder; a rice or host replaces it, and turns the seat off with `enable`. A role owns what calling its holder takes, such as an entrance the environment reads; a candidate keeps its own configuration.

Most candidates keep their own enable: several may be installed while one holds the seat, which then requires its holder enabled. A candidate without `enable`, such as a color scheme, is data the seat selects among and can always hold it. In a role declared `seatedOnly`, a candidate's enable belongs to the seat instead: the role enables its holder, tags do not enable candidates, and an enabled candidate outside the seat fails.

A module that reads a seat, such as the part of an application that takes its colors from `roles.colorscheme`, declares `meta.follows`. It is enabled by default only while the seats it follows are, and turning it off leaves the rest of the application in place.

## Declaring choices

Whether a value is declared depends on whether its behavior was chosen, not on whether it differs from the default. A chosen behavior is declared even when its value equals the default.

A setting affects only the scope that needs it. User preferences are declared in the user's domain through Hjem; a setting applied with root privileges is limited to what the user's domain cannot achieve.

## Directory ownership

- `abstractions/hosts/` owns machine-specific facts and choices.
- `abstractions/rices/` owns rices: choices that span modules and that hosts select.
- `abstractions/modules/` owns modules: application features, the capabilities other modules use, such as user services, user defaults and single-definer files, and roles under `roles/`. A module keeps its options and its Darwin, Hjem, and other module-system outputs together, with the anchors it pins.
- `adapters/` owns module systems that Denix does not provide: their evaluation, the input schema that makes up the system, and the common contract of their results and application. A capability reaches the result through that contract, such as Hjem's apply steps, and stays in its module.
- `extensions/` owns extensions of Denix's module and host declarations and of their evaluation rules, such as host attributes and behavior applied to every module or host.
- `lib/` owns pure Nix helpers passed to abstractions as `mylib`. Helpers define types and transformations; they do not own configuration.
- `tests/` owns sandboxed tests of repository mechanisms, the composition, and properties spanning the published configurations. `checks/` owns the remaining flake checks, which verify the repository's state rather than a behavior, such as generated files being current. The contract of a single module is tested inside that module instead.
- `scripts/`, `justfile`, and `just/` own repository operations.

A concern has one owner. Shared outputs have one final writer, and adapters translate values without taking ownership of the feature that produced them.

A module owns its declaration's directory, independently of its dotted interface name. Other files there are helpers that declarations read, such as a package or a table. A module reads the helpers of its own directory and of an ancestor module's directory, naming that ancestor in its `tests.fixture`, and no other feature's files; shared tools, inputs and common configuration enter through the mechanisms. Incremental check selection maps changed paths to the deepest module directory and follows `tests.fixture` and `uses` in reverse; it infers no other dependency, so a module reading another feature's files would not be checked when they change.

Nix owns evaluation and realization. Build recipes call Nix directly without activating the configuration. Repository mechanisms use the language of the layer they own:

- Operator procedures and external-command composition stay thin and use Nushell.
- Build-time generation is expressed in Nix.
- Activation-time execution logic that keeps a state machine of its own uses Crystal; logic that composes the commands of a program holding the state, such as dinit, uses Nushell.
- Checks use the language of the layer they observe: Nix for evaluated configuration, Crystal for runtime state machines, and Nushell for external-command integration.
- Logic that grows beyond command composition belongs in Nix transformations or the execution implementation, not in the orchestration layer.

These rules govern repository mechanisms, not feature applications or upstream implementations. Minimal generated shell glue remains where build tools or platform startup require it, such as waiting for the Nix store before launching a program.

## Repository mechanisms

The index below names each mechanism; its option descriptions, documented functions and tests state its behavior.

- `extensions/hosts.nix`: host attributes (system and sole user), exposed as read-only `myconfig.host` by the host module.
- `extensions/rices.nix`: rice registration, a host's `rice` selection, and `riceConfig`.
- `extensions/module-constraints.nix`: modules' constraints, enforced in every module system.
- `extensions/module-dependencies.nix`: a dotted module's `enable` depends on its immediate parent, and a module's on the roles it follows.
- `extensions/module-metadata.nix`: required responsibility descriptions and optional classification tags for modules.
- `extensions/module-tests.nix`: module-owned test cases and fixtures; `lib/module-tests.nix` evaluates them into `checks.<system>.module-<name>`, and `lib/typescript-check.nix` builds the `typescriptCheck` that cases receive.
- `lib/checks.nix` and `checks/default.nix`: discovery of each immediate `tests/<name>/default.nix` and `checks/<name>/default.nix` as `checks.<system>.<name>`, a name appearing in only one of them. Each returns either `cases`, run by `lib/cases.nix`, each with `protects` and one of `expected`, `fails` or `build`, or a `check` with `protects` for the whole, and may declare `platforms`, which are read without forcing check bodies. `checks/default.nix` also generates the checks that the published outputs and each host's configurations evaluate; `lib.checks.<system>` publishes ownership and selection metadata.
- `extensions/provenance.nix`: every module and host section is labelled with its origin as the location of its definitions, and `myconfig` definitions receive their source's priority from `lib/sources.nix`.
- `lib/sources.nix`: source priorities, their descent along option types, and atomic and accumulating options.
- `lib/roles.nix` and `extensions/roles.nix`: `delib.role`, the seat it declares and its holder; the candidates' `meta.role` and the rejection of undeclared roles.
- `adapters/hjem/default.nix`: the Hjem module system and the apply steps the switch runs after Hjem activation.
- `adapters/bundles.nix`: the bundles module system.
- `abstractions/modules/services/`: user service declarations, their lowering to dinit descriptions and the LaunchAgent that starts dinit on Darwin, with the switch-time lifecycle in `reconcile.nu`, whose behaviors the scenes of `test/reconcile.nu` name.
- `abstractions/modules/imprynt/`: real-file deployment declarations and their Hjem apply step, delegating file ownership, conflicts, and recovery to imprynt; `abstractions/modules/fonts/` lowers user font packages into those declarations.
- `abstractions/modules/defaults/`: user defaults declarations and Darwin lowering, with ownership, restoration and change actions in `reconciler/reconciler.cr`.
- `abstractions/modules/colorscheme/`: color schemes, each the module `colorscheme.<name>` declared with `mylib.colorschemes.scheme` (`lib/colorschemes.nix`), which `roles.colorscheme` holds. Each application maps the held palette, or a scheme-specific theme from `mylib.schemeThemes` (`lib/scheme-themes.nix`), in its `<application>.colorscheme` module.
- `abstractions/modules/exclusive/`: files that only one location may define, in Hjem's file sets and nix-darwin's `environment.etc`.
- `abstractions/modules/nix-secrets/`: standalone compatibility for upstream nix-secrets options and manifest-based Darwin user activation.
- `lib/plist.nix`: the plist values that defaults accept and their serialization, also used for the services module's LaunchAgent.
- `lib/fragments.nix`: named fragments ordered by dependency, for a file that several features contribute to.
- `lib/anchors.nix`: dependencies a module pins in its `anchors.json`, an npins lock file, read as sources or evaluated as flakes from their own lock files; `scripts/anchors.nu` lists, compares, and updates them.
- `lib/documented.nix`: `mylib.documented` and the listing of library functions, which rejects an undocumented one.
- `lib/authoring.nix`: live authoring queries (`just modules`, `just reference`, and `just options`), rendered from declarations without generating a host configuration.
- `scripts/bun.nu`: npm dependencies of a Bun project pinned for Nix in a `bun.nix` generated from its `bun.lock`, kept current by `checks/bun-lock`.
- `git-hooks.nix`: development-shell installation of commit and push gates. `scripts/commit.nu` owns the index transaction, `scripts/checks.nu` selects checks from metadata, `scripts/pre-push.nu` verifies outgoing tip trees with the full gate of `scripts/gate.nu`.

## Validation boundary

A test or check belongs under `tests/` or `checks/` only when it can run as a sandboxed flake check. Use Nix option validation, evaluation, or a consumer validator before adding a behavioral test at a higher layer. A test covers what this repository wrote or changed and trusts everything else. A program or module system that the repository configures behaves as its project publishes it, whether it comes from nixpkgs, an official flake, or a third-party flake; repository-owned code behaves as its contract states, because that code's own tests cover it. For a package the repository patches, a test covers only the patched behavior; patch application itself detects conflicting upstream changes when the package builds, and other changes of upstream behavior are caught by the pinned lock file and live verification, not by tests.

The number of tests does not measure validation; a test that restates its implementation or verifies trusted behavior is noise that hides the failures that matter. Nix evaluation is pure, so a result that the published configurations produce is verified by reading that result, not by a test restating it. A test covers only what evaluating the published configurations cannot show:

- a guard that valid configurations never trip, such as the forwarding of constraints or the detection of a second definer;
- an input or path that no published configuration exercises, such as a scheme variant no host selects or a bundle no host uses;
- reliance on upstream internals that a lock update can change silently, such as an upstream option set the repository embeds. A patch's applicability is checked when the patched package builds, not by a test.

For a program the repository configures, a test stops at what a build can observe: passing a generated file to the program's own validator belongs to the build, while running the program to observe its behavior does not. A program the repository writes is covered by its own tests, which may exercise its runtime behavior.

Cases under `tests/` are written by the same rules as [a module's](module-authoring.md#tests). Mechanism tests use the smallest input boundary they own, without importing unrelated feature modules or extensions. Tests of feature wiring receive the real Denix `configuration` from `flake.nix` instead of reconstructing its module list.

Live activation and platform behavior require an explicit operator command; evaluation and derivation builds do not exercise them.
