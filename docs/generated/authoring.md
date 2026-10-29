# Authoring

Generated from module, host and option declarations. Do not edit; run `just docs`.

## Declarations

Options this repository adds to Denix declarations.

### Modules (<code>delib.module</code>)

| Option | Type | Default | Description | Source |
| --- | --- | --- | --- | --- |
| <code>checks</code> | <code>function that evaluates to a(n) attribute set of (submodule)</code> | <code>_: { }</code> | Inline cases of this module's contract, by name. A function of `{pkgs, lib, system, home, oxlintConfig}`, where `home` is the fixture user's home directory and `oxlintConfig` the repository's oxlint configuration. | [<code>extensions/module-checks.nix</code>](../../extensions/module-checks.nix) |
| <code>checks.&lt;function body&gt;.&lt;name&gt;.build</code> | <code>function that evaluates to a(n) package</code> |  | One of the modes: maps the fixture's result to a derivation that the module's check builds. Cannot be combined with `expr`. | [<code>extensions/module-checks.nix</code>](../../extensions/module-checks.nix) |
| <code>checks.&lt;function body&gt;.&lt;name&gt;.expected</code> | <code>raw value</code> |  | Value that `expr` must return. One of the modes. | [<code>extensions/module-checks.nix</code>](../../extensions/module-checks.nix) |
| <code>checks.&lt;function body&gt;.&lt;name&gt;.expr</code> | <code>function that evaluates to a(n) raw value</code> |  | Maps the fixture's result to the value compared with `expected`, or that must fail to evaluate when `fails = true`. Required unless the mode is `build` or `fails` is a string. | [<code>extensions/module-checks.nix</code>](../../extensions/module-checks.nix) |
| <code>checks.&lt;function body&gt;.&lt;name&gt;.fails</code> | <code>value true (singular enum) or string</code> |  | One of the modes: `true` requires `expr` to fail evaluation; a string requires a failed assertion containing it. | [<code>extensions/module-checks.nix</code>](../../extensions/module-checks.nix) |
| <code>checks.&lt;function body&gt;.&lt;name&gt;.host</code> | <code>attribute set</code> | <code>{ }</code> | Attributes merged into the fixture's `delib.host` declaration, such as `myconfig.ifEnabled` choices or `system`. The fixture's module system is evaluated for that `system`. | [<code>extensions/module-checks.nix</code>](../../extensions/module-checks.nix) |
| <code>checks.&lt;function body&gt;.&lt;name&gt;.moduleSystem</code> | <code>one of "bundles", "darwin", "hjem", "nixos"</code> | <code>"hjem"</code> | Module system whose result the case observes. | [<code>extensions/module-checks.nix</code>](../../extensions/module-checks.nix) |
| <code>checks.&lt;function body&gt;.&lt;name&gt;.modules</code> | <code>attribute set of (attribute set)</code> | <code>{ }</code> | Contributor modules by name: `delib.module` attributes without `name` or `meta.description`. | [<code>extensions/module-checks.nix</code>](../../extensions/module-checks.nix) |
| <code>checks.&lt;function body&gt;.&lt;name&gt;.platforms</code> | <code>list of string</code> | <code>[<br>  "aarch64-darwin"<br>  "aarch64-linux"<br>  "x86_64-linux"<br>]</code> | Systems on which the case runs. Read before any fixture is generated. | [<code>extensions/module-checks.nix</code>](../../extensions/module-checks.nix) |
| <code>checks.&lt;function body&gt;.&lt;name&gt;.tsRoots</code> | <code>list of module-relative path without `..` segments</code> | <code>[ ]</code> | TypeScript roots whose coverage this case provides, relative to the module directory; `.` is the module directory. | [<code>extensions/module-checks.nix</code>](../../extensions/module-checks.nix) |
| <code>checks.&lt;function body&gt;.&lt;name&gt;.uses</code> | <code>list of string</code> | <code>[ ]</code> | Modules added to this case's fixture beside the module, infrastructure and contributors. Their own uses are not followed; each must name a module. | [<code>extensions/module-checks.nix</code>](../../extensions/module-checks.nix) |
| <code>meta.description</code> | <code>string</code> |  | One-sentence responsibility of this module, not an inventory of its current settings. | [<code>extensions/module-metadata.nix</code>](../../extensions/module-metadata.nix) |
| <code>meta.tags</code> | <code>list of string</code> | <code>[ ]</code> | Classification labels declared for this module. | [<code>extensions/module-metadata.nix</code>](../../extensions/module-metadata.nix) |

### Hosts (<code>delib.host</code>)

