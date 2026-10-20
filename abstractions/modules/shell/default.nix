{
  delib,
  lib,
  ...
}: let
  availableShells = ["zsh"];
in
  delib.module ({
    cfg,
    myconfig,
    myoptions,
    ...
  }: {
    name = "shell";
    meta.description = "Define a shared configuration interface for shells and configure the selected login shell.";

    options = with delib; {
      enable = boolOption true;
      loginShell = enumOption availableShells;
    };

    myconfig.ifEnabled =
      lib.genAttrs availableShells (shell: {
        login.enable = lib.mkDefault (
          myoptions.shell.loginShell.isDefined
          && cfg.loginShell == shell
          && myconfig.${shell}.enable
        );
      })
      // {
        assertions = [
          {
            assertion = builtins.length (lib.filter (shell: myconfig.${shell}.login.enable) availableShells) <= 1;
            message = "At most one login shell may be enabled: ${lib.concatStringsSep ", " availableShells}";
          }
        ];
      };

    darwin.ifEnabled = {
      environment.shells = [myconfig.${cfg.loginShell}.package];

      users.users.${myconfig.host.user.name} = {
        ignoreShellProgramCheck = true;
        shell = myconfig.${cfg.loginShell}.package;
      };
    };

    # A distinct package shows that the selected shell module's package is
    # used, not a default that happens to equal it.
    checks = {pkgs, ...}: let
      package = pkgs.writeShellScriptBin "fixture-shell" "" // {shellPath = "/bin/fixture-shell";};
    in {
      login-shell = {
        uses = ["zsh" "zsh.login" "host" "nixpkgs"];
        host.myconfig.ifEnabled = {
          shell.loginShell = "zsh";
          zsh.package = package;
        };
        moduleSystem = "darwin";
        expr = result: {
          shell = toString result.config.users.users.fixture.shell;
          # nix-darwin lists shells by their path in the system profile.
          listed = lib.elem "/run/current-system/sw/bin/fixture-shell" result.config.environment.shells;
        };
        expected = {
          shell = toString package;
          listed = true;
        };
      };
    };
  })
