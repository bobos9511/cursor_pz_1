"use strict";

/**
 * Korean (and CJK-heavy) copy for server.js.
 * Keep this file UTF-8 only; edit server.js logic without touching these strings.
 */

const errors = {
  rateLimit: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  invalidJsonBody: "요청 본문(JSON) 형식이 올바르지 않습니다.",
  titleContentRequired: "title/content는 필수입니다.",
  appDataRequired: "appData가 필요합니다.",
  signupUsersRequired: "signupUsers 배열이 필요합니다.",
  boardHelpMapRequired: "boardHelpMap 객체가 필요합니다.",
  aiSettingsRequired: "aiSettings 객체가 필요합니다.",
  geminiApiGeneric: "Gemini API 오류",
  aiReplyParse: "AI 응답을 해석할 수 없습니다.",
  aiServerError: "AI 서버 통신 중 오류가 발생했습니다.",
};

const re = {
  sanitizeDeskIntro: /^은행 헬프데스크 시니어 분석가로서[,\s:]*/i,
  sanitizeQueryLead: /^질의하신[^\n]{0,120}\n?/i,
  sanitizeAskLead: /^문의하신[^\n]{0,120}\n?/i,
  chatNumUnitSplit: /([0-9])\n(%|건|명|원|만원|억원|일|개월|년)/g,
  chatWordSplit: /([가-힣A-Za-z0-9])\n([가-힣A-Za-z0-9])/g,
};

const latestInfoKeywords = [
  "최신",
  "최근",
  "오늘",
  "금일",
  "이번달",
  "올해",
  "2025",
  "2026",
  "2027",
  "업데이트",
  "개정",
  "발표",
  "공지",
  "뉴스",
  "금리",
  "환율",
  "정책",
  "규정 변경",
  "보도자료",
];

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

function demoModeReply(boardType, title) {
  return `데모 모드 응답입니다. (${boardType})\n제목: ${title}\n핵심 확인 포인트를 정리한 뒤 담당자에게 전달하세요.`;
}

function quotaDegradedReplyLines() {
  return [
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
  ];
}

function internalContinuationPrompt(reply) {
  return [
    "아래는 직전에 작성한 답변의 앞부분입니다. 끊긴 지점부터 자연스럽게 이어서 작성하세요.",
    "이미 쓴 문장을 반복하지 말고, 남은 내용만 이어서 작성하세요.",
    "",
    "[앞부분]",
    reply,
  ].join("\n");
}

module.exports = {
  errors,
  re,
  latestInfoKeywords,
  bizKeywords,
  demoModeReply,
  quotaDegradedReplyLines,
  internalContinuationPrompt,
};
