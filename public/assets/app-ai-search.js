"use strict";

function knockSessionAuthHeaders() {
    try {
        const t = sessionStorage.getItem("knockSessionToken") || "";
        if (!t) return {};
        return { Authorization: "Bearer " + t };
    } catch (_) {
        return {};
    }
}

function getLoginNonce() {
    return localStorage.getItem("knockLoginNonce") || "no-login";
}

/** 직원번호 표기(앞자리 0 유무)가 달라도 동일 키를 쓰도록 6자리로 통일. guest는 그대로. */
function normalizeAiSearchScopeKey(raw) {
    const s = String(raw || "").trim();
    if (!s || s === "guest") return "guest";
    const digits = s.replace(/\D/g, "").slice(0, 6);
    if (!digits) return "guest";
    return digits.padStart(6, "0");
}

/** 예전 버전에서 쓰던 history 키 후보(비정규 직원번호 등) */
function legacyAiSearchHistoryKeys(scopeRaw) {
    const s = String(scopeRaw || "").trim();
    if (!s || s === "guest") return [];
    const keys = [];
    keys.push(`${AI_SEARCH_HISTORY_KEY_PREFIX}${s}`);
    const digits = s.replace(/\D/g, "").slice(0, 6);
    if (!digits) return [...new Set(keys)];
    keys.push(`${AI_SEARCH_HISTORY_KEY_PREFIX}${digits}`);
    keys.push(`${AI_SEARCH_HISTORY_KEY_PREFIX}${digits.padStart(6, "0")}`);
    const unpadded = digits.replace(/^0+/, "") || "0";
    if (unpadded !== digits) keys.push(`${AI_SEARCH_HISTORY_KEY_PREFIX}${unpadded}`);
    return [...new Set(keys)];
}

function loadAiSearchHistoryWithMigration() {
    const keys = getAiSearchStorageKeyBase();
    const primary = keys.historyKey;
    let data = loadJsonFromStorage(primary, []);
    if (Array.isArray(data) && data.length > 0) return data;

    const rawCookie = typeof getCookie === "function" ? getCookie(USER_SCOPE_COOKIE) || "" : "";
    const variants = legacyAiSearchHistoryKeys(rawCookie);
    for (let i = 0; i < variants.length; i++) {
        const vk = variants[i];
        if (vk === primary) continue;
        const alt = loadJsonFromStorage(vk, []);
        if (Array.isArray(alt) && alt.length > 0) {
            saveJsonToStorage(primary, alt);
            return alt;
        }
    }
    return [];
}

function bindAiSearchHistoryCrossTabSyncOnce() {
    if (typeof window === "undefined" || window.__knockAiHistoryStorageBound) return;
    window.__knockAiHistoryStorageBound = true;
    window.addEventListener("storage", (e) => {
        if (!e.key || e.key.indexOf(AI_SEARCH_HISTORY_KEY_PREFIX) !== 0) return;
        const keys = getAiSearchStorageKeyBase();
        if (e.key !== keys.historyKey) return;
        try {
            const next = e.newValue ? JSON.parse(e.newValue) : [];
            if (!Array.isArray(next)) return;
            aiSearchHistory = next;
            renderAiSearchHistory();
            renderAiSearchHistoryMobile();
            updateAiSearchDeleteAllButtonState();
        } catch (_) {
            // no-op
        }
    });
}

function mergeAiChatHistoriesByUpdatedAt(local, remote) {
    const map = new Map();
    function newer(a, b) {
        return String(a.updatedAt || "") >= String(b.updatedAt || "") ? a : b;
    }
    (Array.isArray(local) ? local : []).forEach((h) => {
        if (h && h.id) map.set(String(h.id), h);
    });
    (Array.isArray(remote) ? remote : []).forEach((h) => {
        if (!h || !h.id) return;
        const id = String(h.id);
        const prev = map.get(id);
        map.set(id, prev ? newer(prev, h) : h);
    });
    return Array.from(map.values()).sort((x, y) =>
        String(y.updatedAt || "").localeCompare(String(x.updatedAt || ""), "ko"),
    );
}

async function mergeAiChatHistoryFromServer() {
    const raw = typeof getCookie === "function" ? getCookie(USER_SCOPE_COOKIE) || "" : "";
    const scope = normalizeAiSearchScopeKey(raw);
    if (scope === "guest") return;
    try {
        const res = await fetch(`/api/db/ai-chat-history?scope=${encodeURIComponent(scope)}`, {
            headers: { ...knockSessionAuthHeaders() },
        });
        if (res.status === 401 && typeof window.knockOnSessionUnauthorized === "function") {
            const payload = await res.json().catch(() => ({}));
            window.knockOnSessionUnauthorized(payload);
            return;
        }
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        const remote = Array.isArray(data && data.history) ? data.history : [];
        if (!remote.length) return;
        const local = Array.isArray(aiSearchHistory) ? aiSearchHistory : [];
        aiSearchHistory = mergeAiChatHistoriesByUpdatedAt(local, remote).slice(0, 30);
        const keys = getAiSearchStorageKeyBase();
        saveJsonToStorage(keys.historyKey, aiSearchHistory);
        renderAiSearchHistory();
        renderAiSearchHistoryMobile();
        updateAiSearchDeleteAllButtonState();
    } catch (_) {
        /* 서버 미가동·오프라인 등 — 로컬만 사용 */
    }
}

