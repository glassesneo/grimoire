{lib}: let
  sources = import ./sources.nix {inherit lib;};
in {
  assertions = import ./assertions.nix {inherit lib;};
  choice = import ./choice.nix {inherit lib;};
  fragments = import ./fragments.nix {inherit lib;};
  plist = import ./plist.nix {inherit lib;};
  inherit sources;
  inherit (sources) accumulatingOption atomicOption;
  inherit (import ./rices.nix) rice;
  schemeThemes = import ./scheme-themes.nix {inherit lib;};
  sourceFiles = import ./source-files.nix {inherit lib;};
}
