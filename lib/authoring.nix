# Render the authoring reference from declarations, without generating a host.
#
# The reference lists the options this repository adds to Denix module and host
# declarations, the options adapters add to their module systems, and every
# module, regardless of host enablement and sorted by Denix name, with its
# responsibility (`meta.description`), tags, source, `myconfig` options and the
# options it declares in each module system. An option is the repository's when
# all of its declarations are repository files or module and host sections;
# options that extend an upstream declaration are not listed. Internal options
# are omitted.
#
# Rendering enforces the description and `defaultText` requirements of
# docs/documentation-policy.md where it can: a listed option without a
# description, other than a `myconfig` `enable` or `package`, fails, and so
# does a default without `defaultText` that contains a package or, evaluated
# without a host, reads the host. A default that reads another option renders
# that option's value here, so only its `defaultText` keeps it general. The
# reference contains no generation timestamp.
{lib}: {
  # The Denix configuration whose declarations are rendered.
  configuration,
  # Repository root, against which sources are linked relatively.
  root,
  # Nixpkgs given to `myconfig` sections that take `pkgs`.
  pkgs,
  # Module system name to its evaluated option declarations.
  moduleSystems,
}: let
  rootPrefix = "${toString root}/";

  escape = lib.replaceStrings ["&" "<" ">" "|" "\r\n" "\n" "\r"] ["&amp;" "&lt;" "&gt;" "&#124;" "<br>" "<br>" "<br>"];
  code = text: "<code>${escape text}</code>";
  link = file: let
    path = lib.removePrefix rootPrefix (toString file);
    url = lib.concatMapStringsSep "/" lib.escapeURL (lib.splitString "/" path);
  in "[${code path}](../../${url})";

  inRepository = file: lib.hasPrefix rootPrefix file;
  # Provenance labels: `<module|host> <name> (<system>.<section>)`.
  labelOf = file: builtins.match "(module|host) ([^ ]+) \\(([^.]+)\\.[A-Za-z]+\\)" file;
  owned = option: option.declarations != [] && lib.all (file: inRepository file || labelOf file != null) option.declarations;

  docs = options:
    lib.filter (option: !option.internal && option.visible != false && !(lib.elem "_module" option.loc))
    (lib.optionAttrSetToDocList options);

  # A default that renders a package names its version and system.
  hasPackage = value:
    lib.isDerivation value
    || (builtins.isList value && lib.any hasPackage value)
    || (builtins.isAttrs value && lib.any hasPackage (builtins.attrValues value));

  # optionAttrSetToDocList renders `defaultText` or else the value; read the raw
  # value from the declaration to reject packages first.
  rawDefault = options: loc: let
    option = lib.attrByPath loc null options;
  in
    if option != null && lib.isOption option && option ? default && !(option ? defaultText)
    then option.default
    else null;

  describe = exempt: option:
    if option.description or null != null && option.description != ""
    then option.description
    else if exempt option
    then ""
    else throw "authoring: option `${option.name}' needs a description";

  row = {
    options,
    strip,
    exempt ? _: false,
    withSource ? false,
  }: option: let
    raw = rawDefault options option.loc;
    default = builtins.addErrorContext "while rendering the default of option `${option.name}'; a default that reads the host needs defaultText" (
      if raw != null && hasPackage raw
      then throw "authoring: the default of option `${option.name}' contains a package; declare defaultText"
      else option.default or null
    );
    # A Markdown default is prose, not an expression.
    renderedDefault =
      if default == null
      then ""
      else if default._type or null == "literalMD"
      then escape default.text
      else code default.text;
    description = describe exempt option;
    flags = lib.optional (option.readOnly or false) "read-only";
  in "| ${code (strip option.name)} | ${code option.type} | ${renderedDefault} | ${escape (lib.concatStringsSep "; " (flags ++ lib.optional (description != "") description))} |${
    lib.optionalString withSource " ${lib.concatMapStringsSep "<br>" link option.declarations} |"
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

  # Denix declarations.

  # `myconfig` options, from the myconfig sections alone.
  myconfigOptions =
    (lib.evalModules {
      modules = [
        (configuration.genModule {moduleSystem = "myconfig";})
        {_module.args.pkgs = pkgs;}
      ];
    }).options;
  myconfigEntries = lib.filter (option: lib.head option.loc == "myconfig") (docs myconfigOptions);

  moduleNames = builtins.attrNames configuration.config.modules;
  modulePaths = map (name: {
    inherit name;
    path = lib.splitString "." name;
  }) (lib.sort (a: b: builtins.stringLength a > builtins.stringLength b) moduleNames);
  # The module owning an option path is the longest module name prefixing it.
  ownerOf = path: (lib.findFirst (module: lib.lists.hasPrefix module.path path) {name = "";} modulePaths).name;
  myconfigByOwner = lib.groupBy (option: ownerOf (lib.tail option.loc)) myconfigEntries;
  unowned = myconfigByOwner."" or [];

  # Every module system also merges `myconfig`, which is listed per module.
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

  moduleSection = name: let
    module = configuration.config.modules.${name};
    own = myconfigByOwner.${name} or [];
    declared = lib.filterAttrs (_: entries: entries != []) (lib.genAttrs (builtins.attrNames systemEntries) (declaredBy name));
  in
    lib.concatStringsSep "\n" (
      [
        "### ${code name}"
        ""
        (escape module.meta.description)
        ""
        "Source: ${lib.concatMapStringsSep ", " link (sourcesOf name)}${
          lib.optionalString (module.meta.tags != []) "<br>Tags: ${lib.concatMapStringsSep ", " code module.meta.tags}"
        }"
        ""
      ]
      ++ lib.optionals (own != []) [
        (table {
            options = myconfigOptions;
            strip = lib.removePrefix "myconfig.";
            exempt = option: lib.elem (lib.last option.loc) ["enable" "package"];
          }
          own)
      ]
      ++ lib.concatLists (lib.mapAttrsToList (system: entries: [
          "${code system} options:"
          ""
          (table {
              options = moduleSystems.${system};
              strip = lib.id;
            }
            entries)
        ])
        declared)
    );

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

  # Denix declarations.
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
  assert lib.assertMsg (unowned == []) "authoring: myconfig options outside any module: ${toString (map (option: option.name) unowned)}"; ''
    # Authoring

    Generated from module, host and option declarations. Do not edit; run `just docs`.

    ## Declarations

    Options this repository adds to Denix declarations.

    ${declarationSection "modules" "Modules (<code>delib.module</code>)"}
    ${declarationSection "hosts" "Hosts (<code>delib.host</code>)"}
    ## Module systems

    Options that adapters add to their module systems. Options that modules add are listed with each module.

    ${lib.concatStringsSep "\n" (lib.filter (section: section != "") (map adapterSection (builtins.attrNames moduleSystems)))}
    ## Modules

    ${lib.concatStringsSep "\n" (map moduleSection moduleNames)}''
