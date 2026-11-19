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
  name = "neovim.languages.kdl";
  tests.fixture = ["neovim.languages" "neovim.treesitter"];
  meta.description = "Configure KDL editing support in Neovim.";

  options = with delib; {
    enable = boolOption true;
    treesitter = {
      enable = boolOption true;
      highlight = boolOption true;
      indent = boolOption true "Use Tree-sitter indentation when an indent query is available; otherwise retain filetype indentation.";
    };
  };

  myconfig.ifEnabled.neovim.treesitter.registrations = lib.optionalAttrs cfg.treesitter.enable {
    kdl = {
      grammars = with myconfig.neovim.treesitter.grammars; [kdl];
      filetypes = {kdl = "kdl";};
      inherit (cfg.treesitter) highlight indent;
    };
  };
})
