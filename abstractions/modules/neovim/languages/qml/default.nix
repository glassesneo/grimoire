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
  name = "neovim.languages.qml";
  tests.fixture = ["neovim.languages" "neovim.treesitter"];
  meta.description = "Configure QML editing support in Neovim.";

  options = with delib; {
    enable = boolOption true;
    treesitter = {
      enable = boolOption true;
      highlight = boolOption true;
      indent = boolOption true "Use Tree-sitter indentation when an indent query is available; otherwise retain filetype indentation.";
    };
  };

  myconfig.ifEnabled.neovim.treesitter.registrations = lib.optionalAttrs cfg.treesitter.enable {
    qml = {
      grammars = with myconfig.neovim.treesitter.grammars; [qmljs javascript];
      filetypes = {qml = "qmljs";};
      inherit (cfg.treesitter) highlight indent;
    };
  };
})
