# Owns harness-independent skill declarations and their Hjem file outputs,
# including the skills this repository ships as sibling directories.
# Directory sources are linked as <targetDir>/<name>; deployment stays with Hjem.
{
  delib,
  lib,
  ...
}: let
  # Each directory is a complete skill package named by its directory.
  ownSkills = ["context-projection-design" "idea-kindling" "parallax-bridge"];
  harnessDirs = [".agents/skills" ".claude/skills"];

  parts = dir: lib.splitString "/" dir;
  validName = name: name != "" && name != "." && name != ".." && !(lib.hasInfix "/" name);
  validDir = dir: dir != "" && !(lib.hasPrefix "/" dir) && !(lib.elem ".." (parts dir));
  normalize = dir: lib.concatStringsSep "/" (lib.filter (part: part != "" && part != ".") (parts dir));

  targetDir =
    lib.types.addCheck lib.types.str validDir
    // {description = "home-relative directory without a '..' component";};
in
  delib.module {
    name = "skills";
    meta.description = "Declare harness-independent skills and deploy them for agent use.";

    options.enable = delib.boolOption true;

    hjem.always.options.skills = lib.mkOption {
      default = {};
      description = "Skills deployed independently of harness configuration.";
      type = lib.types.attrsOf (lib.types.submodule {
        options = {
          source = lib.mkOption {
            type = lib.types.path;
            description = "Source directory of the complete skill package.";
          };
          targetDirs = lib.mkOption {
            type = lib.types.listOf targetDir;
            description = "Home-relative parent directories; the skill is linked under its attribute name in each directory. An empty list deploys nothing.";
          };
        };
      });
    };

    hjem.ifEnabled = {config, ...}: {
      skills = lib.genAttrs ownSkills (name: {
        source = ./. + "/${name}";
        targetDirs = harnessDirs;
      });

      # An element type cannot check attribute names.
      assertions =
        lib.mapAttrsToList (name: _: {
          assertion = validName name;
          message = "skills: name '${name}' must be a single directory name other than '.' or '..'.";
        })
        config.skills;

      files = lib.listToAttrs (lib.concatLists (lib.mapAttrsToList (name: skill:
        map (dir: {
          name = lib.concatStringsSep "/" (lib.optional (dir != "") dir ++ [name]);
          value = {
            inherit (skill) source;
            type = "symlink";
            exclusive = true;
            clobber = false;
          };
        }) (lib.unique (map normalize skill.targetDirs)))
      config.skills));
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
    tests = {
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

      declarations = {
        first.hjem.always.skills.alpha = {
          inherit source;
          targetDirs = [".agents/skills" ".agents//./skills/" ".claude/skills"];
        };
        second.hjem.always.skills.beta = {
          source = otherSource;
          targetDirs = [".cursor/skills"];
        };
      };
      declare = name: targetDirs: {
        declaration.hjem.always.skills.${name} = {inherit source targetDirs;};
      };
      ownTargets = lib.concatMap (name: map (dir: "${home}/${dir}/${name}") harnessDirs) ownSkills;
      # Cases below compare fixture declarations; the shipped skills are
      # always declared and would otherwise appear in every result.
      files = result: lib.filter (file: !(lib.elem file.target ownTargets)) result.manifest.files;
    in
      {
        # A harness selects a skill by its frontmatter name; a mismatch with
        # the deployed directory name deploys a skill no harness selects.
        frontmatter-names-match-directories = {
          expr = _: lib.filter (name: !(lib.hasInfix "\nname: ${name}\n" (builtins.readFile (./. + "/${name}/SKILL.md")))) ownSkills;
          expected = [];
        };
        aggregates-and-normalizes = {
          host.hjem.ifEnabled.skills.alpha = {
            inherit source;
            targetDirs = ["."];
          };
          modules = declarations;
          expr = result: lib.sort lib.lessThan (map (file: "${file.target} -> ${toString file.source}") (files result));
          expected = [
            "${home}/.agents/skills/alpha -> ${source}"
            "${home}/.claude/skills/alpha -> ${source}"
            "${home}/.cursor/skills/beta -> ${otherSource}"
            "${home}/alpha -> ${source}"
          ];
        };
        links-without-clobbering = {
          modules = declarations;
          expr = result: lib.unique (map (file: {inherit (file) type clobber;}) (files result));
          expected = [
            {
              type = "symlink";
              clobber = false;
            }
          ];
        };
        empty-registry = {
          expr = files;
          expected = [];
        };
        empty-target-dirs = {
          modules = declare "unused" [];
          expr = files;
          expected = [];
        };
        disabled-keeps-declarations = {
          host.myconfig.ifEnabled.skills.enable = false;
          modules = declarations;
          expr = files;
          expected = [];
        };
        rejects-second-owner = {
          modules =
            declare "alpha" [".agents/skills"]
            // {intruder.hjem.always.files.".agents/skills/alpha".source = source;};
          fails = "is exclusive but defined by";
        };
      }
      // lib.mapAttrs' (name: lib.nameValuePair "rejects-name-${builtins.toJSON name}") (lib.genAttrs ["" "." ".." "nested/name"] (name: {
        modules = declare name [".agents/skills"];
        fails = "must be a single directory name";
      }))
      // lib.mapAttrs' (dir: lib.nameValuePair "rejects-dir-${builtins.toJSON dir}") (lib.genAttrs ["" "/absolute" ".." "safe/../escape"] (dir: {
        modules = declare "alpha" [dir];
        expr = files;
        fails = true;
      }));
  }
