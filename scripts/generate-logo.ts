/**
 * Generates the versionary logo as standalone SVG files.
 *
 * Concept: a realistic git history resolving into a semantic version `x.y.z`.
 * Feature branches fork off `main`, do a little work, and merge back into a
 * release commit that bumps a version component. Each release commit is
 * color-coupled to its glyph (major/minor/patch <-> breaking/feat/fix) and
 * drops a colored tick onto it.
 *
 *   pnpm tsx scripts/generate-logo.ts
 *
 * Output lands in `assets/logo/`.
 *
 * ----------------------------------------------------------------------------
 * TWEAKING
 * ----------------------------------------------------------------------------
 * Almost everything you'd want to change lives in the `CONFIG` object below:
 * fonts, colors (light + dark), canvas size, spacing, stroke widths, node
 * sizes, the tick drop, and the git-graph structure itself.
 *
 * The three version components share a single x per column (`CONFIG.columns`).
 * Each column's release commit, its tick, and its wordmark glyph all align to
 * that x, so you can re-space the whole mark just by editing `columns` — the
 * graph and the text stay in sync. The "." separators auto-center between
 * adjacent columns.
 *
 * Coordinates are in SVG user units; y grows downward, so a *smaller* `lane`
 * value sits *higher* above the spine.
 * ----------------------------------------------------------------------------
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ===========================================================================
// CONFIG — tweak me
// ===========================================================================

/** A color palette. One per output variant (light/dark). */
interface Palette {
  x: string; // major  -> breaking change
  y: string; // minor  -> feat
  z: string; // patch  -> fix
  spine: string; // the `main` line
  commit: string; // neutral commits on `main`
  dot: string; // the "." separators in the wordmark
  bg: string; // background; use "" / "none" for transparent
}

/** A sub-branch: a branch that forks off another branch (not off `main`). */
interface SubBranch {
  fork: number; // x where it forks off the parent lane
  lane: number; // its own y lane (smaller = higher)
  commits: number[]; // x of each commit along its lane
  merge: number; // x where it merges back into the parent lane
}

/** A feature branch that forks off `main` and merges into a release commit. */
interface Branch {
  column: number; // index into CONFIG.columns; the release/merge sits here
  hue: "x" | "y" | "z"; // which palette color this branch uses
  fork: number; // x on the spine where the branch forks off
  lane: number; // this branch's y lane (smaller = higher)
  commits: number[]; // x of each feature commit along the lane
  sub?: SubBranch; // optional branch-off-a-branch
}

const CONFIG = {
  // --- canvas ----------------------------------------------------------
  width: 432,
  height: 290,

  // --- layout anchors --------------------------------------------------
  // The x-center of each version component. Release commits, ticks, and
  // wordmark glyphs all align to these. Spread or tighten the mark here.
  columns: [98, 218, 338],
  spineY: 124, // y of the `main` line
  spineStart: 34, // x where `main` begins (left)
  spineEnd: 398, // x where `main` ends (right)

  // --- node sizes (radii) ----------------------------------------------
  radii: {
    release: 12, // the merge/release commits (on the spine, under each glyph)
    commit: 7.5, // feature commits on a branch lane
    sub: 6, // commits on a sub-branch
    neutral: 6, // plain commits on `main` (forks + trunk)
  },

  // --- stroke widths ---------------------------------------------------
  strokes: {
    spine: 6, // the `main` line
    edge: 6, // branch/merge curves
    tick: 5, // the colored drop from a release commit to its glyph
  },

  // --- curves ----------------------------------------------------------
  // Horizontal "tension" of fork/merge S-curves, 0..1. 0.5 = gentle S;
  // lower = sharper corners, higher = lazier, more overshooting curve.
  curveTension: 0.5,
  haloPad: 3, // halo punched behind release commits so lines read cleanly

  // --- the tick (release commit -> glyph) ------------------------------
  tick: {
    show: true,
    gap: 4, // gap below the release node before the tick starts
    toY: 174, // y where the tick stops (just above the glyph tops)
  },

  // --- trunk commits ---------------------------------------------------
  // Plain commits drawn on `main` so the trunk looks alive. x positions.
  // (Branch fork points also get a neutral commit automatically.)
  trunkCommits: [128, 268, 398],

  // --- wordmark --------------------------------------------------------
  font: {
    family:
      "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', ui-monospace, monospace",
    size: 100,
    weight: 700,
    baseline: 250, // y of the text baseline
  },

  // --- the git graph ---------------------------------------------------
  // Each branch merges into the release commit at `columns[column]`.
  // Shapes deliberately vary to read like a real history:
  //   major (x): long-running feature, high lane, with its own sub-branch
  //   minor (y): an ordinary feature branch
  //   patch (z): a quick hotfix — forks and merges almost immediately
  branches: [
    {
      column: 0,
      hue: "x",
      fork: 34,
      lane: 62,
      commits: [54, 92],
      sub: { fork: 54, lane: 30, commits: [68, 80], merge: 92 },
    },
    { column: 1, hue: "y", fork: 150, lane: 64, commits: [174, 198] },
    { column: 2, hue: "z", fork: 306, lane: 96, commits: [324] },
  ] as Branch[],

  // --- color variants --------------------------------------------------
  // Each entry becomes an output file: `logo<suffix>.svg`.
  variants: [
    {
      suffix: "", // -> logo.svg
      palette: {
        x: "#e5484d", // major
        y: "#30a46c", // minor
        z: "#3e63dd", // patch
        spine: "#c7cad1",
        commit: "#9ea2ad",
        dot: "#9ea2ad",
        bg: "#ffffff",
      } as Palette,
    },
    {
      suffix: "-dark", // -> logo-dark.svg
      palette: {
        x: "#ff6369",
        y: "#3dd68c",
        z: "#7c93f5",
        spine: "#3a3d46",
        commit: "#6b6f78",
        dot: "#6b6f78",
        bg: "#111113",
      } as Palette,
    },
  ],
};

