{
  delib,
  lib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "a";
  meta.description = "A | B\n<detail>";

  options = {pkgs, ...}:
    with delib; {
      value = strOption "x" "Value of a.";
      bare = strOption "y";
      host = strOption myconfig.host.name;
      home = strOption "${myconfig.host.user.homeDirectory}/.a";
      named = strOption myconfig.host.name {defaultText = lib.literalMD "the host's name";};
      tool = packageOption pkgs.hello;
      lazy = lazyAttrsOfOption str {key = throw "forced";};
    };

  hjem.always.options.a.setting = lib.mkOption {
    type = lib.types.str;
    default = "";
    description = "Setting of a.";
  };
})
