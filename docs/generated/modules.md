# Modules

Generated from Denix module metadata. Do not edit; run `just docs`.

| Module | Description | Source |
| --- | --- | --- |
| <code>agents</code> | Provide a shared configuration interface for LLM agents and configure the selected agent packages. | [<code>abstractions/modules/agents/default.nix</code>](../../abstractions/modules/agents/default.nix) |
| <code>alacritty</code> | Provide Alacritty terminal emulator. | [<code>abstractions/modules/alacritty/default.nix</code>](../../abstractions/modules/alacritty/default.nix) |
| <code>app-identity</code> | Expose nix-mac-app-identity helpers that give Nix-built macOS programs a code-signing identity surviving rebuilds. | [<code>abstractions/modules/app-identity/default.nix</code>](../../abstractions/modules/app-identity/default.nix) |
| <code>appcleaner</code> | Provide AppCleaner. | [<code>abstractions/modules/appcleaner/default.nix</code>](../../abstractions/modules/appcleaner/default.nix) |
| <code>appearance</code> | Configure the system's visual appearance: color scheme, menu bar, and menu bar clock. | [<code>abstractions/modules/appearance/default.nix</code>](../../abstractions/modules/appearance/default.nix) |
| <code>assertions</code> | Enforce module-contributed assertions across module systems. | [<code>abstractions/modules/assertions/default.nix</code>](../../abstractions/modules/assertions/default.nix) |
| <code>bat</code> | Provide and configure bat for file display. | [<code>abstractions/modules/bat/default.nix</code>](../../abstractions/modules/bat/default.nix) |
| <code>batman</code> | Provide batman and configure it as Zsh's manual page pager. | [<code>abstractions/modules/bat/batman/default.nix</code>](../../abstractions/modules/bat/batman/default.nix) |
| <code>bettertouchtool</code> | Provide BetterTouchTool. | [<code>abstractions/modules/bettertouchtool/default.nix</code>](../../abstractions/modules/bettertouchtool/default.nix) |
| <code>casks</code> | Expose Homebrew casks, packaged by cask2nix from the official and third-party taps, to modules. | [<code>abstractions/modules/casks/default.nix</code>](../../abstractions/modules/casks/default.nix) |
| <code>claude-code</code> | Provide and configure Claude Code. | [<code>abstractions/modules/agents/claude-code/default.nix</code>](../../abstractions/modules/agents/claude-code/default.nix) |
| <code>cursor-agent</code> | Provide the Cursor Agent CLI. | [<code>abstractions/modules/agents/cursor-agent/default.nix</code>](../../abstractions/modules/agents/cursor-agent/default.nix) |
| <code>direnv</code> | Provide and configure direnv, including its Zsh integration. | [<code>abstractions/modules/direnv/default.nix</code>](../../abstractions/modules/direnv/default.nix) |
| <code>dock</code> | Configure the Dock and the actions of screen hot corners. | [<code>abstractions/modules/dock/default.nix</code>](../../abstractions/modules/dock/default.nix) |
| <code>eza</code> | Provide eza for listing files and directories. | [<code>abstractions/modules/eza/default.nix</code>](../../abstractions/modules/eza/default.nix) |
| <code>fd</code> | Provide fd for finding files and directories. | [<code>abstractions/modules/fd/default.nix</code>](../../abstractions/modules/fd/default.nix) |
| <code>files</code> | Configure how the Finder and file dialogs present files, and what the Finder writes to other volumes. | [<code>abstractions/modules/files/default.nix</code>](../../abstractions/modules/files/default.nix) |
| <code>fzf</code> | Provide and configure fzf, including its Zsh integration. | [<code>abstractions/modules/fzf/default.nix</code>](../../abstractions/modules/fzf/default.nix) |
| <code>gh</code> | Provide the GitHub CLI. | [<code>abstractions/modules/gh/default.nix</code>](../../abstractions/modules/gh/default.nix) |
| <code>ghostty</code> | Provide Ghostty terminal emulator. | [<code>abstractions/modules/ghostty/default.nix</code>](../../abstractions/modules/ghostty/default.nix) |
| <code>git</code> | Provide Git and configure the user's Git environment. | [<code>abstractions/modules/git/default.nix</code>](../../abstractions/modules/git/default.nix) |
| <code>git.include</code> | Configure Git settings through includes. | [<code>abstractions/modules/git/include/default.nix</code>](../../abstractions/modules/git/include/default.nix) |
| <code>gomi</code> | Provide gomi and integrate it into Zsh. | [<code>abstractions/modules/gomi/default.nix</code>](../../abstractions/modules/gomi/default.nix) |
| <code>grok-bot</code> | Provide the Grok-bot desktop app. | [<code>abstractions/modules/grok-bot/default.nix</code>](../../abstractions/modules/grok-bot/default.nix) |
| <code>host</code> | Expose the selected host's information to modules and reflect its identity in OS host names. | [<code>abstractions/modules/host/default.nix</code>](../../abstractions/modules/host/default.nix) |
| <code>identity</code> | Expose the fixed identity of the person who uses these hosts. | [<code>abstractions/modules/identity/default.nix</code>](../../abstractions/modules/identity/default.nix) |
| <code>keyboard</code> | Configure system-wide keyboard behavior: key repeat, text substitutions, function keys, and system shortcuts. | [<code>abstractions/modules/keyboard/default.nix</code>](../../abstractions/modules/keyboard/default.nix) |
| <code>locale</code> | Configure the languages and region used by the system and applications. | [<code>abstractions/modules/locale/default.nix</code>](../../abstractions/modules/locale/default.nix) |
| <code>neovim</code> | Provide and configure neovim | [<code>abstractions/modules/neovim/default.nix</code>](../../abstractions/modules/neovim/default.nix) |
| <code>neovim.completion</code> | Provide insert-mode and command-line completion in Neovim. | [<code>abstractions/modules/neovim/completion/default.nix</code>](../../abstractions/modules/neovim/completion/default.nix) |
| <code>neovim.diagnostic</code> | Display diagnostics in Neovim buffers. | [<code>abstractions/modules/neovim/diagnostic/default.nix</code>](../../abstractions/modules/neovim/diagnostic/default.nix) |
| <code>neovim.lsp</code> | Connect Neovim to language servers and format buffers through them. | [<code>abstractions/modules/neovim/lsp/default.nix</code>](../../abstractions/modules/neovim/lsp/default.nix) |
| <code>nh</code> | Provide nh for package and option searches. | [<code>abstractions/modules/nh/default.nix</code>](../../abstractions/modules/nh/default.nix) |
| <code>nix</code> | Configure Nix itself. | [<code>abstractions/modules/nix/default.nix</code>](../../abstractions/modules/nix/default.nix) |
| <code>nixpkgs</code> | Configure Nixpkgs for the host. | [<code>abstractions/modules/nixpkgs/default.nix</code>](../../abstractions/modules/nixpkgs/default.nix) |
| <code>notion</code> | Provide the Notion desktop app. | [<code>abstractions/modules/notion/default.nix</code>](../../abstractions/modules/notion/default.nix) |
| <code>pay-respects</code> | Provide command typo recovery with pay-respects. | [<code>abstractions/modules/pay-respects/default.nix</code>](../../abstractions/modules/pay-respects/default.nix) |
| <code>pay-respects.disrespectful</code> | Replace command typo recovery with a playful response. | [<code>abstractions/modules/pay-respects/disrespectful/default.nix</code>](../../abstractions/modules/pay-respects/disrespectful/default.nix) |
| <code>phi</code> | Provide the Phi browser. | [<code>abstractions/modules/phi/default.nix</code>](../../abstractions/modules/phi/default.nix) |
| <code>privacy</code> | Limit what the system shares and what it opens without being asked. | [<code>abstractions/modules/privacy/default.nix</code>](../../abstractions/modules/privacy/default.nix) |
| <code>publication</code> | Centralize publication choices for feature-owned bundles. | [<code>abstractions/modules/publication/default.nix</code>](../../abstractions/modules/publication/default.nix) |
| <code>ripgrep</code> | Provide ripgrep for searching file contents. | [<code>abstractions/modules/ripgrep/default.nix</code>](../../abstractions/modules/ripgrep/default.nix) |
| <code>screenshots</code> | Configure where screenshots are saved and in which format. | [<code>abstractions/modules/screenshots/default.nix</code>](../../abstractions/modules/screenshots/default.nix) |
| <code>secrets</code> | Manage the selected encrypted secrets with nix-secrets. | [<code>abstractions/modules/secrets/default.nix</code>](../../abstractions/modules/secrets/default.nix) |
| <code>security</code> | Configure how a person authenticates to the host: sudo, the login window, and the screen lock. | [<code>abstractions/modules/security/default.nix</code>](../../abstractions/modules/security/default.nix) |
| <code>shell</code> | Define a shared configuration interface for shells and configure the selected login shell. | [<code>abstractions/modules/shell/default.nix</code>](../../abstractions/modules/shell/default.nix) |
| <code>shield</code> | Provide the SHIELD process hub and the keel agent screens it attaches. | [<code>abstractions/modules/agents/shield/default.nix</code>](../../abstractions/modules/agents/shield/default.nix) |
| <code>skills</code> | Declare harness-independent skills and deploy them for agent use. | [<code>abstractions/modules/agents/skills/default.nix</code>](../../abstractions/modules/agents/skills/default.nix) |
| <code>slack</code> | Provide the Slack desktop app. | [<code>abstractions/modules/slack/default.nix</code>](../../abstractions/modules/slack/default.nix) |
| <code>sound</code> | Configure system sounds and alert feedback. | [<code>abstractions/modules/sound/default.nix</code>](../../abstractions/modules/sound/default.nix) |
| <code>spaces</code> | Configure Spaces across displays and how the desktop and its widgets are revealed. | [<code>abstractions/modules/spaces/default.nix</code>](../../abstractions/modules/spaces/default.nix) |
| <code>ssh</code> | Configure the OpenSSH client and the user's personal key. | [<code>abstractions/modules/ssh/default.nix</code>](../../abstractions/modules/ssh/default.nix) |
| <code>tags</code> | Enable by default the modules that carry a tag selected for the host. | [<code>abstractions/modules/tags/default.nix</code>](../../abstractions/modules/tags/default.nix) |
| <code>trackpad</code> | Configure pointing devices: trackpad clicking and gestures, scrolling, and pointer speed. | [<code>abstractions/modules/trackpad/default.nix</code>](../../abstractions/modules/trackpad/default.nix) |
| <code>users</code> | Apply the host's declared user information to OS user configuration. | [<code>abstractions/modules/users/default.nix</code>](../../abstractions/modules/users/default.nix) |
| <code>vicinae</code> | Provide the Vicinae launcher as a login service with a stable code-signing identity. | [<code>abstractions/modules/vicinae/default.nix</code>](../../abstractions/modules/vicinae/default.nix) |
| <code>vicinae.compact-transition</code> | Animate the Vicinae launcher window between its compact and expanded states. | [<code>abstractions/modules/vicinae/compact-transition/default.nix</code>](../../abstractions/modules/vicinae/compact-transition/default.nix) |
| <code>vicinae.selection-highlight</code> | Animate the Vicinae selection highlight as it moves between list items. | [<code>abstractions/modules/vicinae/selection-highlight/default.nix</code>](../../abstractions/modules/vicinae/selection-highlight/default.nix) |
| <code>xdg</code> | Define the user's XDG base directories and export them to the user's environment. | [<code>abstractions/modules/xdg/default.nix</code>](../../abstractions/modules/xdg/default.nix) |
| <code>zoom</code> | Configure Accessibility Zoom: its mode, how it follows the pointer and focus, and the Picture-in-Picture window. | [<code>abstractions/modules/zoom/default.nix</code>](../../abstractions/modules/zoom/default.nix) |
| <code>zoxide</code> | Provide zoxide and initialize its directory navigation in Zsh. | [<code>abstractions/modules/zoxide/default.nix</code>](../../abstractions/modules/zoxide/default.nix) |
| <code>zsh</code> | Enable Zsh and provide the foundation required for its use. | [<code>abstractions/modules/shell/zsh/default.nix</code>](../../abstractions/modules/shell/zsh/default.nix) |
| <code>zsh.interactive</code> | Build Zsh's interactive environment. | [<code>abstractions/modules/shell/zsh/interactive/default.nix</code>](../../abstractions/modules/shell/zsh/interactive/default.nix) |
| <code>zsh.login</code> | Configure the behavior required to use Zsh as a login shell. | [<code>abstractions/modules/shell/zsh/login/default.nix</code>](../../abstractions/modules/shell/zsh/login/default.nix) |
