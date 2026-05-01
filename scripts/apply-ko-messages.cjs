"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const serverPath = path.join(root, "server.js");
let s = fs.readFileSync(serverPath, "utf8").replace(/\r\n/g, "\n");

if (s.includes('require("./server-messages.ko.cjs")')) {
  console.log("already patched");
  process.exit(0);
}

function sliceReplace(startNeedle, endNeedle, replacement, label) {
  const i = s.indexOf(startNeedle);
  const j = s.indexOf(endNeedle, i + startNeedle.length);
  if (i < 0 || j < 0) throw new Error(`${label}: boundaries not found`);
  s = s.slice(0, i) + replacement + s.slice(j);
}

s = s.replace(
  `} = require("./server-ai-settings");\n\nloadEnv`,
  `} = require("./server-ai-settings");\nconst ko = require("./server-messages.ko.cjs");\n\nloadEnv`,
);

s = s.replace(
  `  if (isRender) {\n    // Render에서 /tmp 경로는 재배포 시 초기화될 수 있으므로 영속 디스크 경로를 우선 사용한다.\n    if (!raw || raw.startsWith("/tmp")) return "/var/data";\n  }`,
  `  if (isRender) {\n    // On Render, /tmp may be wiped on redeploy; prefer a persistent disk path.\n    if (!raw || raw.startsWith("/tmp")) return "/var/data";\n  }`,
);

const newSanitizeAi = `function sanitizeAiReplyText(text) {
  let out = String(text || "").trim();
  out = out.replace(ko.re.sanitizeDeskIntro, "");
  out = out.replace(ko.re.sanitizeQueryLead, "");
  out = out.replace(ko.re.sanitizeAskLead, "");
  return out.trim();
}
`;

sliceReplace(
  "function sanitizeAiReplyText(text) {",
  "\nfunction sanitizeChatReplyText(text) {",
  newSanitizeAi,
  "sanitizeAiReplyText",
);

const newChatHead = `function sanitizeChatReplyText(text) {
  let out = String(text || "").replace(/\\r/g, "").trim();
  out = out.replace(/([0-9])\\n([0-9])/g, "$1$2");
  out = out.replace(ko.re.chatNumUnitSplit, "$1$2");
  out = out.replace(ko.re.chatWordSplit, "$1$2");
`;

sliceReplace(
  "function sanitizeChatReplyText(text) {",
  "  const blocked =",
  `${newChatHead}\n`,
  "sanitizeChatReplyText head",
);

s = s.replace(
  `    .filter((line) => !blocked.test(line))\n    // bullet 표기 통일\n    .map((line) => line.replace(/^[•*]\\s*/, "- ").replace(/^\\d+\\)\\s*/, "- "));\n\n  // bullet 아닌 라인은 이전 bullet에 이어 붙여 자연스럽게 정리`,
  `    .filter((line) => !blocked.test(line))\n    .map((line) => line.replace(/^[•*]\\s*/, "- ").replace(/^\\d+\\)\\s*/, "- "));\n\n`,
);

s = s.replace(`  // bullet만 유지하고 최대 50줄 제한\n  out = merged`, `  out = merged`);

s = s.replace(
  `  // 줄바꿈/공백만 정리하고 본문은 최대한 보존(이어쓰기 손실 방지)\n  return src`,
  `  return src`,
);

const newGrounding = `function shouldUseGrounding(boardType, title, content) {
  if (!GEMINI_ENABLE_GROUNDING) return false;
  const text = \`\${title || ""} \${content || ""}\`.toLowerCase();
  const needsLatestGrounding = ko.latestInfoKeywords.some((kw) => text.includes(kw));
  const isBizContext = ko.bizKeywords.some((kw) => text.includes(kw));
  const type = String(boardType || "").toUpperCase();
  if (type === "CHAT") return needsLatestGrounding || isBizContext;
  if (type === "BIZ") return true;
  if (type === "IT" || type === "SYS") return needsLatestGrounding;
  return needsLatestGrounding;
}
`;

sliceReplace(
  "function shouldUseGrounding(boardType, title, content) {",
  "\nfunction ensureDbFile() {",
  newGrounding,
  "shouldUseGrounding",
);

