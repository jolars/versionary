{
  lib,
  stdenvNoCC,
  src,
  nodejs,
  pnpm_10,
  fetchPnpmDeps,
  pnpmConfigHook,
  makeWrapper,
  git,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "versionary";
  version = (lib.importJSON ../package.json).version;
  inherit src;

  nativeBuildInputs = [
    nodejs
    pnpm_10
    pnpmConfigHook
    makeWrapper
  ];

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname src;
    pnpm = pnpm_10;
    fetcherVersion = 5;
    hash = "sha256-ajkpIC6LLJ3ts6W8V6xAip8kbTP9+8NpEx4ZET6lccY=";
  };

  buildPhase = ''
    runHook preBuild
    pnpm build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    rm -rf node_modules
    pnpm install --prod --offline --frozen-lockfile --ignore-scripts
    mkdir -p "$out/lib/versionary"
    cp -r dist package.json node_modules "$out/lib/versionary/"
    makeWrapper ${lib.getExe nodejs} "$out/bin/versionary" \
      --add-flags "$out/lib/versionary/dist/cli/index.js" \
      --prefix PATH : ${lib.makeBinPath [ git ]}
    runHook postInstall
  '';

  meta = {
    description = "Automatic releases based on Conventional Commits";
    homepage = "https://github.com/jolars/versionary";
    license = lib.licenses.mit;
    mainProgram = "versionary";
  };
})
