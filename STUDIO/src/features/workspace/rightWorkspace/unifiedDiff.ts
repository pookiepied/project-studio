export type DiffLineKind = "context" | "addition" | "deletion" | "meta" | "hunk";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface SplitDiffRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(source: string): DiffLine[] {
  if (!source) return [];

  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  return source.replace(/\r\n/g, "\n").split("\n").map((text) => {
    const hunk = HUNK_HEADER.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      return { kind: "hunk", text, oldLine: null, newLine: null };
    }

    if (!inHunk) return { kind: "meta", text, oldLine: null, newLine: null };
    if (text.startsWith("+") && !text.startsWith("+++")) {
      return { kind: "addition", text, oldLine: null, newLine: newLine++ };
    }
    if (text.startsWith("-") && !text.startsWith("---")) {
      return { kind: "deletion", text, oldLine: oldLine++, newLine: null };
    }
    if (text.startsWith(" ")) {
      return { kind: "context", text, oldLine: oldLine++, newLine: newLine++ };
    }
    return { kind: "meta", text, oldLine: null, newLine: null };
  });
}

export function createSplitRows(lines: DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (line.kind === "deletion" || line.kind === "addition") {
      const deletions: DiffLine[] = [];
      const additions: DiffLine[] = [];
      while (lines[index]?.kind === "deletion") deletions.push(lines[index++]);
      while (lines[index]?.kind === "addition") additions.push(lines[index++]);
      const count = Math.max(deletions.length, additions.length);
      for (let offset = 0; offset < count; offset += 1) {
        rows.push({ left: deletions[offset] ?? null, right: additions[offset] ?? null });
      }
      continue;
    }
    rows.push({ left: line, right: line });
    index += 1;
  }
  return rows;
}
