# Authoring

Generated from module, host and option declarations. Do not edit; run `just docs`. `just options <module>` shows every option of a module.

## Declarations

Options this repository adds to Denix declarations.

### Modules (<code>delib.module</code>)

| Option | Type | Default | Description | Source |
| --- | --- | --- | --- | --- |
| <code>meta.description</code> | <code>string</code> |  | One-sentence responsibility of this module, not an inventory of its current settings. | [<code>extensions/module-metadata.nix</code>](../../extensions/module-metadata.nix) |
| <code>meta.follows</code> | <code>list of string</code> | <code>[ ]</code> | Roles whose seat this module reads, by name; the module is enabled by default only while each `roles.&lt;name&gt;` is. | [<code>extensions/module-dependencies.nix</code>](../../extensions/module-dependencies.nix) |
| <code>meta.role</code> | <code>null or string</code> | <code>null</code> | Role whose seat this module can hold, by the role's name; `roles.&lt;name&gt;.holder` selects the holder. | [<code>extensions/roles.nix</code>](../../extensions/roles.nix) |
| <code>meta.tags</code> | <code>list of string</code> | <code>[ ]</code> | Classification labels declared for this module. | [<code>extensions/module-metadata.nix</code>](../../extensions/module-metadata.nix) |
| <code>tests.cases</code> | <code>function that evaluates to a(n) attribute set of (submodule)</code> | <code>_: { }</code> | Inline cases of this module's contract, by name. A function of `{pkgs, lib, system, home, oxlintConfig, typescriptCheck}`, where `home` is the fixture user's home directory, `oxlintConfig` the repository's oxlint configuration, and `typescriptCheck {name, src, types}` a derivation that type-checks and lints the TypeScript directory `src` against the types of the Bun project directory `types` (`lib/typescript-check.nix`). | [<code>extensions/module-tests.nix</code>](../../extensions/module-tests.nix) |
| <code>tests.cases.&lt;function body&gt;.&lt;name&gt;.build</code> | <code>function that evaluates to a(n) package</code> |  | One of the modes: maps the fixture's result to a derivation that the module's check builds. Cannot be combined with `expr`. | [<code>extensions/module-tests.nix</code>](../../extensions/module-tests.nix) |
| <code>tests.cases.&lt;function body&gt;.&lt;name&gt;.expected</code> | <code>raw value</code> |  | Value that `expr` must return. One of the modes. | [<code>extensions/module-tests.nix</code>](../../extensions/module-tests.nix) |
| <code>tests.cases.&lt;function body&gt;.&lt;name&gt;.expr</code> | <code>function that evaluates to a(n) raw value</code> |  | Maps the fixture's result to the value compared with `expected`, or that must fail to evaluate when `fails = true`. Required unless the mode is `build` or `fails` is a string. | [<code>extensions/module-tests.nix</code>](../../extensions/module-tests.nix) |
| <code>tests.cases.&lt;function body&gt;.&lt;name&gt;.fails</code> | <code>value true (singular enum) or string</code> |  | One of the modes: `true` requires `expr` to fail evaluation; a string requires a failed constraint or module-system assertion containing it. | [<code>extensions/module-tests.nix</code>](../../extensions/module-tests.nix) |
| <code>tests.cases.&lt;function body&gt;.&lt;name&gt;.host</code> | <code>attribute set</code> | <code>{ }</code> | Attributes merged into the fixture's `delib.host` declaration, such as `myconfig.ifEnabled` choices or `system`. The fixture's module system is evaluated for that `system`. | [<code>extensions/module-tests.nix</code>](../../extensions/module-tests.nix) |
| <code>tests.cases.&lt;function body&gt;.&lt;name&gt;.moduleSystem</code> | <code>one of "bundles", "darwin", "hjem", "nixos"</code> | <code>"hjem"</code> | Module system whose result the case observes. | [<code>extensions/module-tests.nix</code>](../../extensions/module-tests.nix) |
| <code>tests.cases.&lt;function body&gt;.&lt;name&gt;.modules</code> | <code>attribute set of ((attribute set) or function that evaluates to a(n) (attribute set))</code> | <code>{ }</code> | Contributor modules by name: `delib.module` attributes, or a function of its Denix arguments returning them, without `name` or `meta.description`. | [<code>extensions/module-tests.nix</code>](../../extensions/module-tests.nix) |
| <code>tests.cases.&lt;function body&gt;.&lt;name&gt;.platforms</code> | <code>list of string</code> | <code>[<br>  "aarch64-darwin"<br>  "aarch64-linux"<br>  "x86_64-linux"<br>]</code> | Systems on which the case runs. Read before any fixture is generated. | [<code>extensions/module-tests.nix</code>](../../extensions/module-tests.nix) |
| <code>tests.cases.&lt;function body&gt;.&lt;name&gt;.protects</code> | <code>non-empty string</code> |  | What this repository wrote or changed that the case protects, and the behavior it keeps. Required. | [<code>extensions/module-tests.nix</code>](../../extensions/module-tests.nix) |
| <code>tests.cases.&lt;function body&gt;.&lt;name&gt;.tsRoots</code> | <code>list of module-relative path without `..` segments</code> | <code>[ ]</code> | TypeScript roots whose coverage this case provides, relative to the module directory; `.` is the module directory. | [<code>extensions/module-tests.nix</code>](../../extensions/module-tests.nix) |
| <code>tests.cases.&lt;function body&gt;.&lt;name&gt;.uses</code> | <code>list of string</code> | <code>[ ]</code> | Modules added to this case's fixture beside the module's `tests.fixture` and contributors. Their `tests.fixture` is followed, their uses are not; each must name a module. | [<code>extensions/module-tests.nix</code>](../../extensions/module-tests.nix) |
| <code>tests.fixture</code> | <code>list of string</code> | <code>[ ]</code> | Modules loaded with this module in its test fixtures and in every fixture that loads it, such as the owners of options it defines; a fixture otherwise holds only the module under test. A change to one of them selects this module's checks. | [<code>extensions/module-tests.nix</code>](../../extensions/module-tests.nix) |

### Hosts (<code>delib.host</code>)

| Option | Type | Default | Description | Source |
| --- | --- | --- | --- | --- |
| <code>rice</code> | <code>null or value "default" (singular enum)</code> | <code>null</code> | Rice whose `myconfig` this host builds on; `null` selects none. | [<code>extensions/rices.nix</code>](../../extensions/rices.nix) |
| <code>system</code> | <code>string</code> |  | Nix system of this host. | [<code>extensions/hosts.nix</code>](../../extensions/hosts.nix) |
| <code>user</code> | <code>submodule</code> |  | The sole user of this host. | [<code>extensions/hosts.nix</code>](../../extensions/hosts.nix) |
| <code>user.homeDirectory</code> | <code>string</code> | `/Users/&lt;name&gt;` on Darwin, otherwise `/home/&lt;name&gt;` | Home directory of the user on this host. | [<code>extensions/hosts.nix</code>](../../extensions/hosts.nix) |
| <code>user.name</code> | <code>string</code> |  | Unix account name of the person using this host. | [<code>extensions/hosts.nix</code>](../../extensions/hosts.nix) |
| <code>user.uid</code> | <code>signed integer</code> | 501 on Darwin, otherwise 1000 | Numeric user ID of the user's account on this host. | [<code>extensions/hosts.nix</code>](../../extensions/hosts.nix) |

