"use strict";

const ADMIN_AI_POST_KEYS = ["IT", "BIZ"];
let adminAiPostTabsInited = false;
let adminAiGenWired = false;
let adminSettingsMainTabsInited = false;
let adminAiApiLogs = [];

function clampAdminAiGen01(v) {
    const n = Math.round(Number(v) * 10) / 10;
    if (!Number.isFinite(n)) return 0.1;
    return Math.min(1, Math.max(0, n));
}

function clampAdminAiInt(v, min, max, fallback) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function setAdminRuntimeInputValue(id, value, defaultValue) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value == null ? "" : String(value);
    if (defaultValue != null && Number.isFinite(Number(defaultValue))) {
        el.placeholder = `기본값 ${defaultValue}`;
    }
}

function setAdminRuntimeDefaultText(id, defaultValue) {
    const el = document.getElementById(id);
    if (!el) return;
    const hasDefault = defaultValue != null && Number.isFinite(Number(defaultValue));
    el.innerText = hasDefault ? `기본값: ${defaultValue}` : "기본값: -";
}

function wireAdminAiGenControlsOnce() {
    if (adminAiGenWired) return;
    adminAiGenWired = true;
    document.querySelectorAll(".admin-ai-gen-range").forEach((range) => {
        range.addEventListener("input", () => {
            const v = clampAdminAiGen01(range.value);
            range.value = String(v);
            const num = document.getElementById(`${range.id}-num`);
            if (num) num.value = String(v);
        });
    });
    document.querySelectorAll(".admin-ai-gen-num").forEach((num) => {
        const syncFromNum = () => {
            const v = clampAdminAiGen01(num.value);
            num.value = String(v);
            const rangeId = num.id.replace(/-num$/, "");
            const range = document.getElementById(rangeId);
            if (range) range.value = String(v);
        };
        num.addEventListener("input", syncFromNum);
        num.addEventListener("change", syncFromNum);
    });
}

function initAdminAiPostTabsOnce() {
    if (adminAiPostTabsInited) return;
    adminAiPostTabsInited = true;
    document.querySelectorAll(".admin-tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => selectAdminAiPostTab(btn.getAttribute("data-board")));
    });
    selectAdminAiPostTab("IT");
}

function selectAdminAiPostTab(board) {
    document.querySelectorAll(".admin-tab-btn").forEach((b) => {
        const on = b.getAttribute("data-board") === board;
        b.classList.toggle("btn-primary", on);
        b.classList.toggle("btn-outline", !on);
    });
    document.querySelectorAll(".admin-ai-post-panel").forEach((p) => {
        p.classList.toggle("hidden", p.getAttribute("data-board") !== board);
    });
}

function fillAdminPromptDefaultEls(promptDefaults) {
    const defs = promptDefaults && typeof promptDefaults === "object" ? promptDefaults : {};
    const chatPre = document.getElementById("admin-default-chat");
    if (chatPre) chatPre.textContent = typeof defs.chat === "string" ? defs.chat : "";
    ADMIN_AI_POST_KEYS.forEach((k) => {
        const el = document.getElementById(`admin-default-post-${k}`);
        const s = defs.posts && typeof defs.posts[k] === "string" ? defs.posts[k] : "";
        if (el) el.textContent = s;
    });
}

