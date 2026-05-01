"use strict";

/**
 * Non-ASCII labels embedded in AI prompt envelopes (buildAiPrompt).
 * Keep UTF-8 text here so server-ai-settings.js stays ASCII-only for fragile encodings.
 */

const PROMPT_LABELS = {
  board: "[게시판]",
  title: "[제목]",
  contentSummary: "[본문 요지]",
  content: "[본문]",
  priorAnswer: "[이미 출력된 답변]",
};

module.exports = { PROMPT_LABELS };
