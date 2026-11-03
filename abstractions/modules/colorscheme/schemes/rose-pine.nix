# Rosé Pine (main). The named colors are its roles, from rose-pine/palette;
# the terminal roles follow its Ghostty port (rose-pine/ghostty dist/rose-pine).
let
  named = {
    base = "#191724";
    surface = "#1f1d2e";
    overlay = "#26233a";
    muted = "#6e6a86";
    subtle = "#908caa";
    text = "#e0def4";
    love = "#eb6f92";
    gold = "#f6c177";
    rose = "#ebbcba";
    pine = "#31748f";
    foam = "#9ccfd8";
    iris = "#c4a7e7";
    highlightLow = "#21202e";
    highlightMed = "#403d52";
    highlightHigh = "#524f67";
  };
in {
  palette = with named; {
    inherit named;
    background = base;
    foreground = text;
    cursor = text;
    cursorText = base;
    selectionBackground = highlightMed;
    selectionForeground = text;
    ansi = {
      black = overlay;
      red = love;
      green = pine;
      yellow = gold;
      blue = foam;
      magenta = iris;
      cyan = rose;
      white = text;
      brightBlack = muted;
      brightRed = love;
      brightGreen = pine;
      brightYellow = gold;
      brightBlue = foam;
      brightMagenta = iris;
      brightCyan = rose;
      brightWhite = text;
    };
  };
}