async function loadAdminAiSettingsView() {
    try {
        const data = await fetchJson("/api/db/ai-settings");
        const cfg = data && data.aiSettings ? data.aiSettings : null;
        if (!cfg) throw new Error("empty");
        fillAdminPromptDefaultEls(data.promptDefaults);
        const chatPrompt = document.getElementById("adminAi-chat-prompt");
        if (chatPrompt) chatPrompt.value = cfg.chat && cfg.chat.systemPrompt != null ? cfg.chat.systemPrompt : "";
        const chatT = clampAdminAiGen01(cfg.chat && cfg.chat.temperature != null ? cfg.chat.temperature : 0.1);
        const chatTp = clampAdminAiGen01(cfg.chat && cfg.chat.topP != null ? cfg.chat.topP : 0.8);
        [["adminAi-chat-temp", chatT], ["adminAi-chat-topP", chatTp]].forEach(([id, v]) => {
            const range = document.getElementById(id);
            const num = document.getElementById(`${id}-num`);
            if (range) range.value = String(v);
            if (num) num.value = String(v);
        });
        const runtime = cfg.runtime && typeof cfg.runtime === "object" ? cfg.runtime : {};
        const defaults = data && data.runtimeDefaults && typeof data.runtimeDefaults === "object" ? data.runtimeDefaults : {};
        setAdminRuntimeInputValue("adminAi-runtime-chatMaxOutputTokens", runtime.chatMaxOutputTokens, defaults.chatMaxOutputTokens);
        setAdminRuntimeInputValue("adminAi-runtime-postMaxOutputTokens", runtime.postMaxOutputTokens, defaults.postMaxOutputTokens);
        setAdminRuntimeInputValue("adminAi-runtime-chatMaxContinuations", runtime.chatMaxContinuations, defaults.chatMaxContinuations);
        setAdminRuntimeInputValue("adminAi-runtime-postMaxContinuations", runtime.postMaxContinuations, defaults.postMaxContinuations);
        setAdminRuntimeInputValue(
            "adminAi-runtime-chatMaxContinuationRuntimeMs",
            runtime.chatMaxContinuationRuntimeMs,
            defaults.chatMaxContinuationRuntimeMs,
        );
        setAdminRuntimeInputValue(
            "adminAi-runtime-postMaxContinuationRuntimeMs",
            runtime.postMaxContinuationRuntimeMs,
            defaults.postMaxContinuationRuntimeMs,
        );
        setAdminRuntimeDefaultText("adminAi-runtime-chatMaxOutputTokens-default", defaults.chatMaxOutputTokens);
        setAdminRuntimeDefaultText("adminAi-runtime-postMaxOutputTokens-default", defaults.postMaxOutputTokens);
        setAdminRuntimeDefaultText("adminAi-runtime-chatMaxContinuations-default", defaults.chatMaxContinuations);
        setAdminRuntimeDefaultText("adminAi-runtime-postMaxContinuations-default", defaults.postMaxContinuations);
        setAdminRuntimeDefaultText("adminAi-runtime-chatMaxContinuationRuntimeMs-default", defaults.chatMaxContinuationRuntimeMs);
        setAdminRuntimeDefaultText("adminAi-runtime-postMaxContinuationRuntimeMs-default", defaults.postMaxContinuationRuntimeMs);
        ADMIN_AI_POST_KEYS.forEach((k) => {
            const p = cfg.posts && cfg.posts[k] ? cfg.posts[k] : {};
            const ta = document.getElementById(`adminAi-post-${k}-prompt`);
            if (ta) ta.value = p.systemPrompt != null ? p.systemPrompt : "";
            const t = clampAdminAiGen01(p.temperature != null ? p.temperature : 0.1);
            const tp = clampAdminAiGen01(p.topP != null ? p.topP : 0.8);
            const rt = document.getElementById(`adminAi-post-${k}-temp`);
            const rtp = document.getElementById(`adminAi-post-${k}-topP`);
            const ntt = document.getElementById(`adminAi-post-${k}-temp-num`);
            const ntp = document.getElementById(`adminAi-post-${k}-topP-num`);
            if (rt) rt.value = String(t);
            if (rtp) rtp.value = String(tp);
            if (ntt) ntt.value = String(t);
            if (ntp) ntp.value = String(tp);
        });
    } catch (e) {
        console.error(e);
        showAlert("관리자 설정을 불러오지 못했습니다.", "error");
    }
}

