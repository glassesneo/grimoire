# Module Authoring

This file owns the judgments made when designing a module's interface and validating it: where its values go, which kind of option each needs, which module owns a translation, and how its constraints and tests are written. The concepts it applies, such as module systems, sources and choices, are defined in [Architecture](architecture.md); the syntax of declarations is listed in [the authoring reference](generated/authoring.md).

## Interface

Where a value is placed and which kind of option declares it follow from concepts defined in [Architecture](architecture.md): `myconfig` as the input layer, source priorities with atomic and accumulating options, and choices among modules. Among values that a higher source replaces, one whose parts only make sense together, such as a scheme and its variant, is declared with `mylib.atomicOption`, so that no part is inherited from a lower source.

### Translations

An application-specific translation belongs to the application's module, and more generally a translation into a format belongs to the module that owns that format. An application module maps shared data into its own configuration; a capability module lowers the declarations it receives into each platform's form. Other modules write only in the vocabulary of the options that the owner declares.

## Validation

A module's options are a contract between whoever writes declarations and the module's author. Each kind of validation covers one part of it:

| Kind | Covers | Addresses |
|---|---|---|
| Option type | a single value | whoever writes the declaration |
| Constraint | a precondition that types cannot express | whoever writes the declarations |
| Test | the postcondition: what declarations meeting the preconditions produce | the module's author |

A condition a type can express is not a constraint. A condition that no declaration can break, only a defect in the module, is a test rather than a constraint.

### Constraints

A constraint states a precondition that the module's own choices create: a configuration that cannot be realized as declared. What an option type, an upstream option, or the configured program already rejects is not constrained again. Such configurations include combinations of the module's options that cannot be used together, choices that require another module, values that a type cannot check, conflicting definitions from several definers, and values a platform cannot represent. Whether a choice that would have no effect is rejected is the module's decision, as part of its contract.

A message names the precondition that was broken in the terms of whoever wrote the declarations: the option paths and values involved, the condition they must meet, and a choice that resolves it when one exists. For example: `example.mode = "compact" requires example.window.enable = true`.

A precondition whose condition reads `myconfig` values is a constraint, declared in `constraints.always` or `constraints.ifEnabled`. A precondition about the values of one module system is an assertion in that system's section.

### Tests

A module's case follows [the validation boundary](architecture.md#validation-boundary). A module output that the published configurations produce has no case, however the module computes it, and neither has the way a trusted program interprets it. For example, the rc's content is visible in the published configuration, and that Zsh uses the emacs keymap after the rc runs `bindkey -e` is Zsh's behavior. Each case states in `protects` what this repository wrote or changed that the case protects and the behavior it keeps; a case that can name only upstream behavior or a published result is not written.

A case is written from the contract, not from the defect that revealed it. When a defect appears, identify the statement of the contract it violates, and write that statement first if none exists. Choose inputs across the range the statement governs, not only the reported input, and only inputs on which an implementation violating the statement would fail. Observe only published results, such as evaluated values, failures, and published names, never priorities, wrapper shapes, or internal names, so that any implementation satisfying the contract passes. Name a case after the statement it shows, such as `host-list-replaces-rice`, not after the defect.

A module's cases cover both parts of its contract: what declarations meeting the preconditions produce, and that a constraint rejects what breaks it where its condition distinguishes many inputs, such as unsafe plist values or path names, rather than comparing declared values directly. That constraints reach every module system is tested once with the mechanism. They are the module's `tests`, beside its definition. Each case uses the adapters and extensions of `flake.nix` with only that module, the modules it requires, transitively, those named in the case's `uses` with their requirements, and fixture contributors. A case either compares an evaluated value, expects an evaluation failure or a failed constraint, or builds a derivation from the fixture result. Platform filtering precedes fixture generation; supported cases aggregate into one check per module. Build cases stay with their owning feature rather than reading published packages to bypass the fixture. What a test may trust is stated in [the validation boundary](architecture.md#validation-boundary).