function persistAiSearchHistoryToServer() {
    const raw = typeof getCookie === "function" ? getCookie(USER_SCOPE_COOKIE) || "" : "";
    const scope = normalizeAiSearchScopeKey(raw);
    if (scope === "guest") return;
    if (persistAiSearchHistoryToServer._debounce) clearTimeout(persistAiSearchHistoryToServer._debounce);
    persistAiSearchHistoryToServer._debounce = setTimeout(() => {
        persistAiSearchHistoryToServer._debounce = null;
        try {
            fetch(`/api/db/ai-chat-history?scope=${encodeURIComponent(scope)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", ...knockSessionAuthHeaders() },
                body: JSON.stringify({ history: aiSearchHistory }),
            })
                .then(async (res) => {
                    if (res.status === 401 && typeof window.knockOnSessionUnauthorized === "function") {
                        const payload = await res.json().catch(() => ({}));
                        window.knockOnSessionUnauthorized(payload);
                    }
                })
                .catch(() => {});
        } catch (_) {
            // no-op
        }
    }, 400);
}

function getAiSearchStorageKeyBase() {
    const raw = typeof getCookie === "function" ? getCookie(USER_SCOPE_COOKIE) || "" : "";
    const scope = normalizeAiSearchScopeKey(raw);
    return { activeKey: `${AI_SEARCH_ACTIVE_KEY_PREFIX}${scope}:${getLoginNonce()}`, historyKey: `${AI_SEARCH_HISTORY_KEY_PREFIX}${scope}` };
}

function loadJsonFromStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        return fallback;
    }
}

function saveJsonToStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function updateAiSearchDeleteAllButtonState() {
    const deleteAllBtn = document.getElementById("aiSearchDeleteAllBtn");
    if (!deleteAllBtn) return;
    const disabled = !Array.isArray(aiSearchHistory) || aiSearchHistory.length === 0;
    deleteAllBtn.disabled = disabled;
    deleteAllBtn.title = disabled ? "삭제할 대화가 없습니다." : "모든 대화를 삭제합니다.";
}

function toQuestionSourceText(post) {
    if (!post) return "";
    const title = String(post.title || "").replace(/\[AI채택\]\s*/g, "").trim();
    const body = String(post.content || "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return `${title} ${body}`.trim();
}

function parsePostDateTime(post) {
    if (!post) return null;
    const raw = String(post.datetime || "").trim();
    if (!raw) return null;
    const m = raw.match(/^(\d{4})\.(\d{2})\.(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    const h = Number(m[4] || 0);
    const mi = Number(m[5] || 0);
    const dt = new Date(y, mo, d, h, mi, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function collectPopularSuggestionsByDays(basePosts, lookbackDays, limit) {
    const now = Date.now();
    const windowMs = lookbackDays * 24 * 60 * 60 * 1000;
    const scoped = basePosts.filter((post) => {
        const dt = parsePostDateTime(post);
        if (!dt) return false;
        return now - dt.getTime() <= windowMs;
    });
    if (!scoped.length) return [];
    const buckets = new Map();
    scoped.forEach((post) => {
        const source = toQuestionSourceText(post);
        if (!source) return;
        const key = normalizeQuestionKey(source);
        if (!key) return;
        const current = buckets.get(key) || { prompt: source, count: 0, latestTs: 0 };
        current.count += 1;
        const ts = parsePostDateTime(post);
        current.latestTs = Math.max(current.latestTs, ts ? ts.getTime() : 0);
        if (!current.prompt || current.prompt.length > source.length) current.prompt = source;
        buckets.set(key, current);
    });
    return Array.from(buckets.values())
        .sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return b.latestTs - a.latestTs;
        })
        .slice(0, limit)
        .map((item) => ({
            prompt: item.prompt,
            label: summarizeQuestionText(item.prompt),
            count: item.count,
        }));
}

function normalizeQuestionKey(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^\w가-힣\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function summarizeQuestionText(text) {
    const plain = String(text || "").replace(/\s+/g, " ").trim();
    if (plain.length <= 16) return plain;
    return `${plain.slice(0, 16).trim()}...`;
}

function parseAiSearchDateTime(rawValue) {
    if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) {
        return new Date(rawValue.getTime());
    }
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
        const byTs = new Date(rawValue);
        return Number.isNaN(byTs.getTime()) ? null : byTs;
    }
    const raw = String(rawValue || "").trim();
    if (!raw) return null;
    const byNative = new Date(raw);
    if (!Number.isNaN(byNative.getTime())) return byNative;
    const m = raw.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})(?:\s+(\d{2}):(\d{2}))?/);
    if (!m) return null;
    const dt = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4] || 0),
        Number(m[5] || 0),
        0,
        0,
    );
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatAiSearchMessageDateKey(dt) {
    if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return "";
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}.${m}.${d}`;
}

function formatAiSearchDateDividerLabel(dt) {
    if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return "";
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const target = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
    const diffDays = Math.floor((today - target) / (24 * 60 * 60 * 1000));
    if (diffDays === 0) return "오늘";
    if (diffDays === 1) return "어제";
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    const weekday = weekdays[dt.getDay()] || "-";
    return `${y}.${m}.${d}(${weekday})`;
}

function formatAiSearchMessageTime(dt) {
    if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return "--:--";
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

function buildAiSearchBubbleAvatar(role) {
    if (role === "ai") {
        return '<span class="ai-search-msg-avatar ai" aria-hidden="true"><svg class="icon"><use href="#icon-magic"></use></svg></span>';
    }
    const activeUser = currentLoginUser || roleMatrix[currentRole] || {};
    const rawName = String(activeUser.name || getCurrentActorNameToken() || "U").trim();
    const initial = escapeHtml((rawName.replace(/\s+/g, "").slice(0, 1) || "U").toUpperCase());
    return `<span class="ai-search-msg-avatar user" aria-hidden="true">${initial}</span>`;
}

function getAiSearchPopularSuggestions(limit = 5) {
    const posts = appData && Array.isArray(appData.posts) ? appData.posts : [];
    const targetPosts = posts.filter((p) => p && (p.type === "IT" || p.type === "BIZ"));
    if (!targetPosts.length) return [];
    const recent7 = collectPopularSuggestionsByDays(targetPosts, 7, limit);
    if (recent7.length >= Math.min(3, limit)) return recent7;
    return collectPopularSuggestionsByDays(targetPosts, 30, limit);
}

function renderAiSearchSuggestions() {
    const rowEl = document.getElementById("aiSearchSuggestRow");
    if (!rowEl) return;
    const suggestions = getAiSearchPopularSuggestions(5);
    if (!suggestions.length) {
        rowEl.classList.add("hidden");
        rowEl.innerHTML = "";
        return;
    }
    rowEl.classList.remove("hidden");
    rowEl.innerHTML = "";
    suggestions.forEach((suggestion) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ai-search-suggest-chip";
        btn.title = `많이 물어본 질문 (${Number(suggestion.count) || 1}건)`;
        btn.textContent = String(suggestion.label || "추천 질문");
        btn.addEventListener("click", () => setAiSearchPrompt(String(suggestion.prompt || "")));
        rowEl.appendChild(btn);
    });
}

function buildAiSearchGreeting() {
    const d = new Date();
    const hour = d.getHours();
    const activeUser = currentLoginUser || roleMatrix[currentRole];
    const rawName = activeUser ? String(activeUser.name || "") : "";
    const rawPosition = activeUser ? String(activeUser.position || "") : "";
    const name = normalizeDisplayText(rawName, getCurrentActorNameToken() || "고객");
    const position = normalizeDisplayText(rawPosition, "");
    const dept = normalizeDisplayText((activeUser && (activeUser.deptName || activeUser.dept)) || "", "");
    const who = `${name}${position ? ` ${position}` : ""}`.trim();
    const dayPart = hour < 6 ? "이른 시간" : hour < 12 ? "오전" : hour < 18 ? "오후" : "저녁";
    const mood = [
        `${dayPart}에도 접속해 주셔서 반갑습니다, <b>${escapeHtml(who)}</b>님.`,
        `${dayPart} 업무도 힘내세요, <b>${escapeHtml(who)}</b>님.`,
        `${dayPart}에 도움이 필요하시면 바로 정리해드릴게요, <b>${escapeHtml(who)}</b>님.`,
    ];
    const ctx = dept ? ` <span style="color:#64748b;">(${escapeHtml(dept)})</span>` : "";
    const idx = Math.floor(Math.random() * mood.length);
    return `${mood[idx]}${ctx}<br><span style="color:#475569;">질문을 입력하면 핵심만 간단히 정리해 드립니다. 필요한 정보가 부족하면 추가로 물어볼게요.</span>`;
}

function makeDefaultAiSearchState() {
    return {
        id: `chat_${Date.now()}`,
        title: "새 대화",
        boardType: "IT",
        draft: "",
        updatedAt: nowDateTimeLabel(),
        messages: [{ role: "ai", text: buildAiSearchGreeting(), createdAt: nowDateTimeLabel() }],
        loadedFromHistoryId: null,
        dirty: false,
    };
}

function saveAiSearchActiveState() {
    if (!aiSearchActive) return;
    const inputEl = document.getElementById("aiSearchInput");
    aiSearchActive.draft = inputEl ? inputEl.value || "" : "";
    aiSearchActive.boardType = aiSearchActive.boardType || "IT";
    aiSearchActive.updatedAt = nowDateTimeLabel();
    const keys = getAiSearchStorageKeyBase();
    saveJsonToStorage(keys.activeKey, aiSearchActive);
}

function isAiSearchErrorMessageText(text) {
    const plain = stripHtmlForRag(String(text || "")).replace(/\s+/g, " ").trim();
    if (!plain) return false;
    return /^오류\s*:/.test(plain) || plain.includes("AI 분석 실패") || plain.includes("요청 실패");
}

function renderAiSearchMessages() {
    const logEl = document.getElementById("aiSearchLog");
    if (!logEl) return;
    logEl.innerHTML = "";
    const messages = aiSearchActive && Array.isArray(aiSearchActive.messages) ? aiSearchActive.messages : [];
    const getPreferButtonLabel = (preferred) => {
        const compact = typeof window !== "undefined" && window.innerWidth <= 520;
        if (preferred) return compact ? "선호됨" : "도움이 됐음";
        return compact ? "답변선호" : "도움이 됐어요";
    };
    const isRefusalOrNeedsConfirmationMessage = (text) => {
        const normalized = stripHtmlForRag(String(text || "")).replace(/\s+/g, " ").trim().toLowerCase();
        if (!normalized) return false;
        const refusalHints = [
            "답변할 수 없습니다",
            "도와드릴 수 없습니다",
            "지원하지 않습니다",
            "제공된 근거 자료에 포함되어 있지",
            "거절",
            "불가",
            "죄송하지만",
            "권한이 없습니다",
        ];
        const needsCheckHints = [
            "확인이 필요",
            "확인하시기 바랍니다",
            "확인해주시기 바랍니다",
            "확인 후 안내",
            "정확한 확인",
            "공식 경로를 통해",
            "창구나 고객센터를 통해",
        ];
        if (refusalHints.some((hint) => normalized.includes(hint))) return true;
        if (needsCheckHints.some((hint) => normalized.includes(hint))) return true;
        return false;
    };
    const isPreferButtonHiddenMessage = (text, idx) => {
        const plain = stripHtmlForRag(String(text || ""));
        const normalized = plain.replace(/\s+/g, " ").trim();
        if (!normalized) return true;
        // 첫 인삿말(대화 시작 메시지)에는 선호 버튼을 표시하지 않음
        if (idx === 0 && normalized.includes("질문을 입력하면 핵심만 간단히 정리해")) return true;
        // 추가정보 요청 안내 성격 메시지에는 선호 버튼을 표시하지 않음
        if (normalized.includes("추가 정보") && normalized.includes("요청")) return true;
        // AI 오류 메시지에는 선호 버튼을 표시하지 않음
        if (isAiSearchErrorMessageText(text)) return true;
        // 사용자가 원하는 직접 답변 대신 확인/거절 성격인 메시지에는 선호 버튼 숨김
        if (isRefusalOrNeedsConfirmationMessage(text)) return true;
        return false;
    };
    let lastDateKey = "";
    let lastResolvedDate = parseAiSearchDateTime(aiSearchActive && aiSearchActive.updatedAt) || new Date();
    messages.forEach((msg, idx) => {
        const role = msg && msg.role === "user" ? "user" : "ai";
        const text = String(msg && msg.text ? msg.text : "");
        const msgDate = parseAiSearchDateTime(msg && msg.createdAt) || lastResolvedDate;
        if (msg && !msg.createdAt) {
            msg.createdAt = formatAiSearchMessageDateKey(msgDate) + " " + formatAiSearchMessageTime(msgDate);
        }
        lastResolvedDate = msgDate;
        const dateKey = formatAiSearchMessageDateKey(msgDate);
        const timeLabel = formatAiSearchMessageTime(msgDate);
        if (dateKey && dateKey !== lastDateKey) {
            const dateDivider = document.createElement("div");
            dateDivider.className = "ai-search-date-divider";
            dateDivider.innerHTML = `<span>${escapeHtml(formatAiSearchDateDividerLabel(msgDate))}</span>`;
            logEl.appendChild(dateDivider);
            lastDateKey = dateKey;
        }
        const row = document.createElement("div");
        row.className = `ai-search-msg-row ${role}`;
        row.style.animationDelay = `${Math.min(idx * 42, 260)}ms`;
        const item = document.createElement("div");
        item.className = `ai-search-msg ${role}`;
        const isLoadingMsg = role === "ai" && text.includes("ai-search-loading");
        if (isLoadingMsg) item.classList.add("loading");
        const timeHtml = `<span class="ai-search-msg-time">${escapeHtml(timeLabel)}</span>`;
        const avatarHtml = buildAiSearchBubbleAvatar(role);
        if (role === "user") {
            item.innerHTML = `<div class="ai-search-msg-body">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
            row.innerHTML = `${timeHtml}`;
            row.appendChild(item);
            row.insertAdjacentHTML("beforeend", avatarHtml);
        } else {
            const preferred = !!(msg && msg.preferred);
            const hidePrefer = isPreferButtonHiddenMessage(text, idx);
            const preferBtn = !isLoadingMsg && !hidePrefer
                ? `<button type="button" class="ai-prefer-btn ${preferred ? "active" : ""}" title="${preferred ? "도움이 됐어요 취소" : "도움이 됐어요"}" onclick="toggleAiSearchPreferred(${idx})"><svg class="icon"><use href="#icon-thumb-up"></use></svg> ${getPreferButtonLabel(preferred)}</button>`
                : "";
            let retryHtml = "";
            if (!isLoadingMsg && isAiSearchErrorMessageText(text)) {
                const qPlain = getNearestAiSearchQuestion(idx);
                const qEsc = escapeHtml(qPlain);
                retryHtml = `
                    <div class="ai-search-error-retry" onclick="event.stopPropagation();">
                        <label class="ai-search-retry-label" for="ai-search-retry-q-${idx}">질문 수정 후 다시 시도</label>
                        <textarea id="ai-search-retry-q-${idx}" class="ai-search-retry-textarea" rows="3" autocomplete="off">${qEsc}</textarea>
                        <button type="button" class="ai-search-retry-btn btn btn-primary" onclick="retryAiSearchQuestion(${idx})" title="다시 시도">
                            <svg class="icon" aria-hidden="true"><use href="#icon-refresh"></use></svg>
                            <span>다시 시도</span>
                        </button>
                    </div>`;
                item.classList.add("ai-search-msg-has-retry");
            }
            item.innerHTML = `<div class="ai-search-msg-body">${text}</div>${retryHtml}`;
            row.insertAdjacentHTML("beforeend", avatarHtml);
            row.appendChild(item);
            row.insertAdjacentHTML("beforeend", timeHtml);
            if (preferBtn) row.insertAdjacentHTML("beforeend", `<span class="ai-search-msg-prefer-outside">${preferBtn}</span>`);
        }
        logEl.appendChild(row);
    });
    logEl.scrollTop = logEl.scrollHeight;
}

function getNearestAiSearchQuestion(messageIndex) {
    if (!aiSearchActive || !Array.isArray(aiSearchActive.messages)) return "";
    for (let i = messageIndex - 1; i >= 0; i -= 1) {
        const msg = aiSearchActive.messages[i];
        if (msg && msg.role === "user") return String(msg.text || "").trim();
    }
    return "";
}

function toggleAiSearchPreferred(messageIndex) {
    if (!aiSearchActive || !Array.isArray(aiSearchActive.messages)) return;
    const idx = Number(messageIndex);
    if (!Number.isFinite(idx) || idx < 0 || idx >= aiSearchActive.messages.length) return;
    const msg = aiSearchActive.messages[idx];
    if (!msg || msg.role !== "ai") return;
    if (String(msg.text || "").includes("ai-search-loading")) return;
    if (isAiSearchErrorMessageText(msg.text)) return;
    if (
        plain.includes("답변할 수 없습니다") ||
        plain.includes("도와드릴 수 없습니다") ||
        plain.includes("지원하지 않습니다") ||
        plain.includes("확인이 필요") ||
        plain.includes("확인하시기 바랍니다") ||
        plain.includes("확인해주시기 바랍니다") ||
        plain.includes("제공된 근거 자료에 포함되어 있지")
    ) return;
    msg.preferred = !msg.preferred;
    aiSearchActive.dirty = true;
    saveAiSearchActiveState();
    upsertAiSearchHistoryFromActive();
    renderAiSearchMessages();
    if (!msg.preferred) return;
    const questionText = getNearestAiSearchQuestion(idx);
    const answerText = stripHtmlForRag(msg.text || "");
    const sourceRef = `${aiSearchActive.id || "chat"}:${idx}`;
    const created = createAutoRagKnowledgeFromQA(questionText, answerText, {
        sourceType: "CHAT",
        sourceRef,
        boardType: "BIZ",
        sourceLabel: "AI Chat 도움이 됐어요"
    });
    if (!created) return;
}

function renderAiSearchHistory() {
    const listEl = document.getElementById("aiSearchHistoryList");
    if (!listEl) return;
    if (!aiSearchHistory.length) {
        listEl.innerHTML = '<div class="ai-search-history-empty">저장된 지난 대화가 없습니다.</div>';
        renderAiSearchHistoryMobile();
        updateAiSearchDeleteAllButtonState();
        return;
    }
    listEl.innerHTML = aiSearchHistory
        .map((h) => {
            const title = escapeHtml(String(h.title || "지난 대화"));
            const meta = `${escapeHtml(String(h.updatedAt || "-"))} · ${escapeHtml(String(h.boardType || "IT"))}`;
            const id = escapeHtml(String(h.id || ""));
            return `
                <div class="ai-search-history-card" role="button" tabindex="0" onclick="loadAiSearchConversation('${id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault(); loadAiSearchConversation('${id}');}">
                    <button type="button" class="ai-search-history-close" onclick="event.stopPropagation(); deleteAiSearchConversation('${id}')" title="지난대화 삭제" aria-label="지난대화 삭제">
                        <svg class="icon"><use href="#icon-close"></use></svg>
                    </button>
                    <div class="ai-search-history-item">
                        <div class="ai-search-history-title-wrap">
                            <div class="ai-search-history-title">${title}</div>
                        </div>
                        <div class="ai-search-history-meta">${meta}</div>
                    </div>
                </div>
            `;
        })
        .join("");
    renderAiSearchHistoryMobile();
    updateAiSearchDeleteAllButtonState();
}

function renderAiSearchHistoryMobile() {
    const bodyEl = document.getElementById("aiSearchHistoryMobileBody");
    if (!bodyEl) return;
    if (!Array.isArray(aiSearchHistory) || !aiSearchHistory.length) {
        bodyEl.innerHTML = '<div class="ai-history-mobile-empty">저장된 지난 대화가 없습니다.</div>';
        return;
    }
    bodyEl.innerHTML = aiSearchHistory
        .map((h) => {
            const title = escapeHtml(String(h.title || "지난 대화"));
            const meta = `${escapeHtml(String(h.updatedAt || "-"))} · ${escapeHtml(String(h.boardType || "IT"))}`;
            const id = escapeHtml(String(h.id || ""));
            return `
                <div class="ai-history-mobile-item" onclick="loadAiSearchConversation('${id}')">
                    <div class="ai-history-mobile-item-head">
                        <div class="ai-history-mobile-title-wrap">
                            <div class="ai-history-mobile-title">${title}</div>
                        </div>
                        <button type="button" class="ai-history-mobile-del" title="지난대화 삭제" onclick="event.stopPropagation(); deleteAiSearchConversation('${id}')">
                            <svg class="icon"><use href="#icon-close"></use></svg>
                        </button>
                    </div>
                    <div class="ai-history-mobile-meta">${meta}</div>
                </div>
            `;
        })
        .join("");
}

function upsertAiSearchHistoryFromActive() {
    if (!aiSearchActive || !Array.isArray(aiSearchActive.messages) || aiSearchActive.messages.length < 2) return;
    if (aiSearchActive.loadedFromHistoryId && !aiSearchActive.dirty) return;
    const copy = {
        id: aiSearchActive.id,
        title: aiSearchActive.title || "지난 대화",
        boardType: aiSearchActive.boardType || "IT",
        updatedAt: aiSearchActive.updatedAt || nowDateTimeLabel(),
        messages: aiSearchActive.messages.slice(0, 120),
    };
    const idx = aiSearchHistory.findIndex((h) => h.id === copy.id);
    if (idx >= 0) aiSearchHistory[idx] = copy;
    else aiSearchHistory.unshift(copy);
    aiSearchHistory = aiSearchHistory.slice(0, 30);
    const keys = getAiSearchStorageKeyBase();
    saveJsonToStorage(keys.historyKey, aiSearchHistory);
    renderAiSearchHistory();
    updateAiSearchDeleteAllButtonState();
    persistAiSearchHistoryToServer();
}

function deleteAiSearchConversation(conversationId) {
    const before = aiSearchHistory.length;
    aiSearchHistory = aiSearchHistory.filter((h) => String(h.id) !== String(conversationId));
    if (aiSearchHistory.length === before) return;
    const keys = getAiSearchStorageKeyBase();
    saveJsonToStorage(keys.historyKey, aiSearchHistory);
    renderAiSearchHistory();
    updateAiSearchDeleteAllButtonState();
    persistAiSearchHistoryToServer();
    showAlert("지난 대화를 삭제했습니다.", "success");
}

function deleteAllAiSearchHistory() {
    if (!aiSearchHistory.length) return;
    showConfirm("지난 대화를 모두 삭제하시겠습니까?", () => {
        aiSearchHistory = [];
        const keys = getAiSearchStorageKeyBase();
        saveJsonToStorage(keys.historyKey, aiSearchHistory);
        renderAiSearchHistory();
        updateAiSearchDeleteAllButtonState();
        persistAiSearchHistoryToServer();
        closeAiSearchHistoryMobileModal();
        showAlert("지난 대화를 모두 삭제했습니다.", "success");
    });
}

function openAiSearchHistoryMobileModal() {
    const modal = document.getElementById("aiSearchHistoryMobileModal");
    if (!modal) return;
    renderAiSearchHistoryMobile();
    modal.classList.add("active");
}

function closeAiSearchHistoryMobileModal() {
    const modal = document.getElementById("aiSearchHistoryMobileModal");
    if (modal) modal.classList.remove("active");
}

function setAiSearchStateBadge(isLoading = aiSearchIsLoading) {
    const badgeEl = document.getElementById("aiSearchStateBadge");
    if (!badgeEl) return;
    badgeEl.className = isLoading ? "badge bg-ai" : "badge bg-ready";
    badgeEl.innerText = isLoading ? "답변 생성중" : "대기중";
}

function initializeAiSearchView() {
    if (aiSearchInitialized) return;
    const logEl = document.getElementById("aiSearchLog");
    const inputEl = document.getElementById("aiSearchInput");
    bindAiSearchHistoryCrossTabSyncOnce();
    aiSearchHistory = loadAiSearchHistoryWithMigration();
    const keys = getAiSearchStorageKeyBase();
    aiSearchActive = loadJsonFromStorage(keys.activeKey, null) || makeDefaultAiSearchState();
    if (inputEl) inputEl.value = aiSearchActive.draft || "";
    if (aiSearchActive && Array.isArray(aiSearchActive.messages) && aiSearchActive.messages.length === 1 && aiSearchActive.messages[0].role === "ai") {
        aiSearchActive.messages[0].text = buildAiSearchGreeting();
    }
    renderAiSearchMessages();
    renderAiSearchHistory();
    renderAiSearchSuggestions();
    if (inputEl) inputEl.addEventListener("input", saveAiSearchActiveState);
    if (inputEl) {
        inputEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitAiSearchQuestion();
            }
        });
    }
    if (logEl) logEl.addEventListener("click", () => setAiSearchStateBadge());
    setAiSearchStateBadge();
    updateAiSearchDeleteAllButtonState();
    aiSearchInitialized = true;
    void mergeAiChatHistoryFromServer().then(() => {
        persistAiSearchHistoryToServer();
    });
}

function startNewAiSearchChat() {
    upsertAiSearchHistoryFromActive();
    aiSearchActive = makeDefaultAiSearchState();
    const inputEl = document.getElementById("aiSearchInput");
    if (inputEl) inputEl.value = "";
    renderAiSearchMessages();
    saveAiSearchActiveState();
    aiSearchIsLoading = false;
    setAiSearchStateBadge();
    if (inputEl) inputEl.focus();
}

function loadAiSearchConversation(conversationId) {
    const found = aiSearchHistory.find((h) => String(h.id) === String(conversationId));
    if (!found) return;
    aiSearchActive = {
        id: `chat_${Date.now()}`,
        title: found.title || "불러온 대화",
        boardType: found.boardType || "IT",
        draft: "",
        updatedAt: nowDateTimeLabel(),
        messages: Array.isArray(found.messages) ? found.messages : [],
        loadedFromHistoryId: String(found.id || ""),
        dirty: false,
    };
    if (!aiSearchActive.messages.length) aiSearchActive.messages = [{ role: "ai", text: "대화를 불러왔습니다." }];
    const inputEl = document.getElementById("aiSearchInput");
    if (inputEl) inputEl.value = "";
    renderAiSearchMessages();
    saveAiSearchActiveState();
    aiSearchIsLoading = false;
    setAiSearchStateBadge();
    closeAiSearchHistoryMobileModal();
}

function setAiSearchPrompt(promptText) {
    const inputEl = document.getElementById("aiSearchInput");
    if (!inputEl) return;
    inputEl.value = String(promptText || "");
    saveAiSearchActiveState();
    inputEl.focus();
}

function isAiSearchForeground() {
    const view = document.getElementById("view-ai-search");
    return !!(view && view.classList.contains("active") && document.visibilityState === "visible");
}

function buildContinueButtonHtml() {
    return '<br><button class="btn btn-outline" style="margin-top:8px; padding:6px 10px; font-size:12px;" onclick="continueAiSearchAnswer()">이어서 답변</button>';
}

async function continueAiSearchAnswer() {
    if (!aiSearchPendingContinuation || !aiSearchActive || !Array.isArray(aiSearchActive.messages)) return;
    const pending = { ...aiSearchPendingContinuation };
    aiSearchPendingContinuation = null;
    const sendBtn = document.getElementById("aiSearchSendBtn");
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerText = "이어서 생성중...";
    }
    aiSearchIsLoading = true;
    setAiSearchStateBadge();
    let continuedRaw = String(pending.answerRaw || "");
    let needsMore = true;
    let step = 0;
    while (needsMore && step < 8) {
        step += 1;
        const result = await requestAiPreview({
            title: `AI Chat 이어쓰기 ${step}`,
            content: pending.question,
            boardType: "CHAT",
            timeoutMs: 0,
            abortOnTimeout: false,
            continueFrom: continuedRaw,
        });
        if (!result.ok) {
            const errorHtml = `<span style="color:#b91c1c;">오류: ${escapeHtml(result.errorMessage || "이어쓰기 요청 실패")}</span>`;
            const lastIdx = aiSearchActive.messages.length - 1;
            aiSearchActive.messages[lastIdx].text = `${formatAiReplyHtml(continuedRaw)}<br>${errorHtml}`;
            saveAiSearchActiveState();
            renderAiSearchMessages();
            needsMore = false;
            break;
        }
        const nextRaw = String(result.rawReply || "").trim();
        if (!nextRaw) {
            needsMore = false;
            break;
        }
        continuedRaw = mergeAiContinuationSegments(continuedRaw, nextRaw);
        const lastIdx = aiSearchActive.messages.length - 1;
        aiSearchActive.messages[lastIdx].text = formatAiReplyHtml(continuedRaw);
        saveAiSearchActiveState();
        renderAiSearchMessages();
        needsMore = !!result.truncated;
        if (needsMore && !isAiSearchForeground()) {
            aiSearchPendingContinuation = { question: pending.question, answerRaw: continuedRaw };
            aiSearchActive.messages[lastIdx].text = `${formatAiReplyHtml(continuedRaw)}${buildContinueButtonHtml()}`;
            saveAiSearchActiveState();
            renderAiSearchMessages();
            showAlert("다른 페이지로 이동해 이어서 답변을 멈췄습니다. AI채팅에서 버튼으로 재개하세요.", "success");
            break;
        }
    }
    if (needsMore && isAiSearchForeground() && !aiSearchPendingContinuation) {
        aiSearchPendingContinuation = { question: pending.question, answerRaw: continuedRaw };
        const lastIdx = aiSearchActive.messages.length - 1;
        aiSearchActive.messages[lastIdx].text = `${formatAiReplyHtml(continuedRaw)}${buildContinueButtonHtml()}`;
        saveAiSearchActiveState();
        renderAiSearchMessages();
    }
    if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.innerText = "질문하기";
    }
    aiSearchIsLoading = false;
    setAiSearchStateBadge();
    if (aiSearchActive) aiSearchActive.dirty = true;
    upsertAiSearchHistoryFromActive();
}

async function retryAiSearchQuestion(aiMessageIndex) {
    const idx = Number(aiMessageIndex);
    if (!Number.isFinite(idx) || idx < 0) return;
    if (!aiSearchActive || !Array.isArray(aiSearchActive.messages)) return;
    if (aiSearchIsLoading) {
        showAlert("다른 답변을 생성 중입니다. 잠시 후 다시 시도해 주세요.", "error");
        return;
    }
    const userIdx = idx - 1;
    if (userIdx < 0 || !aiSearchActive.messages[userIdx] || aiSearchActive.messages[userIdx].role !== "user") return;
    const aiMsg = aiSearchActive.messages[idx];
    if (!aiMsg || aiMsg.role !== "ai") return;
    if (!isAiSearchErrorMessageText(String(aiMsg.text || ""))) return;
    const ta = document.getElementById(`ai-search-retry-q-${idx}`);
    const q = ta ? String(ta.value || "").trim() : String(aiSearchActive.messages[userIdx].text || "").trim();
    if (!q) {
        showAlert("질문을 입력해 주세요.", "error");
        return;
    }
    aiSearchActive.messages[userIdx].text = q;
    if (!aiSearchActive.title || aiSearchActive.title === "새 대화") aiSearchActive.title = q.slice(0, 28);
    aiSearchActive.boardType = "CHAT";
    aiSearchActive.dirty = true;
    aiMsg.text =
        '<span class="ai-search-loading">AI 답변 생성 중입니다<span class="ai-search-loading-dots"><i>.</i><i>.</i><i>.</i></span></span>';
    delete aiMsg.preferred;
    saveAiSearchActiveState();
    renderAiSearchMessages();

    const sendBtn = document.getElementById("aiSearchSendBtn");
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerText = "생성중...";
    }
    aiSearchIsLoading = true;
    setAiSearchStateBadge();
    let delayNotified = false;
    const delayTimer = setTimeout(() => {
        delayNotified = true;
        showAlert("AI 응답이 지연되고 있습니다. 응답이 도착하면 자동으로 표시됩니다.", "error");
    }, AI_CHAT_REQUEST_TIMEOUT_MS);
    try {
        const result = await requestAiPreview({
            title: `AI Chat: ${q.slice(0, 45)}`,
            content: q,
            boardType: "CHAT",
            timeoutMs: 0,
            abortOnTimeout: false,
        });
        const replyHtml = result.ok
            ? result.replyHtml
            : `<span style="color:#b91c1c;">오류: ${escapeHtml(result.errorMessage || "AI 요청 실패")}</span>`;
        if (idx >= 0 && aiSearchActive.messages[idx] && aiSearchActive.messages[idx].role === "ai") {
            aiSearchActive.messages[idx].text = replyHtml;
        }
        saveAiSearchActiveState();
        upsertAiSearchHistoryFromActive();
        renderAiSearchMessages();
        if (result && result.ok && result.truncated) {
            showAlert("답변이 길어 핵심만 표시했습니다. 질문을 더 구체화하면 빠르게 이어서 받을 수 있습니다.", "success");
        } else if (delayNotified && result && result.ok) {
            showAlert("지연된 AI 응답이 도착했습니다.", "success", { noticeLevel: "important" });
        }
    } catch (error) {
        const failHtml = `<span style="color:#b91c1c;">오류: ${escapeHtml(error && error.message ? error.message : "AI 요청 실패")}</span>`;
        if (idx >= 0 && aiSearchActive.messages[idx] && aiSearchActive.messages[idx].role === "ai") {
            aiSearchActive.messages[idx].text = failHtml;
        }
        saveAiSearchActiveState();
        upsertAiSearchHistoryFromActive();
        renderAiSearchMessages();
    } finally {
        clearTimeout(delayTimer);
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerText = "질문하기";
        }
        aiSearchIsLoading = false;
        setAiSearchStateBadge();
    }
}

async function submitAiSearchQuestion() {
    const inputEl = document.getElementById("aiSearchInput");
    const sendBtn = document.getElementById("aiSearchSendBtn");
    if (!inputEl || !sendBtn) return;
    const question = String(inputEl.value || "").trim();
    if (!question) return;
    if (!aiSearchActive) aiSearchActive = makeDefaultAiSearchState();
    aiSearchActive.boardType = "CHAT";
    aiSearchActive.dirty = true;
    const sentAt = nowDateTimeLabel();
    aiSearchActive.messages.push({ role: "user", text: question, createdAt: sentAt });
    if (!aiSearchActive.title || aiSearchActive.title === "새 대화") aiSearchActive.title = question.slice(0, 28);
    aiSearchActive.messages.push({
        role: "ai",
        text: '<span class="ai-search-loading">AI 답변 생성 중입니다<span class="ai-search-loading-dots"><i>.</i><i>.</i><i>.</i></span></span>',
        createdAt: sentAt,
    });
    inputEl.value = "";
    saveAiSearchActiveState();
    renderAiSearchMessages();
    aiSearchIsLoading = true;
    setAiSearchStateBadge();
    sendBtn.disabled = true;
    sendBtn.innerText = "생성중...";
    let delayNotified = false;
    const delayTimer = setTimeout(() => {
        delayNotified = true;
        showAlert("AI 응답이 지연되고 있습니다. 응답이 도착하면 자동으로 표시됩니다.", "error");
    }, AI_CHAT_REQUEST_TIMEOUT_MS);
    try {
        const result = await requestAiPreview({
            title: `AI Chat: ${question.slice(0, 45)}`,
            content: question,
            boardType: "CHAT",
            timeoutMs: 0,
            abortOnTimeout: false,
        });
        const replyHtml = result.ok ? result.replyHtml : `<span style="color:#b91c1c;">오류: ${escapeHtml(result.errorMessage || "AI 요청 실패")}</span>`;
        const lastIdx = aiSearchActive.messages.length - 1;
        if (lastIdx >= 0 && aiSearchActive.messages[lastIdx].role === "ai") aiSearchActive.messages[lastIdx].text = replyHtml;
        else aiSearchActive.messages.push({ role: "ai", text: replyHtml, createdAt: nowDateTimeLabel() });
        saveAiSearchActiveState();
        upsertAiSearchHistoryFromActive();
        renderAiSearchMessages();
        if (result && result.ok && result.truncated) {
            showAlert("답변이 길어 핵심만 표시했습니다. 질문을 더 구체화하면 빠르게 이어서 받을 수 있습니다.", "success");
        } else if (delayNotified && result && result.ok) {
            showAlert("지연된 AI 응답이 도착했습니다.", "success", { noticeLevel: "important" });
        }
    } catch (error) {
        const failHtml = `<span style="color:#b91c1c;">오류: ${escapeHtml(error && error.message ? error.message : "AI 요청 실패")}</span>`;
        const lastIdx = aiSearchActive.messages.length - 1;
        if (lastIdx >= 0 && aiSearchActive.messages[lastIdx].role === "ai") aiSearchActive.messages[lastIdx].text = failHtml;
        else aiSearchActive.messages.push({ role: "ai", text: failHtml, createdAt: nowDateTimeLabel() });
        saveAiSearchActiveState();
        upsertAiSearchHistoryFromActive();
        renderAiSearchMessages();
    } finally {
        clearTimeout(delayTimer);
        sendBtn.disabled = false;
        sendBtn.innerText = "질문하기";
        aiSearchIsLoading = false;
        setAiSearchStateBadge();
    }
}
