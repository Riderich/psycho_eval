/**
 * Batch-infer seeker age group metadata via DeepSeek.
 *
 * Usage examples:
 * 1) (Recommended) pass API key via env
 *    DEEPSEEK_API_KEY=... node scripts/infer_age_metadata_deepseek.mjs
 *
 * 2) pass API key via argument
 *    node scripts/infer_age_metadata_deepseek.mjs --api-key sk-xxx
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_ROOT = path.join(PROJECT_ROOT, "data", "data_zh_en");
const OUTPUT_FILE = path.join(DATA_ROOT, "age_metadata.json");

const ALLOWED_AGE = new Set([
  "child_3_12",
  "teen_13_18",
  "young_19_45",
  "mid_46_59",
  "old_60_plus"
]);

function getArg(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] || fallback;
}

function parseOptions() {
  const apiKey = getArg("--api-key") || process.env.DEEPSEEK_API_KEY || "";
  const baseUrl = getArg("--base-url") || "https://api.deepseek.com";
  const model = getArg("--model") || "deepseek-v4-flash";
  const maxSamples = Number(getArg("--max-samples") || "0");
  const delayMs = Number(getArg("--delay-ms") || "120");
  const overwrite = process.argv.includes("--overwrite");
  return { apiKey, baseUrl, model, maxSamples, delayMs, overwrite };
}

function readText(fp) {
  return fs.existsSync(fp) ? fs.readFileSync(fp, "utf8").trim() : "";
}

function buildSystemPrompt() {
  return [
    "你是心理对话标注助手。你的任务是根据给定对话，仅推断“求助者（Seeker）”最可能的年龄段。",
    "只能在以下五个标签中选择其一，不得自创：",
    "- child_3_12",
    "- teen_13_18",
    "- young_19_45",
    "- mid_46_59",
    "- old_60_plus",
    "",
    "判别原则：",
    "1) 以对话中的显性线索为主：自称身份、家庭角色、学业/职业阶段、人生阶段、健康与社会角色描述。",
    "2) 禁止仅凭语气风格主观猜测。",
    "3) 若证据冲突，选择证据更直接、更明确的一侧。",
    "4) 若证据不足，仍需给出最可能标签，但置信度应降低并说明不确定来源。",
    "5) 不要输出链路推理，只输出要求的JSON。",
    "",
    "输出必须是严格 JSON，字段如下：",
    "{",
    '  "age_group": "child_3_12|teen_13_18|young_19_45|mid_46_59|old_60_plus",',
    '  "confidence": 0.00-1.00,',
    '  "evidence": ["证据1", "证据2", "证据3"],',
    '  "counter_evidence": ["反证或不确定点1", "反证或不确定点2"],',
    '  "note": "一句话解释"',
    "}"
  ].join("\n");
}

function buildUserPrompt(groupId, dialogueZh, dialogueEn, criteriaText) {
  return [
    `请根据下面样本推断“求助者（Seeker）”年龄段（五选一）。`,
    `group_id: ${groupId}`,
    "",
    "【中文对话】",
    dialogueZh || "(空)",
    "",
    "【英文对话】",
    dialogueEn || "(空)",
    "",
    "【个性化评估细则（可辅助判断）】",
    criteriaText || "(空)",
    "",
    "只返回JSON，不要任何额外文字。"
  ].join("\n");
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

async function callDeepSeek({ apiKey, baseUrl, model, systemPrompt, userPrompt }) {
  const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 400)}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = safeJsonParse(content);
  if (!parsed) throw new Error("模型未返回可解析JSON");
  return parsed;
}

function normalizeAgeGroup(raw) {
  const val = String(raw || "").trim();
  return ALLOWED_AGE.has(val) ? val : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const opts = parseOptions();
  if (!opts.apiKey) {
    throw new Error("缺少 API Key。请设置 DEEPSEEK_API_KEY 或传入 --api-key。");
  }

  const allDirs = fs
    .readdirSync(DATA_ROOT)
    .filter((d) => /^\d+$/.test(d))
    .map(Number)
    .sort((a, b) => a - b);

  const systemPrompt = buildSystemPrompt();
  const existing = fs.existsSync(OUTPUT_FILE)
    ? JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"))
    : {};
  const out = opts.overwrite ? {} : { ...existing };

  let processed = 0;
  for (const gidNum of allDirs) {
    const gid = String(gidNum);
    if (!opts.overwrite && out[gid]?.age_group && ALLOWED_AGE.has(out[gid].age_group)) {
      continue;
    }
    if (opts.maxSamples > 0 && processed >= opts.maxSamples) break;

    const folder = path.join(DATA_ROOT, gid);
    const dialogueZh = readText(path.join(folder, "dialogue_zh.txt"));
    const dialogueEn = readText(path.join(folder, "dialogue_en.txt"));
    const criteriaText = readText(path.join(folder, "criteria.txt"));

    if (!dialogueZh && !dialogueEn) {
      console.warn(`[skip] ${gid}: 对话为空`);
      continue;
    }

    const userPrompt = buildUserPrompt(gid, dialogueZh, dialogueEn, criteriaText);

    try {
      const ret = await callDeepSeek({
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
        model: opts.model,
        systemPrompt,
        userPrompt
      });

      const ageGroup = normalizeAgeGroup(ret.age_group);
      if (!ageGroup) throw new Error(`非法 age_group: ${ret.age_group}`);

      const confidence = Number(ret.confidence);
      out[gid] = {
        age_group: ageGroup,
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
        evidence: Array.isArray(ret.evidence) ? ret.evidence.slice(0, 5) : [],
        counter_evidence: Array.isArray(ret.counter_evidence) ? ret.counter_evidence.slice(0, 5) : [],
        note: String(ret.note || ""),
        source: "deepseek-v4-flash",
        updated_at: new Date().toISOString()
      };

      processed += 1;
      console.log(`[ok] ${gid} -> ${ageGroup} (${out[gid].confidence.toFixed(2)})`);
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
      if (opts.delayMs > 0) await sleep(opts.delayMs);
    } catch (err) {
      console.error(`[fail] ${gid}: ${err.message}`);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`\nDone. metadata written to: ${OUTPUT_FILE}`);
  console.log(`total entries: ${Object.keys(out).length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
