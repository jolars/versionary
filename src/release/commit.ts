export function isReleaseCommitMessage(commitMessage: string): boolean {
  if (/^Versionary-Release:\s*true$/imu.test(commitMessage)) {
    return true;
  }
  const subject = commitMessage.split("\n")[0]?.trim() ?? "";
  return /^chore\(release\):\s+(?:(?:v\d+\.\d+\.\d+|\S+-v\d+\.\d+\.\d+)(?:,\s+(?:v\d+\.\d+\.\d+|\S+-v\d+\.\d+\.\d+))*|(?:v\d+\.\d+\.\d+|\S+-v\d+\.\d+\.\d+)\s+\(\+\d+\s+more\))(?:\s+\(#\d+\))?$/u.test(
    subject,
  );
}
