"use strict";

function getLoginNonce() {
    return localStorage.getItem("knockLoginNonce") || "no-login";
}

function getAiSearchStorageKeyBase() {
    const scope = getCookie(USER_SCOPE_COOKIE) || "guest";
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
        messages: [{ role: "ai", text: buildAiSearchGreeting() }],
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

function renderAiSearchMessages() {
    const logEl = document.getElementById("aiSearchLog");
    if (!logEl) return;
    logEl.innerHTML = "";
    const messages = aiSearchActive && Array.isArray(aiSearchActive.messages) ? aiSearchActive.messages : [];
    messages.forEach((msg) => {
        const role = msg && msg.role === "user" ? "user" : "ai";
        const text = String(msg && msg.text ? msg.text : "");
        const item = document.createElement("div");
        item.className = `ai-search-msg ${role}`;
        if (role === "ai" && text.includes("ai-search-loading")) item.classList.add("loading");
        item.innerHTML = role === "user" ? escapeHtml(text).replace(/\n/g, "<br>") : text;
        logEl.appendChild(item);
    });
    logEl.scrollTop = logEl.scrollHeight;
}

function renderAiSearchHistory() {
    const listEl = document.getElementById("aiSearchHistoryList");
    if (!listEl) return;
    if (!aiSearchHistory.length) {
        listEl.innerHTML = '<div class="ai-search-history-empty">저장된 지난 대화가 없습니다.</div>';
        return;
    }
    listEl.innerHTML = aiSearchHistory
        .map((h) => {
            const title = escapeHtml(String(h.title || "지난 대화"));
            const meta = `${escapeHtml(String(h.updatedAt || "-"))} · ${escapeHtml(String(h.boardType || "IT"))}`;
            const id = escapeHtml(String(h.id || ""));
            return `
                <div class="ai-search-history-row">
                    <button type="button" class="ai-search-history-item" onclick="loadAiSearchConversation('${id}')">
                        <div class="ai-search-history-title">${title}</div>
                        <div class="ai-search-history-meta">${meta}</div>
                    </button>
                    <button type="button" class="btn btn-outline ai-search-history-del" onclick="event.stopPropagation(); deleteAiSearchConversation('${id}')" title="지난대화 삭제">
                        <svg class="icon"><use href="#icon-trash"></use></svg>
                    </button>
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
}

function deleteAiSearchConversation(conversationId) {
    const before = aiSearchHistory.length;
    aiSearchHistory = aiSearchHistory.filter((h) => String(h.id) !== String(conversationId));
    if (aiSearchHistory.length === before) return;
    const keys = getAiSearchStorageKeyBase();
    saveJsonToStorage(keys.historyKey, aiSearchHistory);
    renderAiSearchHistory();
    showAlert("지난 대화를 삭제했습니다.", "success");
}

function deleteAllAiSearchHistory() {
    if (!aiSearchHistory.length) return;
    showConfirm("지난 대화를 모두 삭제하시겠습니까?", () => {
        aiSearchHistory = [];
        const keys = getAiSearchStorageKeyBase();
        saveJsonToStorage(keys.historyKey, aiSearchHistory);
        renderAiSearchHistory();
        showAlert("지난 대화를 모두 삭제했습니다.", "success");
    });
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
    const keys = getAiSearchStorageKeyBase();
    aiSearchHistory = loadJsonFromStorage(keys.historyKey, []);
    aiSearchActive = loadJsonFromStorage(keys.activeKey, null) || makeDefaultAiSearchState();
    if (inputEl) inputEl.value = aiSearchActive.draft || "";
    if (aiSearchActive && Array.isArray(aiSearchActive.messages) && aiSearchActive.messages.length === 1 && aiSearchActive.messages[0].role === "ai") {
        aiSearchActive.messages[0].text = buildAiSearchGreeting();
    }
    renderAiSearchMessages();
    renderAiSearchHistory();
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
    aiSearchInitialized = true;
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
            title: `AI 검색 이어쓰기 ${step}`,
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
        continuedRaw = `${continuedRaw}\n${nextRaw}`.trim();
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

async function submitAiSearchQuestion() {
    const inputEl = document.getElementById("aiSearchInput");
    const sendBtn = document.getElementById("aiSearchSendBtn");
    if (!inputEl || !sendBtn) return;
    const question = String(inputEl.value || "").trim();
    if (!question) return;
    if (!aiSearchActive) aiSearchActive = makeDefaultAiSearchState();
    aiSearchActive.boardType = "CHAT";
    aiSearchActive.dirty = true;
    aiSearchActive.messages.push({ role: "user", text: question });
    if (!aiSearchActive.title || aiSearchActive.title === "새 대화") aiSearchActive.title = question.slice(0, 28);
    aiSearchActive.messages.push({
        role: "ai",
        text: '<span class="ai-search-loading">AI 답변 생성 중입니다<span class="ai-search-loading-dots"><i>.</i><i>.</i><i>.</i></span></span>',
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
            title: `AI 검색: ${question.slice(0, 45)}`,
            content: question,
            boardType: "CHAT",
            timeoutMs: 0,
            abortOnTimeout: false,
        });
        const replyHtml = result.ok ? result.replyHtml : `<span style="color:#b91c1c;">오류: ${escapeHtml(result.errorMessage || "AI 요청 실패")}</span>`;
        const lastIdx = aiSearchActive.messages.length - 1;
        if (lastIdx >= 0 && aiSearchActive.messages[lastIdx].role === "ai") aiSearchActive.messages[lastIdx].text = replyHtml;
        else aiSearchActive.messages.push({ role: "ai", text: replyHtml });
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
        else aiSearchActive.messages.push({ role: "ai", text: failHtml });
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
