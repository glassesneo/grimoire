# Maple Mono NF with Japanese glyphs, built from source because the released
# CJK fonts keep the glyphs at their base size inside the two-cell advance,
# leaving a visible gap between adjacent kana in a terminal. The scale factor
# enlarges the CJK outlines within that advance.
{
  lib,
  python3,
  stdenvNoCC,
  source,
  jpBase,
  scaleFactor,
}:
stdenvNoCC.mkDerivation {
  pname = "maple-nf-jp";
  version = lib.removePrefix "v" source.version;
  src = source;

  nativeBuildInputs = [
    (python3.withPackages (ps:
      with ps; [
        booleanoperations
        brotli
        cffsubr
        compreffor
        fontmake
        fontmath
        fonttools
        glyphslib
        openstep-plist
        py7zr
        skia-pathops
        ttfautohint-py
        ufo2ft
        ufolib2
        unicodedata2
        zopfli
      ]))
  ];

  # build.py takes the CJK base archive from beside itself instead of
  # downloading it.
  buildPhase = ''
    runHook preBuild
    export HOME=$TMPDIR
    cp ${jpBase} jp-base-static.zip
    python build.py --cjk jp --cjk-scale-factor ${scaleFactor} --least-styles --format ttf --no-hinted
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    install -Dm444 -t $out/share/fonts/truetype fonts/NF-JP/*.ttf
    runHook postInstall
  '';

  meta.license = lib.licenses.ofl;
}
