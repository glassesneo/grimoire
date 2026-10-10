{
  inputs,
  denix,
  pkgs,
  system,
}: let
  lib = pkgs.lib;

  # Checks repository-owned lowering at the manifest boundary: wrong paths,
  # enable leaks, or missing exclusivity can deploy a skill to the wrong place.
  # Hjem's symlink execution and general exclusivity checks remain trusted.
  source = pkgs.runCommand "skills-fixture" {} ''
    mkdir -p "$out/references"
    printf '%s\n' '# Synthetic skill' > "$out/SKILL.md"
    printf '%s\n' 'Synthetic reference' > "$out/references/note.md"
  '';
  otherSource = pkgs.writeTextDir "SKILL.md" "# Other synthetic skill";
  home = "/tmp/skills-fixture";

  host = extra: {delib, ...}:
    delib.host ({
        name = "fixture";
        inherit system;
        user.name = "fixture";
      }
      // extra);

  contributor = name: config: {delib, ...}:
    delib.module {
      inherit name;
      meta.description = "Contribute synthetic declarations for the skills check.";
      hjem.always = config;
    };

  result = modules:
    (denix.lib.denixConfiguration {
      extraInputs = inputs;
      modules =
        [
          denix.denixModules.nixDarwin
          ../../adapters/hjem
          ../../extensions/hosts.nix
          ../../extensions/module-metadata.nix
          ../../extensions/provenance.nix
          ../../abstractions/modules/agents/skills
        ]
        ++ modules;
    }).genSystem {
      moduleSystem = "hjem";
      host = "fixture";
      extraArgs = {
        inherit system;
        username = "fixture";
        homeDirectory = home;
      };
    };

  manifest = modules: (result modules).manifest;
  fails = modules: !(builtins.tryEval (builtins.deepSeq (manifest modules) true)).success;
  declare = name: targetDirs:
    contributor "declaration" {
      skills.${name} = {inherit source targetDirs;};
    };

  declarations = [
    (contributor "first" {
      skills.alpha = {
        inherit source;
        targetDirs = [".agents/skills" ".agents//./skills/" ".claude/skills"];
      };
    })
    (contributor "second" {
      skills.beta = {
        source = otherSource;
        targetDirs = [".cursor/skills"];
      };
    })
  ];
  normal = result ([
      (host {
        hjem.ifEnabled.skills.alpha = {
          inherit source;
          targetDirs = ["."];
        };
      })
    ]
    ++ declarations);
  files = normal.manifest.files;
  expected = {
    "${home}/.agents/skills/alpha" = toString source;
    "${home}/.claude/skills/alpha" = toString source;
    "${home}/alpha" = toString source;
    "${home}/.cursor/skills/beta" = toString otherSource;
  };
  actual = lib.listToAttrs (map (file: {
      name = file.target;
      value = toString file.source;
    })
    files);

  invalidNames = ["" "." ".." "nested/name"];
  invalidDirs = ["" "/absolute" ".." "safe/../escape"];
in
  assert lib.assertMsg (actual == expected && builtins.length files == builtins.length (builtins.attrNames expected))
  "Skill declarations must aggregate, normalize, and link each complete source at the requested targets";
  assert lib.assertMsg (lib.all (file: file.type == "symlink" && !file.clobber) files)
  "Skill outputs must be non-clobbering symlinks";
  assert lib.assertMsg ((manifest [(host {})]).files == [])
  "An empty skill registry must produce no files";
  assert lib.assertMsg ((manifest [(host {}) (declare "unused" [])]).files == [])
  "Empty targetDirs must produce no files";
  assert lib.assertMsg ((manifest ([
      (host {myconfig.ifEnabled.skills.enable = false;})
    ]
    ++ declarations)).files
  == [])
  "Disabling skills must stop outputs while retaining its declaration options";
  assert lib.assertMsg (fails [
    (host {})
    (declare "alpha" [".agents/skills"])
    (contributor "intruder" {files.".agents/skills/alpha".source = source;})
  ])
  "Skill files must reject a second owner even when its source agrees";
  assert lib.assertMsg (lib.all (name: fails [(host {}) (declare name [".agents/skills"])]) invalidNames)
  "Skill names must not escape their single directory component";
  assert lib.assertMsg (lib.all (dir: fails [(host {}) (declare "alpha" [dir])]) invalidDirs)
  "Skill targetDirs must stay within the home directory";
    pkgs.runCommand "skills-test" {
      inherit (normal) preflight;
      skillSource = source;
      otherSkillSource = otherSource;
    } ''
      set -eu
      grep -Fxq "$skillSource" "$preflight"
      grep -Fxq "$otherSkillSource" "$preflight"
      mkdir "$out"
    ''