## Module systems

Options that adapters add to their module systems.

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

| Module | Responsibility | Tags |
| --- | --- | --- |
| [<code>agents</code>](../../abstractions/modules/agents/default.nix) | Provide a shared configuration interface for LLM agents and configure the selected agent packages. |  |
| [<code>ai-mop</code>](../../abstractions/modules/ai-mop/default.nix) | Provide an isolated Pi workbench for trying INIAD AI MOP models and tool calls. |  |
| [<code>alacritty</code>](../../abstractions/modules/alacritty/default.nix) | Provide Alacritty terminal emulator. | <code>gui</code> |
| [<code>alacritty.colorscheme</code>](../../abstractions/modules/alacritty/colorscheme/default.nix) | Give Alacritty the colors of the held color scheme. |  |
| [<code>antigravity-cli</code>](../../abstractions/modules/agents/antigravity-cli/default.nix) | Provide and configure the Google Antigravity CLI. |  |
| [<code>app-identity</code>](../../abstractions/modules/app-identity/default.nix) | Expose nix-mac-app-identity helpers that give Nix-built macOS programs a code-signing identity surviving rebuilds. |  |
| [<code>appcleaner</code>](../../abstractions/modules/appcleaner/default.nix) | Provide AppCleaner. | <code>gui</code> |
| [<code>appearance</code>](../../abstractions/modules/appearance/default.nix) | Configure the system's visual appearance: color scheme, menu bar, and menu bar clock. |  |
| [<code>aquaskk</code>](../../abstractions/modules/aquaskk/default.nix) | Install AquaSKK and configure its keymap, dictionaries and user preferences. |  |
| [<code>bat</code>](../../abstractions/modules/bat/default.nix) | Provide and configure bat for file display. |  |
| [<code>bat.colorscheme</code>](../../abstractions/modules/bat/colorscheme/default.nix) | Give bat the theme of the held color scheme. |  |
| [<code>batman</code>](../../abstractions/modules/bat/batman/default.nix) | Provide batman and configure it as Zsh's manual page pager. |  |
| [<code>bettertouchtool</code>](../../abstractions/modules/bettertouchtool/default.nix) | Provide BetterTouchTool and place its portable preset, which is imported by hand through BetterTouchTool's preset import. | <code>gui</code> |
| [<code>casks</code>](../../abstractions/modules/casks/default.nix) | Expose Homebrew casks, packaged by cask2nix from the official and third-party taps, to modules. |  |
| [<code>claude-code</code>](../../abstractions/modules/agents/claude-code/default.nix) | Provide and configure Claude Code. |  |
| [<code>claude-code.colorscheme</code>](../../abstractions/modules/agents/claude-code/colorscheme/default.nix) | Give Claude Code the theme matching the held color scheme. |  |
| [<code>colorscheme</code>](../../abstractions/modules/colorscheme/default.nix) | Collect the combinations of every registered color scheme, for features that publish one per combination. |  |
| [<code>colorscheme.rose-pine</code>](../../abstractions/modules/colorscheme/rose-pine/default.nix) | Register the Rosé Pine color scheme, its main variant. |  |
| [<code>cursor-agent</code>](../../abstractions/modules/agents/cursor-agent/default.nix) | Provide the Cursor Agent CLI. |  |
| [<code>defaults</code>](../../abstractions/modules/defaults/default.nix) | Declare the current user's preferences and reconcile them with the platform's preferences store. |  |
| [<code>direnv</code>](../../abstractions/modules/direnv/default.nix) | Provide and configure direnv, including its Zsh integration. |  |
| [<code>dock</code>](../../abstractions/modules/dock/default.nix) | Configure the Dock and the actions of screen hot corners. |  |
| [<code>edith</code>](../../abstractions/modules/agents/edith/default.nix) | Provide EDITH, an agent on pi-durable whose conversations clients such as Discord reach by address, as a resident service and as `edith dev` for trying it out. |  |
| [<code>elio</code>](../../abstractions/modules/elio/default.nix) | Provide and publish elio, configure its settings and theme, and integrate it with Zsh. |  |
| [<code>elio.colorscheme</code>](../../abstractions/modules/elio/colorscheme/default.nix) | Give elio a theme from the held color scheme's palette. |  |
| [<code>elio.ctrl-np</code>](../../abstractions/modules/elio/ctrl-np/default.nix) | Move through elio's search results and scroll its help with Ctrl-N and Ctrl-P, which elio hard-codes to the arrow keys. |  |
| [<code>elio.quit-after-open</code>](../../abstractions/modules/elio/quit-after-open/default.nix) | Quit elio without changing the shell's directory once a program it opened in the terminal exits successfully. |  |
| [<code>exclusive</code>](../../abstractions/modules/exclusive/default.nix) | Reject a second definition of a file that one location must own. |  |
| [<code>eza</code>](../../abstractions/modules/eza/default.nix) | Provide eza for listing files and directories. |  |
| [<code>eza.colorscheme</code>](../../abstractions/modules/eza/colorscheme/default.nix) | Give eza the theme of the held color scheme. |  |
| [<code>fd</code>](../../abstractions/modules/fd/default.nix) | Provide fd for finding files and directories. |  |
| [<code>files</code>](../../abstractions/modules/files/default.nix) | Configure how the Finder and file dialogs present files, and what the Finder writes to other volumes. |  |
| [<code>fonts</code>](../../abstractions/modules/fonts/default.nix) | Register font families for applications and install their packages as real files in the user's font directory. |  |
| [<code>fzf</code>](../../abstractions/modules/fzf/default.nix) | Provide and configure fzf, including its Zsh integration. |  |
| [<code>fzf.colorscheme</code>](../../abstractions/modules/fzf/colorscheme/default.nix) | Give fzf the colors of the held color scheme. |  |
| [<code>gh</code>](../../abstractions/modules/gh/default.nix) | Provide the GitHub CLI. |  |
| [<code>ghostty</code>](../../abstractions/modules/ghostty/default.nix) | Provide Ghostty terminal emulator. | <code>gui</code> |
| [<code>ghostty.colorscheme</code>](../../abstractions/modules/ghostty/colorscheme/default.nix) | Give Ghostty the colors of the held color scheme's palette. |  |
| [<code>git</code>](../../abstractions/modules/git/default.nix) | Provide Git and configure the user's Git environment. |  |
| [<code>git.include</code>](../../abstractions/modules/git/include/default.nix) | Configure Git settings through includes. |  |
| [<code>gomi</code>](../../abstractions/modules/gomi/default.nix) | Provide gomi and integrate it into Zsh. |  |
| [<code>grok-bot</code>](../../abstractions/modules/grok-bot/default.nix) | Provide the Grok-bot desktop app. | <code>gui</code> |
| [<code>host</code>](../../abstractions/modules/host/default.nix) | Expose the selected host's information to modules and reflect its identity in OS host names. |  |
| [<code>identity</code>](../../abstractions/modules/identity/default.nix) | Expose the fixed identity of the person who uses these hosts. |  |
| [<code>imprynt</code>](../../abstractions/modules/imprynt/default.nix) | Declare real-file deployments and apply them through imprynt. |  |
| [<code>input-methods</code>](../../abstractions/modules/input-methods/default.nix) | Register user input sources and own the shared HIToolbox input-source preferences. |  |
| [<code>kanata</code>](../../abstractions/modules/kanata/default.nix) | Remap keyboard input with Kanata, generating its configuration from actions declared per layer and key. |  |
| [<code>keyboard</code>](../../abstractions/modules/keyboard/default.nix) | Configure system-wide keyboard behavior: key repeat, text substitutions, function keys, and system shortcuts. |  |
| [<code>locale</code>](../../abstractions/modules/locale/default.nix) | Configure the languages and region used by the system and applications. |  |
| [<code>mcp</code>](../../abstractions/modules/agents/mcp/default.nix) | Declare stdio MCP servers and resolve each agent consumer's selection of them. |  |
| [<code>mcp.web</code>](../../abstractions/modules/agents/mcp/web/default.nix) | Provide the web retrieval MCP server and its backend configuration. |  |
| [<code>neovim</code>](../../abstractions/modules/neovim/default.nix) | Provide and configure Neovim. |  |
| [<code>neovim.ai-completion</code>](../../abstractions/modules/neovim/ai-completion/default.nix) | Provide switchable inline AI completions through Minuet. |  |
| [<code>neovim.animations</code>](../../abstractions/modules/neovim/animations/default.nix) | Animate Neovim edits and movement while preserving existing key semantics. |  |
| [<code>neovim.autopairs</code>](../../abstractions/modules/neovim/autopairs/default.nix) | Insert paired delimiters and track generated closers in Neovim. |  |
| [<code>neovim.bars</code>](../../abstractions/modules/neovim/bars/default.nix) | Compose Neovim status and buffer displays from placement-independent Heirline components. |  |
| [<code>neovim.cmdline</code>](../../abstractions/modules/neovim/cmdline/default.nix) | Present Neovim command and search input in a popup without replacing messages or notifications. |  |
| [<code>neovim.colorscheme</code>](../../abstractions/modules/neovim/colorscheme/default.nix) | Give Neovim the colorscheme plugin of the held color scheme. |  |
| [<code>neovim.completion</code>](../../abstractions/modules/neovim/completion/default.nix) | Provide insert-mode and command-line completion in Neovim. |  |
| [<code>neovim.diagnostic</code>](../../abstractions/modules/neovim/diagnostic/default.nix) | Display diagnostics in Neovim buffers. |  |
| [<code>neovim.finder</code>](../../abstractions/modules/neovim/finder/default.nix) | Find files, search their contents and browse directories in Neovim with Snacks. |  |
| [<code>neovim.git</code>](../../abstractions/modules/neovim/git/default.nix) | Display Git changes and expose hunk navigation, previews and blame in Neovim. |  |
| [<code>neovim.languages</code>](../../abstractions/modules/neovim/languages/default.nix) | Group language-specific Neovim editing support. |  |
| [<code>neovim.languages.bash</code>](../../abstractions/modules/neovim/languages/bash/default.nix) | Configure Bash editing support in Neovim. |  |
| [<code>neovim.languages.json</code>](../../abstractions/modules/neovim/languages/json/default.nix) | Configure JSON editing support in Neovim. |  |
| [<code>neovim.languages.just</code>](../../abstractions/modules/neovim/languages/just/default.nix) | Configure Just editing support in Neovim. |  |
| [<code>neovim.languages.kdl</code>](../../abstractions/modules/neovim/languages/kdl/default.nix) | Configure KDL editing support in Neovim. |  |
| [<code>neovim.languages.lua</code>](../../abstractions/modules/neovim/languages/lua/default.nix) | Configure Lua editing support in Neovim. |  |
| [<code>neovim.languages.markdown</code>](../../abstractions/modules/neovim/languages/markdown/default.nix) | Configure Markdown editing support in Neovim. |  |
| [<code>neovim.languages.nix</code>](../../abstractions/modules/neovim/languages/nix/default.nix) | Configure Nix editing support in Neovim. |  |
| [<code>neovim.languages.nushell</code>](../../abstractions/modules/neovim/languages/nushell/default.nix) | Configure Nushell editing support in Neovim. |  |
| [<code>neovim.languages.objc</code>](../../abstractions/modules/neovim/languages/objc/default.nix) | Configure Objective-C editing support in Neovim. |  |
| [<code>neovim.languages.qml</code>](../../abstractions/modules/neovim/languages/qml/default.nix) | Configure QML editing support in Neovim. |  |
| [<code>neovim.languages.rust</code>](../../abstractions/modules/neovim/languages/rust/default.nix) | Configure Rust editing support in Neovim. |  |
| [<code>neovim.languages.toml</code>](../../abstractions/modules/neovim/languages/toml/default.nix) | Configure TOML editing support in Neovim. |  |
| [<code>neovim.languages.typescript</code>](../../abstractions/modules/neovim/languages/typescript/default.nix) | Configure TypeScript editing support in Neovim. |  |
| [<code>neovim.languages.zsh</code>](../../abstractions/modules/neovim/languages/zsh/default.nix) | Configure Zsh editing support in Neovim. |  |
| [<code>neovim.lsp</code>](../../abstractions/modules/neovim/lsp/default.nix) | Connect Neovim to language servers and format buffers through them. |  |
| [<code>neovim.mkdir</code>](../../abstractions/modules/neovim/mkdir/default.nix) | Create missing parent directories when saving ordinary Neovim files. |  |
| [<code>neovim.motion</code>](../../abstractions/modules/neovim/motion/default.nix) | Provide search and line-movement aids in Neovim. |  |
| [<code>neovim.navigation</code>](../../abstractions/modules/neovim/navigation/default.nix) | Move focus across Neovim windows and adjacent Zellij or Rex panes. |  |
| [<code>neovim.surround</code>](../../abstractions/modules/neovim/surround/default.nix) | Edit surrounding delimiters through a consistent Neovim command namespace. |  |
| [<code>neovim.treesitter</code>](../../abstractions/modules/neovim/treesitter/default.nix) | Assemble language-owned Tree-sitter parsers and queries and apply their buffer settings. |  |
| [<code>neovim.undo</code>](../../abstractions/modules/neovim/undo/default.nix) | Browse Neovim undo branches and changes with Snacks. |  |
| [<code>nh</code>](../../abstractions/modules/nh/default.nix) | Provide nh for package and option searches. |  |
| [<code>nix</code>](../../abstractions/modules/nix/default.nix) | Configure Nix itself. |  |
| [<code>nix-secrets</code>](../../abstractions/modules/nix-secrets/default.nix) | Provide nix-secrets to Hjem and activate its secrets on Darwin. |  |
| [<code>nixpkgs</code>](../../abstractions/modules/nixpkgs/default.nix) | Configure Nixpkgs for the host. |  |
| [<code>notion</code>](../../abstractions/modules/notion/default.nix) | Provide the Notion desktop app. | <code>gui</code> |
| [<code>omniwm</code>](../../abstractions/modules/omniwm/default.nix) | Provide OmniWM as a user service, own its writable settings, and integrate its navigation with Kanata. | <code>gui</code> |
| [<code>omniwm.colorscheme</code>](../../abstractions/modules/omniwm/colorscheme/default.nix) | Color OmniWM's focused-window border with the held color scheme's cursor color. |  |
| [<code>pay-respects</code>](../../abstractions/modules/pay-respects/default.nix) | Provide command typo recovery with pay-respects. |  |
| [<code>pay-respects.disrespectful</code>](../../abstractions/modules/pay-respects/disrespectful/default.nix) | Replace command typo recovery with a playful response. |  |
| [<code>phi</code>](../../abstractions/modules/phi/default.nix) | Provide and publish the Phi browser and the CLI and agent skill that drive it. | <code>gui</code> |
| [<code>pi</code>](../../abstractions/modules/agents/pi/default.nix) | Configure Pi for Hjem and publish a standalone configured Pi. |  |
| [<code>pi.compaction</code>](../../abstractions/modules/agents/pi/compaction/default.nix) | Compact Pi conversations through the public Responses API. |  |
| [<code>pi.input</code>](../../abstractions/modules/agents/pi/input/default.nix) | Provide Pi's command palette and stop confirmation. |  |
| [<code>pi.question</code>](../../abstractions/modules/agents/pi/question/default.nix) | Ask the user for decisions through Pi's question tool. |  |
| [<code>privacy</code>](../../abstractions/modules/privacy/default.nix) | Limit what the system shares and what it opens without being asked. |  |
| [<code>rex</code>](../../abstractions/modules/rex/default.nix) | Configure the hand-installed Rex terminal multiplexer and provide the CLI it bundles. | <code>gui</code> |
| [<code>rex.colorscheme</code>](../../abstractions/modules/rex/colorscheme/default.nix) | Generate Rex's dark theme from the held color scheme's palette; Rex selects it only once `rex-import-theme` runs. |  |
| [<code>ripgrep</code>](../../abstractions/modules/ripgrep/default.nix) | Provide ripgrep for searching file contents. |  |
| [<code>roles.colorscheme</code>](../../abstractions/modules/roles/colorscheme/default.nix) | Seat the color scheme that applications share. |  |
| [<code>roles.editor</code>](../../abstractions/modules/roles/editor/default.nix) | Seat the editor that programs open through `EDITOR`. |  |
| [<code>roles.launcher</code>](../../abstractions/modules/roles/launcher/default.nix) | Seat the one application launcher a graphical host runs. | <code>gui</code> |
| [<code>roles.login-shell</code>](../../abstractions/modules/roles/login-shell/default.nix) | Seat the user's login shell and register it with the system. |  |
| [<code>screenshots</code>](../../abstractions/modules/screenshots/default.nix) | Configure where screenshots are saved and in which format. |  |
| [<code>secrets</code>](../../abstractions/modules/secrets/default.nix) | Manage the selected encrypted secrets with nix-secrets. |  |
| [<code>security</code>](../../abstractions/modules/security/default.nix) | Configure how a person authenticates to the host: sudo, the login window, and the screen lock. |  |
| [<code>services</code>](../../abstractions/modules/services/default.nix) | Declare user services and run them under a dinit user instance that the platform's service manager starts. |  |
| [<code>skills</code>](../../abstractions/modules/agents/skills/default.nix) | Declare harness-independent skills and deploy them for agent use. |  |
| [<code>skills.ponytail</code>](../../abstractions/modules/agents/skills/ponytail/default.nix) | Deploy the Ponytail skill. |  |
| [<code>slack</code>](../../abstractions/modules/slack/default.nix) | Provide the Slack desktop app. | <code>gui</code> |
| [<code>sound</code>](../../abstractions/modules/sound/default.nix) | Configure system sounds and alert feedback. |  |
| [<code>source-files</code>](../../abstractions/modules/source-files/default.nix) | Replace whole files of packages' sources before they are built, checked against the upstream files they were written against. |  |
| [<code>spaces</code>](../../abstractions/modules/spaces/default.nix) | Configure Spaces across displays and how the desktop and its widgets are revealed. |  |
| [<code>spicetify</code>](../../abstractions/modules/spicetify/default.nix) | Provide Spotify patched by Spicetify with its extensions, and keep Spotify from updating itself. |  |
| [<code>spicetify.colorscheme</code>](../../abstractions/modules/spicetify/colorscheme/default.nix) | Give Spotify colors from the held color scheme's palette. |  |
| [<code>ssh</code>](../../abstractions/modules/ssh/default.nix) | Configure the OpenSSH client, declare the person's SSH keys and the commands sshd runs as the user at the start of each session. |  |
| [<code>ssh.keyholder</code>](../../abstractions/modules/ssh/keyholder/default.nix) | Hold the person's SSH keys in this host's Secure Enclave and lend them to the other hosts through a forwarded agent. |  |
| [<code>ssh.remote</code>](../../abstractions/modules/ssh/remote/default.nix) | Let the key holder log in to this host, and sign and push to GitHub here with the keys its forwarded agent lends. |  |
| [<code>tags</code>](../../abstractions/modules/tags/default.nix) | Enable by default the modules that carry a tag selected for the host, except candidates whose seat decides their enable. |  |
| [<code>tailscale</code>](../../abstractions/modules/tailscale/default.nix) | Join the host to the person's tailnet through Tailscale's daemon, which runs from boot without a login session. |  |
| [<code>tart</code>](../../abstractions/modules/tart/default.nix) | Provide Tart and reach each of its virtual machines over SSH by name, starting one that is not running. |  |
| [<code>trackpad</code>](../../abstractions/modules/trackpad/default.nix) | Configure pointing devices: trackpad clicking and gestures, scrolling, and pointer speed. |  |
| [<code>users</code>](../../abstractions/modules/users/default.nix) | Apply the host's declared user information to OS user configuration. |  |
| [<code>vicinae</code>](../../abstractions/modules/vicinae/default.nix) | Provide the Vicinae launcher as a login service with a stable code-signing identity. | <code>gui</code> |
| [<code>vicinae.colorscheme</code>](../../abstractions/modules/vicinae/colorscheme/default.nix) | Give Vicinae the bundled theme of the held color scheme. |  |
| [<code>vicinae.compact-transition</code>](../../abstractions/modules/vicinae/compact-transition/default.nix) | Animate the Vicinae launcher window between its compact and expanded states. |  |
| [<code>vicinae.selection-highlight</code>](../../abstractions/modules/vicinae/selection-highlight/default.nix) | Animate the Vicinae selection highlight as it moves between list items. |  |
| [<code>xdg</code>](../../abstractions/modules/xdg/default.nix) | Define the user's XDG base directories and export them to the user's environment. |  |
| [<code>zellij</code>](../../abstractions/modules/zellij/default.nix) | Provide, configure and publish the Zellij terminal multiplexer, and own its configuration file. |  |
| [<code>zellij.colorscheme</code>](../../abstractions/modules/zellij/colorscheme/default.nix) | Give Zellij the official theme of the held color scheme. |  |
| [<code>zellij.navigator</code>](../../abstractions/modules/zellij/navigator/default.nix) | Move focus across Zellij panes through vim-zellij-navigator, which leaves the keys to Neovim when it runs in the focused pane. |  |
| [<code>zoom</code>](../../abstractions/modules/zoom/default.nix) | Configure Accessibility Zoom: its mode, how it follows the pointer and focus, and the Picture-in-Picture window. |  |
| [<code>zoxide</code>](../../abstractions/modules/zoxide/default.nix) | Provide zoxide and initialize its directory navigation in Zsh. |  |
| [<code>zsh</code>](../../abstractions/modules/shell/zsh/default.nix) | Enable Zsh and provide the foundation required for its use. |  |
| [<code>zsh.interactive</code>](../../abstractions/modules/shell/zsh/interactive/default.nix) | Build Zsh's interactive environment. |  |
| [<code>zsh.interactive.zabrze</code>](../../abstractions/modules/shell/zsh/interactive/zabrze/default.nix) | Provide zabrze, expand the abbreviations features contribute in Zsh, and own its configuration file. |  |

