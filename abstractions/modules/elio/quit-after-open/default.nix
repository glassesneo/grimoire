{
  delib,
  inputs,
  mylib,
  ...
}: let
  sourceFiles = {
    "src/terminal_runtime/tui_event_loop.rs" = {
      source = ./src/terminal_runtime/tui_event_loop.rs;
      upstreamSha256 = "5a16d869a0e4e44143dd8fd374860b72b182b0e776c9254e146d1dc45cc34fd0";
    };
  };
in
  delib.module {
    name = "elio.quit-after-open";
    meta.description = "Quit elio without changing the shell's directory once a program it opened in the terminal exits successfully.";

    options.enable = delib.boolOption true;

    myconfig.ifEnabled.elio.sourceFiles = sourceFiles;

    # The replacements were written against the files of the locked upstream source.
    tests = _: {
      upstream = mylib.sourceFiles.upstreamCase inputs.elio sourceFiles;
    };
  }
