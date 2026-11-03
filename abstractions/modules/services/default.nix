# Owns Hjem user-service declarations and their Darwin lowering to LaunchAgents.
#
# A service is declared portably in `userServices`, natively in
# `platform.darwin.launchAgents`, or both under one name, which lowers to one
# job. Native `config` adds plist leaves to the portable ones and never replaces
# them: a leaf both define is rejected, as is a native `Program` beside a
# portable command. Plist values may be strings, booleans, integers, finite
# floats, lists or dictionaries. XML control characters in strings or keys are
# rejected; `_module` keys are outside the supported plist contract.
#
# The executable and its arguments reach the program as argv, never as shell
# text. Every job first waits for /nix/store to be mounted, so a custom argv[0]
# is not preserved. A Label defaults to a hash of the service name and must be
# unique ignoring case, because it also names the owned plist file. The `user`
# domain, the default, runs in the Background session and is not guaranteed to
# be loaded at login; the `gui` domain runs in the Aqua session that login loads.
#
# `platform.darwin.serviceTargets` resolves each declared name to the launchd
# domain and Label of its job, on any host. It describes declarations, not jobs
# that are loaded or ready.
#
# Portable services are rejected on Linux, where native declarations are
# ignored. Invalid declarations fail through the assertions, which guard the
# Hjem result. The apply step is registered even without declarations, so
# removing the last one still retires its job. The step's `jobs` and `plists`
# passthrus expose the manifest values and Nix-generated plist files (empty on
# Linux) for evaluation checks. Lifecycle and ownership are implemented by
# reconciler/reconciler.cr, not nix-darwin.
{
  delib,
  mylib,
  ...
}:
delib.module {
  name = "services";
  meta.description = "Declare user services and reconcile them with the platform's service manager.";

  hjem.always = {
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
    inherit (mylib.plist) validValue validXml toPlist;
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
        else if !validValue merged
        then "${name}: unsupported plist value"
        else if !validXml merged
        then "${name}: XML control characters in plist keys or strings"
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
    serviceJobs = lib.optionals pkgs.stdenv.hostPlatform.isDarwin (map (entry: entry.job) (builtins.attrValues jobs));
    manifest = pkgs.writeText "hjem-services.json" (builtins.toJSON serviceJobs);
    plists = lib.listToAttrs (map (job:
      lib.nameValuePair job.label
      (pkgs.writeText "${job.label}.plist" (toPlist job.config)))
    serviceJobs);
    reconciler = pkgs.callPackage ./reconciler/package.nix {};
    services =
      if !pkgs.stdenv.hostPlatform.isDarwin
      then pkgs.writeShellScriptBin "apply" "exit 0"
      else
        pkgs.runCommand "hjem-services" {} ''
          mkdir -p "$out/bin" "$out/plists"
          cp ${manifest} "$out/services.json"
          ${lib.concatStringsSep "\n" (lib.mapAttrsToList (label: plist: ''cp ${plist} "$out/plists/${label}.plist"'') plists)}
          cat > "$out/bin/apply" <<'EOF'
          #!${pkgs.runtimeShell}
          exec ${reconciler}/bin/hjem-services-reconcile "$(cd "$(${pkgs.coreutils}/bin/dirname "$0")/.." && pwd)" ${lib.escapeShellArg config.directory} ${pkgs.nix}/bin/nix-store
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
      platform.darwin.serviceTargets = mkOption {
        type = types.attrsOf (types.submodule {
          options = {
            domain = mkOption {
              type = types.enum ["user" "gui"];
              description = "Launchctl domain of the job.";
            };
            label = mkOption {
              type = types.str;
              description = "Label of the job.";
            };
          };
        });
        readOnly = true;
        description = "Launchd domain and Label of each declared service, by name.";
      };
    };
    config = {
      platform.darwin.serviceTargets = lib.mapAttrs (_: entry: {inherit (entry.job) domain label;}) jobs;
      applySteps.services.package = services.overrideAttrs (_: {
        passthru = {
          jobs = serviceJobs;
          inherit plists;
        };
      });
      assertions =
        map (problem: {
          assertion = false;
          message = "Hjem user services: ${problem}";
        })
        problems;
    };
  };

  # Lowering is observed before serialization; lib/plist.nix owns plist syntax.
  # The output build checks file placement, and the reconciler specs own
  # lifecycle transitions.
  tests = {pkgs, ...}: let
    inherit (pkgs) lib;
    darwin = ["aarch64-darwin"];
    jobsOf = result: lib.listToAttrs (map (job: lib.nameValuePair job.name job) result.apply.steps.services.jobs);
    controls = builtins.fromJSON ''["\u0001", "\u0008", "\u000b", "\u000c", "\u000e", "\u001f"]'';
    wait = ["/bin/sh" "-c" ''/bin/wait4path /nix/store && exec "$@"'' "sh"];
    good.hjem.always = {
      userServices = {
        example = {
          command = ["${pkgs.coreutils}/bin/true" "literal $arg"];
          environment.A = "a";
        };
        manual = {
          command = ["${pkgs.coreutils}/bin/true"];
          autoStart = false;
        };
      };
      platform.darwin.launchAgents = {
        example = {
          domain = "user";
          config.EnvironmentVariables.B = "b";
        };
        native = {
          domain = "gui";
          config = {
            Program = "${pkgs.coreutils}/bin/true";
            Label = "fixture.native";
            EnvironmentVariables."A&B" = "<value>\t\n\r${builtins.fromJSON ''"\u007f"''}";
            Extra = [true false (-1) [] {nested = "value";}];
          };
        };
      };
    };
    base = {userServices.x.command = ["/bin/true"];};
    bad = extra:
      lib.recursiveUpdate base {
        platform.darwin.launchAgents.x = {
          domain = "user";
          config = extra;
        };
      };
    # Declaration errors are constraints, so a rejection names its reason.
    rejects = reason: declarations: {
      protects = "a declaration that cannot be lowered safely is rejected, naming its reason";
      platforms = darwin;
      modules.fixture.hjem.always = declarations;
      fails = reason;
    };
    agent = domain: label: {
      inherit domain;
      config = {
        Label = label;
        Program = "/bin/true";
      };
    };
  in
    {
      lowering = {
        protects = "portable and native declarations lower to launchd jobs with escaped values";
        platforms = darwin;
        modules.fixture = good;
        expr = result: let
          jobs = jobsOf result;
          xml = result.apply.steps.services.plists."fixture.native".text;
        in {
          exampleArguments = jobs.example.config.ProgramArguments;
          inherit (jobs.example.config) EnvironmentVariables LimitLoadToSessionType;
          nativeArguments = jobs.native.config.ProgramArguments;
          nativeProgram = jobs.native.config ? Program;
          # Observe the escape=true wiring, not the serializer's syntax.
          escaped = map (text: lib.hasInfix text xml) [
            ''/bin/wait4path /nix/store &amp;&amp; exec &quot;$@&quot;''
            "<key>A&amp;B</key>"
            "<string>&lt;value&gt;"
          ];
          runAtLoad = lib.genAttrs ["example" "manual"] (name: [jobs.${name}.config.RunAtLoad jobs.${name}.runAtLoad]);
        };
        expected = {
          exampleArguments = wait ++ ["${pkgs.coreutils}/bin/true" "literal $arg"];
          EnvironmentVariables = {
            A = "a";
            B = "b";
          };
          LimitLoadToSessionType = "Background";
          nativeArguments = wait ++ ["${pkgs.coreutils}/bin/true"];
          nativeProgram = false;
          escaped = [true true true];
          runAtLoad = {
            example = [true true];
            manual = [false false];
          };
        };
      };
      reconciler = {
        protects = "the reconciler builds and passes its own tests";
        build = _: pkgs.callPackage ./reconciler/package.nix {};
      };
      linux-portable = {
        protects = "portable services are rejected on Linux, which has no user-service backend";
        host.system = "x86_64-linux";
        modules.fixture.hjem.always = base;
        fails = "Linux user-service backend";
      };
      linux-native-ignored = {
        protects = "native launchd declarations are ignored on Linux";
        host.system = "x86_64-linux";
        modules.fixture.hjem.always.platform.darwin.launchAgents.native = {
          domain = "gui";
          config.Program = "/bin/true";
        };
        expr = result: result.apply.steps.services.jobs;
        expected = [];
      };
      duplicate-label-case = rejects "duplicate Label" {
        platform.darwin.launchAgents = {
          a = agent "user" "Org.Test";
          b = agent "gui" "org.test";
        };
      };
      duplicate-label = rejects "duplicate Label" {
        platform.darwin.launchAgents = {
          a = agent "user" "same";
          b = agent "gui" "same";
        };
      };
      duplicate-environment = rejects "duplicate x.EnvironmentVariables.A" (lib.recursiveUpdate (bad {EnvironmentVariables.A = "same";}) {userServices.x.environment.A = "same";});
      duplicate-working-directory = rejects "duplicate x.WorkingDirectory" (lib.recursiveUpdate (bad {WorkingDirectory = "/tmp";}) {userServices.x.workingDirectory = "/tmp";});
      duplicate-relative-arguments = rejects "duplicate x.ProgramArguments" (bad {ProgramArguments = ["relative"];});
      duplicate-arguments = rejects "duplicate x.ProgramArguments" (bad {ProgramArguments = ["/bin/true"];});
      program-conflict = rejects "portable command conflicts with Program" (bad {Program = "/bin/true";});
      duplicate-run-at-load = rejects "duplicate x.RunAtLoad" (bad {RunAtLoad = true;});
      unsafe-label = rejects "invalid plist identity" (bad {Label = "../unsafe";});
      foreign-session = rejects "invalid plist identity" (bad {LimitLoadToSessionType = "Aqua";});
      infinite-float = rejects "unsupported plist value" (bad {ThrottleInterval = 1.0e308 * 10.0;});
      null-value = rejects "unsupported plist value" (bad {Extra = [{nested = null;}];});
      control-key = rejects "XML control characters" (bad {EnvironmentVariables."bad${builtins.head controls}" = "value";});
      control-argument = rejects "XML control characters" {userServices.x.command = ["/bin/true" (builtins.head controls)];};
      duplicate-policy = rejects "duplicate restartOnSwitch policy" (lib.recursiveUpdate base {
        platform.darwin.launchAgents.x = {
          domain = "user";
          restartOnSwitch = false;
        };
      });
    }
    // lib.listToAttrs (lib.imap0 (index: control:
      lib.nameValuePair "control-value-${toString index}"
      (rejects "XML control characters" (bad {Extra = [{nested = control;}];})))
    controls);
}
