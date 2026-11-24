{pkgs, ...}: let
  inherit (pkgs) lib;
  mylib = import ../../lib {inherit lib;};
  inherit (mylib) plist;
  infinity = 1.0e308 * 10.0;
  nan = infinity - infinity;
  control = builtins.fromJSON ''"\u0001"'';
  body = value: lib.removeSuffix "</plist>\n" (lib.last (lib.splitString "<plist version=\"1.0\">" (plist.toPlist value)));
in {
  cases = {
    accepted-values = {
      protects = "strings, booleans, integers, finite floats, lists and dictionaries are plist values";
      expr = plist.validValue {
        string = "s";
        bool = true;
        int = 1;
        float = 0.5;
        list = [1 "two"];
        dict.nested = false;
      };
      expected = true;
    };
    non-finite-floats-rejected = {
      protects = "NaN and the infinities, which have no plist real form, are not plist values";
      expr = map plist.validValue [nan infinity (-infinity)];
      expected = [false false false];
    };
    values-without-plist-form-rejected = {
      protects = "null and functions are not plist values";
      expr = map plist.validValue [null (x: x)];
      expected = [false false];
    };
    xml-control-characters-rejected = {
      protects = "a string or dictionary key holding an XML control character is rejected, while tab and newline are allowed";
      expr = map plist.validXml ["a${control}b" {"a${control}b" = 1;} ["a${control}"] "tab\tand\nnewline"];
      expected = [false false false true];
    };
    floats-round-trip = {
      protects = "a float is written in its shortest decimal form that parses back to the same value";
      expr = map body [0.1 1.0e-7 123456.789];
      expected = ["<real>0.1</real>" "<real>1e-07</real>" "<real>123456.789</real>"];
    };
    nested-values-serialize = {
      protects = "dictionaries, arrays, booleans and escaped strings serialize as plist XML";
      expr = body {
        flag = true;
        items = [1 "a<b"];
      };
      expected = "<dict><key>flag</key><true/><key>items</key><array><integer>1</integer><string>a&lt;b</string></array></dict>";
    };
  };
}
