{delib, ...}:
delib.module {
  name = "elio.quit-after-open";
  tests.fixture = ["elio"];
  meta.description = "Quit elio without changing the shell's directory once a program it opened in the terminal exits successfully.";

  options.enable = delib.boolOption true;

  myconfig.ifEnabled.elio.patches = [./quit-after-open.patch];
}
