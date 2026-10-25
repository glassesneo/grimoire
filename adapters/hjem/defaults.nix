# Owns Hjem user defaults declarations and their Darwin lowering.
#
# `platform.darwin.defaults.<domain>.settings` declares top-level keys of a
# preferences domain of the current user on any host; `NSGlobalDomain` names
# the global domain. Each switch writes every declared value that differs from
# the current one, so a value changed elsewhere is overwritten by the next
# switch. A dictionary or list is written whole, replacing the existing value.
# The switch that first declares a key records its value at that moment, or its
# absence; removing the declaration restores that value or deletes the key.
# Plist values may be strings, booleans, integers, lists or dictionaries, not
# floats. XML control characters in strings or keys are rejected. Domain names
# must be unique ignoring case.
#
# `onChange` acts after a switch that wrote or restored a key of the domain,
# including the switch that restores keys whose declarations were removed.
# Restarting a service that is not loaded does nothing; restarting a `gui`
# service without a GUI session is deferred to a later switch.
#
# Declarations are ignored on non-Darwin systems. Invalid declarations fail
# through the assertions, which guard `defaultsApply`. Its `domains` passthru
# exposes the manifest for evaluation checks. Ownership, restoration and
# pending actions are implemented by defaults/reconciler.cr.
{
  config,
  lib,
  pkgs,
  ...
}: let
  inherit (lib) mkOption types;
  plist = import ./plist.nix {inherit lib;};
  # launchd starts these again after they exit, so killing one reloads its preferences.
  relaunchedProcesses = ["ControlCenter" "Dock" "Finder" "NotificationCenter" "SystemUIServer" "WindowManager"];
  domain = types.submodule {
    options = {
      settings = mkOption {
        type = types.attrsOf types.anything;
        default = {};
        description = "Top-level keys of the domain and their plist values; each value replaces the key's whole value.";
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
          description = "Names of Hjem user services (`userServices` or `platform.darwin.launchAgents`) to restart.";
        };
      };
    };
  };
  declared = config.platform.darwin.defaults;
  services = config.userServices // config.platform.darwin.launchAgents;
  jobs = lib.listToAttrs (map (job: lib.nameValuePair job.name job) config.serviceApply.jobs);
  safeDomain = name: builtins.match "[A-Za-z0-9][A-Za-z0-9._-]*" name != null;
  domainProblems = name: entry:
    lib.optional (!safeDomain name) "${name}: invalid domain name"
    ++ lib.concatLists (lib.mapAttrsToList (key: value:
      if key == "" || !plist.xmlString key
      then ["${name}: invalid key ${builtins.toJSON key}"]
      else if !plist.validValue value
      then ["${name}.${key}: unsupported plist value (floats are not supported)"]
      else if !plist.validXml value
      then ["${name}.${key}: XML control characters in plist keys or strings"]
      else [])
    entry.settings)
    ++ map (service: "${name}: unknown service ${service}")
    (lib.filter (service: !(services ? ${service})) entry.onChange.restartServices);
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
        target = "${jobs.${name}.domain}/${jobs.${name}.label}";
      })
      entry.onChange.restartServices
    );
  domains = lib.optionals pkgs.stdenv.hostPlatform.isDarwin (lib.mapAttrsToList (name: entry: {
      domain = name;
      keys = lib.mapAttrs (_: lib.generators.toPlist {escape = true;}) entry.settings;
      actions = actions entry;
    })
    declared);
  manifest = pkgs.writeText "hjem-defaults.json" (builtins.toJSON domains);
  reconciler = pkgs.callPackage ./defaults {};
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
      description = "Hjem-owned user defaults, by preferences domain; removing a key restores the value it had before it was declared.";
    };
    defaultsApply = mkOption {
      type = types.package;
      internal = true;
      readOnly = true;
      description = "Defaults closure with bin/apply, invoked after the service apply.";
    };
  };
  config = {
    defaultsApply = apply.overrideAttrs (_: {
      passthru = {inherit domains;};
    });
    assertions =
      map (problem: {
        assertion = false;
        message = "Hjem user defaults: ${problem}";
      })
      (lib.optionals pkgs.stdenv.hostPlatform.isDarwin problems);
  };
}