## Interfaces

Options that other modules define, and options that modules add to other module systems, by the module that declares them.

### <code>alacritty</code>

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>alacritty.settings</code> | <code>TOML value</code> | <code>{ }</code> | Settings written to the alacritty configuration file. |

### <code>bat</code>

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>bat.settings</code> | <code>attribute set of (true or string)</code> | <code>{ }</code> | Command-line options written to bat's configuration file, by long name without `--`; `true` writes an option without a value. |

### <code>claude-code</code>

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>claude-code.settings</code> | <code>JSON value</code> | <code>{ }</code> | Settings written to the user's Claude Code settings file. |

### <code>defaults</code>

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>platform.darwin.defaults</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Hjem-owned user defaults, by preferences domain; removing a declaration restores the value it had before it was declared. |
| <code>platform.darwin.defaults.&lt;name&gt;.onChange.activateSettings</code> | <code>boolean</code> | <code>false</code> | Whether to run `activateSettings -u`, which applies some system settings, such as keyboard shortcuts, without logging out. |
| <code>platform.darwin.defaults.&lt;name&gt;.onChange.restartProcesses</code> | <code>list of (one of "ControlCenter", "Dock", "Finder", "NotificationCenter", "SystemUIServer", "WindowManager")</code> | <code>[ ]</code> | System processes that launchd relaunches, killed so that they read the new values. |
| <code>platform.darwin.defaults.&lt;name&gt;.onChange.restartServices</code> | <code>list of string</code> | <code>[ ]</code> | Names of `userServices` to restart. |
| <code>platform.darwin.defaults.&lt;name&gt;.settings</code> | <code>attribute set of anything</code> | <code>{ }</code> | Values of the domain; each leaf of a nested attribute set is declared at its key path, leaving undeclared keys of the dictionaries along it in place, and a list or other value is written whole. |

