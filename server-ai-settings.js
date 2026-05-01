"use strict";

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

const ANTI_HALLUC_BLOCK_CHAT = [
  "[Grounding]",
  "Do not invent facts, numbers, or internal policies not present in the user question.",
  "If unsure, say verification is needed instead of guessing.",
].join("\n");

const ANTI_HALLUC_BLOCK_POST = [
  "[Grounding — strict]",
  "Do not invent concrete facts, rates, policy names, dates, or system names not in the post body/attachments.",
  "Do not assert root causes absent from logs/screenshots; if unclear, say the post alone is insufficient and list what to check.",
  "Without tool/search evidence, do not state latest regulations or market figures as fact.",
].join("\n");

function buildAiPrompt(boardType, title, content, continueFrom, aiSettings) {
  const isChat = boardType === "CHAT";
  const adminExtra = (
    isChat ? String(aiSettings.chat.systemPrompt || "").trim() : String(getPostAiSlice(aiSettings, boardType).systemPrompt || "").trim()
  );

  if (continueFrom) {
    const anti = isChat ? ANTI_HALLUC_BLOCK_CHAT : ANTI_HALLUC_BLOCK_POST;
    const lines = [
      "Continue naturally from the last sentence of the previous answer.",
      "Do not repeat sentences already written; only add missing substance.",
      "Never output chain-of-thought, English fragments, or stray code-comment debris.",
      isChat ? "Keep bullet format; at most 3 bullets; stay concise." : "Keep the same format and tone as the partial answer.",
      "",
      anti,
    ];
    if (adminExtra) lines.push("", "[Admin instructions]", adminExtra);
    lines.push(
      "",
      `[Board] ${boardType}`,
      `[Title] ${title}`,
      `[Original question / body] ${content}`,
      "",
      "[Answer so far]",
      continueFrom,
    );
    return lines.join("\n");
  }

  const blocks = [];
  blocks.push(isChat ? ANTI_HALLUC_BLOCK_CHAT : ANTI_HALLUC_BLOCK_POST);
  if (adminExtra) blocks.push("", "[Admin system prompt]", adminExtra);

  if (isChat) {
    blocks.push(
      "",
      "You assist bank/office work. Reply in Korean only.",
      "No greetings or preamble; lead with conclusions.",
      "Use only lines starting with '-' as bullets (max 4). One short sentence per bullet.",
      "Keep the full reply under about 40 lines.",
      "",
      `[Question] ${title}`,
      `[Detail] ${content}`,
    );
    return blocks.join("\n");
  }

  const type = String(boardType || "").toUpperCase();
  if (type === "IT") {
    blocks.push(
      "",
      "You assist an IT helpdesk. Follow this shape only. Reply in Korean.",
      "No role intro or greetings.",
      "1) Likely cause: 1-2 sentences grounded in the post only.",
      "2) Checks/actions: 3-5 '-' bullets, imperative, short. At most one code/config block if essential.",
      "3) If the post lacks data, ask only in bullets what is needed next.",
      "",
      `[Board] ${boardType}`,
      `[Title] ${title}`,
      `[Body] ${content}`,
    );
  } else if (type === "BIZ") {
    blocks.push(
      "",
      "You assist regulation/product questions. Reply in Korean. No greetings.",
      "3-5 '-' bullets, 1-2 short sentences each.",
      "Quote rules or numbers only when grounded in the post or search/tool evidence; otherwise point to official verification paths.",
      "",
      `[Board] ${boardType}`,
      `[Title] ${title}`,
      `[Body] ${content}`,
    );
  } else if (type === "KNOW") {
    blocks.push(
      "",
      "You help draft or structure knowledge-base entries. Reply in Korean.",
      "Do not fill in facts missing from the post. '-' bullets, max 5.",
      "",
      `[Board] ${boardType}`,
      `[Title] ${title}`,
      `[Body] ${content}`,
    );
  } else {
    blocks.push(
      "",
      "You assist improvement suggestions and general tickets. Reply in Korean. No role intro.",
      "Summary, verification items, and recommended follow-up as 3-5 '-' bullets.",
      "",
      `[Board] ${boardType}`,
      `[Title] ${title}`,
      `[Body] ${content}`,
    );
  }
  return blocks.join("\n");
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
  buildAiPrompt,
  buildGenerationConfig,
};