| Option | Type | Default | Description | Source |
| --- | --- | --- | --- | --- |
| <code>system</code> | <code>string</code> |  | Nix system of this host. | [<code>extensions/hosts.nix</code>](../../extensions/hosts.nix) |
| <code>user</code> | <code>submodule</code> |  | The sole user of this host. | [<code>extensions/hosts.nix</code>](../../extensions/hosts.nix) |
| <code>user.homeDirectory</code> | <code>string</code> | `/Users/&lt;name&gt;` on Darwin, otherwise `/home/&lt;name&gt;` | Home directory of the user on this host. | [<code>extensions/hosts.nix</code>](../../extensions/hosts.nix) |
| <code>user.name</code> | <code>string</code> |  | Unix account name of the person using this host. | [<code>extensions/hosts.nix</code>](../../extensions/hosts.nix) |
| <code>user.uid</code> | <code>signed integer</code> | 501 on Darwin, otherwise 1000 | Numeric user ID of the user's account on this host. | [<code>extensions/hosts.nix</code>](../../extensions/hosts.nix) |

## Module systems

Options that adapters add to their module systems. Options that modules add are listed with each module.

### <code>bundles</code>

| Option | Type | Default | Description | Source |
| --- | --- | --- | --- | --- |
| <code>assertions</code> | <code>list of unspecified value</code> | <code>[ ]</code> | Assertions that must hold before returning published bundles. | [<code>adapters/bundles.nix</code>](../../adapters/bundles.nix) |
| <code>bundles</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Feature-owned bundles and their publication choices. | [<code>adapters/bundles.nix</code>](../../adapters/bundles.nix) |
| <code>bundles.&lt;name&gt;.package</code> | <code>package</code> |  | The package containing this bundle's configuration. | [<code>adapters/bundles.nix</code>](../../adapters/bundles.nix) |
| <code>bundles.&lt;name&gt;.publish</code> | <code>boolean</code> | <code>false</code> | Whether to include this bundle in the published packages. | [<code>adapters/bundles.nix</code>](../../adapters/bundles.nix) |

### <code>hjem</code>

| Option | Type | Default | Description | Source |
| --- | --- | --- | --- | --- |
| <code>applySteps</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Steps the switch runs after Hjem activates files and packages. Steps run one at a time and the switch stops at the first failure; a step that relies on another having run declares it in `after` or `before`, and the order of steps without such a declaration is stable but unspecified. | [<code>adapters/hjem/default.nix</code>](../../adapters/hjem/default.nix) |
| <code>applySteps.&lt;name&gt;.after</code> | <code>list of string</code> | <code>[ ]</code> | Registered steps that run before this one. | [<code>adapters/hjem/default.nix</code>](../../adapters/hjem/default.nix) |
| <code>applySteps.&lt;name&gt;.before</code> | <code>list of string</code> | <code>[ ]</code> | Registered steps that run after this one. | [<code>adapters/hjem/default.nix</code>](../../adapters/hjem/default.nix) |
| <code>applySteps.&lt;name&gt;.package</code> | <code>package</code> |  | Package whose bin/apply the step runs. | [<code>adapters/hjem/default.nix</code>](../../adapters/hjem/default.nix) |
| <code>nixpkgs.config.allowUnfreePackages</code> | <code>list of string</code> | <code>[ ]</code> | Names of unfree packages that `pkgs` may evaluate; definitions from every module are merged. | [<code>adapters/hjem/default.nix</code>](../../adapters/hjem/default.nix) |

## Modules

### <code>agents</code>

Provide a shared configuration interface for LLM agents and configure the selected agent packages.

