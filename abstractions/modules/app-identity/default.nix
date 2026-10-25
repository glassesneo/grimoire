{
  delib,
  inputs,
  ...
}:
delib.module {
  name = "app-identity";
  meta.description = "Expose nix-mac-app-identity helpers that give Nix-built macOS programs a code-signing identity surviving rebuilds.";

  options = {pkgs, ...}: let
    appIdentity = pkgs.callPackage inputs.nix-mac-app-identity {};
  in {
    stabilizeApp = delib.readOnly (delib.functionOption appIdentity.stabilizeApp "Signs a package's `.app` bundle under a requirement naming only its bundle identifier, so TCC grants survive rebuilds; Developer ID signed bundles pass through unchanged.");
    mkAppBundle = delib.readOnly (delib.functionOption appIdentity.mkAppBundle "Wraps a bare executable in a minimal bundle with a stable identifier, so TCC grants survive rebuilds.");
  };
}
