{lib}: {
  fragments = import ./fragments.nix {inherit lib;};
  plist = import ./plist.nix {inherit lib;};
}
