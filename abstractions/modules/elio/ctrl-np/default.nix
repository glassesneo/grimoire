{
  delib,
  mylib,
  ...
}: let
  sourceFiles = {
    "src/input_handling/fuzzy_finder.rs" = {
      source = ./src/input_handling/fuzzy_finder.rs;
      upstreamSha256 = "b216fad63178fb03a165096c48afee0d94365ab3c9c055f35a11d908c93d4ee3";
    };
    "src/input_handling/keyboard.rs" = {
      source = ./src/input_handling/keyboard.rs;
      upstreamSha256 = "71f5c820d41e61ab7b0e013c1d302bb2f2e640d702b12d3cfb52db26b5c7666a";
    };
  };
in
  delib.module {
    name = "elio.ctrl-np";
    meta.description = "Move through elio's search results and scroll its help with Ctrl-N and Ctrl-P, which elio hard-codes to the arrow keys.";

    options.enable = delib.boolOption true;

    myconfig.ifEnabled.elio.sourceFiles = sourceFiles;
  }
