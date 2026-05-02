"use strict";

const fs = require("fs");
const path = require("path");
const { PROMPT_LABELS } = require("./server-ai-prompt-labels.ko.cjs");

const POST_AI_BOARD_KEYS = ["IT", "BIZ", "SYS", "KNOW"];
const DEFAULT_RAG_KEYWORD_BLOCKLIST = [
  "대해",
  "대한",
  "관련",
  "관한",
  "기반",
  "통해",
  "위해",
  "경우",
  "사항",
  "내용",
  "부분",
  "방식",
  "정보",
  "문의",
  "질문",
  "답변",
  "요청",
  "처리",
  "확인",
  "정리",
  "설명",
  "설명해",
  "설명해줘",
  "설명해주세요",
  "알려줘",
  "알려주세요",
  "말해줘",
  "말해주세요",
  "보여줘",
  "보여주세요",
  "가능",
  "부탁",
  "참고",
  "및",
  "등",
  "또는",
  "그리고",
  "하지만",
  "즉",
  "예시",
  "예를들어",
  "아래",
  "위",
  "해당",
  "이것",
  "저것",
  "그것",
  "무엇",
  "어떻게",
  "왜",
  "언제",
  "어디",
  "please",
  "pls",
  "kindly",
  "about",
  "regarding",
  "explain",
  "tell",
  "show",
];

const DEFAULT_AI_SETTINGS = {
  chat: { systemPrompt: "", temperature: 0.1, topP: 0.8 },
  posts: {
    IT: { systemPrompt: "", temperature: 0.1, topP: 0.8 },
    BIZ: { systemPrompt: "", temperature: 0.1, topP: 0.8 },
    SYS: { systemPrompt: "", temperature: 0.1, topP: 0.8 },
    KNOW: { systemPrompt: "", temperature: 0.1, topP: 0.8 },
  },
  runtime: {
    chatMaxOutputTokens: null,
    postMaxOutputTokens: null,
    chatMaxContinuations: null,
    postMaxContinuations: null,
    chatMaxContinuationRuntimeMs: null,
    postMaxContinuationRuntimeMs: null,
    ragMaxCandidates: null,
    ragMinOverlapTokens: null,
    ragMinScore: null,
    ragRelativeCutoffPct: null,
    ragKeywordBlocklist: [...DEFAULT_RAG_KEYWORD_BLOCKLIST],
  },
};

let cachedPromptDefaults = null;

function loadPromptDefaults() {
  if (cachedPromptDefaults) return cachedPromptDefaults;
  const filePath = path.join(__dirname, "config", "ai-prompt-defaults.json");
  const raw = fs.readFileSync(filePath, "utf8");
  cachedPromptDefaults = JSON.parse(raw);
  return cachedPromptDefaults;
}

function deepCloneAiSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_AI_SETTINGS));
}

function roundGenParam(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0.1;
  return Math.round(Math.min(1, Math.max(0, x)) * 10) / 10;
}

function normalizeSystemPromptText(v) {
  if (typeof v !== "string") return "";
  const withoutBom = v.replace(/^\uFEFF/, "");
  const withoutInvisible = withoutBom.replace(/[\u200B-\u200D\u2060]/g, "");
  const trimmed = withoutInvisible.trim();
  if (!trimmed) return "";
  return withoutInvisible.slice(0, 8000);
}

function clampIntOrNull(v, min, max) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 이어쓰기 전체 시간(ms): 0·비움 = 서버·환경 기본값 사용. 유효 입력은 RUNTIME_CONTINUATION_MS 범위로만 제한 */
const RUNTIME_CONTINUATION_MS_MIN = 100;
const RUNTIME_CONTINUATION_MS_MAX = 3600000;

function clampContinuationMsOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return null;
  return Math.min(RUNTIME_CONTINUATION_MS_MAX, Math.max(RUNTIME_CONTINUATION_MS_MIN, Math.round(n)));
}

function normalizeKeywordToken(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^\w가-힣]/g, "")
    .trim();
}

function normalizeKeywordBlocklist(rawList, fallbackList = DEFAULT_RAG_KEYWORD_BLOCKLIST) {
  const source = Array.isArray(rawList)
    ? rawList
    : typeof rawList === "string"
      ? rawList.split(/[,\n]/g)
      : [];
  const out = [];
  const seen = new Set();
  source.forEach((item) => {
    const token = normalizeKeywordToken(item);
    if (!token || token.length < 2 || seen.has(token)) return;
    seen.add(token);
    out.push(token);
  });
  if (out.length > 0) return out;
  return Array.isArray(fallbackList) ? [...fallbackList] : [...DEFAULT_RAG_KEYWORD_BLOCKLIST];
}

