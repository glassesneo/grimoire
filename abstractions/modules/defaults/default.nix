# Owns Hjem user defaults declarations and their Darwin lowering.
#
# `platform.darwin.defaults.<domain>.settings` declares values of a
# preferences domain of the current user on any host; `NSGlobalDomain` names
# the global domain. An attribute set declares each of its leaves, the values
# that are not attribute sets, at its key path: a dictionary is written into,
# keeping keys that are not declared, and missing dictionaries along the path
# are created. A list or other value is written whole, and an empty attribute
# set declares nothing. Each switch writes every declared leaf that differs
# from the current one, so a value changed elsewhere is overwritten by the next
# switch; a switch fails before writing when a value along a declared path is
# not a dictionary. The switch that first declares a leaf records its value at
# that moment, or its absence; removing the declaration restores that value, or
# deletes the leaf and the dictionaries the declaration created once they are
# empty. A leaf whose enclosing value is no longer a dictionary is left as it
# is. Leaf values may be strings, booleans, integers, finite floats or lists of
# plist values. XML control characters in strings or keys are rejected, as are
# empty keys. Domain names must be unique ignoring case.
#
# `onChange` acts after a switch that wrote or restored a leaf of the domain,
# including the switch that restores leaves whose declarations were removed.
# The step runs after the services step, so a restart reaches the job that
# switch left loaded. Restarting a service that is not loaded does nothing;
# restarting a `gui` service without a GUI session is deferred to a later
# switch.
#
# Declarations are ignored on non-Darwin systems. Invalid declarations fail
# through the assertions, which guard the Hjem result. Service names resolve
# through `platform.darwin.serviceTargets` of the services module. The apply
# step is registered even without declarations, so removing the last one still
# restores its values. The step's `domains` passthru exposes the manifest for
# evaluation checks. Ownership, restoration and pending actions are implemented
# by reconciler/reconciler.cr.
{
  delib,
  mylib,
  ...
}:
delib.module {
  name = "defaults";
  meta.description = "Declare the current user's preferences and reconcile them with the platform's preferences store.";

  hjem.always = {
    config,
    lib,
    pkgs,
    ...
  }: let
    inherit (lib) mkOption types;
    inherit (mylib) plist;
    # launchd starts these again after they exit, so killing one reloads its preferences.
    relaunchedProcesses = ["ControlCenter" "Dock" "Finder" "NotificationCenter" "SystemUIServer" "WindowManager"];
    domain = types.submodule {
      options = {
        settings = mkOption {
          type = types.attrsOf types.anything;
          default = {};
          description = "Values of the domain; each leaf of a nested attribute set is declared at its key path, leaving undeclared keys of the dictionaries along it in place, and a list or other value is written whole.";
        };
        onChange = {
          restartProcesses = mkOption {
            type = types.listOf (types.enum relaunchedProcesses);
            default = [];
            description = "System processes that launchd relaunches, killed so that they read the new values.";
          };
          activateSettings = mkOption {
            type = types.bool;
            default = false;
            description = "Whether to run `activateSettings -u`, which applies some system settings, such as keyboard shortcuts, without logging out.";
          };
          restartServices = mkOption {
            type = types.listOf types.str;
            default = [];
            description = "Names of user services (`userServices` or `platform.darwin.launchAgents`) to restart.";
          };
        };
      };
    };
    declared = config.platform.darwin.defaults;
    targets = config.platform.darwin.serviceTargets;
    safeDomain = name: builtins.match "[A-Za-z0-9][A-Za-z0-9._-]*" name != null;
    # Values that are not attribute sets, with the key paths that reach them.
    leaves = path: value:
      if builtins.isAttrs value
      then lib.concatLists (lib.mapAttrsToList (key: leaves (path ++ [key])) value)
      else [{inherit path value;}];
    domainProblems = name: entry:
      lib.optional (!safeDomain name) "${name}: invalid domain name"
      ++ lib.concatMap ({
        path,
        value,
      }: let
        at = "${name} ${builtins.toJSON path}";
      in
        if lib.any (key: key == "" || !plist.xmlString key) path
        then ["${name}: invalid key in ${builtins.toJSON path}"]
        else if !plist.validValue value
        then ["${at}: unsupported plist value"]
        else if !plist.validXml value
        then ["${at}: XML control characters in plist keys or strings"]
        else [])
      (leaves [] entry.settings)
      ++ map (service: "${name}: unknown service ${service}")
      (lib.filter (service: !(targets ? ${service})) entry.onChange.restartServices);
    names = map lib.toLower (builtins.attrNames declared);
    problems =
      lib.concatLists (lib.mapAttrsToList domainProblems declared)
      ++ lib.optional (builtins.length names != builtins.length (lib.unique names)) "duplicate domain ignoring case";
    actions = entry:
      lib.unique (
        map (name: {
          kind = "process";
          target = name;
        })
        entry.onChange.restartProcesses
        ++ lib.optional entry.onChange.activateSettings {
          kind = "activateSettings";
          target = "";
        }
        ++ map (name: {
          kind = "service";
          target = "${targets.${name}.domain}/${targets.${name}.label}";
        })
        entry.onChange.restartServices
      );
    domains = lib.optionals pkgs.stdenv.hostPlatform.isDarwin (lib.mapAttrsToList (name: entry: {
        domain = name;
        values = map (leaf: {
          inherit (leaf) path;
          xml = plist.toPlist leaf.value;
        }) (leaves [] entry.settings);
        actions = actions entry;
      })
      declared);
    manifest = pkgs.writeText "hjem-defaults.json" (builtins.toJSON domains);
    reconciler = pkgs.callPackage ./reconciler/package.nix {};
    apply =
      if !pkgs.stdenv.hostPlatform.isDarwin
      then pkgs.writeShellScriptBin "apply" "exit 0"
      else
        pkgs.runCommand "hjem-defaults" {} ''
          mkdir -p "$out/bin"
          cp ${manifest} "$out/defaults.json"
          cat > "$out/bin/apply" <<'EOF'
          #!${pkgs.runtimeShell}
          exec ${reconciler}/bin/hjem-defaults-reconcile "$(cd "$(${pkgs.coreutils}/bin/dirname "$0")/.." && pwd)" ${lib.escapeShellArg config.directory}
          EOF
          chmod +x "$out/bin/apply"
        '';
  in {
    options = {
      platform.darwin.defaults = mkOption {
        type = types.attrsOf domain;
        default = {};
        description = "Hjem-owned user defaults, by preferences domain; removing a declaration restores the value it had before it was declared.";
      };
    };
    config = {
      applySteps.defaults = {
        package = apply.overrideAttrs (_: {
          passthru = {inherit domains;};
        });
        after = ["services"];
      };
      assertions =
        map (problem: {
          assertion = false;
          message = "Hjem user defaults: ${problem}";
        })
        (lib.optionals pkgs.stdenv.hostPlatform.isDarwin problems);
    };
  };

  # Lowering is observed before serialization; lib/plist.nix owns plist syntax.
  # The reconciler build runs its own specs for runtime transitions.
  checks = {pkgs, ...}: let
    inherit (pkgs) lib;
    darwin = ["aarch64-darwin"];
    inf = 1.0e308 * 10.0;
    controls = builtins.fromJSON ''["\u0001", "\u001f"]'';
    settings = name: value: {platform.darwin.defaults.${name}.settings = value;};
    good = {
      service.hjem.always = {
        userServices.tool.command = ["/bin/true"];
        platform.darwin.launchAgents.tool.domain = "gui";
      };
      first.hjem.always.platform.darwin.defaults = {
        "com.example.app" = {
          settings = {
            flag = true;
            count = -1;
            ratio = 0.1 + 0.2;
            tiny = 1.0e-7;
            "A&B" = {
              nested = ["<value>"];
              deeper.leaf = "y";
              empty = {};
            };
          };
          onChange = {
            restartProcesses = ["Dock" "Finder"];
            activateSettings = true;
            restartServices = ["tool"];
          };
        };
        NSGlobalDomain.settings.name = "value";
      };
      # A second location adds keys and actions to the same domain.
      second.hjem.always.platform.darwin.defaults."com.example.app" = {
        settings.other = "x";
        onChange.restartProcesses = ["Dock"];
      };
    };
    # Declaration errors are assertions, so a rejection names its reason.
    rejects = reason: declarations: {
      platforms = darwin;
      modules.fixture.hjem.always = declarations;
      fails = reason;
    };
    # Option types and merging reject these before any assertion.
    rejected = modules: {
      platforms = darwin;
      inherit modules;
      expr = result: result.apply;
      fails = true;
    };
  in
    {
      lowering = {
        platforms = darwin;
        modules = good;
        expr = result: let
          domains = lib.listToAttrs (map (entry: lib.nameValuePair entry.domain entry) result.apply.steps.defaults.domains);
          app = domains."com.example.app";
          values = lib.listToAttrs (map (leaf: lib.nameValuePair (lib.concatStringsSep "/" leaf.path) leaf.xml) app.values);
          tool = lib.findFirst (job: job.name == "tool") null result.apply.steps.services.jobs;
        in {
          # Each leaf is declared at its path; lists are leaves and empty sets declare nothing.
          paths = map (leaf: leaf.path) app.values;
          xml = {
            flag = lib.hasInfix "<true/>" values.flag;
            count = lib.hasInfix "<integer>-1</integer>" values.count;
            # Floats keep every digit needed to parse back to the declared value.
            ratio = lib.hasInfix "<real>0.30000000000000004</real>" values.ratio;
            tiny = lib.hasInfix "<real>1e-07</real>" values.tiny;
            nested = lib.hasInfix "<string>&lt;value&gt;</string>" values."A&B/nested";
          };
          actions = lib.init app.actions;
          # A service name resolves to the job the services module lowers it to.
          service =
            lib.last app.actions
            == {
              kind = "service";
              target = "${tool.domain}/${tool.label}";
            };
          globalActions = domains.NSGlobalDomain.actions;
        };
        expected = {
          paths = [["A&B" "deeper" "leaf"] ["A&B" "nested"] ["count"] ["flag"] ["other"] ["ratio"] ["tiny"]];
          xml = {
            flag = true;
            count = true;
            ratio = true;
            tiny = true;
            nested = true;
          };
          actions = [
            {
              kind = "process";
              target = "Dock";
            }
            {
              kind = "process";
              target = "Finder";
            }
            {
              kind = "activateSettings";
              target = "";
            }
          ];
          service = true;
          globalActions = [];
        };
      };
      outputs = {
        platforms = darwin;
        modules = good;
        build = result:
          pkgs.runCommand "defaults-outputs" {
            inherit (result) apply;
            inherit (result.apply.steps) defaults services;
          } ''
            test -x "$defaults/bin/apply"
            test -f "$defaults/defaults.json"
            # The switch runs the services step first.
            line() { grep -Fn "$1/bin/apply" "$apply/bin/apply" | cut -d: -f1; }
            test "$(line "$services")" -lt "$(line "$defaults")"
            touch "$out"
          '';
      };
      # Declarations are ignored, not rejected, on Linux.
      linux-ignored = {
        host.system = "x86_64-linux";
        modules.fixture.hjem.always = settings "com.example" {ratio = 0.5;};
        expr = result: {
          inherit (result) failedAssertions;
          inherit (result.apply.steps.defaults) domains;
        };
        expected = {
          failedAssertions = [];
          domains = [];
        };
      };
      infinite-float = rejects "unsupported plist value" (settings "com.example" {ratio = inf;});
      nan-in-list = rejects "unsupported plist value" (settings "com.example" {list = [{nested = inf - inf;}];});
      null-value = rejects "unsupported plist value" (settings "com.example" {missing = null;});
      nested-infinite-float = rejects "unsupported plist value" (settings "com.example" {outer.ratio = -inf;});
      control-key = rejects "invalid key" (settings "com.example" {"bad${builtins.head controls}" = "value";});
      empty-key = rejects "invalid key" (settings "com.example" {"" = "value";});
      nested-empty-key = rejects "invalid key" (settings "com.example" {outer."" = "value";});
      relative-domain = rejects "invalid domain name" (settings "../escape" {key = "value";});
      option-domain = rejects "invalid domain name" (settings "-g" {key = "value";});
      duplicate-domain = rejects "duplicate domain ignoring case" {
        platform.darwin.defaults = {
          "com.example".settings.a = "a";
          "Com.Example".settings.b = "b";
        };
      };
      unknown-service = rejects "unknown service missing" {
        platform.darwin.defaults."com.example".onChange.restartServices = ["missing"];
      };
      unknown-process = rejected {fixture.hjem.always.platform.darwin.defaults."com.example".onChange.restartProcesses = ["Safari"];};
      # Conflicting values for one leaf are an option merge error, not a silent choice.
      conflicting-leaf = rejected {
        a.hjem.always = settings "com.example" {key = "a";};
        b.hjem.always = settings "com.example" {key = "b";};
      };
      conflicting-nested-leaf = rejected {
        a.hjem.always = settings "com.example" {outer.key = "a";};
        b.hjem.always = settings "com.example" {outer.key = "b";};
      };
    }
    // lib.listToAttrs (lib.imap0 (index: control:
      lib.nameValuePair "control-value-${toString index}"
      (rejects "XML control characters" (settings "com.example" {key = [control];})))
    controls);
}
