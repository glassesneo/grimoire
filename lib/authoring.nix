{lib}: {
  configuration,
  root,
  pkgs,
  moduleSystems,
  host ? null,
  sources ? {},
  library ? [],
}: let
  rootPrefix = "${toString root}/";

  escape = lib.replaceStrings ["&" "<" ">" "|" "\r\n" "\n" "\r"] ["&amp;" "&lt;" "&gt;" "&#124;" "<br>" "<br>" "<br>"];
  code = text: "<code>${escape text}</code>";
  relative = file: lib.removePrefix rootPrefix (toString file);

  inRepository = file: lib.hasPrefix rootPrefix file;
  optionKinds = import ./sources.nix {
    inherit lib;
    documented = _: value: value;
  };
  labelOf = file: builtins.match "(module|host) ([^ ]+) \\(([^.]+)\\.[A-Za-z]+\\)" file;
  owned = option: option.declarations != [] && lib.all (file: inRepository file || labelOf file != null) option.declarations;

  docs = options:
    lib.filter (option: !option.internal && option.visible != false && !(lib.elem "_module" option.loc))
    (lib.optionAttrSetToDocList options);

  hasPackage = value:
    lib.isDerivation value
    || (builtins.isList value && lib.any hasPackage value)
    || (builtins.isAttrs value && lib.any hasPackage (builtins.attrValues value));

  # optionAttrSetToDocList renders `defaultText` or else the value; the
  # declaration is read to render packages and lazy values without forcing them.
  declarationOf = options: loc: let
    option = lib.attrByPath loc null options;
  in
    if lib.isOption option
    then option
    else null;

  computed = lib.literalMD "(computed)";

  sourceOf = package: let
    position = package.meta.position or "";
    matches = lib.filter (name: lib.hasPrefix "${toString sources.${name}}/" position) (builtins.attrNames sources);
  in
    lib.foldl' (best: name:
      if best == null || builtins.stringLength (toString sources.${name}) > builtins.stringLength (toString sources.${best})
      then name
      else best)
    null
    matches;
  packageText = package: let
    source = sourceOf package;
  in
    lib.optionalString (source != null) "${source}: " + lib.getName package;

  describe = required: option:
    if option.description or null != null && option.description != ""
    then option.description
    else if required
    then throw "authoring: option `${option.name}' needs a description"
    else "";

  row = {
    options,
    strip,
    required ? true,
    withSource ? false,
  }: option: let
    declaration = declarationOf options option.loc;
    raw = declaration.default;
    default = builtins.addErrorContext "while rendering the default of option `${option.name}'; a default that cannot be rendered needs defaultText" (
      if declaration == null || !(declaration ? default) || declaration ? defaultText
      then option.default or null
      else if declaration.type.name == "lazyAttrsOf"
      then computed
      else if lib.isDerivation raw
      then lib.literalExpression (packageText raw)
      else if hasPackage raw
      then computed
      else option.default or null
    );
    # Nix escapes the placeholder host's interpolations inside strings.
    renderedDefault =
      if default == null
      then ""
      else if default._type or null == "literalMD"
      then escape default.text
      else code (lib.replaceStrings ["\\\${myconfig.host."] ["\${myconfig.host."] default.text);
    description = describe required option;
    flags =
      lib.optional (option.readOnly or false) "read-only"
      ++ lib.optional (declaration != null && optionKinds.isAtomic declaration) "a higher source replaces it whole"
      ++ lib.optional (declaration != null && optionKinds.isAccumulating declaration) "collects every source's definitions";
  in "| ${code (strip option.name)} | ${code option.type} | ${renderedDefault} | ${escape (lib.concatStringsSep "; " (flags ++ lib.optional (description != "") description))} |${
    lib.optionalString withSource " ${lib.concatMapStringsSep "<br>" (file: code (relative file)) option.declarations} |"
  }";

  table = {withSource ? false, ...} @ args: entries:
    if entries == []
    then ""
    else
      lib.concatStringsSep "\n" ([
          "| Option | Type | Default | Description |${lib.optionalString withSource " Source |"}"
          "| --- | --- | --- | --- |${lib.optionalString withSource " --- |"}"
        ]
        ++ map (row args) entries)
      + "\n";

  myconfigOptions =
    (lib.evalModules {
      modules = [
        (configuration.genModule ({moduleSystem = "myconfig";} // lib.optionalAttrs (host != null) {inherit host;}))
        {_module.args.pkgs = pkgs;}
      ];
    }).options;
  myconfigEntries = lib.filter (option: lib.head option.loc == "myconfig") (docs myconfigOptions);

  moduleNames = builtins.attrNames configuration.config.modules;
  modulePaths = map (name: {
    inherit name;
    path = lib.splitString "." name;
  }) (lib.sort (a: b: builtins.stringLength a > builtins.stringLength b) moduleNames);
  ownerOf = path: (lib.findFirst (module: lib.lists.hasPrefix module.path path) {name = "";} modulePaths).name;
  myconfigByOwner = lib.groupBy (option: ownerOf (lib.tail option.loc)) myconfigEntries;
  unowned = myconfigByOwner."" or [];

  systemEntries = lib.mapAttrs (_: options: lib.filter (option: owned option && lib.head option.loc != "myconfig") (docs options)) moduleSystems;
  declaredBy = name: system:
    lib.filter (option:
      lib.any (file: let
        label = labelOf file;
      in
        label != null && lib.elemAt label 0 == "module" && lib.elemAt label 1 == name)
      option.declarations)
    systemEntries.${system};

  sourcesOf = name:
    lib.unique (map (definition: definition.file)
      (builtins.filter (definition: builtins.hasAttr name definition.value) configuration.options.modules.definitionsWithLocations));

  ownOf = name: myconfigByOwner.${name} or [];
  declaredOf = name: lib.filterAttrs (_: entries: entries != []) (lib.genAttrs (builtins.attrNames systemEntries) (declaredBy name));
  tagsOf = name: lib.concatMapStringsSep ", " code configuration.config.modules.${name}.meta.tags;

  systemTables = declared:
    lib.concatLists (lib.mapAttrsToList (system: entries: [
        "${code system} options:"
        ""
        (table {
            options = moduleSystems.${system};
            strip = lib.id;
            required = false;
          }
          entries)
      ])
      declared);
  myconfigTable = entries:
    lib.optionals (entries != []) [
      (table {
          options = myconfigOptions;
          strip = lib.removePrefix "myconfig.";
          required = false;
        }
        entries)
    ];

  moduleSection = name: let
    module = configuration.config.modules.${name};
  in
    lib.concatStringsSep "\n" (
      [
        "### ${code name}"
        ""
        (escape module.meta.description)
        ""
        "Source: ${lib.concatMapStringsSep ", " (file: code (relative file)) (sourcesOf name)}${
          lib.optionalString (module.meta.tags != []) "<br>Tags: ${tagsOf name}"
        }"
        ""
      ]
      ++ myconfigTable (ownOf name)
      ++ systemTables (declaredOf name)
    );

  moduleIndex =
    lib.concatStringsSep "\n" ([
        "| Module | Source | Responsibility | Tags |"
        "| --- | --- | --- | --- |"
      ]
      ++ map (name: "| ${code name} | ${lib.concatMapStringsSep ", " (file: code (relative file)) (sourcesOf name)} | ${escape configuration.config.modules.${name}.meta.description} | ${tagsOf name} |") moduleNames)
    + "\n";

  libraryIndex =
    lib.concatStringsSep "\n" ([
        "| Function | Defined in |"
        "| --- | --- |"
      ]
      ++ map (entry: let
        position = builtins.unsafeGetAttrPos "description" entry.doc;
      in "| ${code entry.name} | ${
        if position == null
        then ""
        else code (relative position.file)
      } |")
      library)
    + "\n";

  adapterSection = system: let
    entries = lib.filter (option: lib.all inRepository option.declarations) systemEntries.${system};
  in
    lib.optionalString (entries != []) ''
      ### ${code system}

      ${table {
          options = moduleSystems.${system};
          strip = lib.id;
          withSource = true;
        }
        entries}'';

  declarationSection = kind: title: let
    options = configuration.options.${kind}.type.getSubOptions [kind];
  in ''
    ### ${title}

    ${table {
      inherit options;
      strip = lib.removePrefix "${kind}.<name>.";
      withSource = true;
    } (lib.filter owned (docs options))}'';
in
  assert lib.assertMsg (unowned == []) "authoring: myconfig options outside any module: ${toString (map (option: option.name) unowned)}"; {
    moduleOptions = lib.genAttrs moduleNames moduleSection;

    modules = ''
      # Modules

      ${moduleIndex}'';

    reference = ''
      # Authoring Reference

      ## Declarations

      Options this repository adds to Denix declarations.

      ${declarationSection "modules" "Modules (<code>delib.module</code>)"}
      ${declarationSection "hosts" "Hosts (<code>delib.host</code>)"}
      ## Module systems

      Options that adapters add to their module systems.

      ${lib.concatStringsSep "\n" (lib.filter (section: section != "") (map adapterSection (builtins.attrNames moduleSystems)))}${lib.optionalString (library != []) ''

        ## Library

        Functions and values that modules use from `mylib` and `delib`, documented where they are defined.

        ${libraryIndex}''}'';
  }
