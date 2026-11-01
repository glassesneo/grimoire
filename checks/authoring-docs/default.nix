# Check reference freshness against the flake's rendering of the real declarations. Synthetic modules
# also check that enable-only modules share a table and other module sections
# are sorted, source links stay relative and Markdown-safe, declared options
# and defaultText reach the reference, defaults read the placeholder host as
# expressions, packages render by source and name, lazy defaults are not forced, module
# options need no description, and a Denix declaration option without one fails
# rendering; Nix's option validation cannot detect broken rendered links, table
# cells or omissions.
{
  pkgs,
  compose,
  authoringDocs,
}: let
  inherit (pkgs) lib;
  render = import ../../lib/authoring.nix {inherit lib;};

  renderModules = modules: let
    configuration = compose ([
        ../../abstractions/modules/host/default.nix
        ({delib, ...}:
          delib.host {
            name = host;
            inherit (pkgs.stdenv.hostPlatform) system;
            user = {
              name = "\${myconfig.host.user.name}";
              homeDirectory = "\${myconfig.host.user.homeDirectory}";
            };
          })
      ]
      ++ modules);
  in
    render {
      inherit configuration pkgs host;
      sources.nixpkgs = pkgs.path;
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
  host = "\${myconfig.host.name}";
  example = renderModules [./fixture/z/default.nix (./fixture + "/a space/default.nix")];
  modulesPart = lib.last (lib.splitString "\n## Modules\n" example);
  fails = module: !(builtins.tryEval (renderModules [module])).success;
in {
  check = assert lib.hasInfix "A &#124; B<br>&lt;detail&gt;" example;
  assert lib.hasInfix "(../../checks/authoring-docs/fixture/a%20space/default.nix)" example;
  assert map (lib.removePrefix "### ") (builtins.filter (lib.hasPrefix "### ") (lib.splitString "\n" modulesPart)) == ["<code>a</code>" "<code>host</code>"];
  assert lib.hasInfix "| [<code>z</code>](../../checks/authoring-docs/fixture/z/default.nix) |  | Last |  |" modulesPart;
  assert lib.hasInfix "| <code>a.value</code> | <code>string</code> | <code>\"x\"</code> | Value of a. |" example;
  assert lib.hasInfix "| <code>a.bare</code> | <code>string</code> | <code>\"y\"</code> |  |" example;
  assert lib.hasInfix "| <code>a.host</code> | <code>string</code> | <code>\"\${myconfig.host.name}\"</code> |  |" example;
  assert lib.hasInfix "| <code>a.home</code> | <code>string</code> | <code>\"\${myconfig.host.user.homeDirectory}/.a\"</code> |  |" example;
  assert lib.hasInfix "| <code>a.named</code> | <code>string</code> | the host's name |  |" example;
  assert lib.hasInfix "| <code>a.tool</code> | <code>package</code> | <code>nixpkgs: hello</code> |  |" example;
  assert lib.hasInfix "| <code>a.lazy</code> | <code>lazy attribute set of string</code> | (computed) |  |" example;
  assert lib.hasInfix "| <code>a.setting</code> |" example;
  assert fails ./fixture/undocumented/default.nix;
    pkgs.runCommand "authoring-docs-current" {} ''
      diff -u ${../../docs/generated/authoring.md} ${authoringDocs}
      touch "$out"
    '';
}
