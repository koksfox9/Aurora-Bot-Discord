function readPackage(pkg) {
  if (pkg.name === "prism-media") {
    delete pkg.optionalDependencies?.["@discordjs/opus"];
    delete pkg.peerDependencies?.["@discordjs/opus"];
    delete pkg.peerDependenciesMeta?.["@discordjs/opus"];
  }

  return pkg;
}

module.exports = {
  hooks: {
    readPackage
  }
};
