{lib}: let
  sources = import ./sources.nix {inherit lib;};
in {
  choice = import ./choice.nix {inherit lib;};
  fragments = import ./fragments.nix {inherit lib;};
  plist = import ./plist.nix {inherit lib;};
  inherit sources;
  inherit (sources) atomicOption;
  inherit (import ./rices.nix {}) rice;
}
