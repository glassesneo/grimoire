{
  inputs,
  pkgs,
  system,
}: let
  lib = pkgs.lib;
  makeSystem = (import ../../adapters/hjem {inherit inputs;}).moduleSystems.hjem.makeSystem;
  result = modules:
    makeSystem {
      inherit modules;
      extraArgs = {
        inherit system;
        username = "fixture";
        homeDirectory = "/tmp/hjem-defaults-fixture";
      };
    };
  good = result [
    {
      userServices.tool.command = ["/bin/true"];
      platform.darwin.launchAgents.tool.domain = "gui";
      platform.darwin.defaults = {
        "com.example.app" = {
          settings = {
            flag = true;
            count = -1;
            "A&B" = {
              nested = ["<value>"];
              deeper.leaf = "y";
              empty = {};
            };
          };
          onChange = {
            restartProcesses = ["Dock" "Finder"];
            activateSettings = true;
            restartServices = ["tool"];
          };
        };
        NSGlobalDomain.settings.name = "value";
      };
    }
    # A second location adds keys and actions to the same domain.
    {
      platform.darwin.defaults."com.example.app" = {
        settings.other = "x";
        onChange.restartProcesses = ["Dock"];
      };
    }
  ];
  # Lowering is observed before serialization; the serializer owns plist syntax.
  # The reconciler build runs its own specs for runtime transitions.
  domains = lib.listToAttrs (map (entry: lib.nameValuePair entry.domain entry) good.defaultsApply.domains);
  app = domains."com.example.app";
  values = lib.listToAttrs (map (leaf: lib.nameValuePair (lib.concatStringsSep "/" leaf.path) leaf.xml) app.values);
  label = (lib.findFirst (job: job.name == "tool") null good.serviceApply.jobs).label;
  controls = builtins.fromJSON ''["\u0001", "\u001f"]'';
  rejected = modules: !(builtins.tryEval (builtins.deepSeq (result modules).defaultsApply true)).success;
  # Declaration errors are assertions, so a rejection also names its reason.
  rejects = reason: module: lib.any (lib.hasInfix reason) (result [module]).failedAssertions && rejected [module];
  settings = name: value: {platform.darwin.defaults.${name}.settings = value;};
  linuxResult = module:
    lib.evalModules {
      specialArgs = {
        inherit lib;
        pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
      };
      modules = [
        "${inputs.nixpkgs}/nixos/modules/misc/assertions.nix"
        ../../adapters/hjem/services.nix
        ../../adapters/hjem/defaults.nix
        {
          options.directory = lib.mkOption {
            type = lib.types.str;
            default = "/tmp/fixture";
          };
          config = module;
        }
      ];
    };
in {
  platforms = lib.platforms.darwin;
  check = assert rejects "unsupported plist value" (settings "com.example" {ratio = 0.5;});
  assert rejects "unsupported plist value" (settings "com.example" {list = [{nested = 1.5;}];});
  assert rejects "unsupported plist value" (settings "com.example" {missing = null;});
  assert lib.all (control: rejects "XML control characters" (settings "com.example" {key = [control];})) controls;
  assert rejects "invalid key" (settings "com.example" {"bad${builtins.head controls}" = "value";});
  assert rejects "invalid key" (settings "com.example" {"" = "value";});
  assert rejects "invalid key" (settings "com.example" {outer."" = "value";});
  assert rejects "unsupported plist value" (settings "com.example" {outer.ratio = 0.5;});
  assert rejects "invalid domain name" (settings "../escape" {key = "value";});
  assert rejects "invalid domain name" (settings "-g" {key = "value";});
  assert rejects "duplicate domain ignoring case" {
    platform.darwin.defaults = {
      "com.example".settings.a = "a";
      "Com.Example".settings.b = "b";
    };
  };
  assert rejects "unknown service missing" {
    platform.darwin.defaults."com.example".onChange.restartServices = ["missing"];
  };
  # The option type rejects an unknown process before any assertion.
  assert rejected [{platform.darwin.defaults."com.example".onChange.restartProcesses = ["Safari"];}];
  # Conflicting values for one leaf are an option merge error, not a silent choice.
  assert rejected [(settings "com.example" {key = "a";}) (settings "com.example" {key = "b";})];
  assert rejected [(settings "com.example" {outer.key = "a";}) (settings "com.example" {outer.key = "b";})];
  # Each leaf is declared at its path; lists are leaves and empty sets declare nothing.
  assert map (leaf: leaf.path) app.values == [["A&B" "deeper" "leaf"] ["A&B" "nested"] ["count"] ["flag"] ["other"]];
  assert lib.hasInfix "<true/>" values.flag;
  assert lib.hasInfix "<integer>-1</integer>" values.count;
  assert lib.hasInfix "<string>&lt;value&gt;</string>" values."A&B/nested";
  assert app.actions
  == [
    {
      kind = "process";
      target = "Dock";
    }
    {
      kind = "process";
      target = "Finder";
    }
    {
      kind = "activateSettings";
      target = "";
    }
    {
      kind = "service";
      target = "gui/${label}";
    }
  ];
  assert domains.NSGlobalDomain.actions == [];
  # Declarations are ignored, not rejected, on Linux.
  assert let
    linux = linuxResult (settings "com.example" {ratio = 0.5;});
  in
    lib.all (assertion: assertion.assertion) linux.config.assertions
    && linux.config.defaultsApply.domains == [];
    pkgs.runCommand "hjem-defaults-test" {
      defaults = good.defaultsApply;
    } ''
      test -x "$defaults/bin/apply"
      test -f "$defaults/defaults.json"
      touch "$out"
    '';
}
