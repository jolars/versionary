## [0.3.0](https://github.com/jolars/versionary/compare/v0.2.0...v0.3.0) (2026-04-15)

### Breaking changes
- default to non-major updates for pre-1.0.0 ([`5939fcc`](https://github.com/jolars/versionary/commit/5939fcc2dc99bf922a330ae3caf9b1f2f178d894))
- reorganize package ([`0a10419`](https://github.com/jolars/versionary/commit/0a1041921dbbddd7df314527af16c9dbe279e5e3))

### Features
- add rety and recovery behavior ([`7502011`](https://github.com/jolars/versionary/commit/750201112df9db8434d319fa39e21133c27faa29))
- implement per-package monorepo mode ([`ba41031`](https://github.com/jolars/versionary/commit/ba41031c6a81b471690f65e6ca5969fa76fcab67))
- improve PR body ([`d542e27`](https://github.com/jolars/versionary/commit/d542e27d64692cddf8bde1ff5971143ab314b502))
- improve the layout of the release PR ([`e62ae2f`](https://github.com/jolars/versionary/commit/e62ae2f60f2ff6e21c2b88cc358bb9a2e1b020a4)), closes [#9](https://github.com/jolars/versionary/issues/9)
- default to non-major updates for pre-1.0.0 ([`5939fcc`](https://github.com/jolars/versionary/commit/5939fcc2dc99bf922a330ae3caf9b1f2f178d894))
- add dedicated conventional commits parser ([`6e94963`](https://github.com/jolars/versionary/commit/6e949636151760404b63ff92e19828d5fa6a2e9a))
- add a node release strategy ([`ecbb7ef`](https://github.com/jolars/versionary/commit/ecbb7efff9e476c5f0e165ec9a0ebbf0cfbaa40e))
- add monorepo mode ([`088429e`](https://github.com/jolars/versionary/commit/088429e8d40213c93e1b062b4aad7f31cfcfdf9c))

### Bug Fixes
- harden github plugin ([`9f73132`](https://github.com/jolars/versionary/commit/9f73132211cb54f929f0763265bbc901a1177194))
- fixes #1 ([`4afa832`](https://github.com/jolars/versionary/commit/4afa832b4cfa38edafc46173b1d756ea401a5b9d))
- harden conventional commits parser ([`bb807da`](https://github.com/jolars/versionary/commit/bb807da2af92487eccb20ae0796f30d75a9260fa))
- use correct git sha filtering ([`3df77e4`](https://github.com/jolars/versionary/commit/3df77e4010b37d7a127d1887c27c5150ec73c237))
- fix git filter command ([`2c77a0e`](https://github.com/jolars/versionary/commit/2c77a0e17d3625c617cb900ca2a91a7b74f650e1))

## [0.2.0](https://github.com/jolars/versionary/compare/v0.1.0...v0.2.0) (2026-04-14)

- feat(changelog): make changelog a bit more detailed ([`7053914`](https://github.com/jolars/versionary/commit/7053914e2062f577c61c469212e3e3da5b93d5fb))
- feat(pr): improve pr looks ([`7a9ab39`](https://github.com/jolars/versionary/commit/7a9ab398f724f50b90492c40443a2e78b40547a0))
- feat: add npm plugin ([`b776b67`](https://github.com/jolars/versionary/commit/b776b677df9a0666dab21b946143e412fae33d72))
- fix(filter): allow perf, but not refactor to cause bump ([`0a7387f`](https://github.com/jolars/versionary/commit/0a7387f90d2c98acdde356420ee583bc1e1a45a6))
- feat: improve PR message ([`a917870`](https://github.com/jolars/versionary/commit/a917870e07f75e91c485c6cc41dbe05c1365d6fe))
- feat: filter commit messages ([`a746eb8`](https://github.com/jolars/versionary/commit/a746eb8571a86064964b2beaf7592c81578c2683))
- fix: track git status ([`b584079`](https://github.com/jolars/versionary/commit/b58407982b6307b24906c6d414dad8bf88148c1a))
- fix: don't be so strict with tracking ([`1e25c19`](https://github.com/jolars/versionary/commit/1e25c191d3ee815a409599a856e190b016894d6c))
- fix: loosen git requirement ([`ad1143f`](https://github.com/jolars/versionary/commit/ad1143ff37b83a05382ca45a9d0c3652d31a4d28))
- fix: refine github + ci setup ([`31a347c`](https://github.com/jolars/versionary/commit/31a347c0534aefcb0e21f36d5b11dae1552846a8))
- fix: trim history based on last tag ([`31e7c76`](https://github.com/jolars/versionary/commit/31e7c7695d10d562d09a5e2450730d169af6b7d9))
- feat: simplify github integration ([`4dac6df`](https://github.com/jolars/versionary/commit/4dac6df8cff0cf35e6f2ff455681a0aaf611c34f))
- feat: integrate github pr plugin ([`61b5467`](https://github.com/jolars/versionary/commit/61b546704df501400d213ac09e1e585f12c66fdb))
- feat: add agnostic core + release flow plugin config ([`1373ba4`](https://github.com/jolars/versionary/commit/1373ba48c15fe5ac66c14aeacf46e16515a24430))
- fix: make it one rolling release ([`72f2c71`](https://github.com/jolars/versionary/commit/72f2c71c4684307f8b2ff6109cf345b9b9289063))
- fix: filter out previous commits ([`f1dd57f`](https://github.com/jolars/versionary/commit/f1dd57f9800695b6af67397209c610680177ef5e))
- fix: ignore chore commits ([`17a132b`](https://github.com/jolars/versionary/commit/17a132bba973a47a6940e82f079b57afd424c3bf))
- feat: setup MWP ([`b373a9c`](https://github.com/jolars/versionary/commit/b373a9c2141c581db48d0f7d5dba08174e8acb54))
- feat: add basic architecture for package ([`9af7844`](https://github.com/jolars/versionary/commit/9af7844f1731b0fbd2e79e14f833e68e5d30decf))
