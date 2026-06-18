import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Versionary",
  description:
    "Software-agnostic automated releases driven by Conventional Commits and Semantic Versioning.",
  lang: "en-US",
  base: "/versionary/",
  cleanUrls: true,
  lastUpdated: true,
  head: [["link", { rel: "icon", href: "/versionary/favicon.svg" }]],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/introduction" },
      { text: "Reference", link: "/reference/cli" },
      {
        text: "Contributing",
        link: "/contributing",
      },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
          items: [
            { text: "What is Versionary?", link: "/guide/introduction" },
            { text: "Getting started", link: "/guide/getting-started" },
          ],
        },
        {
          text: "Core concepts",
          items: [
            {
              text: "Conventional Commits",
              link: "/guide/conventional-commits",
            },
            { text: "Versioning", link: "/guide/versioning" },
            { text: "Release workflows", link: "/guide/workflows" },
            { text: "Monorepos", link: "/guide/monorepos" },
          ],
        },
        {
          text: "Automation",
          items: [{ text: "GitHub Actions", link: "/guide/github-actions" }],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "CLI commands", link: "/reference/cli" },
            { text: "Configuration", link: "/reference/configuration" },
            { text: "Strategies", link: "/reference/strategies" },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/jolars/versionary" },
    ],
    editLink: {
      pattern: "https://github.com/jolars/versionary/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    search: {
      provider: "local",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © Johan Larsson",
    },
  },
});
