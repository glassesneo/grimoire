{
  delib,
  lib,
  ...
}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "neovim.languages.rust";
  tests.fixture = ["neovim.languages" "neovim.treesitter"];
  meta.description = "Configure Rust editing support in Neovim.";

  options = with delib; {
    enable = boolOption true;
    treesitter = {
      enable = boolOption true;
      highlight = boolOption true;
      indent = boolOption true "Use Tree-sitter indentation when an indent query is available; otherwise retain filetype indentation.";
    };
  };

  myconfig.ifEnabled.neovim.treesitter.registrations = lib.optionalAttrs cfg.treesitter.enable {
    rust = {
      grammars = with myconfig.neovim.treesitter.grammars; [rust];
      filetypes = {rust = "rust";};
      inherit (cfg.treesitter) highlight indent;
    };
  };
})
