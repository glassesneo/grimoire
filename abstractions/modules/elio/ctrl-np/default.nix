{delib, ...}:
delib.module {
  name = "elio.ctrl-np";
  tests.fixture = ["elio"];
  meta.description = "Move through elio's search results and scroll its help with Ctrl-N and Ctrl-P, which elio hard-codes to the arrow keys.";

  options.enable = delib.boolOption true;

  myconfig.ifEnabled.elio.patches = [./ctrl-np.patch];
}
