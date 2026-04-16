# Changelog

## [0.11.1](https://github.com/jolars/versionary/compare/v0.11.0...v0.11.1) (2026-04-16)

### Bug Fixes
- recover from stale or invalid commit hashes ([`13f8496`](https://github.com/jolars/versionary/commit/13f8496c8c2603935d38c7d81ecb12dfcd9f9a76))

## [0.11.0](https://github.com/jolars/versionary/compare/v0.10.0...v0.11.0) (2026-04-16)

### Features
- report reverts separately in changelog ([`c417b2f`](https://github.com/jolars/versionary/commit/c417b2f88fdf49c20a6e321e7d9f9856ca28e5a1))

### Bug Fixes
- correctly publish changelog notes for non-root packages ([`d419317`](https://github.com/jolars/versionary/commit/d4193179a34034a1d25f571cb1825c197987f337))

## [0.10.0](https://github.com/jolars/versionary/compare/v0.9.0...v0.10.0) (2026-04-16)

### Breaking changes
- change review-mode to pr + direct, and make pr default ([`e0975be`](https://github.com/jolars/versionary/commit/e0975bea405240c938cf301b569647f98e669ad5))

### Features
- change review-mode to pr + direct, and make pr default ([`e0975be`](https://github.com/jolars/versionary/commit/e0975bea405240c938cf301b569647f98e669ad5))
- **pr:** shorten pr title ([`578020d`](https://github.com/jolars/versionary/commit/578020d658eb7aac3f0fdc505f5f4f521be913af))
- add `--dry-un` and machine-readable output ([`2bc7143`](https://github.com/jolars/versionary/commit/2bc714376d74352db3d1584e025865f1f62fd992))

### Bug Fixes
- maintain release targets from manifest ([`5330da1`](https://github.com/jolars/versionary/commit/5330da1b909411fbef8ccc639a1761d70a7f6bb5))

## [0.9.0](https://github.com/jolars/versionary/compare/v0.8.2...v0.9.0) (2026-04-16)

### Features
- **strategies:** support per-path changelogs ([`86d1810`](https://github.com/jolars/versionary/commit/86d18101b34d8cdecbe193e2798e327280fc701c))
- **strategies:** handle `version.workspace` for rust ([`cf82384`](https://github.com/jolars/versionary/commit/cf82384367edf76fd38cb09301d2ce80cf407102))

### Bug Fixes
- **domain:** refresh cargo lock files across workspace ([`001b0db`](https://github.com/jolars/versionary/commit/001b0dbcb8496ceea3ef01814a044c7b59781524))

## [0.8.2](https://github.com/jolars/versionary/compare/v0.8.1...v0.8.2) (2026-04-16)

### Bug Fixes
- correctly infer tag for package in path ([`d0a9399`](https://github.com/jolars/versionary/commit/d0a9399fc19dec7a7a3f4dcf6e6f6084c22d064d))

## [0.8.1](https://github.com/jolars/versionary/compare/v0.8.0...v0.8.1) (2026-04-16)

### Bug Fixes
- **action:** actually track action script ([`8ef3b55`](https://github.com/jolars/versionary/commit/8ef3b559c6507fdac91bf23c15d3cd6f29e6b925))

## [0.8.0](https://github.com/jolars/versionary/compare/v0.7.0...v0.8.0) (2026-04-16)

### Features
- **action:** migrate to node ([`57397e6`](https://github.com/jolars/versionary/commit/57397e63eea2ac3e30ba2b235a7fd26115d96157))
- harden detection of release commit ([`c461fa9`](https://github.com/jolars/versionary/commit/c461fa90439ab6ed6145e72a5854cc0249558d75))

### Bug Fixes
- **action:** fix unexpected token error ([`cbbe4f6`](https://github.com/jolars/versionary/commit/cbbe4f68b59be06a552395c15879d7dd4decb647))

## [0.7.0](https://github.com/jolars/versionary/compare/v0.6.0...v0.7.0) (2026-04-16)

### Features
- **config:** replace `jsonpath` with `field-path` ([`90316fc`](https://github.com/jolars/versionary/commit/90316fc7eb3cdff3c391576ff74843da6b68eaa1))
- **rust:** re-generate cargo lock files ([`222ae3f`](https://github.com/jolars/versionary/commit/222ae3fd4098342e4836f4ac9f68af416ea8ce13))

### Bug Fixes
- correctly find correct commit ([`fd64b2d`](https://github.com/jolars/versionary/commit/fd64b2d68b1d469dac0ff6d6508670c94b76b3a5))

## [0.6.0](https://github.com/jolars/versionary/compare/v0.5.0...v0.6.0) (2026-04-16)

### Breaking changes
- change manifest to use kebab-case ([`12c92a5`](https://github.com/jolars/versionary/commit/12c92a50b963af56a27b8bee9cdf52db65291763))
- resolve canonical names for packages ([`58c05cf`](https://github.com/jolars/versionary/commit/58c05cf2cdb650871f4754baf390de46b3744502))

### Features
- change manifest to use kebab-case ([`12c92a5`](https://github.com/jolars/versionary/commit/12c92a50b963af56a27b8bee9cdf52db65291763))
- **action:** change `github-token` to `token` ([`689429d`](https://github.com/jolars/versionary/commit/689429d8e0c9d23ba94b8922b5194af60417e007))
- **action:** use github token for API calls and git pushes ([`043ffc7`](https://github.com/jolars/versionary/commit/043ffc774e93097e2a9603a48ba069032158cad5))
- **pr:** handle monorepos in PR title ([`234a5a9`](https://github.com/jolars/versionary/commit/234a5a919a73c0f7d7f28ea0dd9ffcbba0cfc252))
- resolve canonical names for packages ([`58c05cf`](https://github.com/jolars/versionary/commit/58c05cf2cdb650871f4754baf390de46b3744502))
- **pr:** make main label be package name ([`01644da`](https://github.com/jolars/versionary/commit/01644da0c29f94e71fff6179b42dfc3775c82aa2))

### Bug Fixes
- **strategies:** handle rust cargo dep ([`ce3171f`](https://github.com/jolars/versionary/commit/ce3171f370cb3ff7e633526dbeee48602f30cf1a))

## [0.5.0](https://github.com/jolars/versionary/compare/v0.4.0...v0.5.0) (2026-04-15)

### Features
- add depdency graph handling ([`174be1a`](https://github.com/jolars/versionary/commit/174be1aea9bbf07516fa9abd8e679e71ed272691))
- add proper path scoping for workspaces ([`91ca8da`](https://github.com/jolars/versionary/commit/91ca8da5dc3ed43760249650c0194d278029e54e))
- support paths correctly ([`9a6147e`](https://github.com/jolars/versionary/commit/9a6147efd049b377e5247eb7f6d6765ddf5611f6))
- **action:** change name to versionary action ([`cb757ac`](https://github.com/jolars/versionary/commit/cb757acafa0577badf870bf1758980b44152f6b8))

## [0.4.0](https://github.com/jolars/versionary/compare/v0.3.0...v0.4.0) (2026-04-15)

### Features
- add github action ([`79eff26`](https://github.com/jolars/versionary/commit/79eff2672d990993bcee7023ec4ebf420761c7c5))
- add schema for manifest ([`bd67225`](https://github.com/jolars/versionary/commit/bd67225945844719e228f4187120edff5cd311d5))
- add `manifestVersion` to schema ([`dc8b2ce`](https://github.com/jolars/versionary/commit/dc8b2ce6d064bc8d2a49047878090bcbca914e68))
- drop `notes` field from manifest ([`0f47496`](https://github.com/jolars/versionary/commit/0f474966acb92e2a62f1ba4ead503e71f826940f))
- add yaml, json, toml, regex engines ([`d5f16aa`](https://github.com/jolars/versionary/commit/d5f16aa2b030e481b705e76a7a2db14181dbf569))
- add a strategy for R ([`53156d5`](https://github.com/jolars/versionary/commit/53156d5795b3e6ba57d3455dfa2844cca0683099))
- don't require `version.txt` on node strategy ([`4ee363a`](https://github.com/jolars/versionary/commit/4ee363a60a2f7a3304cf0a0a609f9b787d618cb3))
- implement rust strategy ([`044922a`](https://github.com/jolars/versionary/commit/044922aaa7911c87e54302691ae9741be6456ce8))

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
