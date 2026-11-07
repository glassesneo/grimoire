# Owns Hjem user-service declarations and their Darwin lowering to a dinit user
# instance that one LaunchAgent starts.
#
# Each `userServices.<name>` lowers to a dinit service description that Hjem
# places in `$XDG_CONFIG_HOME/dinit.d/<name>`. A command is serialized as
# quoted arguments with `\`, `"` and `$` escaped, so each element reaches the
# program as one argument, never as shell text or a variable reference.
# `environment` becomes an env-file whose values are literal. `memberOf` adds
# the service to each named group as a waits-for dependency of that group.
# `login`, the group dinit starts, is not declared: the module writes its
# description from the services naming it. A service that `login` reaches
# through waits-for or depends-on dependencies is "automatic": it starts with
# dinit and after a switch that adds or changes it.
#
# A home without services gets no dinit: nothing is placed and the apply step
# retires an agent a previous generation left.
#
# dinit runs from a bundle with a stable code-signing identity, so TCC grants
# given to it survive rebuilds; TCC attributes the processes it starts to it.
# One gui-domain LaunchAgent, named by `serviceManager.label`, starts it in the
# Aqua session that login loads, after /nix/store is mounted. Its control
# socket is `serviceManager.socket`, the default socket of a user instance
# without XDG_RUNTIME_DIR, so `dinitctl` reaches it without options.
#
# The apply step runs reconcile.nu, which states the switch-time lifecycle; its
# output also holds the descriptions in `dinit.d`, and its `services` passthru
# exposes the lowered declarations, dependencies first, for evaluation checks.
# `serviceManager.restart` is the command that restarts one service for other
# steps.
#
# Service names must be usable as dinit names and file names. Invalid
# declarations fail through the assertions, which guard the Hjem result. On
# non-Darwin systems nothing starts dinit, so declaring a service fails there;
# the apply step is then a no-op.
{
  delib,
  mylib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "services";
  meta.description = "Declare user services and run them under a dinit user instance that the platform's service manager starts.";

  hjem.always = {
    config,
    lib,
    pkgs,
    ...
  }: let
    inherit (lib) mkOption types;
    isDarwin = pkgs.stdenv.hostPlatform.isDarwin;
    active = isDarwin && config.userServices != {};
    oneLine = s: !(lib.hasInfix "\n" s) && !(lib.hasInfix "\r" s);
    absolute = types.addCheck types.str (s: lib.hasPrefix "/" s && oneLine s);
    argv = types.addCheck (types.listOf types.str) (xs: xs != [] && lib.hasPrefix "/" (builtins.head xs) && lib.all oneLine xs);
    nameList = types.listOf types.str;
    service = types.submodule {
      options = {
        type = mkOption {
          type = types.enum ["process" "scripted" "internal"];
          default = "process";
          description = "A process runs until it exits; a scripted service is started when its command has succeeded; an internal service runs nothing and groups its dependencies.";
        };
        command = mkOption {
          type = types.nullOr (types.uniq argv);
          default = null;
          description = "Argv with an absolute executable, required unless `type` is internal; no shell expansion or variable substitution.";
        };
        environment = mkOption {
          type = types.attrsOf (types.addCheck types.str oneLine);
          default = {};
          description = "Variables added to the environment dinit passes on; values are literal.";
        };
        workingDirectory = mkOption {
          type = types.nullOr absolute;
          default = null;
        };
        restart = mkOption {
          type = types.enum ["always" "on-failure" "never"];
          default = "on-failure";
          description = "When dinit starts the service again after it stops other than by request; on-failure applies only to processes and means never for other types.";
        };
        dependsOn = mkOption {
          type = nameList;
          default = [];
          description = "Services that must start before this one; stopping one stops this one.";
        };
        waitsFor = mkOption {
          type = nameList;
          default = [];
          description = "Services started with this one and waited for, whose failure does not prevent it.";
        };
        after = mkOption {
          type = nameList;
          default = [];
          description = "Services this one waits for when both are starting, without starting them.";
        };
        before = mkOption {
          type = nameList;
          default = [];
          description = "Services that wait for this one when both are starting, without starting it.";
        };
        memberOf = mkOption {
          type = nameList;
          default = [root];
          description = "Groups that wait for this service when they start; `[]` leaves it to manual start.";
        };
        logFile = mkOption {
          type = types.nullOr absolute;
          default = null;
          description = "File receiving the service's standard output and error.";
        };
        restartOnSwitch = mkOption {
          type = types.bool;
          default = false;
          description = "Rerun on every switch: restart when started, otherwise start when `login` reaches it.";
        };
      };
    };

    root = "login";
    declared = config.userServices;
    names = builtins.attrNames declared;
    namePattern = "[A-Za-z0-9][A-Za-z0-9._-]*";
    safeName = name: builtins.match namePattern name != null;
    safeVariable = name: builtins.match "[A-Za-z_][A-Za-z0-9_]*" name != null;
    # dinit removes the quotes and backslash escapes, then substitutes variables.
    quote = s: "\"" + lib.replaceStrings ["\\" "\"" "$"] ["\\\\" "\\\"" "$$"] s + "\"";
    restartValue = {
      always = "yes";
      on-failure = "on-failure";
      never = "no";
    };
    membersOf = group: lib.filter (name: lib.elem group declared.${name}.memberOf) names;
    waitsOf = lib.mapAttrs (name: entry: lib.unique (entry.waitsFor ++ membersOf name)) declared;
    closure = start: next:
      map (item: item.key) (builtins.genericClosure {
        startSet = map (key: {inherit key;}) start;
        operator = item: map (key: {inherit key;}) (next item.key);
      });
    automatic = lib.genAttrs (closure (membersOf root) (name: lib.filter (dependency: declared ? ${dependency}) (declared.${name}.dependsOn ++ waitsOf.${name}))) (_: true);
    # The services a restart with --force also restarts.
    dependentsOf = name: lib.remove name (closure [name] (dependency: lib.filter (other: lib.elem dependency declared.${other}.dependsOn) names));

    envFile = name: entry: pkgs.writeText "dinit-${name}.env" (lib.concatStrings (lib.mapAttrsToList (key: value: "${key}=${value}\n") entry.environment));
    text = name: entry:
      lib.concatMapStrings (line: line + "\n") (
        ["type = ${entry.type}"]
        ++ lib.optionals (entry.type != "internal" && entry.command != null) (
          [
            "command = ${lib.concatMapStringsSep " " quote entry.command}"
            "restart = ${restartValue.${entry.restart}}"
          ]
          ++ lib.optional (entry.environment != {}) "env-file = ${quote (toString (envFile name entry))}"
          ++ lib.optional (entry.workingDirectory != null) "working-dir = ${quote entry.workingDirectory}"
          ++ lib.optionals (entry.logFile != null) ["log-type = file" "logfile = ${quote entry.logFile}"]
        )
        ++ map (dependency: "depends-on = ${dependency}") entry.dependsOn
        ++ map (dependency: "waits-for = ${dependency}") waitsOf.${name}
        ++ map (other: "after = ${other}") entry.after
        ++ map (other: "before = ${other}") entry.before
      );
    descriptions =
      lib.mapAttrs (name: entry: pkgs.writeText "dinit-${name}" (text name entry)) declared
      // {${root} = pkgs.writeText "dinit-${root}" (lib.concatMapStrings (line: line + "\n") (["type = internal"] ++ map (name: "waits-for = ${name}") (membersOf root)));};
    directory = pkgs.linkFarm "dinit.d" (lib.mapAttrsToList (name: path: {inherit name path;}) descriptions);

    relations = ["dependsOn" "waitsFor" "after" "before" "memberOf"];
    # Whether dinit starts or orders `a` before `b`.
    precedes = a: b:
      lib.elem a (declared.${b}.dependsOn ++ waitsOf.${b} ++ declared.${b}.after)
      || lib.elem b declared.${a}.before;
    # Dependencies before their dependents.
    sorted = lib.toposort precedes (lib.filter safeName names);
    # Descriptions are files, and Darwin homes are commonly case-insensitive.
    folded = map lib.toLower names;
    problems = let
      references = name: entry:
        lib.concatMap (field:
          map (other: "${name}.${field}: unknown service ${other}")
          (lib.filter (other: !(declared ? ${other} || (field == "memberOf" && other == root))) entry.${field}))
        relations;
      self = name: entry: lib.filter (field: lib.elem name entry.${field}) relations;
    in
      lib.concatLists (lib.mapAttrsToList (name: entry:
        lib.optional (!safeName name) "${name}: invalid service name"
        ++ lib.optional (entry.type == "internal" && entry.command != null) "${name}: an internal service has no command"
        ++ lib.optional (entry.type != "internal" && entry.command == null) "${name}: a ${entry.type} service needs a command"
        ++ map (key: "${name}.environment: invalid variable name ${key}") (lib.filter (key: !safeVariable key) (builtins.attrNames entry.environment))
        ++ map (field: "${name}.${field}: a service cannot name itself") (self name entry)
        ++ references name entry)
      declared)
      ++ lib.optional (declared ? ${root}) "${root} is the group dinit starts and cannot be declared"
      ++ lib.optional (builtins.length folded != builtins.length (lib.unique folded)) "service names must differ ignoring case"
      ++ lib.optional (sorted ? cycle) "dependency cycle through ${lib.concatStringsSep ", " sorted.cycle}"
      ++ lib.optional (!isDarwin && declared != {}) "starting dinit is implemented only on Darwin";

    manager = config.serviceManager;
    dinitctl = "${pkgs.dinit}/bin/dinitctl";
    servicesDirectory = "${config.xdg.config.directory}/dinit.d";
    bundle = myconfig.app-identity.mkAppBundle {
      executable = "${pkgs.dinit}/bin/dinit";
      name = "dinit";
      inherit (pkgs.dinit) version;
      identifier = "io.github.davmac314.dinit";
    };
    agent = {
      Label = manager.label;
      ProgramArguments = [
        "/bin/sh"
        "-c"
        ''/bin/wait4path /nix/store && exec "$@"''
        "sh"
        bundle.mainExecutable
        "--user"
        "--quiet"
        "--services-dir"
        servicesDirectory
        "--socket-path"
        manager.socket
        "--log-file"
        "${config.directory}/Library/Logs/dinit.log"
        root
      ];
      RunAtLoad = true;
      # dinit exits with success after `dinitctl shutdown` and stays stopped
      # until login or a switch starts it.
      KeepAlive.SuccessfulExit = false;
      LimitLoadToSessionType = "Aqua";
      ProcessType = "Interactive";
    };
    # Dependencies come before their dependents, the order the reconciler
    # relies on; assertions guard the result when there is a cycle.
    lowered =
      map (name: let
        entry = declared.${name};
      in {
        inherit name;
        inherit (entry) type command restartOnSwitch;
        file = toString descriptions.${name};
        automatic = automatic ? ${name};
        dependents = dependentsOf name;
      })
      (sorted.result or names);
    # The group dinit starts comes last and is started, not woken. Without
    # services the list is empty, which retires dinit.
    manifest = pkgs.writeText "hjem-services.json" (builtins.toJSON {
      inherit (manager) label socket;
      inherit dinitctl;
      services = lib.optionals active (
        map (entry: removeAttrs entry ["command"]) lowered
        ++ [
          {
            name = root;
            type = "internal";
            file = toString descriptions.${root};
            restartOnSwitch = false;
            automatic = false;
            dependents = [];
          }
        ]
      );
    });
    stateDirectory = "${config.xdg.state.directory}/hjem/dinit";
    services =
      if !isDarwin
      then pkgs.writeShellScriptBin "apply" "exit 0"
      else
        pkgs.runCommand "hjem-services" {} ''
          mkdir -p "$out/bin"
          cp ${manifest} "$out/services.json"
          ${lib.optionalString active ''
            ln -s ${directory} "$out/dinit.d"
            cp ${pkgs.writeText "agent.plist" (mylib.plist.toPlist agent)} "$out/agent.plist"
          ''}
          cat > "$out/bin/apply" <<'EOF'
          #!${pkgs.runtimeShell}
          set -e
          state=${lib.escapeShellArg stateDirectory}
          mkdir -p "$state"
          exec /usr/bin/lockf -k "$state/lock" ${pkgs.nushell}/bin/nu --no-config-file ${./reconcile.nu} "$(cd "$(${pkgs.coreutils}/bin/dirname "$0")/.." && pwd)" ${lib.escapeShellArg config.directory}
          EOF
          chmod +x "$out/bin/apply"
        '';
    restart = pkgs.writeShellScript "hjem-service-restart" ''
      set -u
      ${dinitctl} -p ${lib.escapeShellArg manager.socket} list >/dev/null 2>&1 || exit 75
      exec ${dinitctl} -p ${lib.escapeShellArg manager.socket} restart --no-wait --force --ignore-unstarted "$1"
    '';
  in {
    options = {
      userServices = mkOption {
        type = types.attrsOf service;
        default = {};
        description = "Hjem-owned user services run by dinit, by service name.";
      };
      serviceManager = {
        label = mkOption {
          type = types.strMatching namePattern;
          default = "org.hjem.dinit";
          description = "Label of the LaunchAgent that starts dinit; it also names the agent's plist file.";
        };
        socket = mkOption {
          type = absolute;
          readOnly = true;
          description = "Control socket of the dinit instance.";
        };
        restart = mkOption {
          type = types.path;
          readOnly = true;
          description = "Command restarting the service it names when that service is started; it exits 0 when done or not started, and 75 when dinit is not running.";
        };
      };
    };
    config = lib.mkMerge [
      {
        serviceManager = {
          socket = "${config.directory}/.dinitctl";
          inherit restart;
        };
        applySteps.services.package = services.overrideAttrs (_: {
          passthru.services = lowered;
        });
        assertions =
          map (problem: {
            assertion = false;
            message = "Hjem user services: ${problem}";
          })
          problems;
      }
      (lib.mkIf active {
        # The bundle keeps what the agent's plist runs alive and provides
        # bin/dinit, so only dinitctl comes from the package.
        packages = [
          bundle
          (pkgs.runCommand "dinitctl" {} ''
            mkdir -p "$out/bin"
            ln -s ${dinitctl} "$out/bin/dinitctl"
          '')
        ];
        xdg.config.files = lib.mapAttrs' (name: file: lib.nameValuePair "dinit.d/${name}" {source = file;}) descriptions;
      })
    ];
  };

  # Cases observe dinit running what the module produces. dinit-check is not
  # used: it also checks the host's executables and directories, which a build
  # cannot see. The reconciler case drives reconcile.nu against a real dinit
  # and a fake launchctl.
  tests.fixture = ["app-identity"];
  tests.cases = {pkgs, ...}: let
    inherit (pkgs) lib;
    darwin = ["aarch64-darwin"];
    controls = ["\n" "\r"];
    rejects = reason: declarations: {
      protects = "a declaration that cannot be lowered to dinit is rejected, naming its reason";
      platforms = darwin;
      modules.fixture.hjem.always = declarations;
      fails = reason;
    };
  in
    {
      descriptions = {
        protects = "services run under dinit as declared: arguments and environment values arrive literally, the working directory applies, dependencies and after relations order starts, groups start their members and nothing else, and a service that never restarts runs once";
        platforms = darwin;
        modules.fixture.hjem.always.userServices = let
          sh = script: ["/bin/sh" "-c" script];
        in {
          args = {
            type = "scripted";
            command = sh ''echo args >> "$OUT/order"; printf '%s\n' "$@" > "$OUT/args"; pwd > "$OUT/pwd"; printf '%s' "$A" > "$OUT/env"'' ++ ["sh" "two words" ''quote " and \ backslash'' "$HOME" "#hash" "" "\${x}" "'single'"];
            environment.A = "a $B \"c\" #d";
            workingDirectory = "/usr/bin";
            dependsOn = ["setup"];
            memberOf = ["group"];
          };
          setup = {
            type = "scripted";
            command = sh ''echo setup >> "$OUT/order"'';
            memberOf = [];
          };
          group.type = "internal";
          early = {
            type = "scripted";
            command = sh ''sleep 0.3; echo early >> "$OUT/order"'';
          };
          late = {
            type = "scripted";
            command = sh ''echo late >> "$OUT/order"'';
            after = ["early"];
          };
          manual = {
            type = "scripted";
            command = sh ''echo manual >> "$OUT/manual"'';
            memberOf = [];
          };
          flaky = {
            command = sh ''echo x >> "$OUT/flaky"; exit 1'';
            restart = "on-failure";
          };
          once = {
            command = sh ''echo x >> "$OUT/once"; exit 1'';
            restart = "never";
          };
        };
        build = result:
          pkgs.runCommand "services-descriptions" {nativeBuildInputs = [pkgs.dinit pkgs.nushell];} ''
            export OUT="$TMPDIR/out" HOME=/nonexistent
            mkdir "$OUT"
            # dinit cleans up after its services by process group, so it does
            # not run under the observing process.
            dinit --user --quiet --services-dir ${result.apply.steps.services}/dinit.d --socket-path "$TMPDIR/s" login &
            status=0
            nu --no-config-file ${./test}/descriptions.nu "$TMPDIR/s" || status=$?
            dinitctl --socket-path "$TMPDIR/s" shutdown >/dev/null 2>&1 || kill $! 2>/dev/null || true
            wait
            [ "$status" = 0 ]
            touch "$out"
          '';
      };
      reconciler = {
        protects = "each switch brings dinit and its services to the declarations, as reconcile.nu's contract states";
        platforms = darwin;
        build = _: pkgs.callPackage ./test/check.nix {};
      };
      no-services = {
        protects = "a home without services gets no dinit descriptions or packages";
        platforms = darwin;
        modules = {};
        expr = result: {
          descriptions = lib.filter (file: lib.hasInfix "/dinit.d/" file.target) result.manifest.files;
          packages = lib.filter (lib.hasInfix "dinit") result.packages;
        };
        expected = {
          descriptions = [];
          packages = [];
        };
      };
      linux-rejected = {
        protects = "services are rejected on Linux, where nothing starts dinit";
        host.system = "x86_64-linux";
        modules.fixture.hjem.always.userServices.x.command = ["/bin/true"];
        fails = "implemented only on Darwin";
      };
      linux-without-services = {
        protects = "evaluation without services succeeds on Linux, where services are rejected";
        host.system = "x86_64-linux";
        modules = {};
        expr = result: result.failedAssertions;
        expected = [];
      };
      unknown-dependency = rejects "x.dependsOn: unknown service missing" {
        userServices.x = {
          command = ["/bin/true"];
          dependsOn = ["missing"];
        };
      };
      unknown-group = rejects "x.memberOf: unknown service missing" {
        userServices.x = {
          command = ["/bin/true"];
          memberOf = ["missing"];
        };
      };
      internal-command = rejects "an internal service has no command" {
        userServices.x = {
          type = "internal";
          command = ["/bin/true"];
        };
      };
      cycle = rejects "dependency cycle" {
        userServices = {
          a = {
            command = ["/bin/true"];
            dependsOn = ["b"];
          };
          b = {
            command = ["/bin/true"];
            after = ["a"];
          };
        };
      };
      reserved-login = rejects "login is the group dinit starts" {userServices.login.type = "internal";};
      missing-command = rejects "a scripted service needs a command" {userServices.x.type = "scripted";};
      unsafe-name = rejects "invalid service name" {userServices."../x".command = ["/bin/true"];};
      argument-name = rejects "invalid service name" {userServices."x@y".command = ["/bin/true"];};
      variable-name = rejects "invalid variable name !clear" {
        userServices.x = {
          command = ["/bin/true"];
          environment."!clear" = "";
        };
      };
    }
    // lib.listToAttrs (lib.imap0 (index: control:
      lib.nameValuePair "control-argument-${toString index}" {
        protects = "an argument that would end its description line is rejected";
        platforms = darwin;
        modules.fixture.hjem.always.userServices.x.command = ["/bin/true" "a${control}b"];
        expr = result: result.apply.steps.services.services;
        fails = true;
      })
    controls);
})
