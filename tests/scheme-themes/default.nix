{pkgs, ...}: let
  lib = pkgs.lib;
  mylib = import ../../lib {inherit lib;};

  themes = mylib.schemeThemes {
    name = "fixture";
    themes.known = "entry";
  };
  following = {useColorscheme = true;};
  unmanaged = {useColorscheme = false;};
  known = {name = "known";};
  unknown = {name = "unknown";};
in {
  check = assert lib.assertMsg (themes.select following known == "entry" && (themes.constraint following known).assertion)
  "A followed scheme in the table selects its entry";
  assert lib.assertMsg (themes.select following null == null && (themes.constraint following null).assertion)
  "Without a selected scheme, nothing is selected and nothing is rejected";
  assert lib.assertMsg (themes.select unmanaged known == null && themes.select unmanaged unknown == null && (themes.constraint unmanaged unknown).assertion)
  "An application that does not follow the scheme selects nothing and accepts any scheme";
  assert lib.assertMsg (!(themes.constraint following unknown).assertion)
  "A followed scheme absent from the table is rejected";
  assert lib.assertMsg ((themes.constraint following unknown).message == "fixture has no theme for colorscheme \"unknown\"; set fixture.useColorscheme = false to leave its colors unmanaged")
  "The rejection names the scheme and the option that leaves the colors unmanaged";
  assert lib.assertMsg (themes.of known == "entry" && themes.of unknown == null && themes.of null == null)
  "`of` finds the entry of a resolved scheme whatever the application follows";
    pkgs.runCommand "scheme-themes-test" {} ''
      mkdir "$out"
    '';
}
