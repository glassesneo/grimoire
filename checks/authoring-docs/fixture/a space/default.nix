{
  delib,
  lib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "a";
  meta.description = "A | B\n<detail>";

  options = with delib; {
    value = strOption "x" "Value of a.";
    host = strOption myconfig.host.name {
      defaultText = lib.literalMD "the host's name";
      description = "Name read from the host.";
    };
  };

  hjem.always.options.a.setting = lib.mkOption {
    type = lib.types.str;
    default = "";
    description = "Setting of a.";
  };
})