function mergeAiSettingsFromDb(parsed) {
  const base = deepCloneAiSettings();
  const src = parsed && parsed.aiSettings && typeof parsed.aiSettings === "object" ? parsed.aiSettings : {};
  if (src.chat && typeof src.chat === "object") {
    if (typeof src.chat.systemPrompt === "string") base.chat.systemPrompt = normalizeSystemPromptText(src.chat.systemPrompt);
    base.chat.temperature = roundGenParam(src.chat.temperature ?? base.chat.temperature);
    base.chat.topP = roundGenParam(src.chat.topP ?? base.chat.topP);
  }
  for (const key of POST_AI_BOARD_KEYS) {
    if (src.posts && src.posts[key] && typeof src.posts[key] === "object") {
      const p = src.posts[key];
      if (typeof p.systemPrompt === "string") base.posts[key].systemPrompt = normalizeSystemPromptText(p.systemPrompt);
      base.posts[key].temperature = roundGenParam(p.temperature ?? base.posts[key].temperature);
      base.posts[key].topP = roundGenParam(p.topP ?? base.posts[key].topP);
    }
  }
  if (src.runtime && typeof src.runtime === "object") {
    const r = src.runtime;
    base.runtime.chatMaxOutputTokens = clampIntOrNull(r.chatMaxOutputTokens, 50, 8192);
    base.runtime.postMaxOutputTokens = clampIntOrNull(r.postMaxOutputTokens, 50, 8192);
    base.runtime.chatMaxContinuations = clampIntOrNull(r.chatMaxContinuations, 0, 200);
    base.runtime.postMaxContinuations = clampIntOrNull(r.postMaxContinuations, 0, 200);
    base.runtime.chatMaxContinuationRuntimeMs = clampContinuationMsOrNull(r.chatMaxContinuationRuntimeMs);
    base.runtime.postMaxContinuationRuntimeMs = clampContinuationMsOrNull(r.postMaxContinuationRuntimeMs);
    base.runtime.ragMaxCandidates = clampIntOrNull(r.ragMaxCandidates, 1, 10);
    base.runtime.ragMinOverlapTokens = clampIntOrNull(r.ragMinOverlapTokens, 1, 10);
    base.runtime.ragMinScore = clampIntOrNull(r.ragMinScore, 0, 100);
    base.runtime.ragRelativeCutoffPct = clampIntOrNull(r.ragRelativeCutoffPct, 0, 100);
    base.runtime.ragKeywordBlocklist = normalizeKeywordBlocklist(r.ragKeywordBlocklist, base.runtime.ragKeywordBlocklist);
  }
  return base;
}

function mergeAiSettingsPatch(base, patch) {
  const out = JSON.parse(JSON.stringify(base));
  if (!patch || typeof patch !== "object") return out;
  if (patch.chat && typeof patch.chat === "object") {
    const c = patch.chat;
    if (typeof c.systemPrompt === "string") out.chat.systemPrompt = normalizeSystemPromptText(c.systemPrompt);
    if (c.temperature !== undefined) out.chat.temperature = roundGenParam(c.temperature);
    if (c.topP !== undefined) out.chat.topP = roundGenParam(c.topP);
  }
  if (patch.posts && typeof patch.posts === "object") {
    for (const key of POST_AI_BOARD_KEYS) {
      const p = patch.posts[key];
      if (!p || typeof p !== "object") continue;
      if (typeof p.systemPrompt === "string") out.posts[key].systemPrompt = normalizeSystemPromptText(p.systemPrompt);
      if (p.temperature !== undefined) out.posts[key].temperature = roundGenParam(p.temperature);
      if (p.topP !== undefined) out.posts[key].topP = roundGenParam(p.topP);
    }
  }
  if (patch.runtime && typeof patch.runtime === "object") {
    const r = patch.runtime;
    if (r.chatMaxOutputTokens !== undefined)
      out.runtime.chatMaxOutputTokens = clampIntOrNull(r.chatMaxOutputTokens, 50, 8192);
    if (r.postMaxOutputTokens !== undefined)
      out.runtime.postMaxOutputTokens = clampIntOrNull(r.postMaxOutputTokens, 50, 8192);
    if (r.chatMaxContinuations !== undefined)
      out.runtime.chatMaxContinuations = clampIntOrNull(r.chatMaxContinuations, 0, 200);
    if (r.postMaxContinuations !== undefined)
      out.runtime.postMaxContinuations = clampIntOrNull(r.postMaxContinuations, 0, 200);
    if (r.chatMaxContinuationRuntimeMs !== undefined)
      out.runtime.chatMaxContinuationRuntimeMs = clampContinuationMsOrNull(r.chatMaxContinuationRuntimeMs);
    if (r.postMaxContinuationRuntimeMs !== undefined)
      out.runtime.postMaxContinuationRuntimeMs = clampContinuationMsOrNull(r.postMaxContinuationRuntimeMs);
    if (r.ragMaxCandidates !== undefined) out.runtime.ragMaxCandidates = clampIntOrNull(r.ragMaxCandidates, 1, 10);
    if (r.ragMinOverlapTokens !== undefined)
      out.runtime.ragMinOverlapTokens = clampIntOrNull(r.ragMinOverlapTokens, 1, 10);
    if (r.ragMinScore !== undefined) out.runtime.ragMinScore = clampIntOrNull(r.ragMinScore, 0, 100);
    if (r.ragRelativeCutoffPct !== undefined)
      out.runtime.ragRelativeCutoffPct = clampIntOrNull(r.ragRelativeCutoffPct, 0, 100);
    if (r.ragKeywordBlocklist !== undefined)
      out.runtime.ragKeywordBlocklist = normalizeKeywordBlocklist(r.ragKeywordBlocklist, out.runtime.ragKeywordBlocklist);
  }
  return out;
}

