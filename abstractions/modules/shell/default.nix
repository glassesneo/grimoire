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
  tests = _: {
    unknown-candidate = {
      protects = "loginShell accepts only modules that joined it as candidates";
      host.myconfig.ifEnabled.shell.loginShell = "zsh";
      expr = result: result.options.myconfig.shell.loginShell.value;
      fails = true;
    };
  };
})
