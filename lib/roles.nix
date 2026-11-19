# Owns `delib.role`, the declaration of a role: a seat on the host that one
# module, its holder, takes.
#
# `declare delib { name, enable ? false, seatedOnly ? false, ... }` declares
# the module `roles.<name>` with `enable`, whether the host has the seat, and
# `holder`, one of the candidates: modules declaring `meta.role = "<name>"`,
# found by their metadata. A candidate may define the default holder in
# `myconfig.always`; a rice or host replaces it. While the seat is enabled, its
# holder must be enabled.
#
# With `seatedOnly`, a candidate's enable belongs to the seat: the role enables
# the holder while the seat is enabled, `tags` does not enable candidates, and
# an enabled candidate that does not hold the enabled seat fails.
#
# Every other attribute is the module's own, as in `delib.module`; the role
# declares the options itself. Its `meta`, sections, constraints and tests are
# written as for any module, and `myconfig.ifEnabled` and the constraint lists
# merge with those the role generates. `extensions/roles.nix` owns the metadata
# the role reads and rejects `roles.<name>` modules declared otherwise.
{lib}: {
  declare = delib: {
    name,
    enable ? false,
    seatedOnly ? false,
    ...
  } @ args: let
    module = "roles.${name}";
    own = removeAttrs args ["name" "enable" "seatedOnly"];
    path = candidate: lib.splitString "." candidate ++ ["enable"];
    enabled = myconfig: candidate: lib.attrByPath (path candidate) false myconfig;
  in
    if own ? options
    then throw "delib.role ${name}: a role declares its options itself; write `enable` as an argument"
    else {
      imports = [
        ({config, ...}: let
          candidates = lib.filter (other: config.modules.${other}.meta.role == name) (builtins.attrNames config.modules);
        in
          delib.module ({
            cfg,
            myconfig,
            ...
          }: let
            seated = candidate: cfg.enable && cfg.holder == candidate;

            generated = {
              constraints.ifEnabled = [
                {
                  assertion = enabled myconfig cfg.holder;
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
              options = with delib; {
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
