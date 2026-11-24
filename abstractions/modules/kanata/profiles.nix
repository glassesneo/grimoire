{
  default = {
    settings = {
      process-unmapped-keys = true;
      log-layer-changes = false;
      chords-v2-min-idle = 5;
    };

    layers.base = {
      caps = ["tap-hold-press" 70 70 "esc" "lctl"];
      spc = ["fork" "spc" ["unmod" ["lalt" "ralt"] "bspc"] ["lalt" "ralt"]];
      rmet = ["tap-hold-press" 200 200 "tab" "rmet"];
      ";" = ["tap-hold" 200 200 ["fork" "S-;" ["unmod" ["lsft" "rsft"] ";"] ["lsft" "rsft"]] "lalt"];
    };

    chords = let
      punctuation = key: action: {
        keys = ["f" key];
        inherit action;
        timeout = 40;
        release = "first-release";
      };
    in {
      f-k-comma = punctuation "k" ",";
      f-l-period = punctuation "l" ".";
      f-semicolon-slash = punctuation ";" "/";
    };
  };
}
