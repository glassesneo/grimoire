{
  flake,
  homeDirectory,
  username,
}: let
  system = "aarch64-darwin";
  probe = import ../abstractions/modules/nix-secrets/probe.nix;
  configuration = flake.lib.compose [
    ../abstractions/modules/app-identity/default.nix
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
