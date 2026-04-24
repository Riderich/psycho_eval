/**
 * One-shot sanitizer: normalize speaker aliases, strip leading markdown/meta "Supporter" blobs,
 * remove code fences / page markers / pasted quote blocks from turn text.
 * Writes dialogue_zh.txt / dialogue_en.txt in place (backup recommended).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "data", "data_zh_en");

const ROLE_RE = /^(Supporter|Seeker|支持者|求助者)\s*[:：]\s*(.*)$/i;

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

function serializeTurns(turns) {
  const out = [];
  for (const t of turns) {
    if (t.role === "line") continue;
    const label = t.role === "seeker" ? "Seeker" : "Supporter";
    const parts = String(t.text || "").split("\n");
    out.push(`${label}: ${parts[0] || ""}`.trimEnd());
    for (let i = 1; i < parts.length; i += 1) {
      out.push(parts[i]);
    }
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}

function preprocessRawLines(raw) {
  const lines = String(raw || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  const out = [];
  let pendingSup = false;

  for (let rawLine of lines) {
    const t = rawLine.trim();
    if (!t) {
      out.push("");
      continue;
    }
    if (pendingSup) {
      out.push(`Supporter: ${t}`);
      pendingSup = false;
      continue;
    }
    if (/^#{1,6}\s*咨询师\s*:\s*$/i.test(t) || /^咨询师\s*:\s*$/i.test(t)) {
      pendingSup = true;
      continue;
    }

    let m = t.match(/^(简|来访者|Client)\s*[:：]\s*(.*)$/i);
    if (m) {
      out.push(`Seeker: ${m[2]}`);
      continue;
    }
    m = t.match(/^(晓天|Counselor|Counsellor)\s*[:：]\s*(.*)$/i);
    if (m) {
      out.push(`Supporter: ${m[2]}`);
      continue;
    }
    m = t.match(/^\*\*来访者\*\*\s*[:：]\s*(.*)$/i);
    if (m) {
      out.push(`Seeker: ${m[1]}`);
      continue;
    }
    m = t.match(/^\*\*Client\*\*\s*[:：]\s*(.*)$/i);
    if (m) {
      out.push(`Seeker: ${m[1]}`);
      continue;
    }

    out.push(rawLine);
  }
  return out.join("\n");
}

function isLeadingMetaSupporterTurn(turn) {
  if (!turn || turn.role !== "supporter") return false;
  const s = turn.text.trim();
  if (!s) return true;
  if (/^markdown(\s|$|\n)/i.test(s)) return true;
  if (/^#+\s*(欢迎|会话|咨询|会谈|Chat|Conversation|Conversation Summary|Counselor|Problem|Case|欢迎来到)/i.test(s))
    return true;
  if (/\*\*来访者\*\*\s*:/i.test(s)) return true;
  if (/\n##\s*(聊天记录|案例背景|会谈概述|Chat Transcript|Case Background)/i.test(s)) return true;
  if (/Counselor's Guide to Rational/i.test(s)) return true;
  if (/\n###\s*(讨论要点|下一步|备注|目标|概述|会谈概述)/i.test(s) && s.length > 120)
    return true;
  const headingCount = (s.match(/\n#{2,3}\s/g) || []).length;
  if (headingCount >= 2 && s.length > 180) return true;
  if (/^markdown\n##\s/i.test(s)) return true;
  if (/^#\s*问题探索/i.test(s)) return true;
  if (/^markdown\n#\s*咨询会谈/i.test(s)) return true;
  if (/^markdown\n##\s*客户和咨询师信息/i.test(s)) return true;
  if (/^Session note(\n|$)/i.test(s)) return true;
  if (/^# Session transcript/i.test(s)) return true;
  return false;
}

function cleanTurnText(text) {
  let t = String(text || "");
  t = t.replace(/\r\n/g, "\n");
  t = t.replace(/\n```sql[\s\S]*?```\s*/gi, "\n");
  t = t.replace(/\n```[\s\S]*?```\s*/g, "\n");
  t = t.replace(/^```[\s\S]*?```\s*/g, "");
  t = t.replace(/\n```[a-z]*\s*$/gi, "\n");
  t = t.replace(/\n```\s*$/g, "\n");
  t = t.replace(/\n`--\s*$/g, "\n");
  t = t.replace(/\n-{3,}\s*(?=\n|$)/g, "\n");
  t = t.replace(/\n={5,}\s*(?=\n|$)/g, "\n");
  t = t.replace(/\n\d+\s*\/\s*\d+\s*(?=\n|$)/g, "\n");
  t = t.replace(/\n---[\s\S]*?\n结束啦\s*\n/g, "\n");
  t = t.replace(/\n“[\s\S]*?———\s*\n结束啦\s*/g, "\n");
  t = t.replace(/\n想和你分享一个我曾经看到过的段落[\s\S]*?结束啦\s*\n/g, "\n");
  t = t.replace(/[ \t]+\n/g, "\n");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizeFile(filePath) {
  let raw = fs.readFileSync(filePath, "utf8");
  raw = preprocessRawLines(raw);
  let turns = parseDialogueTurns(raw);
  while (turns.length && isLeadingMetaSupporterTurn(turns[0])) {
    turns.shift();
  }
  turns = turns.filter((t) => t.role !== "line");
  turns = turns
    .map((t) => ({
      role: t.role,
      text: cleanTurnText(t.text)
    }))
    .filter((t) => t.text.length > 0);
  const out = serializeTurns(turns);
  fs.writeFileSync(filePath, out, "utf8");
}

function main() {
  const dirs = fs
    .readdirSync(ROOT)
    .filter((d) => /^\d+$/.test(d))
    .map(Number)
    .sort((a, b) => a - b);

  for (const id of dirs) {
    const base = path.join(ROOT, String(id));
    for (const name of ["dialogue_zh.txt", "dialogue_en.txt"]) {
      const fp = path.join(base, name);
      if (fs.existsSync(fp)) sanitizeFile(fp);
    }
  }
  console.error("sanitized", dirs.length, "folders");
}

main();
