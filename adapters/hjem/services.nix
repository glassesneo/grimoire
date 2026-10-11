# Owns Hjem user-service declarations and their Darwin lowering to LaunchAgents.
#
# A service is declared portably in `userServices`, natively in
# `platform.darwin.launchAgents`, or both under one name, which lowers to one
# job. Native `config` adds plist leaves to the portable ones and never replaces
# them: a leaf both define is rejected, as is a native `Program` beside a
# portable command.
#
# The executable and its arguments reach the program as argv, never as shell
# text. Every job first waits for /nix/store to be mounted, so a custom argv[0]
# is not preserved. A Label defaults to a hash of the service name and must be
# unique ignoring case, because it also names the owned plist file. The `user`
# domain, the default, runs in the Background session and is not guaranteed to
# be loaded at login; the `gui` domain runs in the Aqua session that login loads.
#
# Portable services are rejected on Linux, where native declarations are
# ignored. Invalid declarations fail through the assertions, which guard
# `serviceApply`. Lifecycle and ownership are implemented by services.py, not
# nix-darwin.
{
  config,
  lib,
  pkgs,
  ...
}: let
  inherit (lib) mkOption types;
  absolute = types.addCheck types.str (s: lib.hasPrefix "/" s && !lib.hasInfix "\n" s);
  argv = types.addCheck (types.listOf types.str) (xs: xs != [] && lib.hasPrefix "/" (builtins.head xs));
  plist = types.anything;
  portable = types.submodule {
    options = {
      command = mkOption {
        type = types.uniq argv;
        description = "Nonempty argv with an absolute executable; no shell expansion.";
      };
      autoStart = mkOption {
        type = types.bool;
        default = true;
        description = "Start when launchd loads the job; this does not by itself guarantee loading at login or restart it on every switch.";
      };
      restartOnSwitch = mkOption {
        type = types.bool;
        default = false;
        description = "Request a potentially interrupting restart on every switch, except right after registration has started an autoStart job.";
      };
      environment = mkOption {
        type = types.attrsOf types.str;
        default = {};
        description = "Explicit service environment; session inheritance is not guaranteed.";
      };
      workingDirectory = mkOption {
        type = types.nullOr absolute;
        default = null;
        description = "Absolute working directory, when specified.";
      };
    };
  };
  native = types.submodule ({options, ...}: {
    config.policyDefined = lib.any (definition: !(lib.elem definition.file options.restartOnSwitch.declarations)) options.restartOnSwitch.definitionsWithLocations;
    options = {
      policyDefined = mkOption {
        type = types.bool;
        internal = true;
        readOnly = true;
        description = "Whether native restart policy was explicitly declared.";
      };
      domain = mkOption {
        type = types.enum ["user" "gui"];
        description = "Launchctl domain; GUI registration is deferred without a GUI session.";
      };
      config = mkOption {
        type = types.attrsOf plist;
        default = {};
        description = "Native launchd plist fields. For a service also declared in userServices, these extend rather than override the portable declaration; see the contract at the top of this file for constraints.";
      };
      restartOnSwitch = mkOption {
        type = types.bool;
        default = false;
        description = "Native-only switch restart policy; cannot also be defined by a portable declaration.";
      };
    };
  });
  # Adds b's leaves to a, keeping a's leaf and recording the path of each one b
  # would replace.
  merge = path: a: b:
    lib.foldlAttrs (acc: key: value:
      if !(builtins.hasAttr key acc.value)
      then acc // {value = acc.value // {${key} = value;};}
      else if builtins.isAttrs acc.value.${key} && builtins.isAttrs value
      then let
        nested = merge "${path}.${key}" acc.value.${key} value;
      in {
        value = acc.value // {${key} = nested.value;};
        duplicates = acc.duplicates ++ nested.duplicates;
      }
      else acc // {duplicates = acc.duplicates ++ ["${path}.${key}"];})
    {
      value = a;
      duplicates = [];
    }
    b;
  validValue = v:
    builtins.isString v
    || builtins.isBool v
    || builtins.isInt v
    || builtins.isFloat v
    || (builtins.isList v && lib.all validValue v)
    || (builtins.isAttrs v && lib.all validValue (builtins.attrValues v));
  safeLabel = s: builtins.isString s && builtins.match "[A-Za-z0-9][A-Za-z0-9._-]*" s != null;
  jobs = lib.mapAttrs (name: _: let
    p = config.userServices.${name} or null;
    n = config.platform.darwin.launchAgents.${name} or null;
    domain =
      if n == null
      then "user"
      else n.domain;
    extra =
      if n == null
      then {}
      else n.config;
    base =
      if p == null
      then {}
      else
        {
          ProgramArguments = p.command;
          RunAtLoad = p.autoStart;
        }
        // lib.optionalAttrs (p.environment != {}) {EnvironmentVariables = p.environment;}
        // lib.optionalAttrs (p.workingDirectory != null) {WorkingDirectory = p.workingDirectory;};
    combined = merge name base extra;
    merged = combined.value;
    label = merged.Label or "org.hjem.${builtins.hashString "sha256" name}";
    session =
      if domain == "user"
      then "Background"
      else "Aqua";
    program = merged.Program or (builtins.head (merged.ProgramArguments or [""]));
    args = merged.ProgramArguments or [];
    checks =
      safeLabel label
      && validValue merged
      && builtins.isString program
      && lib.hasPrefix "/" program
      && builtins.isList args
      && lib.all builtins.isString args
      && (!(merged ? ProgramArguments) || args != [])
      && (!(merged ? WorkingDirectory) || (builtins.isString merged.WorkingDirectory && lib.hasPrefix "/" merged.WorkingDirectory))
      && (!(merged ? EnvironmentVariables) || (builtins.isAttrs merged.EnvironmentVariables && lib.all builtins.isString (builtins.attrValues merged.EnvironmentVariables)))
      && (!(merged ? RunAtLoad) || builtins.isBool merged.RunAtLoad)
      && (!(merged ? LimitLoadToSessionType) || merged.LimitLoadToSessionType == session || merged.LimitLoadToSessionType == [session]);
  in {
    problem =
      if p != null && extra ? Program
      then "${name}: portable command conflicts with Program"
      else if p != null && n != null && n.policyDefined
      then "${name}: duplicate restartOnSwitch policy"
      else if combined.duplicates != []
      then "duplicate ${lib.concatStringsSep ", " combined.duplicates}"
      else if !checks
      then "${name}: invalid plist identity, executable or session"
      else null;
    job = {
      inherit name label domain;
      restart =
        if p != null
        then p.restartOnSwitch
        else n.restartOnSwitch;
      runAtLoad = merged.RunAtLoad or false;
      # launchd can start a job at login before the Nix store volume is mounted.
      # The command stays positional parameters of the waiting shell.
      config =
        builtins.removeAttrs merged ["Program"]
        // {
          Label = label;
          LimitLoadToSessionType = session;
          ProgramArguments = ["/bin/sh" "-c" ''/bin/wait4path /nix/store && exec "$@"'' "sh" program] ++ lib.drop 1 args;
        };
    };
  }) (config.userServices // config.platform.darwin.launchAgents);
  # Darwin homes commonly use case-insensitive APFS; identities must also be
  # unique as owned filenames, not merely as launchd label strings.
  labels = map (entry: lib.toLower entry.job.label) (builtins.attrValues jobs);
  problems =
    lib.filter (problem: problem != null) (lib.mapAttrsToList (_: entry: entry.problem) jobs)
    ++ lib.optional (builtins.length labels != builtins.length (lib.unique labels)) "duplicate Label"
    ++ lib.optional (!pkgs.stdenv.hostPlatform.isDarwin && config.userServices != {}) "Linux user-service backend is not implemented";
  manifest = pkgs.writeText "hjem-services.json" (builtins.toJSON (map (entry: entry.job) (builtins.attrValues jobs)));
  services =
    if !pkgs.stdenv.hostPlatform.isDarwin
    then pkgs.writeShellScriptBin "apply" "exit 0"
    else
      pkgs.runCommand "hjem-services" {nativeBuildInputs = [pkgs.python3];} ''
        mkdir -p "$out/bin" "$out/plists"
        cp ${manifest} "$out/services.json"
        python3 - "$out" <<'PY'
        import json, plistlib, sys, pathlib
        out = pathlib.Path(sys.argv[1])
        for job in json.loads((out / 'services.json').read_text()):
            (out / 'plists' / (job['label'] + '.plist')).write_bytes(plistlib.dumps(job['config']))
        PY
        cat > "$out/bin/apply" <<'EOF'
        #!${pkgs.runtimeShell}
        exec ${pkgs.python3}/bin/python3 ${./services.py} "$(cd "$(${pkgs.coreutils}/bin/dirname "$0")/.." && pwd)" ${lib.escapeShellArg config.directory} ${pkgs.nix}/bin/nix-store
        EOF
        chmod +x "$out/bin/apply"
      '';
in {
  options = {
    userServices = mkOption {
      type = types.attrsOf portable;
      default = {};
      description = "Portable Hjem-owned user services; currently implemented on Darwin only.";
    };
    platform.darwin.launchAgents = mkOption {
      type = types.attrsOf native;
      default = {};
      description = "Hjem-owned native LaunchAgents, optionally adding to portable jobs of the same name.";
    };
    serviceApply = mkOption {
      type = types.package;
      internal = true;
      readOnly = true;
      description = "Service closure with bin/apply, invoked after standalone file/package activation.";
    };
  };
  config = {
    serviceApply = services;
    assertions =
      map (problem: {
        assertion = false;
        message = "Hjem user services: ${problem}";
      })
      problems;
  };
}
