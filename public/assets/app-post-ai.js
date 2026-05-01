"use strict";

function stripHtmlToPlainText(rawHtml) {
    const temp = document.createElement("div");
    temp.innerHTML = rawHtml || "";
    return (temp.textContent || temp.innerText || "").trim();
}

function normalizeAiReplyText(rawReply) {
    let text = String(rawReply || "").replace(/\r/g, "").trim();
    text = text.replace(/([가-힣A-Za-z0-9])\n([가-힣A-Za-z0-9])/g, "$1$2");
    text = text.replace(/([^\n])\n(?!\s*(?:[0-9]+\)|[-*•]))/g, "$1 ");
    text = text.replace(/[ \t]{2,}/g, " ");
    text = text.replace(/\n{3,}/g, "\n\n");
    return text.trim();
}

function formatAiReplyHtml(rawReply) {
    const escaped = escapeHtml(normalizeAiReplyText(rawReply));
    return escaped.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
}

function sanitizePostAiRawReply(rawReply) {
    let out = String(rawReply || "").replace(/\r/g, "").trim();
    if (!out) return out;
    out = out
        .replace(/\(응답이 길어 핵심만 우선 제공되었습니다\.[^)]+\)/g, "")
        .replace(/\(End of[^)\n]*\)?/gi, "")
        .replace(/Point\s*\d+\s*\([^)\n]*\):\*/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return out;
}

