import fs from "node:fs";
import path from "node:path";
import type { VersionaryConfig } from "../types/config.js";
import type { VersionStrategy } from "./types.js";

interface CmakeArgument {
  value: string;
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
  literal: boolean;
}

interface CmakeCommand {
  name: string;
  arguments: CmakeArgument[];
  end: number;
}

interface ProjectMetadata {
  name: string | null;
  version: string;
  versionStart: number;
  versionEnd: number;
}

const CMAKE_VERSION_PATTERN = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2,3}$/u;

function bracketDelimiterAt(
  content: string,
  index: number,
): { openLength: number; close: string } | null {
  const match = content.slice(index).match(/^\[(=*)\[/u);
  if (!match) {
    return null;
  }
  const equals = match[1] ?? "";
  return { openLength: equals.length + 2, close: `]${equals}]` };
}

function skipBracket(content: string, index: number): number | null {
  const delimiter = bracketDelimiterAt(content, index);
  if (!delimiter) {
    return null;
  }
  const closeIndex = content.indexOf(
    delimiter.close,
    index + delimiter.openLength,
  );
  return closeIndex === -1
    ? content.length
    : closeIndex + delimiter.close.length;
}

function skipComment(content: string, index: number): number {
  const bracketEnd = skipBracket(content, index + 1);
  if (bracketEnd !== null) {
    return bracketEnd;
  }
  const newline = content.indexOf("\n", index + 1);
  return newline === -1 ? content.length : newline;
}

function skipQuoted(content: string, index: number): number {
  let cursor = index + 1;
  while (cursor < content.length) {
    if (content[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (content[cursor] === '"') {
      return cursor + 1;
    }
    cursor += 1;
  }
  return content.length;
}

function skipTrivia(content: string, index: number): number {
  let cursor = index;
  while (cursor < content.length) {
    if (/\s/u.test(content[cursor] ?? "")) {
      cursor += 1;
      continue;
    }
    if (content[cursor] === "#") {
      cursor = skipComment(content, cursor);
      continue;
    }
    break;
  }
  return cursor;
}

function readQuotedArgument(content: string, start: number): CmakeArgument {
  const end = skipQuoted(content, start);
  const closed = end <= content.length && content[end - 1] === '"';
  const valueEnd = closed ? end - 1 : end;
  const value = content.slice(start + 1, valueEnd);
  return {
    value,
    start,
    end,
    valueStart: start + 1,
    valueEnd,
    literal: closed && !value.includes("$"),
  };
}

function readBracketArgument(
  content: string,
  start: number,
): CmakeArgument | null {
  const delimiter = bracketDelimiterAt(content, start);
  if (!delimiter) {
    return null;
  }
  const end = skipBracket(content, start) ?? content.length;
  const closed = end < content.length || content.endsWith(delimiter.close);
  const valueEnd = closed ? end - delimiter.close.length : end;
  return {
    value: content.slice(start + delimiter.openLength, valueEnd),
    start,
    end,
    valueStart: start + delimiter.openLength,
    valueEnd,
    literal: closed,
  };
}

function readCommand(
  content: string,
  name: string,
  openParen: number,
): CmakeCommand {
  const args: CmakeArgument[] = [];
  let cursor = openParen + 1;
  let depth = 1;

  while (cursor < content.length) {
    cursor = skipTrivia(content, cursor);
    if (cursor >= content.length) {
      break;
    }

    const current = content[cursor];
    if (current === ")") {
      depth -= 1;
      cursor += 1;
      if (depth === 0) {
        break;
      }
      continue;
    }
    if (current === "(") {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (current === '"') {
      const argument = readQuotedArgument(content, cursor);
      if (depth === 1) {
        args.push(argument);
      }
      cursor = argument.end;
      continue;
    }
    if (current === "[") {
      const argument = readBracketArgument(content, cursor);
      if (argument) {
        if (depth === 1) {
          args.push(argument);
        }
        cursor = argument.end;
        continue;
      }
    }

    const start = cursor;
    while (cursor < content.length) {
      const character = content[cursor];
      if (
        /\s/u.test(character ?? "") ||
        character === "#" ||
        character === "(" ||
        character === ")"
      ) {
        break;
      }
      cursor += 1;
    }
    if (cursor === start) {
      cursor += 1;
      continue;
    }
    if (depth === 1) {
      const value = content.slice(start, cursor);
      args.push({
        value,
        start,
        end: cursor,
        valueStart: start,
        valueEnd: cursor,
        literal: !value.includes("$"),
      });
    }
  }

  return { name, arguments: args, end: cursor };
}

function findCommands(content: string): CmakeCommand[] {
  const commands: CmakeCommand[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    const current = content[cursor];
    if (current === "#") {
      cursor = skipComment(content, cursor);
      continue;
    }
    if (current === '"') {
      cursor = skipQuoted(content, cursor);
      continue;
    }
    if (current === "[") {
      const bracketEnd = skipBracket(content, cursor);
      if (bracketEnd !== null) {
        cursor = bracketEnd;
        continue;
      }
    }
    if (!/[A-Za-z_]/u.test(current ?? "")) {
      cursor += 1;
      continue;
    }

    const nameStart = cursor;
    cursor += 1;
    while (/[A-Za-z0-9_]/u.test(content[cursor] ?? "")) {
      cursor += 1;
    }
    const name = content.slice(nameStart, cursor);
    const openParen = skipTrivia(content, cursor);
    if (content[openParen] !== "(") {
      continue;
    }
    const command = readCommand(content, name, openParen);
    commands.push(command);
    cursor = command.end;
  }

  return commands;
}

function parseProjectMetadata(
  content: string,
  versionFile: string,
): ProjectMetadata {
  const projects = findCommands(content).filter(
    (command) => command.name.toLowerCase() === "project",
  );
  const versionedProjects = projects.filter((command) =>
    command.arguments.some(
      (argument) => argument.value.toUpperCase() === "VERSION",
    ),
  );

  if (versionedProjects.length !== 1) {
    if (versionedProjects.length > 1) {
      throw new Error(
        `${versionFile} must contain exactly one project() declaration with a VERSION argument required by release-type "cmake"; found ${versionedProjects.length}.`,
      );
    }
    throw new Error(
      `${versionFile} is missing a literal VERSION argument in project() required by release-type "cmake".`,
    );
  }

  const project = versionedProjects[0];
  if (!project) {
    throw new Error(`Failed to parse ${versionFile}.`);
  }
  const versionIndexes = project.arguments.flatMap((argument, index) =>
    argument.value.toUpperCase() === "VERSION" ? [index] : [],
  );
  if (versionIndexes.length !== 1) {
    throw new Error(
      `${versionFile} must contain exactly one VERSION argument in project() required by release-type "cmake".`,
    );
  }
  const versionArgument = project.arguments[(versionIndexes[0] ?? -1) + 1];
  if (
    !versionArgument?.literal ||
    !CMAKE_VERSION_PATTERN.test(versionArgument.value)
  ) {
    throw new Error(
      `${versionFile} is missing a valid literal VERSION argument in project() required by release-type "cmake"; expected X.Y.Z or X.Y.Z.W.`,
    );
  }

  const nameArgument = project.arguments[0];
  const name =
    nameArgument?.literal && nameArgument.value.trim().length > 0
      ? nameArgument.value.trim()
      : null;
  return {
    name,
    version: versionArgument.value,
    versionStart: versionArgument.valueStart,
    versionEnd: versionArgument.valueEnd,
  };
}

export const cmakeVersionStrategy: VersionStrategy = {
  name: "cmake",
  getVersionFile(config: VersionaryConfig): string {
    return config["version-file"] ?? "CMakeLists.txt";
  },
  validateProject(cwd: string, config: VersionaryConfig): string | null {
    const versionFile = this.getVersionFile(config);
    const versionPath = path.join(cwd, versionFile);
    if (!fs.existsSync(versionPath)) {
      return null;
    }
    try {
      parseProjectMetadata(fs.readFileSync(versionPath, "utf8"), versionFile);
      return null;
    } catch (error: unknown) {
      return error instanceof Error ? error.message : String(error);
    }
  },
  readVersion(cwd: string, config: VersionaryConfig): string {
    const versionFile = this.getVersionFile(config);
    const versionPath = path.join(cwd, versionFile);
    if (!fs.existsSync(versionPath)) {
      throw new Error(`Versionary requires ${versionFile} to exist.`);
    }
    return parseProjectMetadata(
      fs.readFileSync(versionPath, "utf8"),
      versionFile,
    ).version;
  },
  writeVersion(
    cwd: string,
    config: VersionaryConfig,
    version: string,
  ): string[] {
    if (!CMAKE_VERSION_PATTERN.test(version)) {
      throw new Error(
        `release-type "cmake" cannot write version "${version}"; CMake project() requires X.Y.Z or X.Y.Z.W without prerelease or build metadata.`,
      );
    }
    const versionFile = this.getVersionFile(config);
    const versionPath = path.join(cwd, versionFile);
    if (!fs.existsSync(versionPath)) {
      throw new Error(`Versionary requires ${versionFile} to exist.`);
    }
    const existing = fs.readFileSync(versionPath, "utf8");
    const metadata = parseProjectMetadata(existing, versionFile);
    const updated = `${existing.slice(0, metadata.versionStart)}${version}${existing.slice(metadata.versionEnd)}`;
    fs.writeFileSync(versionPath, updated, "utf8");
    return [versionFile];
  },
  readPackageName(cwd: string, config: VersionaryConfig): string | null {
    const versionFile = this.getVersionFile(config);
    const versionPath = path.join(cwd, versionFile);
    if (!fs.existsSync(versionPath)) {
      throw new Error(`Versionary requires ${versionFile} to exist.`);
    }
    return parseProjectMetadata(
      fs.readFileSync(versionPath, "utf8"),
      versionFile,
    ).name;
  },
};
