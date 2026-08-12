import os from "node:os";

/**
 * Isolate the suite from the developer's git configuration.
 *
 * These tests drive real `git` invocations against throwaway repositories, so
 * any global or system setting leaks straight into the fixtures. `tag.gpgsign
 * = true` is the sharp edge: it silently upgrades the lightweight `git tag
 * v1.0.0` calls in the fixtures into signed annotated tags, which then fail
 * with "no tag message?" on any machine that signs tags by default. Pointing
 * both config files at the null device gives every run the same baseline
 * regardless of who is running it.
 *
 * Only `init.defaultBranch` is injected back. Committer identity deliberately
 * is not: `ensureGitIdentity` fills the gap only when `user.name`/`user.email`
 * do not already resolve, and `tests/git-identity.test.ts` covers exactly that
 * absence. Env-injected config also outranks repository-local config, so
 * supplying an identity here would override the one fixtures set for
 * themselves.
 */
const injectedConfig: Array<[string, string]> = [
  ["init.defaultBranch", "main"],
];

process.env.GIT_CONFIG_GLOBAL = os.devNull;
process.env.GIT_CONFIG_SYSTEM = os.devNull;
process.env.GIT_CONFIG_COUNT = String(injectedConfig.length);
for (const [index, [key, value]] of injectedConfig.entries()) {
  process.env[`GIT_CONFIG_KEY_${index}`] = key;
  process.env[`GIT_CONFIG_VALUE_${index}`] = value;
}
