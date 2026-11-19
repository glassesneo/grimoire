# `anchorRoot` is the directory whose anchors `anchors` evaluates once.
{
  lib,
  anchorRoot ? null,
}: let
  sources = import ./sources.nix {inherit lib;};
in {
  anchors = import ./anchors.nix {
    inherit lib;
    root = anchorRoot;
  };
  assertions = import ./assertions.nix {inherit lib;};
  colorschemes = import ./colorschemes.nix {inherit lib;};
  fragments = import ./fragments.nix {inherit lib;};
  plist = import ./plist.nix {inherit lib;};
  inherit sources;
  inherit (sources) accumulatingOption atomicOption;
  inherit (import ./rices.nix) rice;
  roles = import ./roles.nix {inherit lib;};
  schemeThemes = import ./scheme-themes.nix;
  sourceFiles = import ./source-files.nix {inherit lib;};
}
