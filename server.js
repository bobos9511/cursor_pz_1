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
} = require("./server-ai-settings");
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
const AI_SETTINGS_HISTORY_MAX = 120;
function createDefaultDb() {
  return {
    appDataByScope: {},
    signupUsers: [],
    sharedBoardHelp: {},
    aiSettings: deepCloneAiSettings(),
    aiApiLogs: [],
    aiSettingsHistory: [],
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
  const candidate =
    data && Array.isArray(data.candidates) && data.candidates[0] ? data.candidates[0] : null;
  const parts =
    candidate && candidate.content && Array.isArray(candidate.content.parts)
      ? candidate.content.parts
      : [];
  const reply = parts
    .map((part) => (part && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
  const finishReason = candidate && typeof candidate.finishReason === "string" ? candidate.finishReason : "";
  return { reply, finishReason };
}

function sanitizeAiReplyText(text) {
  let out = String(text || "").trim();
  out = out.replace(ko.re.sanitizeDeskIntro, "");
  out = out.replace(ko.re.sanitizeQueryLead, "");
  out = out.replace(ko.re.sanitizeAskLead, "");
  return out.trim();
}

function sanitizeChatReplyText(text) {
  let out = String(text || "").replace(/\r/g, "").trim();
  out = out.replace(/([0-9])\n([0-9])/g, "$1$2");
  out = out.replace(ko.re.chatNumUnitSplit, "$1$2");
  out = out.replace(ko.re.chatWordSplit, "$1$2");

  const blocked =
    /(if applicable|previous logic|wait,|snippet might|let's think|internal|reasoning|analysis|thought process|system prompt)/i;
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

function sanitizePostReplyText(text) {
  let out = String(text || "").replace(/\r/g, "").trim();
  if (!out) return out;

  const blockedLine =
    /^(\*+\s*)?(refining the flow|point\s*\d+|policy\/regulations|analysis|reasoning|thought process|system prompt)\b/i;
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
  for (let i = maxOverlap; i >= 20; i -= 1) {
    if (a.slice(-i) === b.slice(0, i)) {
      overlap = i;
      break;
    }
  }
  return overlap > 0 ? `${a}${b.slice(overlap)}`.trim() : `${a}\n${b}`.trim();
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
    return String(text || "")
      .toLowerCase()
      .replace(/[^0-9a-z\uac00-\ud7a3]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2)
      .slice(0, 60);
  }

  function buildRagContext(queryText) {
    const db = readDb();
    const shared = db.appDataByScope && db.appDataByScope.shared ? db.appDataByScope.shared : null;
    const posts = shared && Array.isArray(shared.posts) ? shared.posts : [];
    const know = posts.filter((p) => p && p.type === "KNOW" && (p.status === "trained" || p.status === "ready"));
    if (!know.length) return "";
    const qTokens = new Set(tokenizeForSearch(queryText));
    if (!qTokens.size) return "";

    const scored = know
      .map((p) => {
        const meta = p.meta && typeof p.meta === "object" ? p.meta : {};
        const hay = [
          p.title,
          meta.knowQuestion,
          meta.knowAnswer,
          meta.knowSummary,
          meta.knowKeywords,
          meta.knowSource,
          stripHtmlToText(p.content),
        ]
          .filter(Boolean)
          .join(" ");
        const hayTokens = tokenizeForSearch(hay);
        let score = 0;
        for (const t of hayTokens) if (qTokens.has(t)) score += 1;
        // Small boost for exact contains.
        const qStr = String(queryText || "").trim();
        if (qStr && hay.toLowerCase().includes(qStr.toLowerCase())) score += 3;
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (!scored.length) return "";

    const lines = [];
    lines.push("RAG_CONTEXT_BEGIN");
    lines.push("Use the following KNOWLEDGE snippets only if relevant. Do not invent facts beyond them.");
    for (const { p } of scored) {
      const meta = p.meta && typeof p.meta === "object" ? p.meta : {};
      lines.push("");
      lines.push(`- id: ${p.id} / domain: ${p.knowCategory || "-"}`);
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
    500,
    300000,
    GEMINI_CHAT_MAX_CONTINUATION_RUNTIME_MS,
  );
  const postMaxContinuationRuntimeMs = clampIntWithFallback(
    runtime.postMaxContinuationRuntimeMs,
    500,
    300000,
    GEMINI_MAX_CONTINUATION_RUNTIME_MS,
  );
  const rag = buildRagContext([title, content].join("\n"));
  const promptBase = buildAiPrompt(boardType, title, content, continueFrom, aiSettings);
  const prompt = rag ? `${rag}\n\n${promptBase}` : promptBase;
  const generationConfig = buildGenerationConfig(boardType, continueFrom, aiSettings, {
    chatMax: chatMaxOutputTokens,
    max: postMaxOutputTokens,
    postFast: postFastMaxOutputTokens,
  });
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
    useGroundingRequested: shouldUseGrounding(boardType, title, content),
    runtime: {
      chatMaxOutputTokens,
      postMaxOutputTokens,
      postFastMaxOutputTokens,
      chatMaxContinuations,
      postMaxContinuations,
      chatMaxContinuationRuntimeMs,
      postMaxContinuationRuntimeMs,
    },
    generationConfig,
    promptText: String(prompt || "").slice(0, 12000),
    attempts: [],
    final: { ok: false, statusCode: 0, error: "", truncated: false, continuationCount: 0 },
  };

  try {
    const useGrounding = aiApiLog.useGroundingRequested;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig,
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
          generationConfig,
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
    let { reply, finishReason } = extractReplyFromGeminiData(data);

    if (!reply) {
      aiApiLog.final = {
        ok: false,
        statusCode: 502,
        error: ko.errors.aiReplyParse,
        truncated: false,
        continuationCount: 0,
      };
      saveAiApiLog(aiApiLog);
      sendJson(res, 502, { error: ko.errors.aiReplyParse });
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
        generationConfig,
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
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
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