### <code>elio</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>elio.theme</code> | <code>submodule</code> | <code>{ }</code> | Tables of elio's `theme.toml`, overriding elio's built-in theme; with every table empty, no file is written. |
| <code>elio.theme.classes</code> | <code>attribute set of attribute set of (TOML value)</code> | <code>{ }</code> |  |
| <code>elio.theme.directories</code> | <code>attribute set of attribute set of (TOML value)</code> | <code>{ }</code> |  |
| <code>elio.theme.extensions</code> | <code>attribute set of attribute set of (TOML value)</code> | <code>{ }</code> |  |
| <code>elio.theme.files</code> | <code>attribute set of attribute set of (TOML value)</code> | <code>{ }</code> |  |
| <code>elio.theme.focused_entry</code> | <code>attribute set of (TOML value)</code> | <code>{ }</code> |  |
| <code>elio.theme.palette</code> | <code>attribute set of (TOML value)</code> | <code>{ }</code> |  |
| <code>elio.theme.preview</code> | <code>attribute set of attribute set of (TOML value)</code> | <code>{ }</code> |  |

### <code>exclusive</code>

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

### <code>ghostty</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>ghostty.settings</code> | <code>attribute set of (atom (null, bool, int, float or string) or a list of them for duplicate keys)</code> | <code>{ }</code> | Settings written to the Ghostty configuration file; a list repeats its key once per element. |

