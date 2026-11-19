{
  delib,
  lib,
  ...
}:
delib.module ({cfg, ...}: {
  name = "neovim.treesitter";
  tests.fixture = ["neovim"];
  meta.description = "Assemble language-owned Tree-sitter parsers and queries and apply their buffer settings.";

  options = {pkgs, ...}: {
    enable = delib.boolOption true;
    grammars = lib.mkOption {
      type = lib.types.lazyAttrsOf lib.types.package;
      readOnly = true;
      default = pkgs.vimPlugins.nvim-treesitter.builtGrammars;
      defaultText = lib.literalExpression "nixpkgs: nvim-treesitter.builtGrammars";
      description = "Parser packages with the queries matching this backend's nvim-treesitter; language profiles select from this catalogue.";
    };
    registrations = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule {
        options = {
          grammars = lib.mkOption {
            type = lib.types.listOf lib.types.package;
            default = [];
            description = "Parser packages, including any auxiliary parsers needed by this language.";
          };
          filetypes = lib.mkOption {
            type = lib.types.attrsOf lib.types.str;
            default = {};
            description = "Neovim filetype to Tree-sitter parser-name mapping.";
          };
          highlight = delib.boolOption true;
          indent = delib.boolOption true;
        };
      });
      default = {};
      description = "Language-owned contributions. A filetype has one owner; disabling this backend ignores all contributions.";
    };
  };

  constraints.ifEnabled = [
    {
      assertion = let
        filetypes = lib.concatMap (entry: builtins.attrNames entry.filetypes) (builtins.attrValues cfg.registrations);
      in
        lib.length filetypes == lib.length (lib.unique filetypes);
      message = "neovim.treesitter.registrations must assign each filetype to only one registration";
    }
  ];

  tests.cases = {pkgs, ...}: {
    filetype-policy = {
      moduleSystem = "bundles";
      uses = ["colorscheme"];
      protects = "language registrations dispatch highlighting and optional indentation without changing unselected or special buffers, and release only settings still owned when filetypes change";
      modules.fixture-feature.myconfig.always.neovim.treesitter.registrations = {
        full = {filetypes.fixture_full = "fixture_parser";};
        fallback = {filetypes.fixture_fallback = "fixture_no_indent";};
        highlight = {
          filetypes.fixture_highlight = "fixture_parser";
          indent = false;
        };
        indent = {
          filetypes.fixture_indent = "fixture_parser";
          highlight = false;
        };
        off = {
          filetypes.fixture_off = "fixture_parser";
          highlight = false;
          indent = false;
        };
      };
      build = result:
        pkgs.runCommand "neovim-treesitter-filetype-policy" {} ''
          export HOME=$TMPDIR/home XDG_CONFIG_HOME=$TMPDIR/config XDG_DATA_HOME=$TMPDIR/data
          export XDG_STATE_HOME=$TMPDIR/state XDG_CACHE_HOME=$TMPDIR/cache
          mkdir -p "$HOME"
          ${lib.getExe result.packages.neovim} --headless -i NONE -c 'lua local ok, err = pcall(dofile, "${./tests/filetypes.lua}"); if not ok then print(err); vim.cmd("cquit") end'
          touch "$out"
        '';
    };
    duplicate-filetype = {
      moduleSystem = "bundles";
      uses = ["colorscheme"];
      protects = "registrations cannot give the same filetype two owners even when their parser names agree";
      modules.fixture-feature.myconfig.always.neovim.treesitter.registrations = {
        first.filetypes.shared = "same_parser";
        second.filetypes.shared = "same_parser";
      };
      fails = "neovim.treesitter.registrations must assign each filetype to only one registration";
    };
  };

  myconfig.ifEnabled.neovim.settings = {pkgs, ...}:
    lib.optionalAttrs (cfg.registrations != {}) {
      plugins.start = [
        (pkgs.vimPlugins.nvim-treesitter.withPlugins (_:
            lib.unique (lib.concatMap (entry: entry.grammars) (builtins.attrValues cfg.registrations))))
      ];
      initLua = ''
        vim.g.grimoire_treesitter = ${lib.generators.toLua {} (lib.mapAttrs (_: entry: {
            inherit (entry) filetypes highlight indent;
          })
          cfg.registrations)}
      '';
      plugins.dev.grimoire-treesitter = {
        pure = ./config;
        impure = "~/grimoire/abstractions/modules/neovim/treesitter/config";
      };
    };
})
