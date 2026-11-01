{
  delib,
  lib,
  mylib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "zsh.login";
  meta.description = "Configure the behavior required to use Zsh as a login shell.";

  # The role follows `shell.loginShell`; it is not chosen separately.
  options.enable = with delib;
    readOnly (defaultText (boolOption ((myconfig.shell.loginShell or null) == "zsh"))
      (lib.literalExpression ''myconfig.shell.loginShell == "zsh"''));

  myconfig.always.options.shell.loginShell = mylib.choice.candidate "zsh";

  hjem.ifEnabled = {config, ...}: {
    zsh.zshenv.hjem-environment.text = ''
      if [ -z "''${__HJEM_ENV_LOADED-}" ]; then
        export __HJEM_ENV_LOADED=1
        . ${config.environment.loadEnv}
      fi
    '';
  };
})
