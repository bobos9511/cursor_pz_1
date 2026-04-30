const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 5500);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const DB_DIR = DATA_DIR;
const DB_FILE = path.join(DB_DIR, "app-db.json");
const MAX_BODY_SIZE = 1_000_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const rateLimitMap = new Map();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
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

  const prompt = [
    "당신은 헬프데스크 접수 내용을 요약/진단하는 도우미입니다.",
    "출력 형식:",
    "1) 추정 원인",
    "2) 즉시 확인 항목 3개",
    "3) 사용자 안내 문구(짧게)",
    "",
    `[게시판] ${boardType}`,
    `[제목] ${title}`,
    `[내용] ${content}`,
  ].join("\n");

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
        }),
      }
    );
    const data = await geminiRes.json();
    if (!geminiRes.ok) {
      const apiError = data && data.error && data.error.message ? data.error.message : "Gemini API 오류";
      sendJson(res, 502, { error: apiError });
      return;
    }
    const reply =
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;

    if (!reply) {
      sendJson(res, 502, { error: "AI 응답을 해석할 수 없습니다." });
      return;
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
});