Source: [<code>abstractions/modules/agents/default.nix</code>](../../abstractions/modules/agents/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>agents.packages</code> | <code>lazy attribute set of package</code> | <code>inputs.llm-agents.packages.${myconfig.host.system}</code> | read-only; Agent packages of llm-agents.nix for the host's system, by name. |

### <code>alacritty</code>

Provide Alacritty terminal emulator.

Source: [<code>abstractions/modules/alacritty/default.nix</code>](../../abstractions/modules/alacritty/default.nix)<br>Tags: <code>gui</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>alacritty.enable</code> | <code>boolean</code> | <code>false</code> |  |
| <code>alacritty.package</code> | <code>package</code> | <code>pkgs.alacritty</code> |  |

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>alacritty.settings</code> | <code>TOML value</code> | <code>{ }</code> | Settings written to the alacritty configuration file. |

### <code>app-identity</code>

Expose nix-mac-app-identity helpers that give Nix-built macOS programs a code-signing identity surviving rebuilds.

Source: [<code>abstractions/modules/app-identity/default.nix</code>](../../abstractions/modules/app-identity/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>app-identity.mkAppBundle</code> | <code>function that evaluates to a(n) unspecified value</code> | <code>&lt;function, args: {executable?, icon?, identifier, mainProgram?, name?, package?, showInDock?, version?}&gt;</code> | read-only; Wraps a bare executable in a minimal bundle with a stable identifier, so TCC grants survive rebuilds. |
| <code>app-identity.stabilizeApp</code> | <code>function that evaluates to a(n) unspecified value</code> | <code>&lt;function&gt;</code> | read-only; Signs a package's `.app` bundle under a requirement naming only its bundle identifier, so TCC grants survive rebuilds; Developer ID signed bundles pass through unchanged. |

### <code>appcleaner</code>

Provide AppCleaner.

Source: [<code>abstractions/modules/appcleaner/default.nix</code>](../../abstractions/modules/appcleaner/default.nix)<br>Tags: <code>gui</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>appcleaner.enable</code> | <code>boolean</code> | <code>false</code> |  |
| <code>appcleaner.package</code> | <code>package</code> | <code>pkgs.appcleaner</code> |  |

### <code>appearance</code>

Configure the system's visual appearance: color scheme, menu bar, and menu bar clock.

Source: [<code>abstractions/modules/appearance/default.nix</code>](../../abstractions/modules/appearance/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>appearance.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>assertions</code>

Enforce module-contributed assertions across module systems.

Source: [<code>abstractions/modules/assertions/default.nix</code>](../../abstractions/modules/assertions/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>assertions</code> | <code>list of unspecified value</code> | <code>[ ]</code> | Assertions, each with `assertion` and `message`, that every module system enforces. |

### <code>bat</code>

Provide and configure bat for file display.

Source: [<code>abstractions/modules/bat/default.nix</code>](../../abstractions/modules/bat/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>bat.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>batman</code>

Provide batman and configure it as Zsh's manual page pager.

Source: [<code>abstractions/modules/bat/batman/default.nix</code>](../../abstractions/modules/bat/batman/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>batman.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>bettertouchtool</code>

Provide BetterTouchTool.

Source: [<code>abstractions/modules/bettertouchtool/default.nix</code>](../../abstractions/modules/bettertouchtool/default.nix)<br>Tags: <code>gui</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>bettertouchtool.enable</code> | <code>boolean</code> | <code>false</code> |  |
| <code>bettertouchtool.package</code> | <code>package</code> | <code>myconfig.casks.packages.bettertouchtool</code> |  |

### <code>casks</code>

Expose Homebrew casks, packaged by cask2nix from the official and third-party taps, to modules.

Source: [<code>abstractions/modules/casks/default.nix</code>](../../abstractions/modules/casks/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>casks.packages</code> | <code>lazy attribute set of package</code> | the casks of the official `homebrew/cask` tap for the host's system | read-only; Casks of the official tap, by token. |
| <code>casks.taps</code> | <code>lazy attribute set of lazy attribute set of lazy attribute set of package</code> | the casks of the third-party taps in brew-taps-api for the host's system | read-only; Casks of third-party taps, by tap owner, tap name and token. |

### <code>claude-code</code>

Provide and configure Claude Code.

Source: [<code>abstractions/modules/agents/claude-code/default.nix</code>](../../abstractions/modules/agents/claude-code/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>claude-code.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>cursor-agent</code>

Provide the Cursor Agent CLI.

Source: [<code>abstractions/modules/agents/cursor-agent/default.nix</code>](../../abstractions/modules/agents/cursor-agent/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>cursor-agent.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>defaults</code>

Declare the current user's preferences and reconcile them with the platform's preferences store.

Source: [<code>abstractions/modules/defaults/default.nix</code>](../../abstractions/modules/defaults/default.nix)

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>platform.darwin.defaults</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Hjem-owned user defaults, by preferences domain; removing a declaration restores the value it had before it was declared. |
| <code>platform.darwin.defaults.&lt;name&gt;.onChange.activateSettings</code> | <code>boolean</code> | <code>false</code> | Whether to run `activateSettings -u`, which applies some system settings, such as keyboard shortcuts, without logging out. |
| <code>platform.darwin.defaults.&lt;name&gt;.onChange.restartProcesses</code> | <code>list of (one of "ControlCenter", "Dock", "Finder", "NotificationCenter", "SystemUIServer", "WindowManager")</code> | <code>[ ]</code> | System processes that launchd relaunches, killed so that they read the new values. |
| <code>platform.darwin.defaults.&lt;name&gt;.onChange.restartServices</code> | <code>list of string</code> | <code>[ ]</code> | Names of user services (`userServices` or `platform.darwin.launchAgents`) to restart. |
| <code>platform.darwin.defaults.&lt;name&gt;.settings</code> | <code>attribute set of anything</code> | <code>{ }</code> | Values of the domain; each leaf of a nested attribute set is declared at its key path, leaving undeclared keys of the dictionaries along it in place, and a list or other value is written whole. |

### <code>direnv</code>

Provide and configure direnv, including its Zsh integration.

Source: [<code>abstractions/modules/direnv/default.nix</code>](../../abstractions/modules/direnv/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>direnv.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>dock</code>

Configure the Dock and the actions of screen hot corners.

Source: [<code>abstractions/modules/dock/default.nix</code>](../../abstractions/modules/dock/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>dock.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>exclusive</code>

Reject a second definition of a file that one location must own.

Source: [<code>abstractions/modules/exclusive/default.nix</code>](../../abstractions/modules/exclusive/default.nix)

<code>darwin</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>environment.etc.&lt;name&gt;.exclusive</code> | <code>boolean</code> | <code>false</code> | Whether a single location must define this file. |

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>files.&lt;path&gt;.exclusive</code> | <code>boolean</code> | <code>false</code> | Whether a single location must define this file. |
| <code>xdg.cache.files.&lt;path&gt;.exclusive</code> | <code>boolean</code> | <code>false</code> | Whether a single location must define this file. |
| <code>xdg.config.files.&lt;path&gt;.exclusive</code> | <code>boolean</code> | <code>false</code> | Whether a single location must define this file. |
| <code>xdg.data.files.&lt;path&gt;.exclusive</code> | <code>boolean</code> | <code>false</code> | Whether a single location must define this file. |
| <code>xdg.state.files.&lt;path&gt;.exclusive</code> | <code>boolean</code> | <code>false</code> | Whether a single location must define this file. |

### <code>eza</code>

Provide eza for listing files and directories.

Source: [<code>abstractions/modules/eza/default.nix</code>](../../abstractions/modules/eza/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>eza.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>fd</code>

Provide fd for finding files and directories.

Source: [<code>abstractions/modules/fd/default.nix</code>](../../abstractions/modules/fd/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>fd.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>files</code>

Configure how the Finder and file dialogs present files, and what the Finder writes to other volumes.

Source: [<code>abstractions/modules/files/default.nix</code>](../../abstractions/modules/files/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>files.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>fzf</code>

Provide and configure fzf, including its Zsh integration.

Source: [<code>abstractions/modules/fzf/default.nix</code>](../../abstractions/modules/fzf/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>fzf.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>gh</code>

Provide the GitHub CLI.

Source: [<code>abstractions/modules/gh/default.nix</code>](../../abstractions/modules/gh/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>gh.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>ghostty</code>

Provide Ghostty terminal emulator.

Source: [<code>abstractions/modules/ghostty/default.nix</code>](../../abstractions/modules/ghostty/default.nix)<br>Tags: <code>gui</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>ghostty.enable</code> | <code>boolean</code> | <code>false</code> |  |
| <code>ghostty.package</code> | <code>package</code> | <code>myconfig.casks.packages.ghostty</code> |  |

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>ghostty.settings</code> | <code>attribute set of (atom (null, bool, int, float or string) or a list of them for duplicate keys)</code> | <code>{ }</code> | Settings written to the Ghostty configuration file; a list repeats its key once per element. |

### <code>git</code>

Provide Git and configure the user's Git environment.

Source: [<code>abstractions/modules/git/default.nix</code>](../../abstractions/modules/git/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>git.enable</code> | <code>boolean</code> | <code>true</code> |  |

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>git.settings</code> | <code>attribute set of attribute set of (INI atom (null, bool, int, float or string) or attribute set of (INI atom (null, bool, int, float or string)))</code> | <code>{ }</code> | Settings written to the user's Git configuration file. |

### <code>git.include</code>

Configure Git settings through includes.

Source: [<code>abstractions/modules/git/include/default.nix</code>](../../abstractions/modules/git/include/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>git.include.enable</code> | <code>boolean</code> | <code>myconfig.git.enable &amp;&amp; true</code> |  |

### <code>gomi</code>

Provide gomi and integrate it into Zsh.

Source: [<code>abstractions/modules/gomi/default.nix</code>](../../abstractions/modules/gomi/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>gomi.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>grok-bot</code>

Provide the Grok-bot desktop app.

Source: [<code>abstractions/modules/grok-bot/default.nix</code>](../../abstractions/modules/grok-bot/default.nix)<br>Tags: <code>gui</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>grok-bot.enable</code> | <code>boolean</code> | <code>false</code> |  |
| <code>grok-bot.package</code> | <code>package</code> | <code>myconfig.casks.packages.grok-bot</code> |  |

### <code>host</code>

Expose the selected host's information to modules and reflect its identity in OS host names.

Source: [<code>abstractions/modules/host/default.nix</code>](../../abstractions/modules/host/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>host.name</code> | <code>string</code> | the host's name | read-only; Denix name of the host being built. |
| <code>host.system</code> | <code>string</code> | the host's `system` | read-only; Nix system of the host being built. |
| <code>host.user</code> | <code>attribute set of unspecified value</code> | the host's `user` | read-only; The sole user of the host being built: `name`, `homeDirectory` and `uid`. |

### <code>identity</code>

Expose the fixed identity of the person who uses these hosts.

Source: [<code>abstractions/modules/identity/default.nix</code>](../../abstractions/modules/identity/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>identity.email</code> | <code>string</code> | <code>"glassesneo@protonmail.com"</code> | read-only; Email address of the person. |
| <code>identity.fullName</code> | <code>string</code> | <code>"Neo Kitani"</code> | read-only; Full name of the person. |

### <code>keyboard</code>

Configure system-wide keyboard behavior: key repeat, text substitutions, function keys, and system shortcuts.

Source: [<code>abstractions/modules/keyboard/default.nix</code>](../../abstractions/modules/keyboard/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>keyboard.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>locale</code>

Configure the languages and region used by the system and applications.

Source: [<code>abstractions/modules/locale/default.nix</code>](../../abstractions/modules/locale/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>locale.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>neovim</code>

Provide and configure neovim

Source: [<code>abstractions/modules/neovim/default.nix</code>](../../abstractions/modules/neovim/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>neovim.enable</code> | <code>boolean</code> | <code>true</code> |  |
| <code>neovim.package</code> | <code>package</code> | <code>inputs.mnw.lib.wrap pkgs myconfig.neovim.settings</code> |  |
| <code>neovim.settings</code> | <code>module</code> | <code>{ }</code> | mnw configuration that builds the Neovim package. Each feature module contributes its plugins and its own Lua runtime directory. |

### <code>neovim.completion</code>

Provide insert-mode and command-line completion in Neovim.

Source: [<code>abstractions/modules/neovim/completion/default.nix</code>](../../abstractions/modules/neovim/completion/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>neovim.completion.enable</code> | <code>boolean</code> | <code>myconfig.neovim.enable &amp;&amp; true</code> |  |

### <code>neovim.diagnostic</code>

Display diagnostics in Neovim buffers.

Source: [<code>abstractions/modules/neovim/diagnostic/default.nix</code>](../../abstractions/modules/neovim/diagnostic/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>neovim.diagnostic.enable</code> | <code>boolean</code> | <code>myconfig.neovim.enable &amp;&amp; true</code> |  |

### <code>neovim.lsp</code>

Connect Neovim to language servers and format buffers through them.

Source: [<code>abstractions/modules/neovim/lsp/default.nix</code>](../../abstractions/modules/neovim/lsp/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>neovim.lsp.enable</code> | <code>boolean</code> | <code>myconfig.neovim.enable &amp;&amp; true</code> |  |

### <code>nh</code>

Provide nh for package and option searches.

Source: [<code>abstractions/modules/nh/default.nix</code>](../../abstractions/modules/nh/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>nh.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>nix</code>

Configure Nix itself.

Source: [<code>abstractions/modules/nix/default.nix</code>](../../abstractions/modules/nix/default.nix)

### <code>nix-secrets</code>

Provide nix-secrets to Hjem and activate its secrets on Darwin.

Source: [<code>abstractions/modules/nix-secrets/default.nix</code>](../../abstractions/modules/nix-secrets/default.nix)

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>security.nix-secrets.activateScript</code> | <code>absolute path</code> |  | read-only; Darwin activation command, serialized with every other trigger that runs it. |

### <code>nixpkgs</code>

Configure Nixpkgs for the host.

Source: [<code>abstractions/modules/nixpkgs/default.nix</code>](../../abstractions/modules/nixpkgs/default.nix)

### <code>notion</code>

Provide the Notion desktop app.

Source: [<code>abstractions/modules/notion/default.nix</code>](../../abstractions/modules/notion/default.nix)<br>Tags: <code>gui</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>notion.enable</code> | <code>boolean</code> | <code>false</code> |  |
| <code>notion.package</code> | <code>package</code> | <code>myconfig.casks.packages.notion</code> |  |

### <code>pay-respects</code>

Provide command typo recovery with pay-respects.

Source: [<code>abstractions/modules/pay-respects/default.nix</code>](../../abstractions/modules/pay-respects/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>pay-respects.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>pay-respects.disrespectful</code>

Replace command typo recovery with a playful response.

Source: [<code>abstractions/modules/pay-respects/disrespectful/default.nix</code>](../../abstractions/modules/pay-respects/disrespectful/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>pay-respects.disrespectful.enable</code> | <code>boolean</code> | <code>myconfig.pay-respects.enable &amp;&amp; true</code> |  |

### <code>phi</code>

Provide the Phi browser.

Source: [<code>abstractions/modules/phi/default.nix</code>](../../abstractions/modules/phi/default.nix)<br>Tags: <code>gui</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>phi.enable</code> | <code>boolean</code> | <code>false</code> |  |
| <code>phi.package</code> | <code>package</code> | <code>myconfig.casks.taps.phibrowser.tap.phi</code> |  |

### <code>privacy</code>

Limit what the system shares and what it opens without being asked.

Source: [<code>abstractions/modules/privacy/default.nix</code>](../../abstractions/modules/privacy/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>privacy.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>publication</code>

Centralize publication choices for feature-owned bundles.

Source: [<code>abstractions/modules/publication/default.nix</code>](../../abstractions/modules/publication/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>publication.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>ripgrep</code>

Provide ripgrep for searching file contents.

Source: [<code>abstractions/modules/ripgrep/default.nix</code>](../../abstractions/modules/ripgrep/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>ripgrep.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>screenshots</code>

Configure where screenshots are saved and in which format.

Source: [<code>abstractions/modules/screenshots/default.nix</code>](../../abstractions/modules/screenshots/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>screenshots.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>secrets</code>

Manage the selected encrypted secrets with nix-secrets.

Source: [<code>abstractions/modules/secrets/default.nix</code>](../../abstractions/modules/secrets/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>secrets.enable</code> | <code>boolean</code> | <code>true</code> |  |
| <code>secrets.names</code> | <code>list of (one of "vercel-ai-gateway-api-key", "openrouter-api-key", "opencode-api-key", "mistral-api-key", "zai-api-key", "cohere-api-key", "brave-api-key", "brave-free-api-key", "parallel-api-key", "exa-api-key", "command-code-api-key", "iniad-gitconfig")</code> | <code>[ ]</code> | Secrets, among those stored in this module, that are decrypted for the user. |

### <code>security</code>

Configure how a person authenticates to the host: sudo, the login window, and the screen lock.

Source: [<code>abstractions/modules/security/default.nix</code>](../../abstractions/modules/security/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>security.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>services</code>

Declare user services and reconcile them with the platform's service manager.

Source: [<code>abstractions/modules/services/default.nix</code>](../../abstractions/modules/services/default.nix)

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>platform.darwin.launchAgents</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Hjem-owned native LaunchAgents, optionally adding to portable jobs of the same name. |
| <code>platform.darwin.launchAgents.&lt;name&gt;.config</code> | <code>attribute set of anything</code> | <code>{ }</code> | Native launchd plist fields. For a service also declared in userServices, these extend rather than override the portable declaration; see the contract at the top of this file for constraints. |
| <code>platform.darwin.launchAgents.&lt;name&gt;.domain</code> | <code>one of "user", "gui"</code> |  | Launchctl domain; GUI registration is deferred without a GUI session. |
| <code>platform.darwin.launchAgents.&lt;name&gt;.restartOnSwitch</code> | <code>boolean</code> | <code>false</code> | Native-only switch restart policy; cannot also be defined by a portable declaration. |
| <code>platform.darwin.serviceTargets</code> | <code>attribute set of (submodule)</code> |  | read-only; Launchd domain and Label of each declared service, by name. |
| <code>platform.darwin.serviceTargets.&lt;name&gt;.domain</code> | <code>one of "user", "gui"</code> |  | Launchctl domain of the job. |
| <code>platform.darwin.serviceTargets.&lt;name&gt;.label</code> | <code>string</code> |  | Label of the job. |
| <code>userServices</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Portable Hjem-owned user services; currently implemented on Darwin only. |
| <code>userServices.&lt;name&gt;.autoStart</code> | <code>boolean</code> | <code>true</code> | Start when launchd loads the job; this does not by itself guarantee loading at login or restart it on every switch. |
| <code>userServices.&lt;name&gt;.command</code> | <code>list of string</code> | <code>[ ]</code> | Nonempty argv with an absolute executable; no shell expansion. |
| <code>userServices.&lt;name&gt;.environment</code> | <code>attribute set of string</code> | <code>{ }</code> | Explicit service environment; session inheritance is not guaranteed. |
| <code>userServices.&lt;name&gt;.restartOnSwitch</code> | <code>boolean</code> | <code>false</code> | Request a potentially interrupting restart on every switch, except right after registration has started an autoStart job. |
| <code>userServices.&lt;name&gt;.workingDirectory</code> | <code>null or string</code> | <code>null</code> | Absolute working directory, when specified. |

### <code>shell</code>

Define a shared configuration interface for shells and configure the selected login shell.

Source: [<code>abstractions/modules/shell/default.nix</code>](../../abstractions/modules/shell/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>shell.enable</code> | <code>boolean</code> | <code>true</code> |  |
| <code>shell.loginShell</code> | <code>value "zsh" (singular enum)</code> |  | Shell that becomes the user's login shell. |

### <code>shield</code>

Provide the SHIELD process hub and the keel agent screens it attaches.

Source: [<code>abstractions/modules/agents/shield/default.nix</code>](../../abstractions/modules/agents/shield/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>shield.defaultModel</code> | <code>null or string matching the pattern [^/]+/.+</code> | <code>"openai/gpt-6.1-sol"</code> | Model, as provider/id, that a new keel agent uses when `settings` names neither defaultProvider nor defaultModel; it is written into the deployed settings.json. null leaves the choice to Pi. |
| <code>shield.enable</code> | <code>boolean</code> | <code>true</code> |  |
| <code>shield.extensions</code> | <code>null or (list of non-empty string)</code> | <code>[<br>  "commands"<br>  "model"<br>  "timeline"<br>  "markdown"<br>  "tools"<br>  "codemode"<br>  "queue"<br>  "commandcode"<br>]</code> | Extensions keel loads, deployed read-only as keel/extensions.json. An entry of lowercase letters, digits, and hyphens names an extension keel ships; any other entry, such as `mine.ts` or `/abs/ext.ts`, is the path of an extension file, absolute or relative to the configuration directory. keel loads no other Pi extension. null leaves extensions.json unmanaged. |
| <code>shield.extraPackages</code> | <code>list of package</code> | <code>[ ]</code> | Packages whose bin directories lead the PATH of a new agent, ahead of the PATH inherited from the keel screen that starts it, and which are not installed for the user. |
| <code>shield.models</code> | <code>attribute set of (JSON value)</code> | <code>{ }</code> | Pi models.json content (providers and their models), deployed read-only as keel/models.json; an empty set is deployed as {"providers": {}}, the form Pi requires. A value written here is stored in the world-readable Nix store, so write a credential as a runtime reference such as `!&lt;absolute command&gt; &lt;quoted secret path&gt;` that Pi runs when it needs the key. When the Hjem configuration declares the secret command-code-api-key, providers.command-code.apiKey defaults to such a reference; a value written here takes precedence. |
| <code>shield.settings</code> | <code>attribute set of JSON values without apiKeys</code> | <code>{ }</code> | Pi settings, deployed read-only as keel/settings.json under the XDG config directory, keel's default configuration directory. Pi's own keys pass through unchanged; the key `apiKeys` is rejected, because Pi would migrate it into auth.json by rewriting the file and its values would enter the Nix store. Give credentials through `models` as a runtime reference or through Pi's auth.json. Changing the model or thinking level in keel is stored in the conversation, never here. |

### <code>skills</code>

Declare harness-independent skills and deploy them for agent use.

Source: [<code>abstractions/modules/agents/skills/default.nix</code>](../../abstractions/modules/agents/skills/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>skills.enable</code> | <code>boolean</code> | <code>true</code> |  |

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>skills</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Skills deployed independently of harness configuration. |
| <code>skills.&lt;name&gt;.source</code> | <code>absolute path</code> |  | Source directory of the complete skill package. |
| <code>skills.&lt;name&gt;.targetDirs</code> | <code>list of home-relative directory without a '..' component</code> | <code>[ ]</code> | Home-relative parent directories; the skill is linked under its attribute name in each directory. An empty list deploys nothing. |

### <code>slack</code>

Provide the Slack desktop app.

Source: [<code>abstractions/modules/slack/default.nix</code>](../../abstractions/modules/slack/default.nix)<br>Tags: <code>gui</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>slack.enable</code> | <code>boolean</code> | <code>false</code> |  |
| <code>slack.package</code> | <code>package</code> | <code>pkgs.slack</code> |  |

### <code>sound</code>

Configure system sounds and alert feedback.

Source: [<code>abstractions/modules/sound/default.nix</code>](../../abstractions/modules/sound/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>sound.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>spaces</code>

Configure Spaces across displays and how the desktop and its widgets are revealed.

Source: [<code>abstractions/modules/spaces/default.nix</code>](../../abstractions/modules/spaces/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>spaces.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>ssh</code>

Configure the OpenSSH client and the user's personal key.

Source: [<code>abstractions/modules/ssh/default.nix</code>](../../abstractions/modules/ssh/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>ssh.enable</code> | <code>boolean</code> | <code>true</code> |  |
| <code>ssh.personalKeyFile</code> | <code>string</code> | <code>"~/.ssh/id_ed25519_personal"</code> | read-only; Path of the personal SSH private key on each host, used for GitHub authentication and Git commit signing. |

### <code>tags</code>

Enable by default the modules that carry a tag selected for the host.

Source: [<code>abstractions/modules/tags/default.nix</code>](../../abstractions/modules/tags/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>tags.enabled</code> | <code>list of value "gui" (singular enum)</code> | <code>[ ]</code> | Tags whose modules are enabled by default. |

### <code>trackpad</code>

Configure pointing devices: trackpad clicking and gestures, scrolling, and pointer speed.

Source: [<code>abstractions/modules/trackpad/default.nix</code>](../../abstractions/modules/trackpad/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>trackpad.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>users</code>

Apply the host's declared user information to OS user configuration.

Source: [<code>abstractions/modules/users/default.nix</code>](../../abstractions/modules/users/default.nix)

### <code>vicinae</code>

Provide the Vicinae launcher as a login service with a stable code-signing identity.

Source: [<code>abstractions/modules/vicinae/default.nix</code>](../../abstractions/modules/vicinae/default.nix)<br>Tags: <code>gui</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>vicinae.enable</code> | <code>boolean</code> | <code>false</code> |  |
| <code>vicinae.package</code> | <code>package</code> | <code>inputs.vicinae.packages.${pkgs.stdenv.hostPlatform.system}.default</code> |  |
| <code>vicinae.sourceFiles</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Files of `package`'s source replaced before it is built, keyed by their path relative to the source root. Each path may be replaced by one definition only. |
| <code>vicinae.sourceFiles.&lt;name&gt;.source</code> | <code>absolute path</code> |  | File that replaces the upstream one. |
| <code>vicinae.sourceFiles.&lt;name&gt;.upstreamSha256</code> | <code>string matching the pattern [0-9a-f]{64}</code> |  | Hex SHA-256 of the upstream file being replaced; a build whose source holds a different file fails, so upstream changes are merged rather than overwritten. |

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>vicinae.settings</code> | <code>JSON value</code> | <code>{ }</code> | Settings layered over Vicinae's own settings.json through VICINAE_OVERRIDES; keys set here take precedence over changes made in the app. |

### <code>vicinae.compact-transition</code>

Animate the Vicinae launcher window between its compact and expanded states.

Source: [<code>abstractions/modules/vicinae/compact-transition/default.nix</code>](../../abstractions/modules/vicinae/compact-transition/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>vicinae.compact-transition.enable</code> | <code>boolean</code> | <code>myconfig.vicinae.enable &amp;&amp; false</code> |  |

### <code>vicinae.selection-highlight</code>

Animate the Vicinae selection highlight as it moves between list items.

Source: [<code>abstractions/modules/vicinae/selection-highlight/default.nix</code>](../../abstractions/modules/vicinae/selection-highlight/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>vicinae.selection-highlight.enable</code> | <code>boolean</code> | <code>myconfig.vicinae.enable &amp;&amp; false</code> |  |

### <code>xdg</code>

Define the user's XDG base directories and export them to the user's environment.

Source: [<code>abstractions/modules/xdg/default.nix</code>](../../abstractions/modules/xdg/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>xdg.cache</code> | <code>string</code> | <code>"${myconfig.host.user.homeDirectory}/.cache"</code> | read-only; The user's XDG cache directory. |
| <code>xdg.config</code> | <code>string</code> | <code>"${myconfig.host.user.homeDirectory}/.config"</code> | read-only; The user's XDG configuration directory. |
| <code>xdg.data</code> | <code>string</code> | <code>"${myconfig.host.user.homeDirectory}/.local/share"</code> | read-only; The user's XDG data directory. |
| <code>xdg.enable</code> | <code>boolean</code> | <code>true</code> |  |
| <code>xdg.state</code> | <code>string</code> | <code>"${myconfig.host.user.homeDirectory}/.local/state"</code> | read-only; The user's XDG state directory. |

### <code>zoom</code>

Configure Accessibility Zoom: its mode, how it follows the pointer and focus, and the Picture-in-Picture window.

Source: [<code>abstractions/modules/zoom/default.nix</code>](../../abstractions/modules/zoom/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>zoom.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>zoxide</code>

Provide zoxide and initialize its directory navigation in Zsh.

Source: [<code>abstractions/modules/zoxide/default.nix</code>](../../abstractions/modules/zoxide/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>zoxide.enable</code> | <code>boolean</code> | <code>true</code> |  |

### <code>zsh</code>

Enable Zsh and provide the foundation required for its use.

Source: [<code>abstractions/modules/shell/zsh/default.nix</code>](../../abstractions/modules/shell/zsh/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>zsh.enable</code> | <code>boolean</code> | <code>true</code> |  |
| <code>zsh.package</code> | <code>package</code> | <code>pkgs.zsh</code> |  |

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>zsh.zshenv</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Fragments rendered in dependency order. |
| <code>zsh.zshenv.&lt;name&gt;.after</code> | <code>list of string</code> | <code>[ ]</code> | Fragments that must precede this one. |
| <code>zsh.zshenv.&lt;name&gt;.before</code> | <code>list of string</code> | <code>[ ]</code> | Fragments that must follow this one. |
| <code>zsh.zshenv.&lt;name&gt;.text</code> | <code>string</code> |  | Text of the fragment. |

### <code>zsh.interactive</code>

Build Zsh's interactive environment.

Source: [<code>abstractions/modules/shell/zsh/interactive/default.nix</code>](../../abstractions/modules/shell/zsh/interactive/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>zsh.interactive.enable</code> | <code>boolean</code> | <code>myconfig.zsh.enable &amp;&amp; true</code> |  |

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>zsh.zshrc</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Fragments rendered in dependency order. |
| <code>zsh.zshrc.&lt;name&gt;.after</code> | <code>list of string</code> | <code>[ ]</code> | Fragments that must precede this one. |
| <code>zsh.zshrc.&lt;name&gt;.before</code> | <code>list of string</code> | <code>[ ]</code> | Fragments that must follow this one. |
| <code>zsh.zshrc.&lt;name&gt;.text</code> | <code>string</code> |  | Text of the fragment. |

### <code>zsh.login</code>

Configure the behavior required to use Zsh as a login shell.

Source: [<code>abstractions/modules/shell/zsh/login/default.nix</code>](../../abstractions/modules/shell/zsh/login/default.nix)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>zsh.login.enable</code> | <code>boolean</code> | <code>myconfig.zsh.enable &amp;&amp; false</code> |  |
