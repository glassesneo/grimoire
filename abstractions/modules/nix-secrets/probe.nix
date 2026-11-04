# The probe that this module's cases and the live check
# (scripts/nix-secrets-smoke.nu) activate. `module homeDirectory` is a Hjem
# module that activates a `dummy` secret under that home with a probe Label
# and publishes the wiring it observes as files; `farm pkgs result` links a
# Hjem result's files and its services step by name.
{
  module = homeDirectory: {
    config,
    lib,
    pkgs,
    ...
  }: let
    cfg = config.security.nix-secrets;
  in {
    security.nix-secrets = {
      enable = lib.mkDefault true;
      installPackage = false;
      storage = "${homeDirectory}/storage";
      identityPaths = ["${homeDirectory}/key.txt"];
      baseDir = "${homeDirectory}/activated";
      generationsDir = "${homeDirectory}/generations";
      secrets.dummy = {};
    };
    platform.darwin.launchAgents = lib.mkIf (cfg.enable && cfg.activate.enable) {
      nix-secrets-activate.config.Label = lib.mkForce "org.hjem.nix-secrets-probe";
    };
    files = {
      "manifest.json".text = cfg.manifest;
      "cli-env.json".text = builtins.toJSON config.environment.sessionVariables;
      "wiring.json".text = builtins.toJSON {
        command = cfg.activate.command false;
        script = cfg.activateScript.text;
        activateScript = toString cfg.activateScript;
        package = toString cfg.package;
        stateDirectory = config.xdg.state.directory;
      };
      "secret-path".text = cfg.secrets.dummy.path;
      "activate".source = pkgs.writeShellScript "probe-activate" ''
        export PATH=/usr/bin:/bin:/usr/sbin:/sbin
        exec ${cfg.activate.command false}
      '';
      "keygen".source = pkgs.writeShellScript "probe-keygen" ''
        exec ${cfg.package}/bin/nix-secrets keygen "$@"
      '';
      "age".source = "${pkgs.age}/bin/age";
    };
  };

  farm = pkgs: result:
    pkgs.linkFarm "nix-secrets-probe" (
      map (file: {
        name = builtins.baseNameOf file.target;
        path = file.source;
      })
      result.manifest.files
      ++ [
        {
          name = "services";
          path = result.apply.steps.services;
        }
      ]
    );
}
