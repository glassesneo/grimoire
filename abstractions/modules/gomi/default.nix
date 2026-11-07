{delib, ...}:
delib.module {
  name = "gomi";
  tests.fixture = ["zsh.interactive.zabrze"];
  meta.description = "Provide gomi and integrate it into Zsh.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [pkgs.gomi];

    zsh.zabrze.snippets.gomi = {
      trigger = "rm";
      snippet = "gomi";
    };
  };
}
