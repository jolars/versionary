export function redactCredentials(message: string): string {
  let redacted = message.replace(
    /([a-z][a-z\d+.-]*:\/\/)[^\s/]*@/giu,
    "$1[REDACTED]@",
  );
  const tokens = [
    process.env.VERSIONARY_PR_TOKEN,
    process.env.GH_TOKEN,
    process.env.GITHUB_TOKEN,
  ].filter((token): token is string => Boolean(token));
  const secrets = new Set(
    tokens.flatMap((token) => [token, encodeURIComponent(token)]),
  );
  // Replace longer secrets first so an overlapping token cannot leave a suffix.
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  return redacted;
}
