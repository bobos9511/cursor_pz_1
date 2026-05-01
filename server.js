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
const DEFAULT_DB = {
  appDataByScope: {},
  signupUsers: [],
  sharedBoardHelp: {},
  aiSettings: deepCloneAiSettings(),
};

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
    };
  } catch (error) {
    return { ...DEFAULT_DB };
  }
}

function writeDb(db) {
  ensureDbFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
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
  const rag = buildRagContext([title, content].join("\n"));
  const promptBase = buildAiPrompt(boardType, title, content, continueFrom, aiSettings);
  const prompt = rag ? `${rag}\n\n${promptBase}` : promptBase;
  const generationConfig = buildGenerationConfig(boardType, continueFrom, aiSettings, {
    chatMax: GEMINI_CHAT_MAX_OUTPUT_TOKENS,
    max: GEMINI_MAX_OUTPUT_TOKENS,
    postFast: GEMINI_POST_FAST_MAX_OUTPUT_TOKENS,
  });

  try {
    const useGrounding = shouldUseGrounding(boardType, title, content);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig,
    };
    if (useGrounding) {
      requestBody.tools = [{ google_search: {} }];
    }

    async function callGemini(body) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      return { res, json };
    }

    let { res: geminiRes, json: data } = await callGemini(requestBody);

    // If grounding is rejected (model/permissions), retry once without tools.
    if (!geminiRes.ok && useGrounding) {
      const msg = data && data.error && data.error.message ? String(data.error.message) : "";
      if (msg.toLowerCase().includes("tool") || msg.toLowerCase().includes("google_search")) {
        ({ res: geminiRes, json: data } = await callGemini({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig,
        }));
      }
    }
    if (!geminiRes.ok) {
      const apiError = data && data.error && data.error.message ? data.error.message : ko.errors.geminiApiGeneric;
      if (isQuotaOrRateLimitError(apiError)) {
        sendJson(res, 200, {
          reply: ko.quotaDegradedReplyLines().join("\n"),
          degraded: true,
          reason: "quota_exceeded",
        });
        return;
      }
      sendJson(res, 502, { error: apiError });
      return;
    }
    let { reply, finishReason } = extractReplyFromGeminiData(data);

    if (!reply) {
      sendJson(res, 502, { error: ko.errors.aiReplyParse });
      return;
    }

    // Continue until complete when truncated by token limit (bounded).
    const maxContinuations = boardType === "CHAT" ? GEMINI_CHAT_MAX_CONTINUATIONS : GEMINI_MAX_CONTINUATIONS;
    const maxContinuationRuntimeMs =
      boardType === "CHAT" ? GEMINI_CHAT_MAX_CONTINUATION_RUNTIME_MS : GEMINI_MAX_CONTINUATION_RUNTIME_MS;
    let continuationCount = 0;
    const continuationStartAt = Date.now();
    while (finishReason === "MAX_TOKENS" && continuationCount < maxContinuations) {
      if (Date.now() - continuationStartAt > maxContinuationRuntimeMs) break;
      continuationCount += 1;
      const continuePrompt = ko.internalContinuationPrompt(reply);
      const { res: continueRes, json: continueData } = await callGemini({
        contents: [{ parts: [{ text: continuePrompt }] }],
        generationConfig,
      });
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
    sendJson(res, 200, { reply, truncated: finishReason === "MAX_TOKENS" });
  } catch (error) {
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
    sendJson(res, 200, { aiSettings: db.aiSettings, promptDefaults: loadPromptDefaults() });
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
    const db = readDb();
    db.aiSettings = mergeAiSettingsPatch(db.aiSettings, patch);
    writeDb(db);
    sendJson(res, 200, { ok: true, aiSettings: db.aiSettings });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/db/reset") {
    writeDb({ ...DEFAULT_DB });
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
