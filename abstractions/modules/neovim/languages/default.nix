{delib, ...}:
delib.module {
  name = "neovim.languages";
  tests.fixture = ["neovim"];
  meta.description = "Group language-specific Neovim editing support.";
  options.enable = delib.boolOption true;
}
