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
  };

  git-hooks.hooks = {
    eslint.enable = true;
  };

}
