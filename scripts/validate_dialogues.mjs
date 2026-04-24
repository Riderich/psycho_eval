/**
 * Validates dialogue files against parseDialogueTurns + data-quality rules:
 * - No parsed turns with role "line" (orphan prefix-less lines at file start)
 * - First non-empty line must be a role line
 * - No markdown / session-header junk inside any turn text
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "data", "data_zh_en");

const ROLE_RE = /^(Supporter|Seeker|支持者|求助者)\s*[:：]\s*(.*)$/i;

/** Junk patterns that should not appear inside dialogue turns */
const JUNK_IN_TURN =
  /(^|\n)\s*#+\s|^\s*#+\s|\*\*[^*]+\*\*\s*:|```|^\s*markdown\s*$/im;

function parseDialogueTurns(raw) {
  const lines = String(raw || "").split(/\r?\n/);
  const turns = [];
  let bufferRole = "";
  let bufferText = [];

  function flush() {
    if (!bufferRole && !bufferText.length) return;
    turns.push({
      role: bufferRole || "line",
      text: bufferText.join("\n").trim()
    });
    bufferRole = "";
    bufferText = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(ROLE_RE);
    if (m) {
      flush();
      const who = m[1].toLowerCase();
      const role =
        who.includes("seek") || who.includes("求") ? "seeker" : "supporter";
      bufferRole = role;
      bufferText.push(m[2]);
    } else if (bufferRole) {
      bufferText.push(trimmed);
    } else {
      bufferRole = "line";
      bufferText.push(trimmed);
    }
  }
  flush();
  return turns;
}

function validateContent(raw) {
  const issues = [];
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    issues.push({ type: "empty" });
    return issues;
  }
  if (!ROLE_RE.test(lines[0])) {
    issues.push({ type: "first_line_not_role", preview: lines[0].slice(0, 120) });
  }

  const turns = parseDialogueTurns(raw);
  turns.forEach((t, i) => {
    if (t.role === "line") {
      issues.push({ type: "line_role_turn", turnIndex: i, preview: t.text.slice(0, 120) });
    }
    if (JUNK_IN_TURN.test(t.text)) {
      issues.push({ type: "markdown_or_header_in_turn", turnIndex: i, role: t.role, preview: t.text.slice(0, 160) });
    }
  });

  return issues;
}

function main() {
  const dirs = fs
    .readdirSync(ROOT)
    .filter((d) => /^\d+$/.test(d))
    .map(Number)
    .sort((a, b) => a - b);

  const all = [];
  for (const id of dirs) {
    const base = path.join(ROOT, String(id));
    for (const name of ["dialogue_zh.txt", "dialogue_en.txt"]) {
      const fp = path.join(base, name);
      if (!fs.existsSync(fp)) {
        all.push({ id, name, issues: [{ type: "missing_file" }] });
        continue;
      }
      const raw = fs.readFileSync(fp, "utf8");
      const issues = validateContent(raw);
      if (issues.length) all.push({ id, name, issues });
    }
  }

  console.log(JSON.stringify(all, null, 2));
  console.error("files_with_issues", all.length);
}

main();