async function saveAdminAiSettingsToServer() {
    if (!currentUserHasAdminAccess()) {
        showAlert("플랫폼 관리자 권한이 필요합니다.", "error");
        return;
    }
    const readPair = (prefix) => ({
        temperature: clampAdminAiGen01(
            document.getElementById(`${prefix}-temp-num`)?.value ?? document.getElementById(`${prefix}-temp`)?.value,
        ),
        topP: clampAdminAiGen01(
            document.getElementById(`${prefix}-topP-num`)?.value ?? document.getElementById(`${prefix}-topP`)?.value,
        ),
    });
    const aiSettings = {
        chat: {
            systemPrompt: String(document.getElementById("adminAi-chat-prompt")?.value || ""),
            ...readPair("adminAi-chat"),
        },
        posts: {},
        runtime: {
            chatMaxOutputTokens: clampAdminAiInt(
                document.getElementById("adminAi-runtime-chatMaxOutputTokens")?.value,
                50,
                8192,
                null,
            ),
            postMaxOutputTokens: clampAdminAiInt(
                document.getElementById("adminAi-runtime-postMaxOutputTokens")?.value,
                50,
                8192,
                null,
            ),
            chatMaxContinuations: clampAdminAiInt(
                document.getElementById("adminAi-runtime-chatMaxContinuations")?.value,
                0,
                200,
                null,
            ),
            postMaxContinuations: clampAdminAiInt(
                document.getElementById("adminAi-runtime-postMaxContinuations")?.value,
                0,
                200,
                null,
            ),
            chatMaxContinuationRuntimeMs: clampAdminAiInt(
                document.getElementById("adminAi-runtime-chatMaxContinuationRuntimeMs")?.value,
                500,
                300000,
                null,
            ),
            postMaxContinuationRuntimeMs: clampAdminAiInt(
                document.getElementById("adminAi-runtime-postMaxContinuationRuntimeMs")?.value,
                500,
                300000,
                null,
            ),
        },
    };
    ADMIN_AI_POST_KEYS.forEach((k) => {
        aiSettings.posts[k] = {
            systemPrompt: String(document.getElementById(`adminAi-post-${k}-prompt`)?.value || ""),
            ...readPair(`adminAi-post-${k}`),
        };
    });
    try {
        await fetchJson("/api/db/ai-settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ aiSettings }),
        });
        showAlert("관리자 설정을 저장했습니다.", "success");
    } catch (e) {
        console.error(e);
        showAlert("저장에 실패했습니다.", "error");
    }
}

function initAdminSettingsMainTabsOnce() {
    if (adminSettingsMainTabsInited) return;
    adminSettingsMainTabsInited = true;
    document.querySelectorAll(".admin-main-tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => selectAdminSettingsMainTab(btn.getAttribute("data-admin-tab")));
    });
    const permPanel = document.getElementById("admin-settings-panel-perms");
    if (permPanel) {
        permPanel.addEventListener("change", (e) => {
            const t = e.target;
            if (!t || !t.classList.contains("admin-perm-isadmin")) return;
            const emp = t.getAttribute("data-emp");
            if (emp != null) toggleSignupUserAdminFlag(emp, !!t.checked);
        });
    }
}

function selectAdminSettingsMainTab(tab) {
    const key = tab === "perms" ? "perms" : tab === "logs" ? "logs" : "ai";
    document.querySelectorAll(".admin-main-tab-btn").forEach((b) => {
        const on = b.getAttribute("data-admin-tab") === key;
        b.classList.toggle("btn-primary", on);
        b.classList.toggle("btn-outline", !on);
    });
    const aiPanel = document.getElementById("admin-settings-panel-ai");
    const permPanel = document.getElementById("admin-settings-panel-perms");
    const logsPanel = document.getElementById("admin-settings-panel-logs");
    if (aiPanel) aiPanel.classList.toggle("hidden", key !== "ai");
    if (permPanel) permPanel.classList.toggle("hidden", key !== "perms");
    if (logsPanel) logsPanel.classList.toggle("hidden", key !== "logs");
    if (key === "logs") void loadAdminAiApiLogsView();
}

function toggleSignupUserAdminFlag(empNo, checked) {
    const u = signupUsers.find((x) => String(x.employeeNo) === String(empNo));
    if (!u) return;
    u.isAdmin = !!checked;
}

function renderAdminPermissionsPanel() {
    const mount = document.getElementById("adminPermissionsMount");
    if (!mount) return;
    const visibleUsers = signupUsers.filter((u) => !isAiSystemUser(u));
    if (!visibleUsers.length) {
        mount.innerHTML =
            '<p class="admin-settings-hint">등록된 테스트 회원이 없습니다. 로그아웃 후 <strong>테스트용 회원가입</strong>에서 계정을 추가하세요.</p>';
        return;
    }
    mount.innerHTML = `
        <div class="admin-perms-table-wrap">
            <table class="admin-perms-table">
                <thead>
                    <tr>
                        <th>이름</th>
                        <th>직원번호</th>
                        <th>업무 역할</th>
                        <th style="text-align:center; width:140px;">플랫폼 관리자</th>
                    </tr>
                </thead>
                <tbody>
                    ${visibleUsers
                        .map((u) => {
                            const emp = escapeHtml(String(u.employeeNo || ""));
                            const checked = resolveUserIsAdmin(u) ? " checked" : "";
                            return `<tr>
                                    <td>${escapeHtml(String(u.name || ""))}</td>
                                    <td>${emp}</td>
                                    <td>${escapeHtml(getRoleDisplayName(u.role))}</td>
                                    <td style="text-align:center;">
                                        <input type="checkbox" class="admin-perm-isadmin" data-emp="${emp}"${checked} aria-label="플랫폼 관리자">
                                    </td>
                                </tr>`;
                        })
                        .join("")}
                </tbody>
            </table>
        </div>`;
}

