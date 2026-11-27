{
  pkgs,
  compose,
  authoring,
}: let
  inherit (pkgs) lib;
  render = import ../../lib/authoring.nix {inherit lib;};
  mylib = import ../../lib {inherit lib;};
  documentedProbe = mylib.documented {description = "Probe.";} (value: value + 1);
  listed = entries: internal: map (entry: entry.name) (mylib.library {inherit entries internal;});

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
  rendered = renderModules [./fixture/z/default.nix ./fixture/w/default.nix (./fixture + "/a space/default.nix")];
  example = rendered.reference;
  inherit (rendered) modules;
  options = rendered.moduleOptions.a;
  fails = module: !(builtins.tryEval (renderModules [module]).reference).success;
  evaluated =
    builtins.deepSeq {
      inherit (authoring) modules reference moduleOptions;
    }
    true;
in {
  protects = "live authoring queries (`just modules`, `just reference`, `just options`) render cleanly from declarations: every repository declaration and adapter option has a description, every library function modules use is documented, and markers, defaults and paths render as written";
  check = assert documentedProbe 1 == 2;
  assert listed {
    x = {
      f = documentedProbe;
      g = value: value;
      data = [1];
    };
  } ["x.g"]
  == ["x.f"];
  assert !(builtins.tryEval (builtins.deepSeq (listed {x.f = value: value;} []) true)).success;
  assert lib.hasInfix "A &#124; B<br>&lt;detail&gt;" modules;
  assert lib.hasInfix "| <code>a</code> | <code>checks/authoring-docs/fixture/a space/default.nix</code> |" modules;
  assert lib.hasInfix "| <code>z</code> | <code>checks/authoring-docs/fixture/z/default.nix</code> | Last |  |" modules;
  assert lib.hasInfix "| <code>a.upstream</code> |" options;
  assert lib.hasInfix "| a higher source replaces it whole |" options;
  assert lib.hasInfix "| collects every source's definitions |" options;
  assert lib.hasInfix "| <code>a.bare</code> | <code>string</code> | <code>\"y\"</code> |  |" options;
  assert lib.hasInfix "| <code>a.host</code> | <code>string</code> | <code>\"\${myconfig.host.name}\"</code> |  |" options;
  assert lib.hasInfix "| <code>a.home</code> | <code>string</code> | <code>\"\${myconfig.host.user.homeDirectory}/.a\"</code> |  |" options;
  assert lib.hasInfix "| <code>a.named</code> | <code>string</code> | the host's name |  |" options;
  assert lib.hasInfix "| <code>a.tool</code> | <code>package</code> | <code>nixpkgs: hello</code> |  |" options;
  assert lib.hasInfix "| <code>a.lazy</code> | <code>lazy attribute set of string</code> | (computed) |  |" options;
  assert lib.hasInfix "| <code>a.setting</code> |" options;
  assert lib.hasInfix "## Declarations" example;
  assert fails ./fixture/undocumented/default.nix;
  assert evaluated;
    pkgs.runCommandLocal "authoring-docs-check" {} ''
      touch "$out"
    '';
}
