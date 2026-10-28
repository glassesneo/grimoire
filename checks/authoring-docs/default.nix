# Check reference freshness against the flake's rendering of the real declarations. Synthetic modules
# also check that module sections are sorted, source links stay relative and
# Markdown-safe, declared options and defaultText reach the reference, and a
# missing description or a package default fails rendering; Nix's option
# validation cannot detect broken rendered links, table cells or omissions.
{
  pkgs,
  compose,
  authoringDocs,
}: let
  inherit (pkgs) lib;
  render = import ../../lib/authoring.nix {inherit lib;};

  # Extensions contribute assertions, which the assertions module declares.
  renderModules = modules: let
    configuration = compose ([../../abstractions/modules/assertions/default.nix] ++ modules);
  in
    render {
      inherit configuration pkgs;
      root = ../..;
      moduleSystems.hjem =
        (configuration.genSystem {
          moduleSystem = "hjem";
          extraArgs = {
            inherit (pkgs.stdenv.hostPlatform) system;
            username = "user";
            homeDirectory = "/home/user";
          };
        }).options;
    };
  example = renderModules [./fixture/z/default.nix (./fixture + "/a space/default.nix")];
  modulesPart = lib.last (lib.splitString "\n## Modules\n" example);
  fails = module: !(builtins.tryEval (renderModules [module])).success;
  undocumented = builtins.toFile "undocumented.nix" ''
    {delib, ...}: delib.module {
      name = "undocumented";
      meta.description = "Declare an option without a description.";
      options.value = delib.strOption "x";
    }
  '';
  packageDefault = builtins.toFile "package-default.nix" ''
    {delib, ...}: delib.module {
      name = "package-default";
      meta.description = "Declare a package default without defaultText.";
      options = {pkgs, ...}: {tool = delib.packageOption pkgs.hello "Tool.";};
    }
  '';
in {
  check = assert lib.hasInfix "A &#124; B<br>&lt;detail&gt;" example;
  assert lib.hasInfix "(../../checks/authoring-docs/fixture/a%20space/default.nix)" example;
  assert map (lib.removePrefix "### ") (builtins.filter (lib.hasPrefix "### ") (lib.splitString "\n" modulesPart)) == ["<code>a</code>" "<code>assertions</code>" "<code>z</code>"];
  assert lib.hasInfix "| <code>a.value</code> | <code>string</code> | <code>\"x\"</code> | Value of a. |" example;
  assert lib.hasInfix "| <code>a.host</code> | <code>string</code> | the host's name | Name read from the host. |" example;
  assert lib.hasInfix "| <code>a.setting</code> |" example;
  assert fails undocumented;
  assert fails packageDefault;
    pkgs.runCommand "authoring-docs-current" {} ''
      diff -u ${../../docs/generated/authoring.md} ${authoringDocs}
      touch "$out"
    '';
}
