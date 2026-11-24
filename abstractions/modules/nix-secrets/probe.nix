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
      checks.missingSecrets.enable = false;
      storage = "${homeDirectory}/storage";
      identityPaths = ["${homeDirectory}/key.txt"];
      baseDir = "${homeDirectory}/activated";
      generationsDir = "${homeDirectory}/generations";
      secrets.dummy = {};
    };
    serviceManager.label = "org.hjem.nix-secrets-probe";
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
