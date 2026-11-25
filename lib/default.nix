{
  lib,
  anchorRoot ? null,
}: let
  inherit (import ./documented.nix {inherit lib;}) documented library;
  sources = import ./sources.nix {inherit lib documented;};
in {
  inherit documented library;
  anchors = import ./anchors.nix {
    inherit lib documented;
    root = anchorRoot;
  };
  assertions = import ./assertions.nix {inherit lib documented;};
  colorschemes = import ./colorschemes.nix {inherit lib documented;};
  fragments = import ./fragments.nix {inherit lib documented;};
  plist = import ./plist.nix {inherit lib documented;};
  inherit sources;
  inherit (sources) accumulatingOption atomicOption;
  inherit (import ./rices.nix {inherit documented;}) rice;
  roles = import ./roles.nix {inherit lib documented;};
  schemeThemes = import ./scheme-themes.nix {inherit documented;};

  internal = ["anchors.discover" "assertions.guard" "documented" "internal" "library" "roles" "sources.accumulatingOption" "sources.atomicOption" "sources.isAccumulating" "sources.isAtomic"];
}
