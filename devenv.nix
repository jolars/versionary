{
  pkgs,
  ...
}:

{
  packages = [ pkgs.git ];

  languages = {
    javascript = {
      enable = true;

      lsp.enable = true;

      corepack.enable = true;
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
