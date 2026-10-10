# Owns harness-independent skill declarations and their Hjem file outputs.
# Directory sources are linked as <targetDir>/<name>; deployment stays with Hjem.
{
  delib,
  lib,
  ...
}: let
  parts = dir: lib.splitString "/" dir;
  validName = name: name != "" && name != "." && name != ".." && !(lib.hasInfix "/" name);
  validDir = dir: dir != "" && !(lib.hasPrefix "/" dir) && !(lib.elem ".." (parts dir));
  normalize = dir: lib.concatStringsSep "/" (lib.filter (part: part != "" && part != ".") (parts dir));
in
  delib.module {
    name = "skills";
    meta.description = "Declare harness-independent skills and deploy their directories through Hjem.";

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
            type = lib.types.listOf lib.types.str;
            description = "Home-relative destination directories; an empty list deploys nothing.";
          };
        };
      });
    };

    hjem.ifEnabled = {config, ...}: {
      assertions = lib.concatLists (lib.mapAttrsToList (name: skill:
        [
          {
            assertion = validName name;
            message = "skills: name '${name}' must be a single directory name other than '.' or '..'.";
          }
        ]
        ++ map (dir: {
          assertion = validDir dir;
          message = "skills.${name}: targetDir '${dir}' must be non-empty, home-relative, and contain no '..' component.";
        })
        skill.targetDirs)
      config.skills);

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
  }
