# Owns harness-independent skill declarations and their Hjem file outputs,
# including the skills this repository ships as sibling directories.
# Every skill is linked as <dir>/<name> in every directory of skillDirs;
# deployment stays with Hjem.
{
  delib,
  lib,
  ...
}: let
  # Each directory is a complete skill package named by its directory.
  ownSkills = ["context-projection-design" "decision-rebase" "idea-kindling" "parallax-bridge"];

  # Paths are compared as written, so only their normal form is accepted.
  component = part: !(lib.elem part ["" "." ".."]);
  relativePath = path: lib.all component (lib.splitString "/" path);

  skillDir =
    lib.types.addCheck lib.types.str relativePath
    // {description = "home-relative directory without empty, '.' or '..' components";};
  skillSet =
    lib.types.addCheck (lib.types.attrsOf lib.types.path) (skills: lib.all (name: relativePath name && !lib.hasInfix "/" name) (lib.attrNames skills))
    // {description = "attribute set of path named by single directory names other than '.' or '..'";};
in
  delib.module {
    name = "skills";
    meta.description = "Declare harness-independent skills and deploy them for agent use.";

    options.enable = delib.boolOption true;

    hjem.always.options = {
      skills = lib.mkOption {
        type = skillSet;
        default = {};
        description = "Source directories of complete skill packages, by skill name.";
      };
      skillDirs = lib.mkOption {
        type = lib.types.listOf skillDir;
        default = [];
        description = "Directories in which every skill is linked under its name; a harness adds the directories it reads.";
      };
    };

    hjem.ifEnabled = {config, ...}: {
      skills = lib.genAttrs ownSkills (name: ./. + "/${name}");
      skillDirs = [".agents/skills"];

      files = lib.listToAttrs (lib.concatMap (dir:
        lib.mapAttrsToList (name: source: {
          name = "${dir}/${name}";
          value = {
            inherit source;
            type = "symlink";
            exclusive = true;
            clobber = false;
          };
        })
        config.skills)
      config.skillDirs);
    };

    bundles.ifEnabled = {pkgs, ...}: {
      skills = {
        package = pkgs.linkFarm "skills" (map (name: {
            inherit name;
            path = ./. + "/${name}";
          })
          ownSkills);
        publish = true;
      };
    };

    # Wrong paths, enable leaks, or missing exclusivity would deploy a skill to
    # the wrong place; Hjem's symlink execution remains trusted.
    tests.fixture = ["exclusive"];
    tests.cases = {
      pkgs,
      home,
      ...
    }: let
      source = pkgs.runCommand "skills-fixture" {} ''
        mkdir -p "$out/references"
        printf '%s\n' '# Synthetic skill' > "$out/SKILL.md"
        printf '%s\n' 'Synthetic reference' > "$out/references/note.md"
      '';
      otherSource = pkgs.writeTextDir "SKILL.md" "# Other synthetic skill";

      declare = attrs: {declaration.hjem.always = attrs;};
      # Cases below compare fixture declarations; the shipped skills are
      # always declared and would otherwise appear in every result.
      files = result: lib.filter (file: !(lib.elem (baseNameOf file.target) ownSkills)) result.manifest.files;
    in
      {
        # A harness selects a skill by its frontmatter name; a mismatch with
        # the deployed directory name deploys a skill no harness selects.
        frontmatter-names-match-directories = {
          protects = "each shipped skill's frontmatter name is its directory name, by which harnesses select it";
          expr = _: lib.filter (name: !(lib.hasInfix "\nname: ${name}\n" (builtins.readFile (./. + "/${name}/SKILL.md")))) ownSkills;
          expected = [];
        };
        every-skill-in-every-dir = {
          protects = "skills and directories from every definer combine, each skill linked once in each directory";
          host.hjem.ifEnabled.skillDirs = [".agents/skills"];
          modules = {
            first.hjem.always = {
              skills.alpha = source;
              skillDirs = [".claude/skills"];
            };
            second.hjem.always.skills.beta = otherSource;
          };
          expr = result: lib.sort lib.lessThan (map (file: "${file.target} -> ${toString file.source}") (files result));
          expected = [
            "${home}/.agents/skills/alpha -> ${source}"
            "${home}/.agents/skills/beta -> ${otherSource}"
            "${home}/.claude/skills/alpha -> ${source}"
            "${home}/.claude/skills/beta -> ${otherSource}"
          ];
        };
        disabled-deploys-nothing = {
          protects = "a disabled skills module links no skill, whatever other modules declare";
          host.myconfig.ifEnabled.skills.enable = false;
          modules = declare {
            skills.alpha = source;
            skillDirs = [".claude/skills"];
          };
          expr = files;
          expected = [];
        };
      }
      // lib.mapAttrs' (name: lib.nameValuePair "rejects-name-${builtins.toJSON name}") (lib.genAttrs ["" "." ".." "nested/name"] (name: {
        protects = "a skill name is a single directory name";
        modules = declare {skills.${name} = source;};
        expr = files;
        fails = true;
      }))
      // lib.mapAttrs' (dir: lib.nameValuePair "rejects-dir-${builtins.toJSON dir}") (lib.genAttrs ["" "/absolute" "." ".." "safe/../escape" "trailing/" "double//slash"] (dir: {
        protects = "a skill directory is a home-relative path in normal form";
        modules = declare {
          skills.alpha = source;
          skillDirs = [dir];
        };
        expr = files;
        fails = true;
      }));
  }