async function requestAiPreview({ title, content, boardType, timeoutMs = AI_REQUEST_TIMEOUT_MS, abortOnTimeout = true, onTimeout = null, continueFrom = "" }) {
    const controller = new AbortController();
    let timeoutNotified = false;
    const timeoutId =
        timeoutMs > 0
            ? setTimeout(() => {
                  timeoutNotified = true;
                  if (typeof onTimeout === "function") onTimeout();
                  if (abortOnTimeout) controller.abort();
              }, timeoutMs)
            : null;
    try {
        const response = await fetch("/api/ai/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, content, boardType, continueFrom }),
            signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok || !data || !data.reply) {
            throw new Error((data && data.error) || "AI 응답을 가져오지 못했습니다.");
        }
        return {
            ok: true,
            replyHtml: formatAiReplyHtml(data.reply),
            rawReply: String(data.reply || ""),
            truncated: !!data.truncated,
            errorMessage: "",
            isTimeout: false,
            wasDelayed: timeoutNotified,
        };
    } catch (error) {
        console.error("AI preview request failed:", error);
        if (error && error.name === "AbortError") {
            return {
                ok: false,
                replyHtml: "",
                errorMessage: `AI 응답 시간이 ${Math.round(timeoutMs / 1000)}초를 초과했습니다.`,
                isTimeout: true,
                wasDelayed: true,
            };
        }
        const reason = error && error.message ? error.message : "AI 서버 통신 중 오류";
        return { ok: false, replyHtml: "", errorMessage: reason, isTimeout: false, wasDelayed: timeoutNotified };
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

function makeAiPendingHtml() {
    return '<b>AI 분석 결과:</b><br><span style="color:#64748b;">AI 답변 생성 중입니다. 잠시 후 자동 반영됩니다...</span>';
}

function makeAiErrorHtml(message) {
    const safe = escapeHtml(String(message || "원인 미상 오류"));
    return `<b>AI 분석 실패:</b><br><span style="color:#b91c1c;">${safe}</span><br><span style="color:#64748b;">(환경변수, 모델명, 쿼터를 확인해주세요)</span>`;
}

function hasAdoptableAiReply(post) {
    if (!post || post.aiSolved) return false;
    const aiText = stripHtmlToPlainText(post.aiContent || "");
    if (!aiText) return false;
    if (aiText.includes("AI 답변 생성 중입니다")) return false;
    if (aiText.includes("AI 분석 실패")) return false;
    return aiText.length >= 40;
}

function ensurePostMeta(post) {
    if (!post || typeof post !== "object") return {};
    if (!post.meta || typeof post.meta !== "object") post.meta = {};
    return post.meta;
}

function pushAiReplyHistory(post, prevAiHtml) {
    const prevText = stripHtmlToPlainText(prevAiHtml || "").trim();
    if (!prevText) return;
    if (prevText.includes("AI 답변 생성 중입니다")) return;
    const meta = ensurePostMeta(post);
    if (!Array.isArray(meta.aiReplyHistory)) meta.aiReplyHistory = [];
    meta.aiReplyHistory.unshift({
        at: nowDateTimeLabel(),
        html: String(prevAiHtml || ""),
    });
    meta.aiReplyHistory = meta.aiReplyHistory.slice(0, 30);
}

function isAiContentLong(aiHtml) {
    return stripHtmlToPlainText(aiHtml).length > 220;
}

function renderAiContentWithToggle(aiHtml, stateKey) {
    const html = String(aiHtml || "");
    const canToggle = isAiContentLong(html);
    const expanded = !!aiExpandState[stateKey];
    const textClass = canToggle && !expanded ? "ai-content-text collapsed" : "ai-content-text";
    const toggleBtn = canToggle
        ? `<button type="button" class="ai-content-toggle-btn" onclick="event.stopPropagation(); toggleAiContentExpand('${stateKey}')">${expanded ? "짧게보기" : "전체보기"}</button>`
        : "";
    const blockOpen = canToggle && !expanded
        ? ` class="ai-content-block ai-content-block--collapsed-hit" onclick="expandAiShortViewIfNeeded(event, '${stateKey}')"`
        : ' class="ai-content-block"';
    return `<div${blockOpen}><div class="${textClass}">${html}</div>${toggleBtn}</div>`;
}

function expandAiShortViewIfNeeded(event, stateKey) {
    if (event.target.closest && event.target.closest(".ai-content-toggle-btn")) return;
    if (event.target.closest && event.target.closest("a,button,input,select,textarea,label")) return;
    if (aiExpandState[stateKey]) return;
    aiExpandState[stateKey] = true;
    if (stateKey.startsWith("detail-") && currentPostId != null) {
        openDetail(currentPostId);
        return;
    }
    if (stateKey.startsWith("similar-")) {
        const id = Number(String(stateKey).replace(/^similar-/, ""));
        if (Number.isFinite(id)) openSimilarPostModal(id);
    }
}

function toggleAiContentExpand(stateKey) {
    aiExpandState[stateKey] = !aiExpandState[stateKey];
    if (stateKey.startsWith("detail-") && currentPostId != null) {
        openDetail(currentPostId);
        return;
    }
    if (stateKey.startsWith("similar-")) {
        const id = Number(String(stateKey).replace(/^similar-/, ""));
        if (Number.isFinite(id)) openSimilarPostModal(id);
    }
}

function openAiReplyHistoryModal() {
    const modal = document.getElementById("aiReplyHistoryModal");
    const body = document.getElementById("aiReplyHistoryBody");
    if (!modal || !body) return;
    const post = getPostByIdAndType(currentPostId, currentBoardType);
    const hist = post && post.meta && Array.isArray(post.meta.aiReplyHistory) ? post.meta.aiReplyHistory : [];
    if (!hist.length) {
        body.innerHTML = '<div class="text-center" style="color:#64748b; padding: 40px;">이력이 없습니다.</div>';
        modal.classList.add("active");
        return;
    }
    body.innerHTML = hist
        .map((h, idx) => {
            const at = escapeHtml(String(h.at || `#${idx + 1}`));
            const html = String(h.html || "");
            return `
                <div style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:14px; margin-bottom:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
                        <div style="font-size:12px; color:#64748b; font-weight:700;">${at}</div>
                    </div>
                    <div style="padding:12px; background:#f0f9ff; border-radius:8px; border:1px solid #bae6fd;">
                        ${renderAiContentWithToggle(html, `history-${currentPostId}-${idx}`)}
                    </div>
                </div>
            `;
        })
        .join("");
    modal.classList.add("active");
}

function closeAiReplyHistoryModal() {
    const modal = document.getElementById("aiReplyHistoryModal");
    if (modal) modal.classList.remove("active");
}

function moveToPostDetail(postId, postType = currentBoardType) {
    const post = getPostByIdAndType(postId, postType);
    if (!post) return;
    currentBoardType = post.type;
    switchView("list", post.type);
    openDetail(postId, post.type);
}

function formatPostAlertRef(post) {
    if (!post) return "게시물";
    const boardLabel = getBoardDisplayLabel(post);
    return `[${boardLabel} #${post.id}]`;
}

async function refreshCurrentPostAiReply() {
    const post = getPostByIdAndType(currentPostId, currentBoardType);
    if (!post) return;
    if (!(post.type === "IT" || post.type === "BIZ") || post.aiSolved) return;
    const myName = getCurrentActorNameToken();
    const isWriter = post.writer.includes(myName);
    const writerMayRefresh = isWriter && post.status === "wait";
    const adminMayRefresh = currentUserHasAdminAccess();
    if (!writerMayRefresh && !adminMayRefresh) return;
    if (aiRefreshingPostIds.has(post.id)) return;
    aiRefreshingPostIds.add(post.id);
    openDetail(post.id, post.type);
    showAlert(`${formatPostAlertRef(post)} 새로운 AI 답변 생성을 시작합니다...`, "success");
    try {
        await queueAsyncAiAnswerForPost(post.id, post.type, String(post.title || "").trim(), stripHtmlToPlainText(post.content || ""), {
            strictContext: true,
        });
    } finally {
        aiRefreshingPostIds.delete(post.id);
        openDetail(post.id, post.type);
    }
}

function retryAiAnswerForPost(postId) {
    const post = getPostByIdAndType(postId, currentBoardType);
    if (!post) return;
    queueAsyncAiAnswerForPost(post.id, post.type, String(post.title || "").trim(), stripHtmlToPlainText(post.content || ""), {
        strictContext: true,
    });
}

async function queueAsyncAiAnswerForPost(postId, boardType, title, plainContent, options = {}) {
    if (!(boardType === "IT" || boardType === "BIZ")) return;
    const allowContinuation = options.allowContinuation !== false;
    const strictContext = options.strictContext === true;
    const requestContent = strictContext
        ? [`질문 주제 고정 지시: 아래 게시물의 제목/내용 범위를 벗어나지 말고 답변하세요.`, `새로운 주제를 만들거나 일반론으로 벗어나지 마세요.`, "", `[게시판] ${boardType}`, `[제목] ${title}`, `[내용] ${plainContent}`].join("\n")
        : plainContent;
    const MAX_AUTO_CONTINUE_STEPS = 2;
    let result = await requestAiPreview({
        title,
        content: requestContent,
        boardType,
        timeoutMs: 0,
        abortOnTimeout: false,
    });
    let mergedRawReply = result && result.ok ? String(result.rawReply || "") : "";
    let continueStep = 0;
    while (allowContinuation && result && result.ok && result.truncated && continueStep < MAX_AUTO_CONTINUE_STEPS) {
        continueStep += 1;
        const next = await requestAiPreview({
            title: `${title} (이어쓰기 ${continueStep})`,
            content: requestContent,
            boardType,
            timeoutMs: 0,
            abortOnTimeout: false,
            continueFrom: mergedRawReply,
        });
        if (!next.ok || !next.rawReply) break;
        mergedRawReply = `${mergedRawReply}\n${String(next.rawReply || "")}`.trim();
        result = {
            ...next,
            rawReply: mergedRawReply,
            replyHtml: formatAiReplyHtml(mergedRawReply),
        };
    }
    if (result && result.ok) {
        const cleanedRaw = sanitizePostAiRawReply(result.rawReply || "");
        result = { ...result, rawReply: cleanedRaw, replyHtml: formatAiReplyHtml(cleanedRaw) };
    }
    const idx = getPostIndexByIdAndType(postId, boardType);
    if (idx < 0) return;
    const post = appData.posts[idx];
    const postRef = formatPostAlertRef(post);

    if (result.ok) {
        pushAiReplyHistory(post, post.aiContent);
        const aiContentHtml = `<b>AI 분석 결과:</b><br>${result.replyHtml}`;
        appData.posts[idx].aiContent = aiContentHtml;
    } else {
        const failHtml = makeAiErrorHtml(result.errorMessage);
        appData.posts[idx].aiContent = failHtml;
    }
    saveData();
    const detailView = document.getElementById("view-detail");
    if (detailView && detailView.classList.contains("active") && currentPostId === postId) {
        document.getElementById("aiPanelContent").innerHTML = renderAiContentWithToggle(appData.posts[idx].aiContent, `detail-${postId}`);
    }
    if (result.ok) {
        showAlert(`${postRef} AI 답변이 등록되었습니다.`, "success", {
            noticeLevel: "important",
            actionText: "해당 게시물 보기",
            onClick: () => moveToPostDetail(postId, boardType),
        });
    } else if (result && result.isTimeout) {
        showAlert(`${postRef} AI 응답 시간이 초과되었습니다.`, "error", {
            actionText: "다시요청",
            onClick: () => retryAiAnswerForPost(postId),
        });
    } else {
        showAlert(`${postRef} AI 답변 생성에 실패했습니다. AI 패널의 실패 사유를 확인해주세요.`, "error", {
            actionText: "해당 게시물 보기",
            onClick: () => moveToPostDetail(postId, boardType),
        });
    }
}
