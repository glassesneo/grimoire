# Owns `delib.role`, the declaration of a role: a seat on the host that one
# module, its holder, takes.
#
# `declare delib { name, enable ? false, seatedOnly ? false, ... }` declares
# the module `roles.<name>` with `enable`, whether the host has the seat, and
# `holder`, one of the candidates: modules declaring `meta.role = "<name>"`,
# found by their metadata. A candidate may define the default holder in
# `myconfig.always`; a rice or host replaces it. While the seat is enabled, its
# holder must be enabled; a candidate without `enable`, such as data a role
# selects among, can always hold it.
#
# With `seatedOnly`, a candidate's enable belongs to the seat: the role enables
# the holder while the seat is enabled, `tags` does not enable candidates, and
# an enabled candidate that does not hold the enabled seat fails.
#
# Every other attribute is the module's own, as in `delib.module`. Its
# `options` add to `enable` and `holder`, which the role declares itself, such
# as what the role derives from its holder; its `meta`, sections, constraints
# and tests are written as for any module, and `myconfig.ifEnabled` and the
# constraint lists merge with those the role generates. As with
# `delib.module`, the declaration
# may be a function of the module's Denix arguments, such as `cfg`, so that
# its sections read the holder; `name`, `enable` and `seatedOnly` must not
# depend on them. `extensions/roles.nix` owns the metadata the role reads and
# rejects `roles.<name>` modules declared otherwise.
{lib}: {
  declare = delib: declaration: let
    # The arguments that shape the module, read without its Denix arguments.
    static =
      if lib.isFunction declaration
      then delib.callWithMocks declaration
      else declaration;
    inherit (static) name;
    enable = static.enable or false;
    seatedOnly = static.seatedOnly or false;
    ownOf = denixArgs:
      removeAttrs (
        if lib.isFunction declaration
        then declaration denixArgs
        else declaration
      ) ["name" "enable" "seatedOnly"];

    module = "roles.${name}";
    path = candidate: lib.splitString "." candidate ++ ["enable"];
    enabled = myconfig: candidate: lib.attrByPath (path candidate) false myconfig;
    available = myconfig: candidate: lib.attrByPath (path candidate) true myconfig;
  in
    if static ? options.enable || static ? options.holder
    then throw "delib.role ${name}: a role declares `enable` and `holder` itself; write `enable` as an argument"
    else {
      imports = [
        ({config, ...}: let
          candidates = lib.filter (other: config.modules.${other}.meta.role == name) (builtins.attrNames config.modules);
        in
          delib.module ({
              cfg,
              myconfig,
              ...
            } @ denixArgs: let
              own = ownOf denixArgs;
              seated = candidate: cfg.enable && cfg.holder == candidate;

              generated = {
                constraints.ifEnabled = [
                  {
                    assertion = available myconfig cfg.holder;
                    message = "${module}.holder = \"${cfg.holder}\" requires ${cfg.holder}.enable = true";
                  }
                ];
                constraints.always = lib.optionals seatedOnly (map (candidate: {
                    assertion = !(enabled myconfig candidate) || seated candidate;
                    message = "${candidate}.enable = true requires ${module}.enable = true and ${module}.holder = \"${candidate}\"";
                  })
                  candidates);
                myconfig.ifEnabled = lib.optionalAttrs seatedOnly (lib.foldl' lib.recursiveUpdate {} (map (candidate:
                  lib.setAttrByPath (path candidate) (lib.mkIf (cfg.holder == candidate) true))
                candidates));
              };

              ownIfEnabled = own.myconfig.ifEnabled or {};
            in
              own
              // {
                name = module;
                seat = {inherit seatedOnly;};
                options = with delib;
                  own.options or {}
                  // {
                    enable = boolOption enable;
                    holder = lib.mkOption {
                      type = lib.types.enum candidates;
                      description = "Module holding the seat, among those declaring `meta.role = \"${name}\"`.";
                    };
                  };
                constraints = {
                  always = generated.constraints.always ++ own.constraints.always or [];
                  ifEnabled = generated.constraints.ifEnabled ++ own.constraints.ifEnabled or [];
                };
                myconfig =
                  own.myconfig or {}
                  // {
                    ifEnabled =
                      if builtins.isAttrs ownIfEnabled
                      then lib.mkMerge [generated.myconfig.ifEnabled ownIfEnabled]
                      else throw "delib.role ${name}: myconfig.ifEnabled merges with the role's own; write it as an attribute set";
                  };
              }))
      ];
    };
}
