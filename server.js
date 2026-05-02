const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const {
  deepCloneAiSettings,
  mergeAiSettingsFromDb,
  mergeAiSettingsPatch,
  buildAiPrompt,
  buildGenerationConfig,
  loadPromptDefaults,
  DEFAULT_RAG_KEYWORD_BLOCKLIST,
  RUNTIME_CONTINUATION_MS_MIN,
  RUNTIME_CONTINUATION_MS_MAX,
} = require("./server-ai-settings");
const { POST_REPLY_HANGUL_GLUE_RULES } = require("./server-post-reply-hangul-glue.cjs");
const ko = require("./server-messages.ko.cjs");

loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 5500);
const PUBLIC_DIR = path.join(__dirname, "public");
function resolveDataDir() {
  const raw = String(process.env.DATA_DIR || "").trim();
  const isRender = String(process.env.RENDER || "").toLowerCase() === "true";
  if (isRender) {
    // On Render, /tmp may be wiped on redeploy; prefer a persistent disk path.
    if (!raw || raw.startsWith("/tmp")) return "/var/data";
  }
  return raw ? path.resolve(raw) : path.join(__dirname, "data");
}

const DATA_DIR = resolveDataDir();
const DB_DIR = DATA_DIR;
const DB_FILE = path.join(DB_DIR, "app-db.json");
const MAX_BODY_SIZE = 1_000_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const rateLimitMap = new Map();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite-preview";
const GEMINI_ENABLE_GROUNDING = String(process.env.GEMINI_ENABLE_GROUNDING || "true").toLowerCase() === "true";
const GEMINI_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 800);
const GEMINI_CHAT_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_CHAT_MAX_OUTPUT_TOKENS || 800);
const GEMINI_POST_FAST_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_POST_FAST_MAX_OUTPUT_TOKENS || 220);
const GEMINI_MAX_CONTINUATIONS = Number(process.env.GEMINI_MAX_CONTINUATIONS || 60);
const GEMINI_MAX_CONTINUATION_RUNTIME_MS = Number(process.env.GEMINI_MAX_CONTINUATION_RUNTIME_MS || 60000);
const GEMINI_CHAT_MAX_CONTINUATIONS = Number(process.env.GEMINI_CHAT_MAX_CONTINUATIONS || 0);
const GEMINI_CHAT_MAX_CONTINUATION_RUNTIME_MS = Number(process.env.GEMINI_CHAT_MAX_CONTINUATION_RUNTIME_MS || 3000);
const RAG_MAX_CANDIDATES = Number(process.env.RAG_MAX_CANDIDATES || 3);
const RAG_MIN_OVERLAP_TOKENS = Number(process.env.RAG_MIN_OVERLAP_TOKENS || 2);
const RAG_MIN_SCORE = Number(process.env.RAG_MIN_SCORE || 3);
const RAG_RELATIVE_CUTOFF_PCT = Number(process.env.RAG_RELATIVE_CUTOFF_PCT || 45);
const AI_SETTINGS_HISTORY_MAX = 120;
function createDefaultDb() {
  return {
    appDataByScope: {},
    signupUsers: [],
    sharedBoardHelp: {},
    aiSettings: deepCloneAiSettings(),
    aiApiLogs: [],
    aiSettingsHistory: [],
    /** 직원번호(스코프)별 AI채팅 지난 대화 — 브라우저와 무관하게 동기화 */
    aiChatHistoryByScope: {},
  };
}
const DEFAULT_DB = createDefaultDb();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function isQuotaOrRateLimitError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("quota") ||
    text.includes("rate limit") ||
    text.includes("resource_exhausted") ||
    text.includes("too many requests") ||
    text.includes("billing")
  );
}