### <code>git</code>

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>git.ignore</code> | <code>list of string</code> | <code>[ ]</code> | Patterns of the user's global Git ignore file. |
| <code>git.settings</code> | <code>attribute set of attribute set of (INI atom (null, bool, int, float or string) or a list of them for duplicate keys or attribute set of (INI atom (null, bool, int, float or string) or a list of them for duplicate keys))</code> | <code>{ }</code> | Settings written to the user's Git configuration file. |

### <code>imprynt</code>

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>imprynt.deployments</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Independent real-file deployments, named by safe single path components. Removing an entry removes the files it installed. |
| <code>imprynt.deployments.&lt;name&gt;.files</code> | <code>list of (submodule)</code> | <code>[ ]</code> | Explicit source files and their root-relative destinations. |
| <code>imprynt.deployments.&lt;name&gt;.files.*.mode</code> | <code>integer between 0 and 511 (both inclusive)</code> | <code>420</code> | POSIX permission bits, as an integer (420 is 0644). |
| <code>imprynt.deployments.&lt;name&gt;.files.*.path</code> | <code>relative destination path without empty, dot or parent components</code> |  | Destination relative to the managed root. |
| <code>imprynt.deployments.&lt;name&gt;.files.*.source</code> | <code>absolute path</code> |  | Source file; symlinks are followed and materialized as regular files. |
| <code>imprynt.deployments.&lt;name&gt;.root</code> | <code>absolute path</code> |  | Absolute destination root, resolved and recorded by imprynt. |
| <code>imprynt.deployments.&lt;name&gt;.trees</code> | <code>list of (submodule)</code> | <code>[ ]</code> | Source trees enumerated at build time, preserving relative file paths below each prefix. |
| <code>imprynt.deployments.&lt;name&gt;.trees.*.extensions</code> | <code>null or (list of string)</code> | <code>null</code> | Included last filename extensions, with leading dots, compared ignoring case; null includes every regular file. |
| <code>imprynt.deployments.&lt;name&gt;.trees.*.mode</code> | <code>integer between 0 and 511 (both inclusive)</code> | <code>420</code> | POSIX permission bits, as an integer (420 is 0644). |
| <code>imprynt.deployments.&lt;name&gt;.trees.*.prefix</code> | <code>string</code> | <code>""</code> | Relative destination prefix; empty places the tree directly below the managed root. |
| <code>imprynt.deployments.&lt;name&gt;.trees.*.source</code> | <code>absolute path</code> |  | Source directory enumerated during the manifest build. |

