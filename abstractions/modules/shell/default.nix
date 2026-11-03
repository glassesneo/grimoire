{
  delib,
  lib,
  mylib,
  ...
}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "shell";
  meta.description = "Define a shared configuration interface for shells and configure the selected login shell.";

  # Shell modules join `loginShell` with `mylib.choice.candidate`, using their
  # module name as the value; that module provides `package`.
  options = with delib; {
    enable = boolOption true;
    loginShell = mylib.choice.option "Shell that becomes the user's login shell; `null` leaves the login shell unmanaged.";
  };

  constraints.ifEnabled = [
    {
      assertion = cfg.loginShell == null || myconfig.${cfg.loginShell}.enable;
      message = "shell.loginShell = \"${toString cfg.loginShell}\" requires ${toString cfg.loginShell}.enable = true";
    }
  ];

  darwin.ifEnabled = lib.mkIf (cfg.loginShell != null) {
    environment.shells = [myconfig.${cfg.loginShell}.package];

    users.users.${myconfig.host.user.name} = {
      ignoreShellProgramCheck = true;
      shell = myconfig.${cfg.loginShell}.package;
    };
  };

  # A distinct package shows that the selected shell module's package is
  # used, not a default that happens to equal it.
  tests = {pkgs, ...}: let
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
        role = result.config.myconfig.zsh.login.enable;
      };
      expected = {
        shell = toString package;
        listed = true;
        role = true;
      };
    };
    unmanaged = {
      uses = ["zsh" "zsh.login"];
      expr = result: result.options.myconfig.zsh.login.enable.value;
      expected = false;
    };
    disabled-candidate = {
      uses = ["zsh" "zsh.login"];
      host.myconfig.ifEnabled = {
        shell.loginShell = "zsh";
        zsh.enable = false;
      };
      fails = "shell.loginShell = \"zsh\" requires zsh.enable = true";
    };
    unknown-candidate = {
      host.myconfig.ifEnabled.shell.loginShell = "zsh";
      expr = result: result.options.myconfig.shell.loginShell.value;
      fails = true;
    };
  };
})