// ===========================================================================
// rendering (you usually won't need to touch below here)
// ===========================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "assets", "logo");

// --- svg primitives ------------------------------------------------------

function dot(cx: number, cy: number, r: number, fill: string): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
}

/** A filled node with a halo punched out of whatever is behind it. */
function ringDot(
  cx: number,
  cy: number,
  r: number,
  fill: string,
  bg: string,
): string {
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r + CONFIG.haloPad}" fill="${bg}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`
  );
}

function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  w: number,
): string {
  return `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>`;
}

/** Smooth S-curve between two points (used for fork and merge). */
function scurve(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  w: number,
): string {
  const k = CONFIG.curveTension;
  const cp1 = x1 + (x2 - x1) * k;
  const cp2 = x2 - (x2 - x1) * k;
  return `<path d="M${x1} ${y1}C${cp1} ${y1} ${cp2} ${y2} ${x2} ${y2}" stroke="${stroke}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
}

// --- the logo ------------------------------------------------------------

function buildLogo(p: Palette): string {
  const c = CONFIG;
  const { spineY } = c;
  const bg = p.bg && p.bg !== "none" ? p.bg : "#ffffff";
  const parts: string[] = [];

  // 1) main spine
  parts.push(
    line(c.spineStart, spineY, c.spineEnd, spineY, p.spine, c.strokes.spine),
  );

  // 2) branch edges (fork up, run along lane, merge down) + sub-branches
  for (const b of c.branches) {
    const color = p[b.hue];
    const merge = c.columns[b.column];
    const first = b.commits[0];
    const last = b.commits[b.commits.length - 1];
    parts.push(scurve(b.fork, spineY, first, b.lane, color, c.strokes.edge));
    if (b.commits.length > 1) {
      parts.push(line(first, b.lane, last, b.lane, color, c.strokes.edge));
    }
    parts.push(scurve(last, b.lane, merge, spineY, color, c.strokes.edge));
    if (b.sub) {
      const sFirst = b.sub.commits[0];
      const sLast = b.sub.commits[b.sub.commits.length - 1];
      parts.push(
        scurve(b.sub.fork, b.lane, sFirst, b.sub.lane, color, c.strokes.edge),
      );
      if (b.sub.commits.length > 1) {
        parts.push(
          line(sFirst, b.sub.lane, sLast, b.sub.lane, color, c.strokes.edge),
        );
      }
      parts.push(
        scurve(sLast, b.sub.lane, b.sub.merge, b.lane, color, c.strokes.edge),
      );
    }
  }

  // 3) neutral commits on the spine: fork points + ongoing trunk work
  for (const b of c.branches) {
    parts.push(dot(b.fork, spineY, c.radii.neutral, p.commit));
  }
  for (const x of c.trunkCommits) {
    parts.push(dot(x, spineY, c.radii.neutral, p.commit));
  }

  // 4) feature + sub-branch commits on the lanes
  for (const b of c.branches) {
    for (const x of b.commits) {
      parts.push(dot(x, b.lane, c.radii.commit, p[b.hue]));
    }
    if (b.sub) {
      for (const x of b.sub.commits) {
        parts.push(dot(x, b.sub.lane, c.radii.sub, p[b.hue]));
      }
    }
  }

  // 5) release commits (merge points) — drawn last so they sit on top
  for (const b of c.branches) {
    const merge = c.columns[b.column];
    parts.push(ringDot(merge, spineY, c.radii.release, p[b.hue], bg));
    if (c.tick.show) {
      const from = spineY + c.radii.release + c.tick.gap;
      parts.push(
        line(merge, from, merge, c.tick.toY, p[b.hue], c.strokes.tick),
      );
    }
  }

  // 6) the wordmark: each glyph centered on its column, dots centered between
  const hues: Array<"x" | "y" | "z"> = ["x", "y", "z"];
  const glyphs = ["x", "y", "z"];
  const f = c.font;
  const textAttrs =
    `font-family="${f.family}" font-size="${f.size}" font-weight="${f.weight}" ` +
    `text-anchor="middle" dominant-baseline="alphabetic"`;
  for (let i = 0; i < c.columns.length; i++) {
    parts.push(
      `<text x="${c.columns[i]}" y="${f.baseline}" ${textAttrs} fill="${p[hues[i]]}">${glyphs[i]}</text>`,
    );
    if (i < c.columns.length - 1) {
      const dotX = (c.columns[i] + c.columns[i + 1]) / 2;
      parts.push(
        `<text x="${dotX}" y="${f.baseline}" ${textAttrs} fill="${p.dot}">.</text>`,
      );
    }
  }

  const bgRect =
    p.bg && p.bg !== "none"
      ? `<rect width="${c.width}" height="${c.height}" fill="${p.bg}"/>\n`
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}" fill="none">\n${bgRect}${parts.join("\n")}\n</svg>\n`;
}

// --- write ---------------------------------------------------------------

mkdirSync(outDir, { recursive: true });

for (const v of CONFIG.variants) {
  const file = join(outDir, `logo${v.suffix}.svg`);
  writeFileSync(file, buildLogo(v.palette));
  console.log(`wrote ${file}`);
}
