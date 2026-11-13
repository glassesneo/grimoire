{
  delib,
  mylib,
  ...
}: let
  source = (mylib.anchors.sources ./anchors.json).ponytail;
in
  delib.module {
    name = "skills.ponytail";
    tests.fixture = ["skills"];
    meta.description = "Deploy the Ponytail skill.";

    options.enable = delib.boolOption false;

    hjem.ifEnabled.skills.ponytail = source + "/skills/ponytail";

    tests.cases = {lib, ...}: let
      names = result: lib.sort lib.lessThan (map (file: baseNameOf file.target) result.manifest.files);
    in {
      deploys-only-the-main-skill = {
        protects = "Ponytail deploys the main skill directory and none of the upstream sibling skills";
        host.myconfig.ifEnabled.skills.ponytail.enable = true;
        expr = result: let
          deployed = names result;
          upstream = lib.filter (name: name != "plugin.json") (builtins.attrNames (builtins.readDir (source + "/skills")));
        in {
          deployed = lib.elem "ponytail" deployed;
          siblings = lib.intersectLists (lib.subtractLists ["ponytail"] upstream) deployed;
          named = lib.hasInfix "\nname: ponytail\n" (builtins.readFile (source + "/skills/ponytail/SKILL.md"));
        };
        expected = {
          deployed = true;
          siblings = [];
          named = true;
        };
      };
    };
  }
