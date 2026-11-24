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