function extractReplyFromGeminiData(data) {
  const blockReason =
    data && data.promptFeedback && data.promptFeedback.blockReason
      ? String(data.promptFeedback.blockReason)
      : "";
  const candidates = data && Array.isArray(data.candidates) ? data.candidates : [];

  const joinPartsText = (candidate) => {
    const parts =
      candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
    return parts
      .map((part) => (part && typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
  };

  let reply = "";
  let finishReason = "";

  for (const candidate of candidates) {
    if (!candidate) continue;
    const chunk = joinPartsText(candidate);
    const fr = typeof candidate.finishReason === "string" ? candidate.finishReason : "";
    if (chunk) {
      reply = chunk;
      finishReason = fr || finishReason;
      break;
    }
    if (fr && !finishReason) finishReason = fr;
  }

  // 여러 후보에 텍스트가 흩어진 경우(드물게 발생)
  if (!reply && candidates.length) {
    const chunks = [];
    for (const candidate of candidates) {
      const t = joinPartsText(candidate);
      if (t) chunks.push(t);
    }
    reply = chunks.join("\n").trim();
  }

  return { reply, finishReason, blockReason };
}

function sanitizeAiReplyText(text) {
  let out = String(text || "").trim();
  out = out.replace(ko.re.sanitizeDeskIntro, "");
  out = out.replace(ko.re.sanitizeQueryLead, "");
  out = out.replace(ko.re.sanitizeAskLead, "");
  return out.trim();
}

function sanitizeChatReplyText(text) {
  let out = stripGeminiEditorialLeakage(String(text || "").replace(/\r/g, "")).trim();
  out = out.replace(/([0-9])\n([0-9])/g, "$1$2");
  out = out.replace(ko.re.chatNumUnitSplit, "$1$2");
  out = out.replace(ko.re.chatWordSplit, "$1$2");

  const blocked =
    /(if applicable|previous logic|wait,|snippet might|let's think|internal|reasoning|analysis|thought process|system prompt|refining\s+for|of\s+the\s+sentence|according\s+to\s+search|here'?s\s+what|let\s+me\s+summarize|chain\s+of\s+thought|tl;?dr|executive\s+summary)/i;
  const normalized = out
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((line) => !blocked.test(line))
    .map((line) => line.replace(/^[?*]\s*/, "- ").replace(/^\d+\)\s*/, "- "));


  const merged = [];
  for (const line of normalized) {
    if (/^- /.test(line)) {
      merged.push(line);
      continue;
    }
    if (!merged.length) merged.push(`- ${line}`);
    else merged[merged.length - 1] = `${merged[merged.length - 1]} ${line}`.replace(/\s{2,}/g, " ").trim();
  }

  out = merged.map((line) => line.replace(/\s{2,}/g, " ").trim()).slice(0, 50).join("\n");
  return out.trim();
}

function compressAiReply(text) {
  const src = String(text || "").trim();
  if (!src) return src;
  return src
    .replace(/\r/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 모델이 본문에 섞어 출력하는 영문 편집 메모·섹션 라벨·내부 코멘트·마크다운 잔재 제거
 */
function stripGeminiEditorialLeakage(text) {
  let out = String(text || "");

  const junkPhrases = [
    /\bLTVRefining\s+for\s+flow\s+and\s+style\s*\(\s*/gi,
    /\bRefining\s+for\s+flow\s+and\s+style\s*\(\s*/gi,
    /\bRefining\s+for\s+flow\s+and\s+style\b/gi,
    /\bRefining\s+the\s+(?:answer|response|text|output)\b[^가-힣\n]{0,80}?/gi,
    /\bRefine\s+(?:for|the)\s+[^가-힣\n]{0,60}?/gi,
    /\s*Stress\s+DSR:\s*\*?\s*Mention\s*/gi,
    /\s*DSR:\s*\*?\s*Mention\s*/gi,
    /\s+LTV\s*DSR\s*:\s*\*?\s*Mention\s*/gi,
    /\s+Mention\s+(?=스트레스|[가-힣])/gi,
    /\s*of\s+the\s+sentence:\s*\*/gi,
    /\s*of\s+the\s+(?:paragraph|response|answer|reply|section|document|passage|bullet)\s*:\s*\*?\s*/gi,
    /\s*of\s+Policy\s+Loans\s+section:\s*\*\s*/gi,
    /\s*of\s+Policy\s+[A-Za-z]+\s+section:\s*\*\s*/gi,
    /\s*of\s+Regulatory\s+[^\n]{0,40}?section:\s*\*?\s*/gi,
    /\s*Conclusion\/Summary:\s*\*\s*General\s*/gi,
    /\s*(?:Introduction|Overview|Background)\s*\/\s*(?:Summary|Conclusion)\s*:\s*\*?\s*[A-Za-z]*\s*/gi,
    /\s*Policy\s+Loans\s+section:\s*\*\s*/gi,
    /\s*Compliance\s+(?:Note|Section)\s*:\s*\*?\s*/gi,
    /\s*\*+\s*Mention\s+/gi,
    /\s*\(\s*General\s*\)\s*/gi,
    /\s*(?:Key\s+Takeaways?|Main\s+Takeaway)\s*:\s*\*?\s*/gi,
    /\s*(?:Executive\s+)?Summary\s*:\s*\*(?:\s*General)?\s*/gi,
    /\s*TL;?DR\s*:\s*/gi,
    /\s*(?:Next\s+Steps?|Action\s+Items?|Follow-?up)\s*:\s*\*?\s*/gi,
    /\s*(?:Important|Please\s+note|Note|NB|FYI|Reminder)\s*:\s*(?=[A-Za-z])/gi,
    /\s*(?:According\s+to|Based\s+on)\s+(?:the\s+)?(?:search|Google|web)\s+results?[,:]\s*/gi,
    /\s*(?:Here's|Here\s+is)\s+(?:what|a|the)\s+[^가-힣]{0,100}?[.:]\s*/gi,
    /\s*Let\s+me\s+(?:explain|summarize|provide|clarify)\s*[^가-힣]{0,80}?[.:]\s*/gi,
    /\s*I'll\s+(?:summarize|provide|note)\s*[^가-힣]{0,60}?[.:]\s*/gi,
    /\s*We\s+should\s+note\s+that\s+/gi,
    /\s*Output\s*:\s*(?=[A-Za-z])/gi,
    /\s*Response\s*:\s*(?=[A-Za-z])/gi,
    /\s*Answer\s*\(\s*continued\s*\)\s*:\s*/gi,
    /\s*\[\s*(?:EDIT|TODO|FIXME|TBD|DRAFT|INTERNAL|PLACEHOLDER)\s*\]\s*/gi,
    /\s*\[앞부분\]\s*/g,
    /\s*<\s*(?:thinking|reasoning|scratchpad|analysis)\s*>[\s\S]*?<\s*\/\s*(?:thinking|reasoning|scratchpad|analysis)\s*>/gi,
    /\s*\[\s*(?:thinking|reasoning|chain\s+of\s+thought)\s*\][\s\S]*?\[\s*\/\s*(?:thinking|reasoning|chain\s+of\s+thought)\s*\]/gi,
    /\(\s*see\s+above\s*\)|\(\s*as\s+mentioned\s+earlier\s*\)/gi,
    /\s*,\s*for\s+(?:clarity|brevity|completeness)(?:\s+and\s+safety)?\s*[,.]?\s*/gi,
    /\s+for\s+flow\s+and\s+style\s*/gi,
    /\s*\*\s*(?:Summary|Details|Analysis)\s*:\s*\*?\s*/gi,
    /\s*:{2,}\s*(?:Mention|Note|Warning)\s+/gi,
    /\s*Disclaimer\s*:\s*(?=[A-Za-z\*])/gi,
    /\s*(?:Written|Edited)\s+by\s*:\s*/gi,
    /\s*(?:Draft|Version)\s*[v\d.]+\s*:\s*/gi,
    /\s*Bullet\s+\d+\s*:\s*\*?\s*/gi,
    /\s*(?:Step\s+\d+|Part\s+[A-Z])\s*:\s*\*?\s*/gi,
    /\s*#{1,3}\s+(?:Introduction|Overview|Summary|Conclusion|References)\s*$/gim,
    /\s*-\s*\*\*(?:Note|Warning|Caution)\*\*\s*:\s*/gi,
    /\s*\[\s*(?:continued|to\s+be\s+continued|\.\.\.)\s*\]\s*/gi,
    /\s*<\/?(?:assistant|user|system)\s*>\s*/gi,
    /\s*\{(?:continuing|same\s+as\s+above)\}\s*/gi,
    // 모델/편집 메타가 본문에 섞인 경우(영문)
    /\bThe fragment ends with\b[^\n]*/gi,
    /\bThe output was truncated\b[^\n]*/gi,
    /\bSimilar (?:fragment|passage) ends with\b[^\n]*/gi,
  ];
  junkPhrases.forEach((re) => {
    out = out.replace(re, "");
  });

  out = out.replace(/of\s+the\s+sentence:\s*\*[^가-힣]*(?:\.{2,3})?[^가-힣]{0,160}?/gi, "");
  out = out.replace(/([가-힣])(of\s+Policy[^\n가-힣]{0,100})(?=[가-힣])/gi, "$1");
  out = out.replace(/([가-힣])(Conclusion\/[^\n가-힣]{0,80})(?=[가-힣])/gi, "$1");
  out = out.replace(/([가-힣])(Introduction\/[^\n가-힣]{0,80})(?=[가-힣])/gi, "$1");

  out = out.replace(/\(\s*[A-Za-z][A-Za-z\s,:.'\-\/\*]{3,120}\)/g, (block) => {
    if (/[가-힣]/.test(block)) return block;
    if (
      /refining|sentence|policy|summary|mention|section|flow|style|general|conclusion|stress|loans|analysis|overview|introduction|appendix|regulatory|compliance|takeaway|emphasis|disclaimer|caveat|elaboration|clarification|bullet|paragraph|response|answer/i.test(
        block,
      )
    )
      return "";
    return block;
  });

  out = out.replace(/([가-힣])([A-Z][a-z]+)\s+for\s+flow\s+and\s+style/gi, "$1");

  const editorialStarters =
    /^(?:refining|mention|general|summary|conclusion|policy|sentence|section|stress|flow|style|analysis|overview|introduction|appendix|regulatory|compliance|takeaway|emphasis|disclaimer|caveat|elaboration|clarification|bullet)$/i;
  out = out.replace(
    /([가-힣])([A-Z][a-z]{2,22})(?=\s*[(\.,]|[가-힣])/g,
    (full, hangul, word) => {
      if (editorialStarters.test(word)) return hangul;
      return full;
    },
  );

  out = out.replace(
    /([가-힣])\s+([A-Z][a-z]+(?:\s+[a-z]{2,12}){0,4})\s+(?=\()/g,
    (full, hangul, phrase) => {
      const p = phrase.toLowerCase();
      if (
        /\b(?:section|summary|policy|sentence|mention|refining|for\s+flow)\b/i.test(p) ||
        /^(?:Key|Main|Policy|Summary)\s/i.test(phrase)
      )
        return hangul;
      return full;
    },
  );

  out = out.replace(/\*{3,}/g, "");
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/\s*\n\s*/g, "\n");
  out = out.replace(/\n{4,}/g, "\n\n\n");
  return out;
}

/** 모델·토큰 경계로 생긴 불필요 공백 정리 — 패턴 목록은 server-post-reply-hangul-glue.cjs 상수 참고 */
function normalizeHangulArtifactSpaces(text) {
  let out = String(text || "");
  out = out.replace(/\u200b/g, "");
  out = out.replace(/\s+([.,!?;:])/g, "$1");
  out = out.replace(/\s+([」』】〉])/g, "$1");
  out = out.replace(/([「『【〈])\s+/g, "$1");
  POST_REPLY_HANGUL_GLUE_RULES.forEach(([re, rep]) => {
    out = out.replace(re, rep);
  });
  out = out.replace(/[ \t]{2,}/g, " ");
  return out;
}

function sanitizePostReplyText(text) {
  let out = stripGeminiEditorialLeakage(String(text || "").replace(/\r/g, "")).trim();
  if (!out) return out;

  const blockedLine =
    /^(\*+\s*)?(refining the flow|refining\s+for|refine\s+for|point\s*\d+|policy\/regulations|analysis|reasoning|thought process|system prompt|mention\s*[:\*]|of\s+the\s+sentence|according\s+to\s+(?:the\s+)?search|based\s+on\s+(?:the\s+)?search|here'?s\s+what|let\s+me\s+(?:explain|summarize)|tl;?dr|executive\s+summary|key\s+takeaways?|chain\s+of\s+thought)\b|^\s*(?:sources?|references?|disclaimer)\s*:\s*$/i;
  out = out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !blockedLine.test(line))
    .map((line) => line.replace(/^\*+\s*/, ""))
    .join("\n");

  out = out
    .replace(/\*{2,}/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  out = normalizeHangulArtifactSpaces(out);

  return out;
}

function clampIntWithFallback(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function mergeContinuationText(base, next) {
  const a = String(base || "").trim();
  const b = String(next || "").trim();
  if (!a) return b;
  if (!b) return a;
  if (a.includes(b)) return a;
  if (b.includes(a)) return b;
  const maxOverlap = Math.min(300, a.length, b.length);
  let overlap = 0;
  for (let i = maxOverlap; i >= 2; i -= 1) {
    if (a.slice(-i) === b.slice(0, i)) {
      overlap = i;
      break;
    }
  }
  if (overlap > 0) return `${a}${b.slice(overlap)}`.trim();
  if (/^(?:[-*•]|[0-9]+[.)])\s/m.test(b)) return `${a}\n${b}`.trim();
  if (/[.!?。．…]["')\]]*\s*$/.test(a)) return `${a}\n${b}`.trim();
  return `${a} ${b}`.replace(/[ \t]{2,}/g, " ").trim();
}

function normalizeKnowStatus(statusRaw) {
  const s = String(statusRaw || "").toLowerCase().trim();
  if (s === "approved" || s === "trained") return "approved";
  if (s === "pending" || s === "ready") return "pending";
  if (s === "rejected" || s === "error") return "rejected";
  return "pending";
}

function shouldUseGrounding(boardType, title, content) {
  if (!GEMINI_ENABLE_GROUNDING) return false;
  const text = `${title || ""} ${content || ""}`.toLowerCase();
  const needsLatestGrounding = ko.latestInfoKeywords.some((kw) => text.includes(kw));
  const isBizContext = ko.bizKeywords.some((kw) => text.includes(kw));
  const type = String(boardType || "").toUpperCase();
  if (type === "CHAT") return needsLatestGrounding || isBizContext;
  if (type === "BIZ") return true;
  if (type === "IT" || type === "SYS") return needsLatestGrounding;
  return needsLatestGrounding;
}

function ensureDbFile() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), "utf8");
  }
}

function readDb() {
  ensureDbFile();
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      appDataByScope: parsed && typeof parsed.appDataByScope === "object" ? parsed.appDataByScope : {},
      signupUsers: Array.isArray(parsed && parsed.signupUsers) ? parsed.signupUsers : [],
      sharedBoardHelp: parsed && typeof parsed.sharedBoardHelp === "object" ? parsed.sharedBoardHelp : {},
      aiSettings: mergeAiSettingsFromDb(parsed),
      aiApiLogs: Array.isArray(parsed && parsed.aiApiLogs) ? parsed.aiApiLogs : [],
      aiSettingsHistory: Array.isArray(parsed && parsed.aiSettingsHistory) ? parsed.aiSettingsHistory : [],
      aiChatHistoryByScope:
        parsed && typeof parsed.aiChatHistoryByScope === "object" ? parsed.aiChatHistoryByScope : {},
    };
  } catch (error) {
    return createDefaultDb();
  }
}

function writeDb(db) {
  ensureDbFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function getNextAiSettingsVersionNo(history) {
  if (!Array.isArray(history) || !history.length) return 1;
  return (
    history.reduce((max, item) => {
      const n = Number(item && item.versionNo);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0) + 1
  );
}

function makeAiSettingsHistoryEntry(db, aiSettings, meta = {}, action = "save") {
  const versionNo = getNextAiSettingsVersionNo(db.aiSettingsHistory);
  return {
    id: `ai_cfg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    versionNo,
    action: String(action || "save"),
    changedBy: String(meta.changedBy || "").trim() || "unknown",
    note: String(meta.note || "").trim(),
    restoredFromVersionNo: meta.restoredFromVersionNo == null ? null : Number(meta.restoredFromVersionNo),
    createdAt: new Date().toISOString(),
    aiSettings,
  };
}

function pushAiSettingsHistory(db, entry) {
  if (!db || !entry) return;
  if (!Array.isArray(db.aiSettingsHistory)) db.aiSettingsHistory = [];
  db.aiSettingsHistory.unshift(entry);
  if (db.aiSettingsHistory.length > AI_SETTINGS_HISTORY_MAX) {
    db.aiSettingsHistory = db.aiSettingsHistory.slice(0, AI_SETTINGS_HISTORY_MAX);
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;
    req.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      totalLength += buf.length;
      if (totalLength > MAX_BODY_SIZE) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function applyRateLimit(req, res) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    sendJson(res, 429, { error: ko.errors.rateLimit });
    return false;
  }
  entry.count += 1;
  return true;
}

function getCookieValueFromHeader(cookieHeader, key) {
  const src = String(cookieHeader || "");
  if (!src || !key) return "";
  const items = src.split(";");
  for (const item of items) {
    const idx = item.indexOf("=");
    if (idx <= 0) continue;
    const k = decodeURIComponent(item.slice(0, idx).trim());
    if (k !== key) continue;
    return decodeURIComponent(item.slice(idx + 1).trim());
  }
  return "";
}

function saveAiApiLog(entry) {
  try {
    const db = readDb();
    if (!Array.isArray(db.aiApiLogs)) db.aiApiLogs = [];
    db.aiApiLogs.unshift(entry);
    db.aiApiLogs = db.aiApiLogs.slice(0, 400);
    writeDb(db);
  } catch (error) {
    // Logging must never break API behavior.
  }
}

function saveClientAiApiErrorLog(payload = {}) {
  const nowIso = new Date().toISOString();
  const errorMessage = String(payload.error || payload.errorMessage || "ai_client_request_failed");
  const entry = {
    id: `ai_client_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    createdAt: nowIso,
    requesterScope: String(payload.requesterScope || "guest").slice(0, 64),
    boardType: String(payload.boardType || "CHAT").slice(0, 32),
    title: String(payload.title || "(클라이언트 요청)").slice(0, 200),
    contentPreview: String(payload.contentPreview || "").slice(0, 1200),
    model: String(payload.model || GEMINI_MODEL || "-"),
    useGroundingRequested: false,
    runtime: {
      timeoutMs: Number(payload.timeoutMs || 0),
      continueFromChars: Number(payload.continueFromChars || 0),
      isTimeout: !!payload.isTimeout,
      errorName: String(payload.errorName || "").slice(0, 120),
      navigatorOnline: payload.navigatorOnline === true ? true : payload.navigatorOnline === false ? false : null,
      attemptCount: Number(payload.attemptCount || 0) || 0,
    },
    generationConfig: {},
    promptText: String(payload.promptText || "").slice(0, 12000),
    attempts: [
      {
        label: "client_request",
        requestedAt: nowIso,
        request: {
          promptChars: String(payload.contentPreview || "").length,
          promptText: String(payload.contentPreview || "").slice(0, 12000),
        },
        response: {
          ok: false,
          status: 0,
          finishReason: "",
          replyPreview: "",
          errorMessage,
        },
      },
    ],
    final: {
      ok: false,
      statusCode: 0,
      error: errorMessage,
      truncated: false,
      continuationCount: 0,
    },
    source: "client",
  };
  saveAiApiLog(entry);
}

async function handleAiChat(req, res) {
  if (!applyRateLimit(req, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: ko.errors.invalidJsonBody });
    return;
  }

  const title = String(body.title || "").slice(0, 200);
  const content = String(body.content || "").slice(0, 2000);
  const boardType = String(body.boardType || "").slice(0, 20);
  const continueFrom = String(body.continueFrom || "").slice(0, 6000);

  if (!title || !content) {
    sendJson(res, 400, { error: ko.errors.titleContentRequired });
    return;
  }

  if (!GEMINI_API_KEY) {
    sendJson(res, 200, {
      reply: ko.demoModeReply(boardType, title),
    });
    return;
  }

  // Only AI chat + IT/BIZ post assistant use the model.
  if (!(boardType === "CHAT" || boardType === "IT" || boardType === "BIZ")) {
    sendJson(res, 400, { error: "AI ??? ???? ?? ??????." });
    return;
  }

  function stripHtmlToText(html) {
    return String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenizeForSearch(text) {
    const stopwords = new Set([
      "요청",
      "문의",
      "내용",
      "관련",
      "기준",
      "안내",
      "확인",
      "처리",
      "업무",
      "정보",
      "대한",
      "위해",
      "있습니다",
      "합니다",
      "the",
      "and",
      "for",
      "with",
      "that",
      "this",
    ]);
    return String(text || "")
      .toLowerCase()
      .replace(/[^0-9a-z\uac00-\ud7a3]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !stopwords.has(t))
      .slice(0, 60);
  }

  function buildRagContext(queryText, boardTypeForRag, ragConfig = {}) {
    const getKnowDomainLabel = (rawDomain) => {
      const d = String(rawDomain || "").toUpperCase();
      if (d === "IT") return "IT 매뉴얼";
      if (d === "BIZ") return "업무 매뉴얼";
      return "기타";
    };
    const db = readDb();
    const shared = db.appDataByScope && db.appDataByScope.shared ? db.appDataByScope.shared : null;
    const posts = shared && Array.isArray(shared.posts) ? shared.posts : [];
    const bt = String(boardTypeForRag || "").toUpperCase();
    const know = posts.filter((p) => {
      if (!(p && p.type === "KNOW")) return false;
      if (normalizeKnowStatus(p.status) !== "approved") return false;
      const domain = String(p.knowCategory || "").toUpperCase();
      // 게시물 AI답변은 해당 게시판 도메인 지식만 사용(IT <-> IT, BIZ <-> BIZ)
      if (bt === "IT") return domain === "IT";
      if (bt === "BIZ") return domain === "BIZ";
      return true; // CHAT은 양쪽 허용
    });
    if (!know.length) return "";
    const qTokens = new Set(tokenizeForSearch(queryText));
    if (!qTokens.size) return "";

    const scored = know
      .map((p) => {
        const meta = p.meta && typeof p.meta === "object" ? p.meta : {};
        const fields = [
          { text: p.title, w: 3.0 },
          { text: meta.knowKeywords, w: 2.5 },
          { text: meta.knowQuestion, w: 2.2 },
          { text: meta.knowSummary, w: 1.8 },
          { text: meta.knowAnswer, w: 1.4 },
          { text: meta.knowSource, w: 1.2 },
          { text: stripHtmlToText(p.content), w: 1.0 },
        ];
        const matchedTokenSet = new Set();
        let score = 0;
        for (const f of fields) {
          const tokens = tokenizeForSearch(f.text);
          let fieldHits = 0;
          for (const t of tokens) {
            if (!qTokens.has(t)) continue;
            fieldHits += 1;
            matchedTokenSet.add(t);
          }
          if (fieldHits > 0) score += fieldHits * f.w;
        }
        const overlapCount = matchedTokenSet.size;
        // Small boost for exact full-query contains.
        const qStr = String(queryText || "").trim();
        const hayFull = fields
          .map((f) => String(f.text || ""))
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (qStr && hayFull.includes(qStr.toLowerCase())) score += 3;
        return { p, score, overlapCount };
      })
      // 단일 토큰 우연 일치는 제외하여 무관 지식 유입 방지
      .filter(
        (x) =>
          x.overlapCount >= Number(ragConfig.minOverlapTokens || 2) &&
          x.score >= Number(ragConfig.minScore || 3),
      )
      .sort((a, b) => b.score - a.score);

    if (!scored.length) return "";
    const topScore = scored[0].score;
    const relPct = Number(ragConfig.relativeCutoffPct || 45);
    const gated = scored
      // 상위 문서 대비 유사도가 낮은 꼬리 후보 제거
      .filter((x) => x.score >= Math.max(Number(ragConfig.minScore || 3), topScore * (relPct / 100)))
      .slice(0, Number(ragConfig.maxCandidates || 3));
    if (!gated.length) return "";

    const lines = [];
    lines.push("RAG_CONTEXT_BEGIN");
    lines.push("Use the following KNOWLEDGE snippets only if relevant. Do not invent facts beyond them.");
    for (const { p } of gated) {
      const meta = p.meta && typeof p.meta === "object" ? p.meta : {};
      lines.push("");
      lines.push(`- id: ${p.id} / domain: ${getKnowDomainLabel(p.knowCategory)}`);
      if (meta.knowSummary) lines.push(`  summary: ${stripHtmlToText(meta.knowSummary)}`);
      if (meta.knowQuestion) lines.push(`  Q: ${stripHtmlToText(meta.knowQuestion)}`);
      if (meta.knowAnswer) lines.push(`  A: ${stripHtmlToText(meta.knowAnswer).slice(0, 700)}`);
      if (meta.knowKeywords) lines.push(`  keywords: ${stripHtmlToText(meta.knowKeywords)}`);
      if (meta.knowSource) lines.push(`  source: ${stripHtmlToText(meta.knowSource).slice(0, 300)}`);
    }
    lines.push("");
    lines.push("RAG_CONTEXT_END");
    return lines.join("\n");
  }

  const aiSettings = readDb().aiSettings;
  const runtime = aiSettings && aiSettings.runtime && typeof aiSettings.runtime === "object" ? aiSettings.runtime : {};
  const chatMaxOutputTokens = clampIntWithFallback(
    runtime.chatMaxOutputTokens,
    50,
    8192,
    GEMINI_CHAT_MAX_OUTPUT_TOKENS,
  );
  const postMaxOutputTokens = clampIntWithFallback(runtime.postMaxOutputTokens, 50, 8192, GEMINI_MAX_OUTPUT_TOKENS);
  const postFastMaxOutputTokens = Math.min(
    clampIntWithFallback(GEMINI_POST_FAST_MAX_OUTPUT_TOKENS, 50, 8192, GEMINI_POST_FAST_MAX_OUTPUT_TOKENS),
    postMaxOutputTokens,
  );
  const chatMaxContinuations = clampIntWithFallback(
    runtime.chatMaxContinuations,
    0,
    200,
    GEMINI_CHAT_MAX_CONTINUATIONS,
  );
  const postMaxContinuations = clampIntWithFallback(runtime.postMaxContinuations, 0, 200, GEMINI_MAX_CONTINUATIONS);
  const chatMaxContinuationRuntimeMs = clampIntWithFallback(
    runtime.chatMaxContinuationRuntimeMs,
    RUNTIME_CONTINUATION_MS_MIN,
    RUNTIME_CONTINUATION_MS_MAX,
    GEMINI_CHAT_MAX_CONTINUATION_RUNTIME_MS,
  );
  const postMaxContinuationRuntimeMs = clampIntWithFallback(
    runtime.postMaxContinuationRuntimeMs,
    RUNTIME_CONTINUATION_MS_MIN,
    RUNTIME_CONTINUATION_MS_MAX,
    GEMINI_MAX_CONTINUATION_RUNTIME_MS,
  );
  const ragMaxCandidates = clampIntWithFallback(runtime.ragMaxCandidates, 1, 10, RAG_MAX_CANDIDATES);
  const ragMinOverlapTokens = clampIntWithFallback(
    runtime.ragMinOverlapTokens,
    1,
    10,
    RAG_MIN_OVERLAP_TOKENS,
  );
  const ragMinScore = clampIntWithFallback(runtime.ragMinScore, 0, 100, RAG_MIN_SCORE);
  const ragRelativeCutoffPct = clampIntWithFallback(
    runtime.ragRelativeCutoffPct,
    0,
    100,
    RAG_RELATIVE_CUTOFF_PCT,
  );
  const rag = buildRagContext([title, content].join("\n"), boardType, {
    maxCandidates: ragMaxCandidates,
    minOverlapTokens: ragMinOverlapTokens,
    minScore: ragMinScore,
    relativeCutoffPct: ragRelativeCutoffPct,
  });
  const promptBase = buildAiPrompt(boardType, title, content, continueFrom, aiSettings);
  const prompt = rag ? `${rag}\n\n${promptBase}` : promptBase;
  const genCaps = {
    chatMax: chatMaxOutputTokens,
    max: postMaxOutputTokens,
    postFast: postFastMaxOutputTokens,
  };
  const useGroundingRequested = shouldUseGrounding(boardType, title, content);
  /* 초기 생성: 클라 이어쓰기(continueFrom)면 전체 max, 아니면 빠른생성·그라운딩 하한 반영 */
  const generationConfigInitial = buildGenerationConfig(boardType, continueFrom, aiSettings, genCaps, {
    groundingFirstShot: useGroundingRequested,
  });
  /* 서버 내부 MAX_TOKENS 이어쓰기: 반드시 게시물 전체 예산(max). 예전에는 postFast(예:220)를 재사용해 조각만 반복 생성됨 */
  const generationConfigContinuation = buildGenerationConfig(boardType, "internal_max_tokens_continuation", aiSettings, genCaps);
  const requesterScope = getCookieValueFromHeader(req.headers.cookie, "knockUserScope");
  const aiApiLog = {
    id: `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    requesterScope: requesterScope || "guest",
    boardType,
    title: String(title || ""),
    contentPreview: String(content || "").slice(0, 3000),
    continueFromProvided: !!continueFrom,
    model: GEMINI_MODEL,
    useGroundingRequested,
    runtime: {
      chatMaxOutputTokens,
      postMaxOutputTokens,
      postFastMaxOutputTokens,
      chatMaxContinuations,
      postMaxContinuations,
      chatMaxContinuationRuntimeMs,
      postMaxContinuationRuntimeMs,
      ragMaxCandidates,
      ragMinOverlapTokens,
      ragMinScore,
      ragRelativeCutoffPct,
    },
    generationConfig: generationConfigInitial,
    generationConfigContinuation,
    promptText: String(prompt || "").slice(0, 12000),
    attempts: [],
    final: { ok: false, statusCode: 0, error: "", truncated: false, continuationCount: 0 },
  };

  try {
    const useGrounding = aiApiLog.useGroundingRequested;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: generationConfigInitial,
    };
    if (useGrounding) {
      requestBody.tools = [{ google_search: {} }];
    }

    async function callGemini(body, label) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      const parsedReply = extractReplyFromGeminiData(json);
      aiApiLog.attempts.push({
        label: String(label || ""),
        requestedAt: new Date().toISOString(),
        request: {
          hasTools: !!(body && body.tools),
          generationConfig: body && body.generationConfig ? body.generationConfig : {},
          promptChars: body && body.contents && body.contents[0] && body.contents[0].parts && body.contents[0].parts[0]
            ? String(body.contents[0].parts[0].text || "").length
            : 0,
          promptText:
            body && body.contents && body.contents[0] && body.contents[0].parts && body.contents[0].parts[0]
              ? String(body.contents[0].parts[0].text || "").slice(0, 12000)
              : "",
        },
        response: {
          ok: !!res.ok,
          status: Number(res.status || 0),
          finishReason: String(parsedReply.finishReason || ""),
          replyPreview: String(parsedReply.reply || "").slice(0, 2000),
          errorMessage:
            json && json.error && json.error.message ? String(json.error.message) : "",
        },
      });
      return { res, json };
    }

    let { res: geminiRes, json: data } = await callGemini(requestBody, "initial");

    // If grounding is rejected (model/permissions), retry once without tools.
    if (!geminiRes.ok && useGrounding) {
      const msg = data && data.error && data.error.message ? String(data.error.message) : "";
      if (msg.toLowerCase().includes("tool") || msg.toLowerCase().includes("google_search")) {
        ({ res: geminiRes, json: data } = await callGemini({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: generationConfigInitial,
        }, "retry_without_grounding"));
      }
    }
    if (!geminiRes.ok) {
      const apiError = data && data.error && data.error.message ? data.error.message : ko.errors.geminiApiGeneric;
      if (isQuotaOrRateLimitError(apiError)) {
        aiApiLog.final = {
          ok: true,
          statusCode: 200,
          error: "quota_exceeded",
          truncated: false,
          continuationCount: 0,
        };
        saveAiApiLog(aiApiLog);
        sendJson(res, 200, {
          reply: ko.quotaDegradedReplyLines().join("\n"),
          degraded: true,
          reason: "quota_exceeded",
        });
        return;
      }
      aiApiLog.final = {
        ok: false,
        statusCode: 502,
        error: String(apiError || ""),
        truncated: false,
        continuationCount: 0,
      };
      saveAiApiLog(aiApiLog);
      sendJson(res, 502, { error: apiError });
      return;
    }
    let { reply, finishReason, blockReason } = extractReplyFromGeminiData(data);

    // google_search 그라운딩 시 첫 응답에 사용자 텍스트 없이 검색/도구 메타만 오는 경우가 있어, 본문이 비면 도구 없이 1회 재요청합니다.
    if (!reply && geminiRes.ok && useGrounding) {
      ({ res: geminiRes, json: data } = await callGemini(
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: generationConfigInitial,
        },
        "retry_empty_without_grounding",
      ));
      if (!geminiRes.ok) {
        const apiError = data && data.error && data.error.message ? data.error.message : ko.errors.geminiApiGeneric;
        if (isQuotaOrRateLimitError(apiError)) {
          aiApiLog.final = {
            ok: true,
            statusCode: 200,
            error: "quota_exceeded",
            truncated: false,
            continuationCount: 0,
          };
          saveAiApiLog(aiApiLog);
          sendJson(res, 200, {
            reply: ko.quotaDegradedReplyLines().join("\n"),
            degraded: true,
            reason: "quota_exceeded",
          });
          return;
        }
        aiApiLog.final = {
          ok: false,
          statusCode: 502,
          error: String(apiError || ""),
          truncated: false,
          continuationCount: 0,
        };
        saveAiApiLog(aiApiLog);
        sendJson(res, 502, { error: apiError });
        return;
      }
      ({ reply, finishReason, blockReason } = extractReplyFromGeminiData(data));
    }

    if (!reply) {
      let friendly = ko.errors.aiReplyParse;
      if (blockReason) friendly = `${ko.errors.aiReplyParse} (${blockReason})`;
      else if (finishReason && String(finishReason).toUpperCase() === "SAFETY") {
        friendly = `${ko.errors.aiReplyParse} (안전 필터)`;
      }
      aiApiLog.final = {
        ok: false,
        statusCode: 502,
        error: friendly,
        truncated: false,
        continuationCount: 0,
      };
      saveAiApiLog(aiApiLog);
      sendJson(res, 502, { error: friendly });
      return;
    }

    // Continue until complete when truncated by token limit (bounded).
    const maxContinuations = boardType === "CHAT" ? chatMaxContinuations : postMaxContinuations;
    const maxContinuationRuntimeMs =
      boardType === "CHAT" ? chatMaxContinuationRuntimeMs : postMaxContinuationRuntimeMs;
    let continuationCount = 0;
    const continuationStartAt = Date.now();
    while (finishReason === "MAX_TOKENS" && continuationCount < maxContinuations) {
      if (Date.now() - continuationStartAt > maxContinuationRuntimeMs) break;
      continuationCount += 1;
      const continuePrompt = ko.internalContinuationPrompt(reply);
      const { res: continueRes, json: continueData } = await callGemini({
        contents: [{ parts: [{ text: continuePrompt }] }],
        generationConfig: generationConfigContinuation,
      }, `continuation_${continuationCount}`);
      if (!continueRes.ok) break;
      const { reply: continuedReply, finishReason: continueFinishReason } = extractReplyFromGeminiData(continueData);
      if (!continuedReply) break;
      const merged = mergeContinuationText(reply, continuedReply);
      if (merged === reply) break;
      reply = merged;
      finishReason = continueFinishReason;
    }
    reply =
      boardType === "CHAT"
        ? sanitizeChatReplyText(sanitizeAiReplyText(reply))
        : compressAiReply(sanitizePostReplyText(sanitizeAiReplyText(reply)));
    aiApiLog.final = {
      ok: true,
      statusCode: 200,
      error: "",
      truncated: finishReason === "MAX_TOKENS",
      continuationCount,
    };
    saveAiApiLog(aiApiLog);
    sendJson(res, 200, { reply, truncated: finishReason === "MAX_TOKENS" });
  } catch (error) {
    aiApiLog.final = {
      ok: false,
      statusCode: 500,
      error: String((error && error.message) || "ai_server_error"),
      truncated: false,
      continuationCount: 0,
    };
    saveAiApiLog(aiApiLog);
    sendJson(res, 500, { error: ko.errors.aiServerError });
  }
}

function normalizeAiChatHistoryScope(raw) {
  const s = String(raw || "").trim();
  if (!s || s === "guest") return "guest";
  const digits = s.replace(/\D/g, "").slice(0, 6);
  if (!digits) return "guest";
  return digits.padStart(6, "0");
}

function sanitizeAiChatHistoryArray(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length && out.length < 30; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const id = String(item.id || "").trim().slice(0, 120);
    if (!id) continue;
    const title = String(item.title || "지난 대화").slice(0, 500);
    const boardType = String(item.boardType || "IT").slice(0, 32);
    const updatedAt = String(item.updatedAt || "").slice(0, 64);
    const msgArr = Array.isArray(item.messages) ? item.messages : [];
    const messages = [];
    for (let j = 0; j < msgArr.length && messages.length < 120; j++) {
      const m = msgArr[j];
      if (!m || typeof m !== "object") continue;
      const role = m.role === "ai" || m.role === "user" ? m.role : "user";
      const entry = {
        role,
        text: String(m.text == null ? "" : m.text).slice(0, 400_000),
        createdAt: String(m.createdAt || "").slice(0, 64),
      };
      if (m.preferred === true) entry.preferred = true;
      messages.push(entry);
    }
    out.push({ id, title, boardType, updatedAt, messages });
  }
  return out;
}

async function handleDbApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/db/app-data") {
    const scope = String(url.searchParams.get("scope") || "guest").slice(0, 64);
    const db = readDb();
    const appData = db.appDataByScope[scope] || { posts: [], settings: { notify: true, sms: false } };
    sendJson(res, 200, { appData });
    return true;
  }
  if (req.method === "PUT" && url.pathname === "/api/db/app-data") {
    const scope = String(url.searchParams.get("scope") || "guest").slice(0, 64);
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: ko.errors.invalidJsonBody });
      return true;
    }
    const appData = body && typeof body.appData === "object" ? body.appData : null;
    if (!appData) {
      sendJson(res, 400, { error: ko.errors.appDataRequired });
      return true;
    }
    const db = readDb();
    db.appDataByScope[scope] = appData;
    writeDb(db);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/db/ai-chat-history") {
    const scope = normalizeAiChatHistoryScope(url.searchParams.get("scope"));
    if (scope === "guest") {
      sendJson(res, 200, { history: [] });
      return true;
    }
    const db = readDb();
    const byScope = db.aiChatHistoryByScope && typeof db.aiChatHistoryByScope === "object" ? db.aiChatHistoryByScope : {};
    const history = Array.isArray(byScope[scope]) ? byScope[scope] : [];
    sendJson(res, 200, { history });
    return true;
  }
  if (req.method === "PUT" && url.pathname === "/api/db/ai-chat-history") {
    const scope = normalizeAiChatHistoryScope(url.searchParams.get("scope"));
    if (scope === "guest") {
      sendJson(res, 400, { error: "Invalid scope." });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: ko.errors.invalidJsonBody });
      return true;
    }
    const history = sanitizeAiChatHistoryArray(body && body.history);
    const db = readDb();
    if (!db.aiChatHistoryByScope || typeof db.aiChatHistoryByScope !== "object") {
      db.aiChatHistoryByScope = {};
    }
    db.aiChatHistoryByScope[scope] = history;
    writeDb(db);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/db/signup-users") {
    const db = readDb();
    sendJson(res, 200, { signupUsers: db.signupUsers });
    return true;
  }
  if (req.method === "PUT" && url.pathname === "/api/db/signup-users") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: ko.errors.invalidJsonBody });
      return true;
    }
    if (!Array.isArray(body && body.signupUsers)) {
      sendJson(res, 400, { error: ko.errors.signupUsersRequired });
      return true;
    }
    const db = readDb();
    db.signupUsers = body.signupUsers;
    writeDb(db);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/db/board-help") {
    const db = readDb();
    sendJson(res, 200, { boardHelpMap: db.sharedBoardHelp || {} });
    return true;
  }
  if (req.method === "PUT" && url.pathname === "/api/db/board-help") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: ko.errors.invalidJsonBody });
      return true;
    }
    const boardHelpMap = body && typeof body.boardHelpMap === "object" ? body.boardHelpMap : null;
    if (!boardHelpMap) {
      sendJson(res, 400, { error: ko.errors.boardHelpMapRequired });
      return true;
    }
    const db = readDb();
    db.sharedBoardHelp = boardHelpMap;
    writeDb(db);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/db/ai-settings") {
    const db = readDb();
    sendJson(res, 200, {
      aiSettings: db.aiSettings,
      promptDefaults: loadPromptDefaults(),
      runtimeDefaults: {
        chatMaxOutputTokens: GEMINI_CHAT_MAX_OUTPUT_TOKENS,
        postMaxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
        chatMaxContinuations: GEMINI_CHAT_MAX_CONTINUATIONS,
        postMaxContinuations: GEMINI_MAX_CONTINUATIONS,
        chatMaxContinuationRuntimeMs: GEMINI_CHAT_MAX_CONTINUATION_RUNTIME_MS,
        postMaxContinuationRuntimeMs: GEMINI_MAX_CONTINUATION_RUNTIME_MS,
        ragMaxCandidates: RAG_MAX_CANDIDATES,
        ragMinOverlapTokens: RAG_MIN_OVERLAP_TOKENS,
        ragMinScore: RAG_MIN_SCORE,
        ragRelativeCutoffPct: RAG_RELATIVE_CUTOFF_PCT,
        ragKeywordBlocklist: [...DEFAULT_RAG_KEYWORD_BLOCKLIST],
      },
    });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/db/ai-settings/history") {
    const db = readDb();
    sendJson(res, 200, { history: Array.isArray(db.aiSettingsHistory) ? db.aiSettingsHistory : [] });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/db/ai-api-logs") {
    const db = readDb();
    sendJson(res, 200, { logs: Array.isArray(db.aiApiLogs) ? db.aiApiLogs : [] });
    return true;
  }
  if (req.method === "DELETE" && url.pathname === "/api/db/ai-api-logs") {
    const db = readDb();
    db.aiApiLogs = [];
    writeDb(db);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/db/ai-api-logs") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: ko.errors.invalidJsonBody });
      return true;
    }
    saveClientAiApiErrorLog(body && typeof body === "object" ? body : {});
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (req.method === "PUT" && url.pathname === "/api/db/ai-settings") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: ko.errors.invalidJsonBody });
      return true;
    }
    const patch = body && body.aiSettings && typeof body.aiSettings === "object" ? body.aiSettings : null;
    if (!patch) {
      sendJson(res, 400, { error: ko.errors.aiSettingsRequired });
      return true;
    }
    const meta = body && body.meta && typeof body.meta === "object" ? body.meta : {};
    const db = readDb();
    db.aiSettings = mergeAiSettingsPatch(db.aiSettings, patch);
    pushAiSettingsHistory(db, makeAiSettingsHistoryEntry(db, db.aiSettings, meta, "save"));
    writeDb(db);
    sendJson(res, 200, { ok: true, aiSettings: db.aiSettings });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/db/ai-settings/reset") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: ko.errors.invalidJsonBody });
      return true;
    }
    const meta = body && body.meta && typeof body.meta === "object" ? body.meta : {};
    const db = readDb();
    db.aiSettings = deepCloneAiSettings();
    pushAiSettingsHistory(db, makeAiSettingsHistoryEntry(db, db.aiSettings, meta, "reset"));
    writeDb(db);
    sendJson(res, 200, { ok: true, aiSettings: db.aiSettings });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/db/ai-settings/restore") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: ko.errors.invalidJsonBody });
      return true;
    }
    const versionNo = Number(body && body.versionNo);
    if (!Number.isFinite(versionNo) || versionNo <= 0) {
      sendJson(res, 400, { error: "versionNo is required." });
      return true;
    }
    const meta = body && body.meta && typeof body.meta === "object" ? body.meta : {};
    const db = readDb();
    const history = Array.isArray(db.aiSettingsHistory) ? db.aiSettingsHistory : [];
    const target = history.find((item) => Number(item && item.versionNo) === versionNo);
    if (!target || !target.aiSettings || typeof target.aiSettings !== "object") {
      sendJson(res, 404, { error: "Target version not found." });
      return true;
    }
    db.aiSettings = mergeAiSettingsFromDb({ aiSettings: target.aiSettings });
    pushAiSettingsHistory(
      db,
      makeAiSettingsHistoryEntry(
        db,
        db.aiSettings,
        { ...meta, restoredFromVersionNo: versionNo },
        "restore",
      ),
    );
    writeDb(db);
    sendJson(res, 200, { ok: true, aiSettings: db.aiSettings });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/db/reset") {
    writeDb(createDefaultDb());
    sendJson(res, 200, { ok: true });
    return true;
  }
  return false;
}

const HTML_INCLUDE_RE = /<!--\s*@include:([\w.-]+)\s*-->/g;

function expandHtmlIncludes(html) {
  return html.replace(HTML_INCLUDE_RE, (_, name) => {
    const rel = path.join("partials", name);
    const full = path.join(PUBLIC_DIR, rel);
    if (!full.startsWith(PUBLIC_DIR)) {
      return `<!-- include denied: ${name} -->`;
    }
    try {
      return fs.readFileSync(full, "utf8");
    } catch {
      return `<!-- include missing: ${name} -->`;
    }
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.join(PUBLIC_DIR, pathname.replace(/^\/+/, ""));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html" && path.basename(filePath) === "index.html") {
    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      const out = expandHtmlIncludes(data);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(out);
    });
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  /* JSON POST 등 non-simple 요청의 CORS preflight(일부 환경·리버스 프록시) */
  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": req.headers.origin || "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    });
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, now: Date.now() });
    return;
  }
  if (url.pathname.startsWith("/api/db/")) {
    const handled = await handleDbApi(req, res, url);
    if (handled) return;
  }
  if (req.method === "POST" && url.pathname === "/api/ai/chat") {
    await handleAiChat(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`DB path: ${DB_FILE}`);
});
