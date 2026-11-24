{
  compose,
  pkgs,
  ...
}: let
  inherit (pkgs) lib;

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
          roles.single.enable = true;
          roles.shared.enable = true;
          roles.data.enable = true;
        }
        myconfig;
    };

  fixture = [
    (role "single" true)
    (candidate "single-a" "single" {default = true;})
    (candidate "single-b" "single" {})
    (role "shared" false)
    (candidate "shared-a" "shared" {
      default = true;
      enable = true;
    })
    (candidate "shared-b" "shared" {})
    (role "data" false)
    ({delib, ...}:
      delib.module {
        name = "data-a";
        meta = {
          description = "Fixture candidate without enable.";
          role = "data";
        };
        myconfig.always.roles.data.holder = "data-a";
      })
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
    failedAssertions = lib.sort lib.lessThan result.failedAssertions;
  };
in {
  cases = {
    candidate-default-holds-seat = {
      protects = "the holder a candidate names by default takes the seat, a seated-only role enables its holder alone, and a role whose candidates keep their own enable leaves them as they are";
      expr = evaluate [] {};
      expected = {
        enabled = ["single-a" "shared-a"];
        failedAssertions = [];
      };
    };
    rice-replaces-default-holder = {
      protects = "a rice's holder replaces the holder a candidate names by default";
      expr = evaluate [] {rice = "picks-b";};
      expected = {
        enabled = ["single-b" "shared-a"];
        failedAssertions = [];
      };
    };
    host-replaces-default-holder = {
      protects = "a host's holder replaces the holder a candidate names by default";
      expr = evaluate [] {myconfig.roles.single.holder = "single-b";};
      expected = {
        enabled = ["single-b" "shared-a"];
        failedAssertions = [];
      };
    };
    disabled-seat-enables-no-candidate = {
      protects = "a disabled seated-only role enables none of its candidates";
      expr = evaluate [] {myconfig.roles.single.enable = false;};
      expected = {
        enabled = ["shared-a"];
        failedAssertions = [];
      };
    };
    candidate-enabled-outside-seat-is-rejected = {
      protects = "a seated-only role rejects a candidate enabled while it does not hold the seat";
      expr = evaluate [] {myconfig.single-b.enable = true;};
      expected = {
        enabled = ["single-a" "single-b" "shared-a"];
        failedAssertions = [''single-b.enable = true requires roles.single.enable = true and roles.single.holder = "single-b"''];
      };
    };
    disabled-holder-is-rejected = {
      protects = "a role whose candidates keep their own enable requires its holder enabled, while a candidate without enable can always hold its role";
      expr = evaluate [] {myconfig.shared-a.enable = false;};
      expected = {
        enabled = ["single-a"];
        failedAssertions = [''roles.shared.holder = "shared-a" requires shared-a.enable = true''];
      };
    };
    undeclared-roles-are-rejected = {
      protects = "the roles namespace and meta.role accept only roles declared with delib.role";
      expr = evaluate [
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
        enabled = ["single-a" "shared-a"];
        failedAssertions = [
          "module roles.plain is in the roles namespace; declare it with delib.role"
          ''orphan: meta.role = "missing" names no role declared with delib.role''
        ];
      };
    };
  };
}
