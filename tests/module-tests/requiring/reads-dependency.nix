# The case of a module whose fixture must hold the dependency.
home: {
  protects = "fixture";
  modules.reader.hjem.always = {config, ...}: {marker = config.myconfig.dependency.value;};
  expr = result: map (file: file.target) result.manifest.files;
  expected = ["${home}/from-dependency"];
}
