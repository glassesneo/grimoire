# Neovim Agent Guidance

This file owns agent work rules for the `neovim` module, its feature submodules, and their Lua configuration.

## Adding features

- Whether a feature uses a Neovim built-in or a plugin is the user's decision. Before implementing one, compare what the built-ins of the packaged Neovim provide against the candidate plugin, feature by feature, and let the user choose.
- Language servers and formatters come from the project's environment and are not added to the wrapper. Add one to `extraBinPath` only when the user decides it must work outside project shells.
- Formatting goes through the language server. Configure a server to call an external formatter rather than adding a separate formatter plugin.

## Feature modules

- Each feature is a submodule `neovim.<feature>` in `<feature>/`. It contributes its plugins and tools to `myconfig.neovim.settings` and registers its own `<feature>/config` as an mnw dev plugin, so enabling or disabling it adds or removes the whole feature.
- A feature works whether or not its siblings are enabled. Its Lua refers only to its own plugins and Neovim built-ins.
- Do not depend on the load order of `plugin/` files, and do not prefix file names with numbers to force one. Prefer APIs that resolve at use time, such as `vim.lsp.config` or autocommands. Code used by several features goes in the parent's `config/lua/grimoire/<name>.lua` and is `require`d where it is used.
- A partial override of an nvim-lspconfig definition goes in `<feature>/config/after/lsp/<name>.lua`. A server defined entirely in this repository goes in `<feature>/config/lsp/<name>.lua`.

## Verification

`nvim` on `PATH` may run a different configuration. Exercise this module with `nix run .#neovim.devMode`, which reads each `config/` directory from the working tree; changes to `default.nix` files need a rebuild. Behavior that needs an interactive UI, such as menus and inline rendering, remains unverified in headless runs; report it as such.
