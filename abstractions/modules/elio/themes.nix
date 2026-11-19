# elio's theme for a resolved scheme, read by `elio` for its bundles and by
# `elio.colorscheme` for the host.
{lib}: let
  # Any scheme's theme. Surfaces the palette lacks reuse its terminal roles;
  # ANSI roles follow upstream's terminal-ansi example theme.
  ansiTheme = palette: let
    a = palette.ansi;
  in {
    palette = {
      bg = palette.background;
      chrome = a.black;
      chrome_alt = palette.background;
      chip_text = palette.background;
      panel = palette.background;
      panel_alt = palette.background;
      surface = a.black;
      elevated = palette.selectionBackground;
      border = a.brightBlack;
      text = palette.foreground;
      muted = a.brightBlack;
      accent = a.blue;
      accent_soft = a.black;
      accent_text = palette.foreground;
      selected_bg = palette.selectionBackground;
      selected_border = a.blue;
      selection_bar = a.yellow;
      yank_bar = a.green;
      cut_bar = a.red;
      progress_bar = a.blue;
      trash_bar = a.red;
      restore_bar = a.blue;
      sidebar_active = a.black;
      button_bg = palette.background;
      button_disabled_bg = palette.background;
      path_bg = palette.background;
    };
    preview.code = {
      fg = palette.foreground;
      bg = palette.background;
      selection_bg = palette.selectionBackground;
      selection_fg = palette.selectionForeground;
      caret = palette.cursor;
      line_highlight = a.black;
      line_number = a.brightBlack;
      comment = a.brightBlack;
      string = a.green;
      constant = a.yellow;
      keyword = a.blue;
      function = a.cyan;
      type = a.magenta;
      parameter = a.yellow;
      tag = a.green;
      operator = a.cyan;
      macro = a.red;
      invalid = a.red;
    };
    classes = lib.mapAttrs (_: color: {inherit color;}) {
      directory = a.blue;
      code = a.cyan;
      config = a.magenta;
      document = a.green;
      license = a.yellow;
      image = a.cyan;
      audio = a.yellow;
      video = a.magenta;
      archive = a.red;
      font = a.magenta;
      data = a.green;
      file = a.white;
    };
  };

  # Schemes whose own vocabulary places elio's surfaces more precisely, by
  # name, layered over the ANSI theme. Rosé Pine has no elio port: neutral
  # roles follow the uses its palette assigns them, and the accent and code
  # colors follow its TextMate port, whose buttons and badges are rose.
  namedThemes.rose-pine = c: {
    palette = {
      bg = c.base;
      chrome = c.surface;
      chrome_alt = c.base;
      chip_text = c.base;
      panel = c.surface;
      panel_alt = c.base;
      inherit (c) surface;
      elevated = c.overlay;
      border = c.highlightHigh;
      inherit (c) text;
      muted = c.subtle;
      accent = c.rose;
      accent_soft = c.overlay;
      selected_bg = c.highlightMed;
      selected_border = c.rose;
      yank_bar = c.foam;
      progress_bar = c.foam;
      restore_bar = c.foam;
      sidebar_active = c.overlay;
      button_bg = c.surface;
      button_disabled_bg = c.base;
      path_bg = c.base;
    };
    preview.code = {
      caret = c.highlightHigh;
      line_highlight = c.highlightLow;
      line_number = c.muted;
      comment = c.muted;
      string = c.gold;
      constant = c.rose;
      keyword = c.pine;
      function = c.rose;
      type = c.foam;
      parameter = c.iris;
      tag = c.foam;
      operator = c.subtle;
      macro = c.love;
      invalid = c.love;
    };
    classes.directory.color = c.iris;
  };

  colorschemeTheme = resolved:
    lib.recursiveUpdate (ansiTheme resolved.palette)
    ((namedThemes.${resolved.name} or (_: {})) resolved.palette.named);
in
  colorschemeTheme
