---
layout: home

hero:
  name: Versionary
  text: Automated releases, your way.
  tagline: Software-agnostic versioning, changelogs, tags, and release metadata driven by Conventional Commits and Semantic Versioning.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Why Versionary?
      link: /guide/introduction
    - theme: alt
      text: View on GitHub
      link: https://github.com/jolars/versionary

features:
  - title: Direct releases or release PRs
    details: Publish straight from your trunk, or gate releases behind a reviewable release PR. Pick per repository with one config key.
  - title: Ecosystem-agnostic
    details: Built-in strategies for Node, Rust, Python, R, Julia, and LaTeX—plus a simple text strategy and composite strategies for polyglot projects.
  - title: Conventional Commits in, SemVer out
    details: Commit types determine the next version and the changelog. Breaking changes, reverts, and pre-1.0 policy are handled for you.
  - title: Monorepo-aware
    details: Independent or fixed versioning, per-package strategies, dependency follows, and path-scoped commit filtering.
  - title: GitHub-native automation
    details: A composite Action prepares release PRs and publishes releases, with machine-readable outputs for downstream publishing workflows.
  - title: Small, stable core
    details: Versioning, changelog, tagging, and release metadata—nothing more. Registry publishing stays in your CI, triggered by the tags Versionary creates.
---
