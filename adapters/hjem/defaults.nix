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
          description = "Names of Hjem user services (`userServices` or `platform.darwin.launchAgents`) to restart.";
        };
      };
    };
  };
  declared = config.platform.darwin.defaults;
  services = config.userServices // config.platform.darwin.launchAgents;
  jobs = lib.listToAttrs (map (job: lib.nameValuePair job.name job) config.serviceApply.jobs);
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
      values = map (leaf: {
        inherit (leaf) path;
        xml = plist.toPlist leaf.value;
      }) (leaves [] entry.settings);
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
      description = "Hjem-owned user defaults, by preferences domain; removing a declaration restores the value it had before it was declared.";
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