### <code>kanata</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>kanata.layers</code> | <code>attribute set of attribute set of Kanata expression (atom string without whitespace, parentheses or quotes; integer; or list of expressions)</code> | <code>{ }</code> | Actions by layer and key name. |

### <code>mcp</code>

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>mcp.selected</code> | <code>attribute set of attribute set of (submodule)</code> |  | read-only; The registered servers each consumer selected, by consumer. |
| <code>mcp.selected.&lt;name&gt;.&lt;name&gt;.args</code> | <code>list of string</code> | <code>[ ]</code> |  |
| <code>mcp.selected.&lt;name&gt;.&lt;name&gt;.command</code> | <code>string</code> |  |  |
| <code>mcp.selected.&lt;name&gt;.&lt;name&gt;.env</code> | <code>attribute set of string</code> | <code>{ }</code> |  |
| <code>mcp.selections</code> | <code>attribute set of list of string</code> | <code>{ }</code> | Names of registered servers each consumer selects, by consumer. |
| <code>mcp.servers</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | stdio MCP servers by name. Registering a server does not start it or select it for a consumer. |
| <code>mcp.servers.&lt;name&gt;.args</code> | <code>list of string</code> | <code>[ ]</code> |  |
| <code>mcp.servers.&lt;name&gt;.command</code> | <code>string</code> |  |  |
| <code>mcp.servers.&lt;name&gt;.env</code> | <code>attribute set of string</code> | <code>{ }</code> |  |

### <code>neovim</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>neovim.settings</code> | <code>submodule</code> | <code>{ }</code> | mnw configuration that builds the Neovim package. Each feature module contributes its plugins and its own Lua runtime directory. |
| <code>neovim.snacks</code> | <code>attribute set of (JSON value)</code> | <code>{ }</code> | Snacks setup options contributed by features; the parent installs and configures the shared plugin once. |
| <code>neovim.snacksDependencies</code> | <code>list of package</code> | <code>[ ]</code> | collects every source's definitions; Plugin dependencies requested by Snacks features. |

### <code>neovim.treesitter</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>neovim.treesitter.registrations</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Language-owned contributions; disabling this backend ignores all contributions. |
| <code>neovim.treesitter.registrations.&lt;name&gt;.filetypes</code> | <code>attribute set of string</code> | <code>{ }</code> | Neovim filetype to Tree-sitter parser-name mapping. |
| <code>neovim.treesitter.registrations.&lt;name&gt;.grammars</code> | <code>list of package</code> | <code>[ ]</code> | Parser packages, including any auxiliary parsers needed by this language. |
| <code>neovim.treesitter.registrations.&lt;name&gt;.highlight</code> | <code>boolean</code> | <code>true</code> |  |
| <code>neovim.treesitter.registrations.&lt;name&gt;.indent</code> | <code>boolean</code> | <code>true</code> |  |

### <code>nix-secrets</code>

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>security.nix-secrets.activateScript</code> | <code>absolute path</code> |  | read-only; Darwin activation command, serialized with every other trigger that runs it. |

### <code>omniwm</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>omniwm.settings</code> | <code>attribute set of (TOML value)</code> | <code>{ }</code> | Settings layered over the pinned OmniWM defaults; hotkeys are merged by id. The switch reapplies them to the writable settings file. |

### <code>pi</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>pi.extensions</code> | <code>list of string</code> | <code>[ ]</code> | collects every source's definitions; Absolute paths of the extension entries Pi loads; the published bundle has only the modules' entries. |

### <code>secrets</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>secrets.required</code> | <code>list of (one of "ai-mop-api-key", "brave-api-key", "brave-free-api-key", "cohere-api-key", "command-code-api-key", "discord-bot-token", "exa-api-key", "github-read-token", "iniad-gitconfig", "mistral-api-key", "opencode-api-key", "openrouter-api-key", "parallel-api-key", "vercel-ai-gateway-api-key", "zai-api-key")</code> | <code>[ ]</code> | collects every source's definitions; Secrets that modules decrypt for the user whatever `names` selects. |

### <code>services</code>

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>serviceManager.label</code> | <code>string matching the pattern [A-Za-z0-9][A-Za-z0-9._-]*</code> | <code>"org.hjem.dinit"</code> | Label of the LaunchAgent that starts dinit; it also names the agent's plist file. |
| <code>serviceManager.restart</code> | <code>absolute path</code> |  | read-only; Command restarting the service it names when that service is started; it exits 0 when done or not started, and 75 when dinit is not running. |
| <code>serviceManager.socket</code> | <code>string</code> |  | read-only; Control socket of the dinit instance. |
| <code>userServices</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Hjem-owned user services run by dinit, by service name. macOS attributes their processes to dinit, so a permission one needs, such as Accessibility, is granted to dinit (`io.github.davmac314.dinit`). |
| <code>userServices.&lt;name&gt;.after</code> | <code>list of string</code> | <code>[ ]</code> | Services this one waits for when both are starting, without starting them. |
| <code>userServices.&lt;name&gt;.before</code> | <code>list of string</code> | <code>[ ]</code> | Services that wait for this one when both are starting, without starting it. |
| <code>userServices.&lt;name&gt;.command</code> | <code>null or (list of string)</code> | <code>null</code> | Argv with an absolute executable, required unless `type` is internal; no shell expansion or variable substitution. |
| <code>userServices.&lt;name&gt;.dependsOn</code> | <code>list of string</code> | <code>[ ]</code> | Services that must start before this one; stopping one stops this one. |
| <code>userServices.&lt;name&gt;.environment</code> | <code>attribute set of string</code> | <code>{ }</code> | Variables added to the environment dinit passes on; values are literal. |
| <code>userServices.&lt;name&gt;.logFile</code> | <code>null or string</code> | <code>null</code> | File receiving the service's standard output and error. |
| <code>userServices.&lt;name&gt;.memberOf</code> | <code>list of string</code> | <code>[<br>  "login"<br>]</code> | Groups that wait for this service when they start; `[]` leaves it to manual start. |
| <code>userServices.&lt;name&gt;.restart</code> | <code>one of "always", "on-failure", "never"</code> | <code>"on-failure"</code> | When dinit starts the service again after it stops other than by request; on-failure applies only to processes and means never for other types. |
| <code>userServices.&lt;name&gt;.restartOnSwitch</code> | <code>boolean</code> | <code>false</code> | Rerun on every switch: restart when started, otherwise start when `login` reaches it. |
| <code>userServices.&lt;name&gt;.type</code> | <code>one of "process", "scripted", "internal"</code> | <code>"process"</code> | A process runs until it exits; a scripted service is started when its command has succeeded; an internal service runs nothing and groups its dependencies. |
| <code>userServices.&lt;name&gt;.waitsFor</code> | <code>list of string</code> | <code>[ ]</code> | Services started with this one and waited for, whose failure does not prevent it. |
| <code>userServices.&lt;name&gt;.workingDirectory</code> | <code>null or string</code> | <code>null</code> |  |

