const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 5500);
const PUBLIC_DIR = path.join(__dirname, "public");
function resolveDataDir() {
  const raw = String(process.env.DATA_DIR || "").trim();
  const isRender = String(process.env.RENDER || "").toLowerCase() === "true";
  if (isRender) {
    // Render에서 /tmp 경로는 재배포 시 초기화될 수 있으므로 영속 디스크 경로를 우선 사용한다.
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
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const GEMINI_ENABLE_GROUNDING = String(process.env.GEMINI_ENABLE_GROUNDING || "false").toLowerCase() === "true";
const GEMINI_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 900);
const DEFAULT_DB = {
  appDataByScope: {},
  signupUsers: [],
  sharedBoardHelp: {},
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

function shouldUseGrounding(boardType, title, content) {
  if (!GEMINI_ENABLE_GROUNDING) return false;
  if (String(boardType || "").toUpperCase() !== "BIZ") return false;
  const text = `${title || ""} ${content || ""}`.toLowerCase();
  const bizKeywords = [
    "규정",
    "약관",
    "지침",
    "내규",
    "법령",
    "세법",
    "감독규정",
    "금감원",
    "대출",
    "담보",
    "이자",
    "한도",
    "연장",
    "중도상환",
  ];
  return bizKeywords.some((kw) => text.includes(kw));
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
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY_SIZE) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
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
    sendJson(res, 429, { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." });
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
    sendJson(res, 400, { error: "요청 본문(JSON) 형식이 올바르지 않습니다." });
    return;
  }

  const title = String(body.title || "").slice(0, 200);
  const content = String(body.content || "").slice(0, 2000);
  const boardType = String(body.boardType || "").slice(0, 20);

  if (!title || !content) {
    sendJson(res, 400, { error: "title/content는 필수입니다." });
    return;
  }

  if (!GEMINI_API_KEY) {
    sendJson(res, 200, {
      reply: `데모 모드 응답입니다. (${boardType})\n제목: ${title}\n핵심 확인 포인트를 정리한 뒤 담당자에게 전달하세요.`,
    });
    return;
  }

  const boardRubric =
    boardType === "IT"
      ? "IT/오류 문의: 오류코드, 재현경로, 영향범위, 즉시 우회조치 중심으로 분석."
      : boardType === "BIZ"
        ? "규정/상품 문의: 적용 규정, 예외 조건, 필요 증빙, 고객 안내 기준 중심으로 분석."
        : "일반 문의: 상황 요약, 확인 항목, 후속 조치 순서 중심으로 분석.";

  const prompt = [
    "당신은 은행 헬프데스크 시니어 분석가입니다.",
    "절대 두루뭉술하게 쓰지 말고, 입력 내용의 핵심 단어를 그대로 인용해 구체적으로 답변하세요.",
    "불확실한 내용은 추정이라고 명시하고 확인 경로를 제시하세요.",
    "가능하면 최신 공개 정보를 검색 근거로 보강하세요.",
    "",
    `[게시판] ${boardType}`,
    `[기준점] ${boardRubric}`,
    `[제목] ${title}`,
    `[내용] ${content}`,
    "",
    "출력 형식(반드시 지켜라):",
    "1) 추정 원인 (2~4줄, 입력 본문 키워드 최소 2개 직접 인용)",
    "2) 즉시 확인 항목 (번호 목록 4개, 각 항목은 '확인 이유 + 확인 방법')",
    "3) 사용자 안내 문구 (현업에서 바로 전달 가능한 문장 2~3개)",
    "4) 근거/기준 (최소 2개 불릿: 내부기준/검색근거를 구분하여 작성)",
  ].join("\n");

  try {
    const useGrounding = shouldUseGrounding(boardType, title, content);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS },
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

    // 모델/권한 이슈로 grounding 도구가 거부되는 경우 도구 없이 한 번 재시도
    if (!geminiRes.ok && useGrounding) {
      const msg = data && data.error && data.error.message ? String(data.error.message) : "";
      if (msg.toLowerCase().includes("tool") || msg.toLowerCase().includes("google_search")) {
        ({ res: geminiRes, json: data } = await callGemini({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS },
        }));
      }
    }
    if (!geminiRes.ok) {
      const apiError = data && data.error && data.error.message ? data.error.message : "Gemini API 오류";
      if (isQuotaOrRateLimitError(apiError)) {
        sendJson(res, 200, {
          reply: [
            "1) 추정 원인",
            "- 현재 Gemini API 사용량 한도(쿼터/요금제)가 초과되었습니다.",
            "",
            "2) 즉시 확인 항목 3개",
            "- API 키가 연결된 프로젝트의 과금/한도 상태를 확인하세요.",
            "- 분당 요청량(RPM)과 일일 사용량을 확인하세요.",
            "- 필요 시 Grounding 사용을 잠시 비활성화해 호출 비용을 낮추세요.",
            "",
            "3) 사용자 안내 문구",
            "- 현재 AI 분석 서비스 사용량이 일시적으로 초과되어 기본 진단 안내로 접수되었습니다.",
          ].join("\n"),
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
      sendJson(res, 502, { error: "AI 응답을 해석할 수 없습니다." });
      return;
    }

    // 토큰 한도로 중간 절단되면 이어쓰기 요청을 한 번 더 수행해 연결한다.
    if (finishReason === "MAX_TOKENS") {
      const continuePrompt = [
        "아래는 직전에 작성한 답변의 앞부분입니다. 끊긴 지점부터 자연스럽게 이어서 작성하세요.",
        "이미 쓴 문장을 반복하지 말고, 남은 내용만 이어서 작성하세요.",
        "",
        "[앞부분]",
        reply,
      ].join("\n");
      const { res: continueRes, json: continueData } = await callGemini({
        contents: [{ parts: [{ text: continuePrompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS },
      });
      if (continueRes.ok) {
        const { reply: continuedReply } = extractReplyFromGeminiData(continueData);
        if (continuedReply) reply = `${reply}\n${continuedReply}`.trim();
      }
    }
    sendJson(res, 200, { reply });
  } catch (error) {
    sendJson(res, 500, { error: "AI 서버 통신 중 오류가 발생했습니다." });
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
      sendJson(res, 400, { error: "요청 본문(JSON) 형식이 올바르지 않습니다." });
      return true;
    }
    const appData = body && typeof body.appData === "object" ? body.appData : null;
    if (!appData) {
      sendJson(res, 400, { error: "appData가 필요합니다." });
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
      sendJson(res, 400, { error: "요청 본문(JSON) 형식이 올바르지 않습니다." });
      return true;
    }
    if (!Array.isArray(body && body.signupUsers)) {
      sendJson(res, 400, { error: "signupUsers 배열이 필요합니다." });
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
      sendJson(res, 400, { error: "요청 본문(JSON) 형식이 올바르지 않습니다." });
      return true;
    }
    const boardHelpMap = body && typeof body.boardHelpMap === "object" ? body.boardHelpMap : null;
    if (!boardHelpMap) {
      sendJson(res, 400, { error: "boardHelpMap 객체가 필요합니다." });
      return true;
    }
    const db = readDb();
    db.sharedBoardHelp = boardHelpMap;
    writeDb(db);
    sendJson(res, 200, { ok: true });
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
