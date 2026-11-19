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
  name = "neovim.languages.bash";
  tests.fixture = ["neovim.languages" "neovim.treesitter"];
  meta.description = "Configure Bash editing support in Neovim.";

  options = with delib; {
    enable = boolOption true;
    treesitter = {
      enable = boolOption true;
      highlight = boolOption true;
      indent = boolOption true "Use Tree-sitter indentation when an indent query is available; otherwise retain filetype indentation.";
    };
  };

  myconfig.ifEnabled.neovim.treesitter.registrations = lib.optionalAttrs cfg.treesitter.enable {
    bash = {
      grammars = with myconfig.neovim.treesitter.grammars; [bash];
      filetypes = {
        sh = "bash";
        bash = "bash";
      };
      inherit (cfg.treesitter) highlight indent;
    };
  };
})
