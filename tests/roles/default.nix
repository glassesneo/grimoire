{
  compose,
  pkgs,
  ...
}: let
  inherit (pkgs) lib;

  # Repository-owned contract of roles (`lib/roles.nix`, `extensions/roles.nix`
  # and the exception in `tags`): the holder a candidate names by default is
  # replaced by a rice or host; a seated-only role enables its holder alone,
  # whatever the candidates' tags, and rejects an enabled candidate outside the
  # seat; a role whose candidates keep their own enable only requires the
  # holder enabled; and the roles namespace and `meta.role` accept only roles
  # declared with `delib.role`.
  role = name: seatedOnly: {delib, ...}:
    delib.role {
      inherit name seatedOnly;
      meta.description = "Fixture seat.";
    };

  candidate = name: role: args: {delib, ...}:
    delib.module {
      inherit name;
      meta = {
        description = "Fixture candidate.";
        tags = ["gui"];
        inherit role;
      };
      options.enable = delib.boolOption (args.enable or false);
      myconfig.always = lib.optionalAttrs (args.default or false) {roles.${role}.holder = name;};
    };

  rice = {mylib, ...}:
    mylib.rice {
      name = "picks-b";
      myconfig.roles.single.holder = "single-b";
    };

  host = {
    myconfig ? {},
    rice ? null,
  }: {delib, ...}:
    delib.host {
      name = "fixture";
      system = pkgs.stdenv.hostPlatform.system;
      user.name = "fixture";
      inherit rice;
      myconfig.ifEnabled =
        lib.recursiveUpdate {
          tags.enabled = ["gui"];
          roles.single.enable = true;
          roles.shared.enable = true;
        }
        myconfig;
    };

  fixture = [
    ../../abstractions/modules/tags/default.nix
    (role "single" true)
    (candidate "single-a" "single" {default = true;})
    (candidate "single-b" "single" {})
    (role "shared" false)
    (candidate "shared-a" "shared" {
      default = true;
      enable = true;
    })
    (candidate "shared-b" "shared" {})
    rice
  ];

  evaluate = extra: hostArgs: let
    result = (compose (fixture ++ extra ++ [(host hostArgs)])).genSystem {
      moduleSystem = "hjem";
      host = "fixture";
      extraArgs = {
        inherit (pkgs.stdenv.hostPlatform) system;
        homeDirectory = "/fixture";
        username = "fixture";
      };
    };
    my = result.options.myconfig;
  in {
    enabled = lib.filter (name: my.${name}.enable.value) ["single-a" "single-b" "shared-a" "shared-b"];
    inherit (result) failedAssertions;
  };

  cases = {
    default-holder = {
      result = evaluate [] {};
      expected = {
        enabled = ["single-a" "shared-a" "shared-b"];
        failedAssertions = [];
      };
    };
    rice-replaces-default = {
      result = evaluate [] {rice = "picks-b";};
      expected = {
        enabled = ["single-b" "shared-a" "shared-b"];
        failedAssertions = [];
      };
    };
    host-replaces-default = {
      result = evaluate [] {myconfig.roles.single.holder = "single-b";};
      expected = {
        enabled = ["single-b" "shared-a" "shared-b"];
        failedAssertions = [];
      };
    };
    disabled-seat = {
      result = evaluate [] {myconfig.roles.single.enable = false;};
      expected = {
        enabled = ["shared-a" "shared-b"];
        failedAssertions = [];
      };
    };
    candidate-outside-seat = {
      result = evaluate [] {myconfig.single-b.enable = true;};
      expected = {
        enabled = ["single-a" "single-b" "shared-a" "shared-b"];
        failedAssertions = [''single-b.enable = true requires roles.single.enable = true and roles.single.holder = "single-b"''];
      };
    };
    holder-disabled = {
      result = evaluate [] {myconfig.shared-a.enable = false;};
      expected = {
        enabled = ["single-a" "shared-b"];
        failedAssertions = [''roles.shared.holder = "shared-a" requires shared-a.enable = true''];
      };
    };
    namespace-and-role-names = {
      result = evaluate [
        ({delib, ...}:
          delib.module {
            name = "roles.plain";
            meta.description = "Not a role.";
          })
        ({delib, ...}:
          delib.module {
            name = "orphan";
            meta = {
              description = "Candidate of no role.";
              role = "missing";
            };
          })
      ] {};
      expected = {
        enabled = ["single-a" "shared-a" "shared-b"];
        failedAssertions = [
          ''orphan: meta.role = "missing" names no role declared with delib.role''
          "module roles.plain is in the roles namespace; declare it with delib.role"
        ];
      };
    };
  };

  normalize = value: value // {failedAssertions = lib.sort lib.lessThan value.failedAssertions;};
  failures = lib.filterAttrs (_: case: normalize case.result != normalize case.expected) cases;
in {
  check = assert lib.assertMsg (failures == {})
  "Role cases failed: ${builtins.toJSON (lib.mapAttrs (_: case: case.result) failures)}";
    pkgs.runCommand "roles-test" {} ''
      mkdir "$out"
    '';
}
