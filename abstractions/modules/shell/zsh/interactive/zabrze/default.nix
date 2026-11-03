# Owns zabrze's configuration file, to which features contribute snippets.
#
# Snippets are keyed by their zabrze `name`. zabrze tries snippets sharing a
# trigger in file order, so conditional snippets are rendered before
# unconditional ones; the order is otherwise by name.
{
  delib,
  lib,
  ...
}:
delib.module {
  name = "zsh.interactive.zabrze";
  meta.description = "Provide zabrze, expand the abbreviations features contribute in Zsh, and own its configuration file.";

  options.enable = delib.boolOption true;

  hjem.always.options.zsh.zabrze.snippets = let
    inherit (lib) types;
    optional = type: description:
      lib.mkOption {
        type = types.nullOr type;
        default = null;
        inherit description;
      };
  in
    lib.mkOption {
      type = types.attrsOf (types.submodule {
        options = {
          trigger = optional types.str "Word that expands. Exactly one of `trigger` and `trigger-pattern` is set.";
          trigger-pattern = optional types.str "Regular expression matching the word that expands.";
          snippet = lib.mkOption {
            type = types.str;
            description = "Text that replaces the trigger.";
          };
          global = optional types.bool "Whether the snippet also expands as an argument, not only as the command.";
          context = optional types.str "Regular expression that the current command must match, including the trigger. The current command is the line after its last `;`, `&`, `|`, `(` or backquote.";
          evaluate = optional types.bool "Whether the snippet is evaluated by the shell before insertion.";
          "if" = optional types.str "Zsh condition under which the snippet expands.";
          cursor = optional types.str "Marker in the snippet where the cursor is placed after expansion.";
          abort-on-error = optional types.bool "Whether an evaluated snippet whose command fails aborts the expansion.";
        };
      });
      default = {};
      description = "zabrze snippets by name. Of snippets sharing a trigger, those with `if` are tried first.";
    };

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: let
    package = pkgs.callPackage ./package.nix {};
    snippets = lib.mapAttrsToList (name: snippet: {inherit name;} // lib.filterAttrs (_: value: value != null) snippet) config.zsh.zabrze.snippets;
    conditionalFirst = a: b:
      if (a ? "if") != (b ? "if")
      then a ? "if"
      else a.name < b.name;
    invalid = lib.filter (snippet: (snippet ? trigger) == (snippet ? trigger-pattern)) snippets;
  in {
    packages = [package];

    zsh.zshrc.zabrze.text = ''
      eval "$(${lib.getExe package} init --bind-keys)"
    '';

    xdg.config.files."zabrze/config.toml" = {
      exclusive = true;
      source = (pkgs.formats.toml {}).generate "zabrze-config.toml" {
        snippets = lib.sort conditionalFirst snippets;
      };
    };

    assertions =
      map (snippet: {
        assertion = false;
        message = "zabrze snippet \"${snippet.name}\" must set exactly one of trigger and trigger-pattern.";
      })
      invalid;
  };
}
