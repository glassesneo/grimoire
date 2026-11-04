# The live check's probe for the invoking user under a temporary home: the
# nix-secrets module and the services module it registers activation with,
# composed as the flake composes module test fixtures.
{
  flake,
  homeDirectory,
  username,
}: let
  system = "aarch64-darwin";
  probe = import ../abstractions/modules/nix-secrets/probe.nix;
  configuration = flake.lib.compose [
    ../abstractions/modules/services/default.nix
    ../abstractions/modules/nix-secrets/default.nix
    ({delib, ...}:
      delib.host {
        name = "smoke";
        inherit system;
        user = {
          name = username;
          inherit homeDirectory;
        };
        hjem.always = probe.module homeDirectory;
      })
  ];
in
  probe.farm flake.inputs.nixpkgs.legacyPackages.${system} (configuration.genSystem {
    moduleSystem = "hjem";
    host = "smoke";
    extraArgs = {inherit system username homeDirectory;};
  })
