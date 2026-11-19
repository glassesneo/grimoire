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
  name = "neovim.languages.markdown";
  tests.fixture = ["neovim.languages" "neovim.treesitter"];
  meta.description = "Configure Markdown editing support in Neovim.";

  options = with delib; {
    enable = boolOption true;
    treesitter = {
      enable = boolOption true;
      highlight = boolOption true;
      indent = boolOption true "Use Tree-sitter indentation when an indent query is available; otherwise retain filetype indentation.";
    };
  };

  myconfig.ifEnabled.neovim.treesitter.registrations = lib.optionalAttrs cfg.treesitter.enable {
    markdown = {
      grammars = with myconfig.neovim.treesitter.grammars; [markdown markdown_inline];
      filetypes = {markdown = "markdown";};
      inherit (cfg.treesitter) highlight indent;
    };
  };
})