const invalidJsonOld = 'sendJson(res, 400, { error: "요청 본문(JSON) 형식이 올바르지 않습니다." });';
const invalidJsonNew = "sendJson(res, 400, { error: ko.errors.invalidJsonBody });";
if (!s.includes(invalidJsonOld)) throw new Error("invalidJson pattern missing");
s = s.split(invalidJsonOld).join(invalidJsonNew);

s = s.replace(
  'sendJson(res, 429, { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." });',
  "sendJson(res, 429, { error: ko.errors.rateLimit });",
);

s = s.replace(
  'sendJson(res, 400, { error: "title/content는 필수입니다." });',
  "sendJson(res, 400, { error: ko.errors.titleContentRequired });",
);

s = s.replace(
  `    sendJson(res, 200, {\n      reply: \`데모 모드 응답입니다. (\${boardType})\\n제목: \${title}\\n핵심 확인 포인트를 정리한 뒤 담당자에게 전달하세요.\`,\n    });`,
  "    sendJson(res, 200, {\n      reply: ko.demoModeReply(boardType, title),\n    });",
);

s = s.replace(
  "    // 모델/권한 이슈로 grounding 도구가 거부되는 경우 도구 없이 한 번 재시도",
  "    // If grounding is rejected (model/permissions), retry once without tools.",
);

s = s.replace(
  'const apiError = data && data.error && data.error.message ? data.error.message : "Gemini API 오류";',
  "const apiError = data && data.error && data.error.message ? data.error.message : ko.errors.geminiApiGeneric;",
);

const oldQuota = `        sendJson(res, 200, {
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
          ].join("\\n"),
          degraded: true,
          reason: "quota_exceeded",
        });`;

const newQuota = `        sendJson(res, 200, {
          reply: ko.quotaDegradedReplyLines().join("\\n"),
          degraded: true,
          reason: "quota_exceeded",
        });`;

if (!s.includes(oldQuota)) throw new Error("quota block not found");
s = s.replace(oldQuota, newQuota);

s = s.replace(
  '      sendJson(res, 502, { error: "AI 응답을 해석할 수 없습니다." });',
  "      sendJson(res, 502, { error: ko.errors.aiReplyParse });",
);

s = s.replace(
  `    // 토큰 한도로 잘리면 완료될 때까지 이어쓰기(안전 상한 포함)`,
  `    // Continue until complete when truncated by token limit (bounded).`,
);

const oldContinue = `      const continuePrompt = [
        "아래는 직전에 작성한 답변의 앞부분입니다. 끊긴 지점부터 자연스럽게 이어서 작성하세요.",
        "이미 쓴 문장을 반복하지 말고, 남은 내용만 이어서 작성하세요.",
        "",
        "[앞부분]",
        reply,
      ].join("\\n");`;

if (!s.includes(oldContinue)) throw new Error("continuePrompt block not found");
s = s.replace(oldContinue, "      const continuePrompt = ko.internalContinuationPrompt(reply);");

s = s.replace(
  '    sendJson(res, 500, { error: "AI 서버 통신 중 오류가 발생했습니다." });',
  "    sendJson(res, 500, { error: ko.errors.aiServerError });",
);

s = s.replace(
  '      sendJson(res, 400, { error: "appData가 필요합니다." });',
  "      sendJson(res, 400, { error: ko.errors.appDataRequired });",
);
s = s.replace(
  '      sendJson(res, 400, { error: "signupUsers 배열이 필요합니다." });',
  "      sendJson(res, 400, { error: ko.errors.signupUsersRequired });",
);
s = s.replace(
  '      sendJson(res, 400, { error: "boardHelpMap 객체가 필요합니다." });',
  "      sendJson(res, 400, { error: ko.errors.boardHelpMapRequired });",
);
s = s.replace(
  '      sendJson(res, 400, { error: "aiSettings 객체가 필요합니다." });',
  "      sendJson(res, 400, { error: ko.errors.aiSettingsRequired });",
);

fs.writeFileSync(serverPath, s, "utf8");
console.log("patched", serverPath);
