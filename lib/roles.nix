{
  lib,
  documented,
}: {
  declare = delib:
    documented {
      description = "A role: a seat on the host, the module `roles.<name>` with `enable`, whether the host has the seat, and `holder`, one of the candidates that declare `meta.role = \"<name>\"`. A candidate may define the default holder; a rice or host replaces it. While the seat is enabled, its holder must be enabled. With `seatedOnly`, the seat decides its candidates' enable: the holder is enabled while the seat is, `tags` do not enable candidates, and an enabled candidate that does not hold the seat fails. The role also declares the read-only `candidates` and `held`, the holder's `myconfig`. Every other attribute is the module's own, as in `delib.module`, and the declaration may be a function of its Denix arguments, except `name`, `enable` and `seatedOnly`.";
      arguments = {
        name = "The role's name.";
        enable = "Whether the host has the seat by default.";
        seatedOnly = "Whether the seat decides its candidates' enable.";
      };
    } (declaration: let
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
      if lib.any (option: static ? options.${option}) ["enable" "holder" "candidates" "held"]
      then throw "delib.role ${name}: a role declares `enable`, `holder`, `candidates` and `held` itself; write `enable` as an argument"
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
                      candidates = readOnly (listOfOption str candidates "Modules declaring `meta.role = \"${name}\"`, which can hold the seat.");
                      held = readOnly (defaultText (lib.mkOption {
                        type = lib.types.raw;
                        default = lib.getAttrFromPath (lib.splitString "." cfg.holder) myconfig;
                        description = "The holder's `myconfig`, from which the role reads what the holder provides.";
                      }) (lib.literalMD "the holder's `myconfig`"));
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
      });
}