function getPostAiSlice(aiSettings, boardType) {
  const k = String(boardType || "").toUpperCase();
  if (aiSettings.posts[k]) return aiSettings.posts[k];
  return aiSettings.posts.SYS;
}

function resolveEffectiveSystemPrompt(boardType, aiSettings, defs) {
  const isChat = boardType === "CHAT";
  const saved = isChat ? aiSettings.chat.systemPrompt : getPostAiSlice(aiSettings, boardType).systemPrompt;
  const normalizedSaved = normalizeSystemPromptText(saved);
  if (normalizedSaved) return normalizedSaved;
  if (isChat) return String(defs.chat || "").trim();
  const k = String(boardType || "").toUpperCase();
  const postDef = defs.posts && defs.posts[k];
  const fromBoard = typeof postDef === "string" ? postDef.trim() : "";
  const fallbackSys =
    defs.posts && typeof defs.posts.SYS === "string" ? defs.posts.SYS.trim() : "";
  return fromBoard || fallbackSys || "";
}

function buildAiPrompt(boardType, title, content, continueFrom, aiSettings) {
  const defs = loadPromptDefaults();
  const isChat = boardType === "CHAT";
  const system = resolveEffectiveSystemPrompt(boardType, aiSettings, defs);

  if (continueFrom) {
    const meta = isChat ? String(defs.continueMetaChat || "").trim() : String(defs.continueMetaPost || "").trim();
    return [
      system,
      "",
      meta,
      "",
      `${PROMPT_LABELS.board} ${boardType}`,
      `${PROMPT_LABELS.title} ${title}`,
      `${PROMPT_LABELS.contentSummary} ${content}`,
      "",
      PROMPT_LABELS.priorAnswer,
      continueFrom,
    ].join("\n");
  }

  return [system, "", `${PROMPT_LABELS.title} ${title}`, `${PROMPT_LABELS.content} ${content}`].join("\n");
}

function buildGenerationConfig(boardType, continueFrom, aiSettings, caps) {
  const { chatMax, max, postFast } = caps;
  const isChat = boardType === "CHAT";
  const slice = isChat ? aiSettings.chat : getPostAiSlice(aiSettings, boardType);
  const temperature = roundGenParam(slice.temperature);
  const topP = roundGenParam(slice.topP);
  const maxOutputTokens = isChat
    ? Math.min(chatMax, max)
    : continueFrom
      ? max
      : Math.min(postFast, max);
  return { temperature, topP, maxOutputTokens };
}

module.exports = {
  POST_AI_BOARD_KEYS,
  DEFAULT_AI_SETTINGS,
  deepCloneAiSettings,
  roundGenParam,
  mergeAiSettingsFromDb,
  mergeAiSettingsPatch,
  getPostAiSlice,
  loadPromptDefaults,
  buildAiPrompt,
  buildGenerationConfig,
  DEFAULT_RAG_KEYWORD_BLOCKLIST,
  RUNTIME_CONTINUATION_MS_MIN,
  RUNTIME_CONTINUATION_MS_MAX,
};