### <code>skills</code>

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>skillDirs</code> | <code>list of home-relative directory without empty, '.' or '..' components</code> | <code>[ ]</code> | Directories in which every skill is linked under its name; a harness adds the directories it reads. |
| <code>skills</code> | <code>attribute set of path named by single directory names other than '.' or '..'</code> | <code>{ }</code> | Source directories of complete skill packages, by skill name. |

### <code>source-files</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>source-files.sources</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Packages whose sources features patch, by name, with the files replaced in each. |
| <code>source-files.sources.&lt;name&gt;.files</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Files of `package`'s source replaced before it is built, keyed by their path relative to the source root. Each path may be replaced by one definition only. |
| <code>source-files.sources.&lt;name&gt;.files.&lt;name&gt;.source</code> | <code>absolute path</code> |  | File that replaces the upstream one. |
| <code>source-files.sources.&lt;name&gt;.files.&lt;name&gt;.upstreamSha256</code> | <code>string matching the pattern [0-9a-f]{64}</code> |  | Hex SHA-256 of the upstream file being replaced; a build whose source holds a different file fails, so upstream changes are merged rather than overwritten. |
| <code>source-files.sources.&lt;name&gt;.package</code> | <code>package</code> | <code>null</code> |  |

### <code>ssh</code>

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>ssh.defaults</code> | <code>attribute set of (boolean or signed integer or string or list of (boolean or signed integer or string))</code> | <code>{ }</code> | SSH client parameters for every host; `ssh.hosts` states how a host's own parameters combine with them. |
| <code>ssh.hosts</code> | <code>attribute set of SSH parameters named by literal host names, without patterns, negation, lists or whitespace</code> | <code>{ }</code> | SSH client parameters by literal host name. A parameter set here takes precedence over `ssh.defaults`; the values of a cumulative parameter such as `IdentityFile` are tried before those of `ssh.defaults`. `true` and `false` render as `yes` and `no`, and a list repeats its parameter. |
| <code>ssh.matches</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | `Match` blocks by name. They precede every block of `ssh.hosts` and `ssh.defaults`, so a parameter they set wins over those, and a cumulative one such as `RemoteForward` is added to theirs. Their order among themselves is unspecified, so two of them do not set the same single-valued parameter. |
| <code>ssh.matches.&lt;name&gt;.criteria</code> | <code>string</code> |  | Criteria of the `Match` line, written as ssh_config(5) reads them. |
| <code>ssh.matches.&lt;name&gt;.parameters</code> | <code>attribute set of (boolean or signed integer or string or list of (boolean or signed integer or string))</code> | <code>{ }</code> | Parameters applied when the criteria hold, rendered as in `ssh.hosts`. |
| <code>ssh.rc</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Fragments of `~/.ssh/rc`, which sshd runs with /bin/sh before the shell or command of every session of this user, whatever the login shell. sshd sends the file's standard output to the client, where it corrupts protocols such as scp and sftp, so a fragment writes nothing there; it also reads nothing from standard input. Without fragments the file is not written. |
| <code>ssh.rc.&lt;name&gt;.after</code> | <code>list of string</code> | <code>[ ]</code> | Fragments that must precede this one. |
| <code>ssh.rc.&lt;name&gt;.before</code> | <code>list of string</code> | <code>[ ]</code> | Fragments that must follow this one. |
| <code>ssh.rc.&lt;name&gt;.text</code> | <code>string</code> |  | Text of the fragment. |

### <code>vicinae</code>

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>vicinae.settings</code> | <code>JSON value</code> | <code>{ }</code> | Settings layered over Vicinae's own settings.json through VICINAE_OVERRIDES; keys set here take precedence over changes made in the app. |

### <code>zellij</code>

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>zellij.keybinds</code> | <code>submodule</code> | <code>{ }</code> | Actions bound by mode and key, replacing Zellij's default keybindings; `shared` binds in every mode, and `null` leaves a key unbound. An action is an attribute set of one action name to its arguments, or to `args` and `children` for an action with a block. |
| <code>zellij.keybinds.entersearch</code> | <code>attribute set of (null or (list of Zellij action))</code> | <code>{ }</code> |  |
| <code>zellij.keybinds.locked</code> | <code>attribute set of (null or (list of Zellij action))</code> | <code>{ }</code> |  |
| <code>zellij.keybinds.move</code> | <code>attribute set of (null or (list of Zellij action))</code> | <code>{ }</code> |  |
| <code>zellij.keybinds.normal</code> | <code>attribute set of (null or (list of Zellij action))</code> | <code>{ }</code> |  |
| <code>zellij.keybinds.pane</code> | <code>attribute set of (null or (list of Zellij action))</code> | <code>{ }</code> |  |
| <code>zellij.keybinds.prompt</code> | <code>attribute set of (null or (list of Zellij action))</code> | <code>{ }</code> |  |
| <code>zellij.keybinds.renamepane</code> | <code>attribute set of (null or (list of Zellij action))</code> | <code>{ }</code> |  |
| <code>zellij.keybinds.renametab</code> | <code>attribute set of (null or (list of Zellij action))</code> | <code>{ }</code> |  |
| <code>zellij.keybinds.resize</code> | <code>attribute set of (null or (list of Zellij action))</code> | <code>{ }</code> |  |
| <code>zellij.keybinds.scroll</code> | <code>attribute set of (null or (list of Zellij action))</code> | <code>{ }</code> |  |
| <code>zellij.keybinds.search</code> | <code>attribute set of (null or (list of Zellij action))</code> | <code>{ }</code> |  |
| <code>zellij.keybinds.session</code> | <code>attribute set of (null or (list of Zellij action))</code> | <code>{ }</code> |  |
| <code>zellij.keybinds.shared</code> | <code>attribute set of (null or (list of Zellij action))</code> | <code>{ }</code> |  |
| <code>zellij.keybinds.tab</code> | <code>attribute set of (null or (list of Zellij action))</code> | <code>{ }</code> |  |
| <code>zellij.keybinds.tmux</code> | <code>attribute set of (null or (list of Zellij action))</code> | <code>{ }</code> |  |
| <code>zellij.settings</code> | <code>attribute set of (KDL node: arguments, or an attribute set of child nodes)</code> | <code>{ }</code> | Top-level nodes of Zellij's `config.kdl` other than `keybinds`; a list repeats the node's arguments. |

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>zellij.pluginPermissions</code> | <code>attribute set of list of (one of "ReadApplicationState", "ChangeApplicationState", "OpenFiles", "RunCommands", "OpenTerminalsOrPlugins", "WriteToStdin", "WebAccess", "ReadCliPipes", "MessageAndLaunchOtherPlugins", "Reconfigure", "FullHdAccess", "StartWebServer", "InterceptInput", "ReadPaneContents", "RunActionsAsUser", "WriteToClipboard", "ReadSessionEnvironmentVariables")</code> | <code>{ }</code> | Permissions granted to plugins, by the absolute path of the plugin's wasm file. When any are declared, they replace Zellij's permission cache, which Zellij can then no longer write, so a plugin that is not declared asks for its permissions in every session. |

