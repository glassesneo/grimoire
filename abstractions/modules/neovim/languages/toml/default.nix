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
  name = "neovim.languages.toml";
  tests.fixture = ["neovim.languages" "neovim.treesitter"];
  meta.description = "Configure TOML editing support in Neovim.";

  options = with delib; {
    enable = boolOption true;
    treesitter = {
      enable = boolOption true;
      highlight = boolOption true;
      indent = boolOption true "Use Tree-sitter indentation when an indent query is available; otherwise retain filetype indentation.";
    };
  };

  myconfig.ifEnabled.neovim.treesitter.registrations = lib.optionalAttrs cfg.treesitter.enable {
    toml = {
      grammars = with myconfig.neovim.treesitter.grammars; [toml];
      filetypes = {toml = "toml";};
      inherit (cfg.treesitter) highlight indent;
    };
  };
})
