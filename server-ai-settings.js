"use strict";

const fs = require("fs");
const path = require("path");
const { PROMPT_LABELS } = require("./server-ai-prompt-labels.ko.cjs");

const POST_AI_BOARD_KEYS = ["IT", "BIZ", "SYS", "KNOW"];

const DEFAULT_AI_SETTINGS = {
  chat: { systemPrompt: "", temperature: 0.1, topP: 0.8 },
  posts: {
    IT: { systemPrompt: "", temperature: 0.1, topP: 0.8 },
    BIZ: { systemPrompt: "", temperature: 0.1, topP: 0.8 },
    SYS: { systemPrompt: "", temperature: 0.1, topP: 0.8 },
    KNOW: { systemPrompt: "", temperature: 0.1, topP: 0.8 },
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

function mergeAiSettingsFromDb(parsed) {
  const base = deepCloneAiSettings();
  const src = parsed && parsed.aiSettings && typeof parsed.aiSettings === "object" ? parsed.aiSettings : {};
  if (src.chat && typeof src.chat === "object") {
    if (typeof src.chat.systemPrompt === "string") base.chat.systemPrompt = src.chat.systemPrompt.slice(0, 8000);
    base.chat.temperature = roundGenParam(src.chat.temperature ?? base.chat.temperature);
    base.chat.topP = roundGenParam(src.chat.topP ?? base.chat.topP);
  }
  for (const key of POST_AI_BOARD_KEYS) {
    if (src.posts && src.posts[key] && typeof src.posts[key] === "object") {
      const p = src.posts[key];
      if (typeof p.systemPrompt === "string") base.posts[key].systemPrompt = p.systemPrompt.slice(0, 8000);
      base.posts[key].temperature = roundGenParam(p.temperature ?? base.posts[key].temperature);
      base.posts[key].topP = roundGenParam(p.topP ?? base.posts[key].topP);
    }
  }
  return base;
}

function mergeAiSettingsPatch(base, patch) {
  const out = JSON.parse(JSON.stringify(base));
  if (!patch || typeof patch !== "object") return out;
  if (patch.chat && typeof patch.chat === "object") {
    const c = patch.chat;
    if (typeof c.systemPrompt === "string") out.chat.systemPrompt = c.systemPrompt.slice(0, 8000);
    if (c.temperature !== undefined) out.chat.temperature = roundGenParam(c.temperature);
    if (c.topP !== undefined) out.chat.topP = roundGenParam(c.topP);
  }
  if (patch.posts && typeof patch.posts === "object") {
    for (const key of POST_AI_BOARD_KEYS) {
      const p = patch.posts[key];
      if (!p || typeof p !== "object") continue;
      if (typeof p.systemPrompt === "string") out.posts[key].systemPrompt = p.systemPrompt.slice(0, 8000);
      if (p.temperature !== undefined) out.posts[key].temperature = roundGenParam(p.temperature);
      if (p.topP !== undefined) out.posts[key].topP = roundGenParam(p.topP);
    }
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
  const trimmed = String(saved || "").trim();
  if (trimmed) return trimmed;
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
};
