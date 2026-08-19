{
  pkgs,
  ...
}:

{
  packages = [
    pkgs.git
    pkgs.biome
    pkgs.go-task
  ];

  languages = {
    javascript = {
      enable = true;

      lsp.enable = true;

      pnpm = {
        enable = true;
        package = pkgs.pnpm_10;
      };
    };

    rust = {
      enable = true;
    };

    typescript = {
      enable = true;

      lsp.enable = true;
    };
  };

  git-hooks.hooks = {
    biome = {
      enable = true;
    };
  };

}
