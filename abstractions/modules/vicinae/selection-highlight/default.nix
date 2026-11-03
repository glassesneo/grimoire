{
  delib,
  mylib,
  ...
}: let
  sourceFiles = {
    "src/server/src/ui/qml/list/SelectableDelegate.qml" = {
      source = ./src/server/src/ui/qml/list/SelectableDelegate.qml;
      upstreamSha256 = "029292b086bcf45133a038dfe793393ce6193cd72214e50a0e30f8d09f63b8fd";
    };
    "src/server/src/ui/qml/views/GenericListView.qml" = {
      source = ./src/server/src/ui/qml/views/GenericListView.qml;
      upstreamSha256 = "d8001e34966ab356648145db18444ff1fdb04c72238fc5adcb442869edb8397a";
    };
  };
in
  delib.module {
    name = "vicinae.selection-highlight";
    meta.description = "Animate the Vicinae selection highlight as it moves between list items.";

    options.enable = delib.boolOption false;

    myconfig.ifEnabled.vicinae.sourceFiles = sourceFiles;
  }