### <code>zsh</code>

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>zsh.zshenv</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Fragments rendered in dependency order. |
| <code>zsh.zshenv.&lt;name&gt;.after</code> | <code>list of string</code> | <code>[ ]</code> | Fragments that must precede this one. |
| <code>zsh.zshenv.&lt;name&gt;.before</code> | <code>list of string</code> | <code>[ ]</code> | Fragments that must follow this one. |
| <code>zsh.zshenv.&lt;name&gt;.text</code> | <code>string</code> |  | Text of the fragment. |

### <code>zsh.interactive</code>

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>zsh.zshrc</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | Fragments rendered in dependency order. |
| <code>zsh.zshrc.&lt;name&gt;.after</code> | <code>list of string</code> | <code>[ ]</code> | Fragments that must precede this one. |
| <code>zsh.zshrc.&lt;name&gt;.before</code> | <code>list of string</code> | <code>[ ]</code> | Fragments that must follow this one. |
| <code>zsh.zshrc.&lt;name&gt;.text</code> | <code>string</code> |  | Text of the fragment. |

### <code>zsh.interactive.zabrze</code>

<code>hjem</code> options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| <code>zsh.zabrze.snippets</code> | <code>attribute set of (submodule)</code> | <code>{ }</code> | zabrze snippets by name. Of snippets sharing a trigger, those with `if` are tried first. |
| <code>zsh.zabrze.snippets.&lt;name&gt;.abort-on-error</code> | <code>null or boolean</code> | <code>null</code> | Whether an evaluated snippet whose command fails aborts the expansion. |
| <code>zsh.zabrze.snippets.&lt;name&gt;.context</code> | <code>null or string</code> | <code>null</code> | Regular expression that the current command must match, including the trigger. The current command is the line after its last `;`, `&amp;`, `&#124;`, `(` or backquote. |
| <code>zsh.zabrze.snippets.&lt;name&gt;.cursor</code> | <code>null or string</code> | <code>null</code> | Marker in the snippet where the cursor is placed after expansion. |
| <code>zsh.zabrze.snippets.&lt;name&gt;.evaluate</code> | <code>null or boolean</code> | <code>null</code> | Whether the snippet is evaluated by the shell before insertion. |
| <code>zsh.zabrze.snippets.&lt;name&gt;.global</code> | <code>null or boolean</code> | <code>null</code> | Whether the snippet also expands as an argument, not only as the command. |
| <code>zsh.zabrze.snippets.&lt;name&gt;."if"</code> | <code>null or string</code> | <code>null</code> | Zsh condition under which the snippet expands. |
| <code>zsh.zabrze.snippets.&lt;name&gt;.snippet</code> | <code>string</code> |  | Text that replaces the trigger. |
| <code>zsh.zabrze.snippets.&lt;name&gt;.trigger</code> | <code>null or string</code> | <code>null</code> | Word that expands. Exactly one of `trigger` and `trigger-pattern` is set. |
| <code>zsh.zabrze.snippets.&lt;name&gt;.trigger-pattern</code> | <code>null or string</code> | <code>null</code> | Regular expression matching the word that expands. |

## Library

Functions and values that modules use from `mylib` and `delib`, documented where they are defined.

| Function | Defined in |
| --- | --- |
| <code>delib.role</code> | [<code>lib/roles.nix</code>](../../lib/roles.nix) |
| <code>mylib.accumulatingOption</code> | [<code>lib/sources.nix</code>](../../lib/sources.nix) |
| <code>mylib.anchors.flakes</code> | [<code>lib/anchors.nix</code>](../../lib/anchors.nix) |
| <code>mylib.anchors.sources</code> | [<code>lib/anchors.nix</code>](../../lib/anchors.nix) |
| <code>mylib.assertions.failed</code> | [<code>lib/assertions.nix</code>](../../lib/assertions.nix) |
| <code>mylib.atomicOption</code> | [<code>lib/sources.nix</code>](../../lib/sources.nix) |
| <code>mylib.colorschemes.ghosttyTheme</code> | [<code>lib/colorschemes.nix</code>](../../lib/colorschemes.nix) |
| <code>mylib.colorschemes.palette</code> | [<code>lib/colorschemes.nix</code>](../../lib/colorschemes.nix) |
| <code>mylib.colorschemes.scheme</code> | [<code>lib/colorschemes.nix</code>](../../lib/colorschemes.nix) |
| <code>mylib.fragments.option</code> | [<code>lib/fragments.nix</code>](../../lib/fragments.nix) |
| <code>mylib.fragments.render</code> | [<code>lib/fragments.nix</code>](../../lib/fragments.nix) |
| <code>mylib.plist.toPlist</code> | [<code>lib/plist.nix</code>](../../lib/plist.nix) |
| <code>mylib.plist.validValue</code> | [<code>lib/plist.nix</code>](../../lib/plist.nix) |
| <code>mylib.plist.validXml</code> | [<code>lib/plist.nix</code>](../../lib/plist.nix) |
| <code>mylib.plist.xmlString</code> | [<code>lib/plist.nix</code>](../../lib/plist.nix) |
| <code>mylib.rice</code> | [<code>lib/rices.nix</code>](../../lib/rices.nix) |
| <code>mylib.schemeThemes</code> | [<code>lib/scheme-themes.nix</code>](../../lib/scheme-themes.nix) |
| <code>mylib.sources.priorities</code> | [<code>lib/sources.nix</code>](../../lib/sources.nix) |
| <code>mylib.sources.prioritize</code> | [<code>lib/sources.nix</code>](../../lib/sources.nix) |
