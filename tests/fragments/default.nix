{pkgs, ...}: let
  inherit (pkgs) lib;
  mylib = import ../../lib {inherit lib;};

  render = fragments:
    mylib.fragments.render
    (lib.evalModules {
      modules = [
        {options.fragments = mylib.fragments.option;}
        {inherit fragments;}
      ];
    }).config.fragments;

  ordered = lib.splitString "\n" (render {
    last = {
      text = "last";
      after = ["anchor"];
    };
    first = {
      text = "first";
      before = ["anchor"];
    };
    anchor.text = "anchor";
    free-b.text = "free-b";
    free-a.text = "free-a";
  });
in {
  cases = {
    each-fragment-once = {
      protects = "rendering writes every fragment exactly once";
      expr = lib.sort lib.lessThan ordered;
      expected = ["anchor" "first" "free-a" "free-b" "last"];
    };
    declared-edges-order = {
      protects = "after and before order the fragments that declare them, whatever the free fragments do";
      expr = lib.filter (line: lib.elem line ["first" "anchor" "last"]) ordered;
      expected = ["first" "anchor" "last"];
    };
    undefined-reference-fails = {
      protects = "a fragment ordered against an undefined fragment fails rendering";
      expr = render {
        a = {
          text = "a";
          after = ["missing"];
        };
      };
      fails = true;
    };
    cycle-fails = {
      protects = "a cycle of order declarations fails rendering";
      expr = render {
        a = {
          text = "a";
          after = ["b"];
        };
        b = {
          text = "b";
          after = ["a"];
        };
      };
      fails = true;
    };
    conflicting-definitions-fail = {
      protects = "two definitions of one fragment with different text conflict instead of concatenating";
      expr =
        mylib.fragments.render
        (lib.evalModules {
          modules = [
            {options.fragments = mylib.fragments.option;}
            {fragments.a.text = "one";}
            {fragments.a.text = "two";}
          ];
        }).config.fragments;
      fails = true;
    };
  };
}
