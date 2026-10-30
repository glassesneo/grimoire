# Render the authoring reference from declarations, without generating a real host.
#
# The reference lists the options this repository adds to Denix module and host
# declarations, the options adapters add to their module systems, and every
# module, regardless of host enablement and sorted by Denix name, with its
# responsibility (`meta.description`), tags, source, `myconfig` options and the
# options it declares in each module system. Modules whose only option is
# `enable`, or that declare none, share one table; the others get a section. An
# option is the repository's when all of its declarations are repository files
# or module and host sections; options that extend an upstream declaration are
# not listed. Internal options are omitted.
#
# Rendering enforces docs/documentation-policy.md where it can: an option of a
# Denix declaration or of an adapter without a description fails; module options
# need none. Defaults are rendered from the declarations: the caller selects a
# host whose values are written as the `myconfig.host` expressions they stand
# for, `defaultText` replaces a default, a `lazyAttrsOf` default is shown as
# computed without being forced, a package default shows its name, and a
# default that otherwise contains a package is shown as computed. A default that
# reads another option renders that option's rendered value. The reference
# contains no generation timestamp.
{lib}: {
  # The Denix configuration whose declarations are rendered.
  configuration,
  # Repository root, against which sources are linked relatively.
  root,
  # Nixpkgs given to `myconfig` sections that take `pkgs`.
  pkgs,
  # Module system name to its evaluated option declarations.
  moduleSystems,
  # Host selected while evaluating `myconfig` options, or null for none.
  host ? null,
}: let
  rootPrefix = "${toString root}/";

  escape = lib.replaceStrings ["&" "<" ">" "|" "\r\n" "\n" "\r"] ["&amp;" "&lt;" "&gt;" "&#124;" "<br>" "<br>" "<br>"];
  code = text: "<code>${escape text}</code>";
  relative = file: lib.removePrefix rootPrefix (toString file);
  url = file: "../../${lib.concatMapStringsSep "/" lib.escapeURL (lib.splitString "/" (relative file))}";
  link = file: "[${code (relative file)}](${url file})";

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

  # optionAttrSetToDocList renders `defaultText` or else the value; read the
  # declaration to render packages and lazy values without forcing them.
  declarationOf = options: loc: let
    option = lib.attrByPath loc null options;
  in
    if option != null && lib.isOption option
    then option
    else null;

  computed = lib.literalMD "(computed)";

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
      then lib.literalExpression (lib.getName raw)
      else if hasPackage raw
      then computed
      else option.default or null
    );
    # A Markdown default is prose, not an expression. Nix escapes the
    # placeholder host's interpolations inside strings.
    renderedDefault =
      if default == null
      then ""
      else if default._type or null == "literalMD"
      then escape default.text
      else code (lib.replaceStrings ["\\\${myconfig.host."] ["\${myconfig.host."] default.text);
    description = describe required option;
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

  ownOf = name: myconfigByOwner.${name} or [];
  declaredOf = name: lib.filterAttrs (_: entries: entries != []) (lib.genAttrs (builtins.attrNames systemEntries) (declaredBy name));
  tagsOf = name: lib.concatMapStringsSep ", " code configuration.config.modules.${name}.meta.tags;
  # A module whose only option is `enable` is a row of the shared table.
  enableOnly = name: declaredOf name == {} && lib.all (option: option.loc == ["myconfig"] ++ lib.splitString "." name ++ ["enable"]) (ownOf name);
  sectioned = lib.partition enableOnly moduleNames;

  enableOnlyTable = lib.optionalString (sectioned.right != []) (lib.concatStringsSep "\n" ([
      "Modules whose only option is `enable`:"
      ""
      "| Module | <code>enable</code> | Responsibility | Tags |"
      "| --- | --- | --- | --- |"
    ]
    ++ map (name: let
      enable = lib.findFirst (_: true) null (ownOf name);
    in "| ${lib.concatMapStringsSep ", " (file: "[${code name}](${url file})") (sourcesOf name)} | ${
      if enable == null
      then ""
      else code enable.default.text
    } | ${escape configuration.config.modules.${name}.meta.description} | ${tagsOf name} |")
    sectioned.right)
  + "\n");

  moduleSection = name: let
    module = configuration.config.modules.${name};
    own = ownOf name;
    declared = declaredOf name;
  in
    lib.concatStringsSep "\n" (
      [
        "### ${code name}"
        ""
        (escape module.meta.description)
        ""
        "Source: ${lib.concatMapStringsSep ", " link (sourcesOf name)}${
          lib.optionalString (module.meta.tags != []) "<br>Tags: ${tagsOf name}"
        }"
        ""
      ]
      ++ lib.optionals (own != []) [
        (table {
            options = myconfigOptions;
            strip = lib.removePrefix "myconfig.";
            required = false;
          }
          own)
      ]
      ++ lib.concatLists (lib.mapAttrsToList (system: entries: [
          "${code system} options:"
          ""
          (table {
              options = moduleSystems.${system};
              strip = lib.id;
              required = false;
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

    ${enableOnlyTable}
    ${lib.concatStringsSep "\n" (map moduleSection sectioned.wrong)}''