async function saveAdminPermissionsToServer() {
    if (!currentUserHasAdminAccess()) {
        showAlert("플랫폼 관리자 권한이 필요합니다.", "error");
        return;
    }
    try {
        await saveSignupUsers({ rethrow: true });
        if (currentLoginUser && currentLoginUser.employeeNo) {
            const refreshed = signupUsers.find((u) => String(u.employeeNo) === String(currentLoginUser.employeeNo));
            if (refreshed) currentLoginUser = refreshed;
        }
        changeRole();
        showAlert("권한 설정을 저장했습니다.", "success");
    } catch (e) {
        console.error(e);
    }
}

function formatAdminAiApiLogTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${y}.${m}.${day} ${hh}:${mm}:${ss}`;
}

function renderAdminAiApiLogsList() {
    const mount = document.getElementById("adminAiApiLogsList");
    const summary = document.getElementById("adminAiApiLogsSummary");
    if (!mount || !summary) return;
    summary.innerText = `요청 기록: ${adminAiApiLogs.length}건`;
    if (!adminAiApiLogs.length) {
        mount.innerHTML = '<div class="text-center p-20" style="color:#94a3b8;">로그가 없습니다.</div>';
        return;
    }
    mount.innerHTML = `
        <table class="admin-ai-logs-table">
            <thead>
                <tr>
                    <th style="width:170px;">요청시각</th>
                    <th style="width:120px;">구분</th>
                    <th>요청 제목</th>
                    <th style="width:110px;">결과</th>
                </tr>
            </thead>
            <tbody>
                ${adminAiApiLogs
                    .map((log) => {
                        const title = escapeHtml(String(log.title || "(제목 없음)"));
                        const board = escapeHtml(String(log.boardType || "-"));
                        const ok = !!(log.final && log.final.ok);
                        const pill = ok
                            ? '<span class="admin-ai-log-pill">성공</span>'
                            : '<span class="admin-ai-log-pill error">실패</span>';
                        return `<tr onclick="openAdminAiApiLogModal('${escapeHtml(String(log.id || ""))}')">
                            <td>${escapeHtml(formatAdminAiApiLogTime(log.createdAt))}</td>
                            <td>${board}</td>
                            <td>${title}</td>
                            <td>${pill}</td>
                        </tr>`;
                    })
                    .join("")}
            </tbody>
        </table>
    `;
}

async function loadAdminAiApiLogsView() {
    try {
        const data = await fetchJson("/api/db/ai-api-logs");
        adminAiApiLogs = Array.isArray(data && data.logs) ? data.logs : [];
        renderAdminAiApiLogsList();
    } catch (e) {
        console.error(e);
        showAlert("AI API 로그를 불러오지 못했습니다.", "error");
    }
}

async function clearAdminAiApiLogs() {
    if (!currentUserHasAdminAccess()) {
        showAlert("플랫폼 관리자 권한이 필요합니다.", "error");
        return;
    }
    showConfirm("AI API 로그를 모두 삭제하시겠습니까?", async () => {
        try {
            await fetchJson("/api/db/ai-api-logs", { method: "DELETE" });
            adminAiApiLogs = [];
            renderAdminAiApiLogsList();
            showAlert("AI API 로그를 삭제했습니다.", "success");
        } catch (e) {
            console.error(e);
            showAlert("로그 삭제에 실패했습니다.", "error");
        }
    });
}

function closeAdminAiApiLogModal() {
    const modal = document.getElementById("adminAiApiLogModal");
    if (modal) modal.classList.remove("active");
}

function buildAdminLogInfoRows(log) {
    const final = log && log.final && typeof log.final === "object" ? log.final : {};
    const runtime = log && log.runtime && typeof log.runtime === "object" ? log.runtime : {};
    const generation = log && log.generationConfig && typeof log.generationConfig === "object" ? log.generationConfig : {};
    const rows = [
        ["요청 시각", formatAdminAiApiLogTime(log.createdAt)],
        ["요청자 범위", String(log.requesterScope || "-")],
        ["게시판 구분", String(log.boardType || "-")],
        ["모델", String(log.model || "-")],
        ["Grounding 사용", log.useGroundingRequested ? "예" : "아니오"],
        ["응답 결과", final.ok ? "성공" : "실패"],
        ["응답 코드", String(final.statusCode || "-")],
        ["이어쓰기 횟수", String(final.continuationCount || 0)],
        ["Truncated", final.truncated ? "예" : "아니오"],
        ["채팅 최대 토큰", String(runtime.chatMaxOutputTokens ?? "-")],
        ["게시물 최대 토큰", String(runtime.postMaxOutputTokens ?? "-")],
        ["채팅 이어쓰기 제한", String(runtime.chatMaxContinuations ?? "-")],
        ["게시물 이어쓰기 제한", String(runtime.postMaxContinuations ?? "-")],
        ["채팅 이어쓰기 시간(ms)", String(runtime.chatMaxContinuationRuntimeMs ?? "-")],
        ["게시물 이어쓰기 시간(ms)", String(runtime.postMaxContinuationRuntimeMs ?? "-")],
        ["요청 maxOutputTokens", String(generation.maxOutputTokens ?? "-")],
        ["요청 temperature", String(generation.temperature ?? "-")],
        ["요청 topP", String(generation.topP ?? "-")],
    ];
    return rows
        .map(
            ([k, v]) => `<div class="admin-ai-log-detail-card"><div class="admin-ai-log-detail-title">${escapeHtml(k)}</div><div>${escapeHtml(String(v))}</div></div>`,
        )
        .join("");
}

function openAdminAiApiLogModal(logId) {
    const log = adminAiApiLogs.find((x) => String(x.id) === String(logId));
    const body = document.getElementById("adminAiApiLogModalBody");
    const modal = document.getElementById("adminAiApiLogModal");
    if (!log || !body || !modal) return;
    const attempts = Array.isArray(log.attempts) ? log.attempts : [];
    const attemptsHtml = attempts.length
        ? attempts
              .map((a, idx) => {
                  const req = a && a.request && typeof a.request === "object" ? a.request : {};
                  const resp = a && a.response && typeof a.response === "object" ? a.response : {};
                  return `
                    <div class="admin-ai-log-detail-card" style="margin-bottom:10px;">
                        <div class="admin-ai-log-detail-title">시도 ${idx + 1} (${escapeHtml(String(a.label || "-"))})</div>
                        <div style="font-size:12px; color:#334155; line-height:1.55;">
                            - 요청 시각: ${escapeHtml(formatAdminAiApiLogTime(a.requestedAt))}<br>
                            - 도구 사용: ${req.hasTools ? "예" : "아니오"}<br>
                            - 프롬프트 길이: ${escapeHtml(String(req.promptChars || 0))}자<br>
                            - 응답 상태: ${resp.ok ? "성공" : "실패"} (${escapeHtml(String(resp.status || "-"))})<br>
                            - finishReason: ${escapeHtml(String(resp.finishReason || "-"))}<br>
                            - 오류 메시지: ${escapeHtml(String(resp.errorMessage || "-"))}
                        </div>
                        <div class="admin-ai-log-detail-title" style="margin-top:8px;">요청 프롬프트(시도)</div>
                        <pre class="admin-ai-log-pre">${escapeHtml(String(req.promptText || ""))}</pre>
                        <div class="admin-ai-log-detail-title" style="margin-top:8px;">수신 요약(시도)</div>
                        <pre class="admin-ai-log-pre">${escapeHtml(String(resp.replyPreview || ""))}</pre>
                    </div>
                  `;
              })
              .join("")
        : '<div class="admin-settings-hint">시도 로그가 없습니다.</div>';
    body.innerHTML = `
        <div class="admin-ai-log-detail-grid">${buildAdminLogInfoRows(log)}</div>
        <div class="admin-ai-log-detail-title">요청 제목</div>
        <pre class="admin-ai-log-pre">${escapeHtml(String(log.title || ""))}</pre>
        <div class="admin-ai-log-detail-title" style="margin-top:10px;">요청 본문 요약</div>
        <pre class="admin-ai-log-pre">${escapeHtml(String(log.contentPreview || ""))}</pre>
        <div class="admin-ai-log-detail-title" style="margin-top:10px;">최종 프롬프트(메인)</div>
        <pre class="admin-ai-log-pre">${escapeHtml(String(log.promptText || ""))}</pre>
        <div class="admin-ai-log-detail-title" style="margin-top:10px;">요청/수신 상세 시도 로그</div>
        ${attemptsHtml}
    `;
    modal.classList.add("active");
}
