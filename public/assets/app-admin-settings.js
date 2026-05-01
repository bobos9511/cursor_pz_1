"use strict";

const ADMIN_AI_POST_KEYS = ["IT", "BIZ"];
let adminAiPostTabsInited = false;
let adminAiGenWired = false;
let adminSettingsMainTabsInited = false;
let adminRuntimeHumanHintWired = false;
let adminAiApiLogs = [];
let adminAiSettingsHistory = [];

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

function parseAdminKeywordBlocklist(raw) {
    const source = String(raw || "")
        .split(/[,\n]/g)
        .map((x) => String(x || "").toLowerCase().replace(/[^\w가-힣]/g, "").trim())
        .filter(Boolean);
    const out = [];
    const seen = new Set();
    source.forEach((token) => {
        if (token.length < 2 || seen.has(token)) return;
        seen.add(token);
        out.push(token);
    });
    return out;
}

function getAdminRagKeywordInputEl() {
    return document.getElementById("adminAi-runtime-ragKeywordBlocklist");
}

function exportAdminRagKeywordBlocklist() {
    const input = getAdminRagKeywordInputEl();
    if (!input) return;
    const list = parseAdminKeywordBlocklist(input.value);
    const payload = list.join("\n");
    const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const a = document.createElement("a");
    a.href = url;
    a.download = `rag-keyword-blocklist-${y}${m}${d}-${hh}${mm}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showAlert(`금칙어 목록 ${list.length}개를 내보냈습니다.`, "success");
}

function importAdminRagKeywordBlocklist() {
    const input = document.getElementById("adminAi-ragKeywordImportInput");
    if (!input) return;
    input.value = "";
    input.click();
}

async function handleAdminRagKeywordImport(event) {
    const file = event && event.target && event.target.files && event.target.files[0];
    if (!file) return;
    try {
        const raw = await file.text();
        let sourceText = raw;
        if ((file.name || "").toLowerCase().endsWith(".json")) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) sourceText = parsed.join(",");
            else if (parsed && Array.isArray(parsed.ragKeywordBlocklist)) sourceText = parsed.ragKeywordBlocklist.join(",");
        }
        const list = parseAdminKeywordBlocklist(sourceText);
        const target = getAdminRagKeywordInputEl();
        if (!target) return;
        target.value = list.join(", ");
        if (typeof window.applyRuntimeRagKeywordBlocklist === "function") {
            window.applyRuntimeRagKeywordBlocklist(list);
        }
        showAlert(`금칙어 목록 ${list.length}개를 가져왔습니다. 저장 버튼으로 반영해주세요.`, "success");
    } catch (error) {
        console.error(error);
        showAlert("금칙어 목록 파일을 읽지 못했습니다.", "error");
    }
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

function getAdminActorName() {
    try {
        if (typeof getCurrentActorName === "function") return String(getCurrentActorName() || "").trim() || "unknown";
    } catch (_) {
        // no-op
    }
    return "unknown";
}

function formatMsToHumanReadable(msRaw) {
    const n = Number(msRaw);
    if (!Number.isFinite(n) || n < 0) return "-";
    if (n < 1000) return `${(n / 1000).toFixed(1)}초`;
    const totalSec = Math.floor(n / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const chunks = [];
    if (h > 0) chunks.push(`${h}시간`);
    if (m > 0 || h > 0) chunks.push(`${m}분`);
    chunks.push(`${s}초`);
    return chunks.join(" ");
}

function updateAdminRuntimeHumanHint(inputId) {
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;
    const targetId = inputEl.getAttribute("data-ms-human-target");
    if (!targetId) return;
    const hintEl = document.getElementById(targetId);
    if (!hintEl) return;
    const raw = String(inputEl.value || "").trim();
    if (!raw) {
        hintEl.innerHTML = '<span class="admin-ms-hint-chip">입력 시 시간 환산</span>';
        return;
    }
    hintEl.innerHTML = `<span class="admin-ms-hint-chip">환산: ${escapeHtml(formatMsToHumanReadable(raw))}</span>`;
}

function wireAdminRuntimeHumanHintOnce() {
    if (adminRuntimeHumanHintWired) return;
    adminRuntimeHumanHintWired = true;
    document.querySelectorAll('input[data-ms-human-target]').forEach((inputEl) => {
        const handler = () => updateAdminRuntimeHumanHint(inputEl.id);
        inputEl.addEventListener("input", handler);
        inputEl.addEventListener("change", handler);
    });
}

function collectAdminAiSettingsFromForm() {
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
            ragMaxCandidates: clampAdminAiInt(
                document.getElementById("adminAi-runtime-ragMaxCandidates")?.value,
                1,
                10,
                null,
            ),
            ragMinOverlapTokens: clampAdminAiInt(
                document.getElementById("adminAi-runtime-ragMinOverlapTokens")?.value,
                1,
                10,
                null,
            ),
            ragMinScore: clampAdminAiInt(
                document.getElementById("adminAi-runtime-ragMinScore")?.value,
                0,
                100,
                null,
            ),
            ragRelativeCutoffPct: clampAdminAiInt(
                document.getElementById("adminAi-runtime-ragRelativeCutoffPct")?.value,
                0,
                100,
                null,
            ),
            ragKeywordBlocklist: parseAdminKeywordBlocklist(
                document.getElementById("adminAi-runtime-ragKeywordBlocklist")?.value,
            ),
        },
    };
    ADMIN_AI_POST_KEYS.forEach((k) => {
        aiSettings.posts[k] = {
            systemPrompt: String(document.getElementById(`adminAi-post-${k}-prompt`)?.value || ""),
            ...readPair(`adminAi-post-${k}`),
        };
    });
    return aiSettings;
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
        setAdminRuntimeInputValue("adminAi-runtime-ragMaxCandidates", runtime.ragMaxCandidates, defaults.ragMaxCandidates);
        setAdminRuntimeInputValue(
            "adminAi-runtime-ragMinOverlapTokens",
            runtime.ragMinOverlapTokens,
            defaults.ragMinOverlapTokens,
        );
        setAdminRuntimeInputValue("adminAi-runtime-ragMinScore", runtime.ragMinScore, defaults.ragMinScore);
        setAdminRuntimeInputValue(
            "adminAi-runtime-ragRelativeCutoffPct",
            runtime.ragRelativeCutoffPct,
            defaults.ragRelativeCutoffPct,
        );
        const ragKeywordInput = document.getElementById("adminAi-runtime-ragKeywordBlocklist");
        if (ragKeywordInput) {
            const runtimeList = Array.isArray(runtime.ragKeywordBlocklist) ? runtime.ragKeywordBlocklist : [];
            ragKeywordInput.value = runtimeList.join(", ");
            if (typeof window.applyRuntimeRagKeywordBlocklist === "function") {
                window.applyRuntimeRagKeywordBlocklist(runtimeList);
            }
        }
        setAdminRuntimeDefaultText("adminAi-runtime-chatMaxOutputTokens-default", defaults.chatMaxOutputTokens);
        setAdminRuntimeDefaultText("adminAi-runtime-postMaxOutputTokens-default", defaults.postMaxOutputTokens);
        setAdminRuntimeDefaultText("adminAi-runtime-chatMaxContinuations-default", defaults.chatMaxContinuations);
        setAdminRuntimeDefaultText("adminAi-runtime-postMaxContinuations-default", defaults.postMaxContinuations);
        setAdminRuntimeDefaultText("adminAi-runtime-chatMaxContinuationRuntimeMs-default", defaults.chatMaxContinuationRuntimeMs);
        setAdminRuntimeDefaultText("adminAi-runtime-postMaxContinuationRuntimeMs-default", defaults.postMaxContinuationRuntimeMs);
        setAdminRuntimeDefaultText("adminAi-runtime-ragMaxCandidates-default", defaults.ragMaxCandidates);
        setAdminRuntimeDefaultText("adminAi-runtime-ragMinOverlapTokens-default", defaults.ragMinOverlapTokens);
        setAdminRuntimeDefaultText("adminAi-runtime-ragMinScore-default", defaults.ragMinScore);
        setAdminRuntimeDefaultText("adminAi-runtime-ragRelativeCutoffPct-default", defaults.ragRelativeCutoffPct);
        const ragKeywordDefaultEl = document.getElementById("adminAi-runtime-ragKeywordBlocklist-default");
        if (ragKeywordDefaultEl) {
            const defaultsList = Array.isArray(defaults.ragKeywordBlocklist) ? defaults.ragKeywordBlocklist : [];
            ragKeywordDefaultEl.innerText = defaultsList.length ? `기본값: ${defaultsList.length}개` : "기본값: -";
        }
        updateAdminRuntimeHumanHint("adminAi-runtime-chatMaxContinuationRuntimeMs");
        updateAdminRuntimeHumanHint("adminAi-runtime-postMaxContinuationRuntimeMs");
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
    const aiSettings = collectAdminAiSettingsFromForm();
    try {
        await fetchJson("/api/db/ai-settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                aiSettings,
                meta: { changedBy: getAdminActorName(), note: "관리자 화면에서 수동 저장" },
            }),
        });
        if (typeof window.applyRuntimeRagKeywordBlocklist === "function") {
            window.applyRuntimeRagKeywordBlocklist(aiSettings && aiSettings.runtime ? aiSettings.runtime.ragKeywordBlocklist : []);
        }
        showAlert("관리자 설정을 저장했습니다.", "success");
    } catch (e) {
        console.error(e);
        showAlert("저장에 실패했습니다.", "error");
    }
}

async function resetAdminAiSettingsToDefault() {
    if (!currentUserHasAdminAccess()) {
        showAlert("플랫폼 관리자 권한이 필요합니다.", "error");
        return;
    }
    showConfirm("AI 설정을 초기 기본값으로 되돌릴까요?", async () => {
        try {
            await fetchJson("/api/db/ai-settings/reset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    meta: { changedBy: getAdminActorName(), note: "초기설정으로 되돌리기 실행" },
                }),
            });
            await loadAdminAiSettingsView();
            showAlert("AI 설정을 초기 기본값으로 되돌렸습니다.", "success");
        } catch (e) {
            console.error(e);
            showAlert("초기설정 복원에 실패했습니다.", "error");
        }
    });
}

function closeAdminAiSettingsHistoryModal() {
    const modal = document.getElementById("adminAiSettingsHistoryModal");
    if (modal) modal.classList.remove("active");
}

function summarizeAiSettingsHtml(settings) {
    const cfg = settings && typeof settings === "object" ? settings : {};
    const c = cfg.chat && typeof cfg.chat === "object" ? cfg.chat : {};
    const p = cfg.posts && typeof cfg.posts === "object" ? cfg.posts : {};
    const r = cfg.runtime && typeof cfg.runtime === "object" ? cfg.runtime : {};
    const ragBlockCount = Array.isArray(r.ragKeywordBlocklist) ? r.ragKeywordBlocklist.length : 0;
    const postIT = p.IT && typeof p.IT === "object" ? p.IT : {};
    const postBIZ = p.BIZ && typeof p.BIZ === "object" ? p.BIZ : {};
    return `
        <div class="admin-ai-settings-version-grid">
            <div class="admin-ai-settings-version-card"><b>채팅</b><span>T ${c.temperature ?? "-"} / P ${c.topP ?? "-"}</span></div>
            <div class="admin-ai-settings-version-card"><b>IT 답변</b><span>T ${postIT.temperature ?? "-"} / P ${postIT.topP ?? "-"}</span></div>
            <div class="admin-ai-settings-version-card"><b>BIZ 답변</b><span>T ${postBIZ.temperature ?? "-"} / P ${postBIZ.topP ?? "-"}</span></div>
            <div class="admin-ai-settings-version-card"><b>토큰/이어쓰기</b><span>chat ${r.chatMaxOutputTokens ?? "-"} / post ${r.postMaxOutputTokens ?? "-"}</span></div>
            <div class="admin-ai-settings-version-card"><b>RAG</b><span>후보 ${r.ragMaxCandidates ?? "-"} / 최소점수 ${r.ragMinScore ?? "-"} / 금칙어 ${ragBlockCount}개</span></div>
        </div>
    `;
}

function renderAdminAiSettingsHistoryList() {
    const mount = document.getElementById("adminAiSettingsHistoryList");
    const summary = document.getElementById("adminAiSettingsHistorySummary");
    if (!mount || !summary) return;
    const list = Array.isArray(adminAiSettingsHistory) ? adminAiSettingsHistory : [];
    summary.innerText = `기록: ${list.length}건`;
    if (!list.length) {
        mount.innerHTML = '<div class="text-center p-20" style="color:#94a3b8;">저장된 설정 이력이 없습니다.</div>';
        return;
    }
    mount.innerHTML = list
        .map((item) => {
            const versionNo = Number(item && item.versionNo) || 0;
            const action = String(item && item.action ? item.action : "save");
            const actionText = action === "restore" ? "복원" : action === "reset" ? "초기화" : "저장";
            const actor = escapeHtml(String(item && item.changedBy ? item.changedBy : "unknown"));
            const note = escapeHtml(String(item && item.note ? item.note : "-"));
            const createdAt = formatAdminAiApiLogTime(item && item.createdAt);
            return `
                <div class="admin-ai-settings-history-item">
                    <div class="admin-ai-settings-history-head">
                        <div class="admin-ai-settings-history-version">v${versionNo}</div>
                        <div class="admin-ai-settings-history-meta">${createdAt} · ${actor} · ${actionText}</div>
                        <button type="button" class="btn btn-primary" style="padding:5px 10px; font-size:12px;" onclick="restoreAdminAiSettingsVersion(${versionNo})">이 버전으로 복원</button>
                    </div>
                    <div class="admin-ai-settings-history-note">${note}</div>
                    ${summarizeAiSettingsHtml(item && item.aiSettings)}
                </div>
            `;
        })
        .join("");
}

async function loadAdminAiSettingsHistory() {
    const data = await fetchJson("/api/db/ai-settings/history");
    adminAiSettingsHistory = Array.isArray(data && data.history) ? data.history : [];
}

async function openAdminAiSettingsHistoryModal() {
    try {
        await loadAdminAiSettingsHistory();
        renderAdminAiSettingsHistoryList();
        const modal = document.getElementById("adminAiSettingsHistoryModal");
        if (modal) modal.classList.add("active");
    } catch (e) {
        console.error(e);
        showAlert("설정 변경 이력을 불러오지 못했습니다.", "error");
    }
}

async function restoreAdminAiSettingsVersion(versionNo) {
    if (!currentUserHasAdminAccess()) {
        showAlert("플랫폼 관리자 권한이 필요합니다.", "error");
        return;
    }
    const target = Number(versionNo);
    if (!Number.isFinite(target) || target <= 0) return;
    showConfirm(`v${target} 설정으로 복원하시겠습니까?`, async () => {
        try {
            await fetchJson("/api/db/ai-settings/restore", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    versionNo: target,
                    meta: { changedBy: getAdminActorName(), note: `v${target} 복원` },
                }),
            });
            await loadAdminAiSettingsView();
            await loadAdminAiSettingsHistory();
            renderAdminAiSettingsHistoryList();
            showAlert(`v${target} 설정으로 복원했습니다.`, "success");
        } catch (e) {
            console.error(e);
            showAlert("설정 복원에 실패했습니다.", "error");
        }
    });
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
    wireAdminRuntimeHumanHintOnce();
}

function buildAdminAiApiLogPlainText(log) {
    if (!log || typeof log !== "object") return "";
    const final = log.final && typeof log.final === "object" ? log.final : {};
    const runtime = log.runtime && typeof log.runtime === "object" ? log.runtime : {};
    const generation = log.generationConfig && typeof log.generationConfig === "object" ? log.generationConfig : {};
    const boardMeta = getAdminAiApiBoardMeta(log.boardType);
    const lines = [];
    lines.push("=== AI API 로그 상세 ===");
    lines.push(`요청 시각: ${formatAdminAiApiLogTime(log.createdAt)}`);
    lines.push(`요청자 범위: ${String(log.requesterScope || "-")}`);
    lines.push(`게시판 구분: ${boardMeta.boardLabel}`);
    lines.push(`모델: ${String(log.model || "-")}`);
    lines.push(`Grounding 사용: ${log.useGroundingRequested ? "예" : "아니오"}`);
    lines.push(`응답 결과: ${final.ok ? "성공" : "실패"} / 코드 ${String(final.statusCode || "-")}`);
    lines.push(`이어쓰기 횟수: ${String(final.continuationCount || 0)}`);
    lines.push(`Truncated: ${final.truncated ? "예" : "아니오"}`);
    lines.push("");
    lines.push(`적용 설정: ${boardMeta.settingsLabel}`);
    if (boardMeta.isChat) {
        lines.push(`채팅 최대 토큰: ${String(runtime.chatMaxOutputTokens ?? "-")}`);
        lines.push(`채팅 이어쓰기 제한: ${String(runtime.chatMaxContinuations ?? "-")}`);
        lines.push(`채팅 이어쓰기 시간(ms): ${String(runtime.chatMaxContinuationRuntimeMs ?? "-")}`);
    } else {
        lines.push(`게시물 최대 토큰: ${String(runtime.postMaxOutputTokens ?? "-")}`);
        lines.push(`게시물 빠른생성 토큰: ${String(runtime.postFastMaxOutputTokens ?? "-")}`);
        lines.push(`게시물 이어쓰기 제한: ${String(runtime.postMaxContinuations ?? "-")}`);
        lines.push(`게시물 이어쓰기 시간(ms): ${String(runtime.postMaxContinuationRuntimeMs ?? "-")}`);
    }
    lines.push(`RAG 최대 후보 수: ${String(runtime.ragMaxCandidates ?? "-")}`);
    lines.push(`RAG 최소 토큰 일치 수: ${String(runtime.ragMinOverlapTokens ?? "-")}`);
    lines.push(`RAG 최소 점수: ${String(runtime.ragMinScore ?? "-")}`);
    lines.push(`RAG 상대 컷오프(%): ${String(runtime.ragRelativeCutoffPct ?? "-")}`);
    lines.push(`RAG 키워드 금칙어 수: ${Array.isArray(runtime.ragKeywordBlocklist) ? runtime.ragKeywordBlocklist.length : 0}개`);
    lines.push(`요청 maxOutputTokens: ${String(generation.maxOutputTokens ?? "-")}`);
    lines.push(`요청 temperature: ${String(generation.temperature ?? "-")}`);
    lines.push(`요청 topP: ${String(generation.topP ?? "-")}`);
    lines.push("");
    lines.push("[요청 제목]");
    lines.push(normalizeAdminAiApiLogText(String(log.title || "")) || "-");
    lines.push("");
    lines.push("[요청 본문 요약]");
    lines.push(normalizeAdminAiApiLogText(String(log.contentPreview || "")) || "-");
    lines.push("");
    lines.push("[최종 프롬프트(메인)]");
    lines.push(normalizeAdminAiApiLogText(String(log.promptText || "")) || "-");
    const attempts = Array.isArray(log.attempts) ? log.attempts : [];
    if (attempts.length) {
        lines.push("");
        lines.push("[요청/수신 상세 시도 로그]");
        attempts.forEach((a, idx) => {
            const req = a && a.request && typeof a.request === "object" ? a.request : {};
            const resp = a && a.response && typeof a.response === "object" ? a.response : {};
            lines.push(`- 시도 ${idx + 1} (${String(a.label || "-")})`);
            lines.push(`  요청 시각: ${formatAdminAiApiLogTime(a.requestedAt)}`);
            lines.push(`  도구 사용: ${req.hasTools ? "예" : "아니오"}`);
            lines.push(`  프롬프트 길이: ${String(req.promptChars || 0)}자`);
            lines.push(`  응답 상태: ${resp.ok ? "성공" : "실패"} (${String(resp.status || "-")})`);
            lines.push(`  finishReason: ${String(resp.finishReason || "-")}`);
            lines.push(`  오류 메시지: ${String(resp.errorMessage || "-")}`);
            lines.push("  [요청 프롬프트]");
            lines.push(`  ${normalizeAdminAiApiLogText(String(req.promptText || "")) || "-"}`);
            lines.push("  [수신 요약]");
            lines.push(`  ${normalizeAdminAiApiLogText(String(resp.replyPreview || "")) || "-"}`);
        });
    }
    return lines.join("\n");
}

async function copyAdminAiApiLogDetail(logId) {
    const log = adminAiApiLogs.find((x) => String(x.id) === String(logId));
    if (!log) {
        showAlert("복사할 로그를 찾지 못했습니다.", "error");
        return;
    }
    const plainText = buildAdminAiApiLogPlainText(log);
    if (!plainText) {
        showAlert("복사할 로그 내용이 없습니다.", "error");
        return;
    }
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(plainText);
        } else {
            const ta = document.createElement("textarea");
            ta.value = plainText;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
        }
        showAlert("AI API 로그 상세 내용을 클립보드에 복사했습니다.", "success");
    } catch (e) {
        console.error(e);
        showAlert("클립보드 복사에 실패했습니다.", "error");
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
            '<div class="admin-user-tools"><button type="button" class="btn btn-primary" onclick="openSignupModal()">사용자 등록</button><span class="admin-settings-hint" style="margin:0;">등록된 사용자가 없습니다. 관리자 화면에서 바로 추가할 수 있습니다.</span></div>';
        return;
    }
    mount.innerHTML = `
        <div class="admin-user-tools">
            <button type="button" class="btn btn-primary" onclick="openSignupModal()">사용자 등록</button>
            <span class="admin-settings-hint" style="margin:0;">권한/사용자 정보 수정 후 <strong>권한 저장</strong> 버튼으로 최종 저장하세요.</span>
        </div>
        <div class="admin-perms-table-wrap">
            <table class="admin-perms-table">
                <thead>
                    <tr>
                        <th>이름</th>
                        <th>직원번호</th>
                        <th>업무 역할</th>
                        <th>내선번호</th>
                        <th>FAX</th>
                        <th>휴대전화</th>
                        <th style="text-align:center; width:140px;">플랫폼 관리자</th>
                        <th style="text-align:center; width:170px;">관리</th>
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
                                    <td>${escapeHtml(String(u.extNo || "8-0000"))}</td>
                                    <td>${escapeHtml(String(u.faxNo || "02-0000-0000"))}</td>
                                    <td>${escapeHtml(String(u.mobileNo || "010-0000-0000"))}</td>
                                    <td style="text-align:center;">
                                        <input type="checkbox" class="admin-perm-isadmin" data-emp="${emp}"${checked} aria-label="플랫폼 관리자">
                                    </td>
                                    <td style="text-align:center;">
                                        <button type="button" class="btn btn-outline" style="padding:5px 10px; font-size:12px;" onclick="openSignupModalForEdit('${emp}')">수정</button>
                                        <button type="button" class="btn btn-danger" style="padding:5px 10px; font-size:12px; margin-left:6px;" onclick="deleteSignupUserFromAdmin('${emp}')">삭제</button>
                                    </td>
                                </tr>`;
                        })
                        .join("")}
                </tbody>
            </table>
        </div>`;
}

function deleteSignupUserFromAdmin(employeeNo) {
    const empNo = String(employeeNo || "");
    const user = signupUsers.find((u) => String(u.employeeNo) === empNo);
    if (!user) return;
    if (isAiSystemUser(user)) {
        showAlert("AI 시스템 계정은 삭제할 수 없습니다.", "error");
        return;
    }
    showConfirm(`[${user.name}] 사용자를 삭제하시겠습니까?`, async () => {
        signupUsers = signupUsers.filter((u) => String(u.employeeNo) !== empNo);
        try {
            await saveSignupUsers({ rethrow: true });
            renderAdminPermissionsPanel();
            showAlert("사용자를 삭제했습니다.", "success");
        } catch (e) {
            console.error(e);
            showAlert("사용자 삭제에 실패했습니다.", "error");
        }
    });
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
    const copyBtn = document.getElementById("adminAiApiLogCopyBtn");
    if (copyBtn) {
        copyBtn.classList.add("hidden");
        copyBtn.dataset.logId = "";
    }
}

function getAdminAiApiBoardMeta(boardTypeRaw) {
    const boardType = String(boardTypeRaw || "").toUpperCase();
    if (boardType === "CHAT") {
        return { boardType, boardLabel: "AI채팅", settingsLabel: "AI채팅 설정", isChat: true };
    }
    if (boardType === "IT") {
        return { boardType, boardLabel: "AI답변(IT)", settingsLabel: "AI답변 설정(IT)", isChat: false };
    }
    if (boardType === "BIZ") {
        return { boardType, boardLabel: "AI답변(규정/상품)", settingsLabel: "AI답변 설정(규정/상품)", isChat: false };
    }
    return { boardType, boardLabel: boardType || "-", settingsLabel: "AI 설정", isChat: false };
}

function normalizeAdminAiApiLogText(rawText) {
    let text = String(rawText || "").replace(/\r/g, "").trim();
    if (!text) return "";
    const PARA_MARK = "__ADMIN_AI_LOG_PARA__";
    const LIST_MARK = "__ADMIN_AI_LOG_LIST__";
    text = text
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\n{2,}/g, PARA_MARK)
        .replace(/\n(?=\s*(?:[-*•]|[0-9]+[.)]))/g, LIST_MARK)
        .replace(/([가-힣A-Za-z]{1,3})\n([가-힣A-Za-z]{1,3})/g, "$1$2")
        .replace(/\n/g, " ")
        .replace(new RegExp(LIST_MARK, "g"), "\n")
        .replace(new RegExp(PARA_MARK, "g"), "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return text;
}

function buildAdminLogInfoRows(log) {
    const final = log && log.final && typeof log.final === "object" ? log.final : {};
    const runtime = log && log.runtime && typeof log.runtime === "object" ? log.runtime : {};
    const generation = log && log.generationConfig && typeof log.generationConfig === "object" ? log.generationConfig : {};
    const boardMeta = getAdminAiApiBoardMeta(log && log.boardType);
    const runtimeRows = boardMeta.isChat
        ? [
              ["적용 설정", boardMeta.settingsLabel],
              ["채팅 최대 토큰", String(runtime.chatMaxOutputTokens ?? "-")],
              ["채팅 이어쓰기 제한", String(runtime.chatMaxContinuations ?? "-")],
              ["채팅 이어쓰기 시간(ms)", String(runtime.chatMaxContinuationRuntimeMs ?? "-")],
          ]
        : [
              ["적용 설정", boardMeta.settingsLabel],
              ["게시물 최대 토큰", String(runtime.postMaxOutputTokens ?? "-")],
              ["게시물 빠른생성 토큰", String(runtime.postFastMaxOutputTokens ?? "-")],
              ["게시물 이어쓰기 제한", String(runtime.postMaxContinuations ?? "-")],
              ["게시물 이어쓰기 시간(ms)", String(runtime.postMaxContinuationRuntimeMs ?? "-")],
          ];
    const ragRows = [
        ["RAG 최대 후보 수", String(runtime.ragMaxCandidates ?? "-")],
        ["RAG 최소 토큰 일치 수", String(runtime.ragMinOverlapTokens ?? "-")],
        ["RAG 최소 점수", String(runtime.ragMinScore ?? "-")],
        ["RAG 상대 컷오프(%)", String(runtime.ragRelativeCutoffPct ?? "-")],
        ["RAG 키워드 금칙어 수", `${Array.isArray(runtime.ragKeywordBlocklist) ? runtime.ragKeywordBlocklist.length : 0}개`],
    ];
    const rows = [
        ["요청 시각", formatAdminAiApiLogTime(log.createdAt)],
        ["요청자 범위", String(log.requesterScope || "-")],
        ["게시판 구분", boardMeta.boardLabel],
        ["모델", String(log.model || "-")],
        ["Grounding 사용", log.useGroundingRequested ? "예" : "아니오"],
        ["응답 결과", final.ok ? "성공" : "실패"],
        ["응답 코드", String(final.statusCode || "-")],
        ["이어쓰기 횟수", String(final.continuationCount || 0)],
        ["Truncated", final.truncated ? "예" : "아니오"],
        ...runtimeRows,
        ...ragRows,
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
    const copyBtn = document.getElementById("adminAiApiLogCopyBtn");
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
                        <pre class="admin-ai-log-pre">${escapeHtml(normalizeAdminAiApiLogText(String(req.promptText || "")))}</pre>
                        <div class="admin-ai-log-detail-title" style="margin-top:8px;">수신 요약(시도)</div>
                        <pre class="admin-ai-log-pre">${escapeHtml(normalizeAdminAiApiLogText(String(resp.replyPreview || "")))}</pre>
                    </div>
                  `;
              })
              .join("")
        : '<div class="admin-settings-hint">시도 로그가 없습니다.</div>';
    body.innerHTML = `
        <div class="admin-ai-log-detail-grid">${buildAdminLogInfoRows(log)}</div>
        <div class="admin-ai-log-detail-title">요청 제목</div>
        <pre class="admin-ai-log-pre">${escapeHtml(normalizeAdminAiApiLogText(String(log.title || "")))}</pre>
        <div class="admin-ai-log-detail-title" style="margin-top:10px;">요청 본문 요약</div>
        <pre class="admin-ai-log-pre">${escapeHtml(normalizeAdminAiApiLogText(String(log.contentPreview || "")))}</pre>
        <div class="admin-ai-log-detail-title" style="margin-top:10px;">최종 프롬프트(메인)</div>
        <pre class="admin-ai-log-pre">${escapeHtml(normalizeAdminAiApiLogText(String(log.promptText || "")))}</pre>
        <div class="admin-ai-log-detail-title" style="margin-top:10px;">요청/수신 상세 시도 로그</div>
        ${attemptsHtml}
    `;
    if (copyBtn) {
        copyBtn.classList.remove("hidden");
        copyBtn.dataset.logId = String(log.id || "");
    }
    modal.classList.add("active");
}

function closeAdminAiHelpModal() {
    const modal = document.getElementById("adminAiHelpModal");
    if (modal) modal.classList.remove("active");
}

function openAdminAiHelpModal(topic) {
    const modal = document.getElementById("adminAiHelpModal");
    const titleEl = document.getElementById("adminAiHelpModalTitle");
    const bodyEl = document.getElementById("adminAiHelpModalBody");
    if (!modal || !titleEl || !bodyEl) return;
    const key = String(topic || "runtime");
    const helpMap = {
        chat: {
            title: "AI 채팅 설정 도움말",
            html: `
                <div class="admin-help-hero">
                    <div class="admin-help-hero-title">CHAT 운영 가이드</div>
                    <div class="admin-help-hero-sub">업무 Q&A는 안정성 중심, 초안 작성은 유연성 중심으로 운영하세요.</div>
                    <div class="admin-help-chip-row">
                        <span class="admin-help-chip">권장 Temperature 0.2~0.4</span>
                        <span class="admin-help-chip">권장 Top-P 0.7~0.9</span>
                    </div>
                </div>
                <div class="admin-help-grid">
                    <div class="admin-help-card">
                        <div class="admin-help-card-title">핵심 설정 의미</div>
                        <ul>
                            <li><b>시스템 프롬프트</b>: 말투/역할/금지사항을 정의합니다. 비우면 기본 프롬프트를 사용합니다.</li>
                            <li><b>Temperature</b>: 낮을수록 일관적, 높을수록 창의적입니다.</li>
                            <li><b>Top-P</b>: 후보 단어 범위를 제어해 표현 다양성을 조절합니다.</li>
                        </ul>
                    </div>
                    <div class="admin-help-card">
                        <div class="admin-help-card-title">운영 팁</div>
                        <ul>
                            <li>일반 업무 답변: Temperature 0.2~0.4, Top-P 0.7~0.9</li>
                            <li>아이디어/초안: Temperature 0.5~0.7, Top-P 0.8~1.0</li>
                            <li>오답 증가 시 Temperature를 먼저 낮춘 후 Top-P를 조정하세요.</li>
                        </ul>
                    </div>
                    <div class="admin-help-card">
                        <div class="admin-help-card-title">실무 예시</div>
                        <ul>
                            <li>"규정 답변이 들쭉날쭉"하면 Temperature 0.3, Top-P 0.8부터 고정 운영합니다.</li>
                        </ul>
                    </div>
                </div>
            `,
        },
        post: {
            title: "AI 답변(게시물) 설정 도움말",
            html: `
                <div class="admin-help-hero">
                    <div class="admin-help-hero-title">POST 운영 가이드</div>
                    <div class="admin-help-hero-sub">게시판 성격(IT/규정)에 맞춰 프롬프트와 생성값을 분리 운영하세요.</div>
                    <div class="admin-help-chip-row">
                        <span class="admin-help-chip">IT: T 0.1~0.3 / P 0.7~0.85</span>
                        <span class="admin-help-chip">BIZ: T 0.2~0.5 / P 0.8~0.95</span>
                    </div>
                </div>
                <div class="admin-help-grid">
                    <div class="admin-help-card">
                        <div class="admin-help-card-title">핵심 설정 의미</div>
                        <ul>
                            <li>게시판별 <b>시스템 프롬프트</b>를 분리해 답변 기준을 명확히 합니다.</li>
                            <li><b>Temperature/Top-P</b>를 분리하면 정확도와 가독성을 동시에 관리할 수 있습니다.</li>
                        </ul>
                    </div>
                    <div class="admin-help-card">
                        <div class="admin-help-card-title">운영 팁</div>
                        <ul>
                            <li>IT 문의는 낮은 Temperature로 사실/절차 중심으로 운영합니다.</li>
                            <li>규정/상품 문의는 설명력이 필요한 만큼 Temperature를 약간 높입니다.</li>
                            <li>값 변경은 한 번에 하나씩 조정 후 결과를 비교하세요.</li>
                        </ul>
                    </div>
                    <div class="admin-help-card">
                        <div class="admin-help-card-title">실무 예시</div>
                        <ul>
                            <li>"규정은 이해하기 쉽게, IT는 정확하게" 목표라면 게시판별 프롬프트와 온도를 분리하는 것이 안정적입니다.</li>
                        </ul>
                    </div>
                </div>
            `,
        },
        runtime: {
            title: "토큰/이어쓰기 설정 도움말",
            html: `
                <div class="admin-help-hero">
                    <div class="admin-help-hero-title">RUNTIME 운영 가이드</div>
                    <div class="admin-help-hero-sub">응답 길이, 끊김, 지연시간은 토큰과 이어쓰기 설정으로 균형을 맞춥니다.</div>
                    <div class="admin-help-chip-row">
                        <span class="admin-help-chip">채팅 토큰 1024~2048</span>
                        <span class="admin-help-chip">게시물 토큰 1536~3072</span>
                        <span class="admin-help-chip">이어쓰기 1~3회</span>
                    </div>
                </div>
                <div class="admin-help-grid">
                    <div class="admin-help-card">
                        <div class="admin-help-card-title">핵심 설정 의미</div>
                        <ul>
                            <li><b>최대 토큰</b>: 1회 응답 길이 제한</li>
                            <li><b>이어쓰기 횟수</b>: 잘린 답변 자동 이어쓰기 시도 횟수</li>
                            <li><b>이어쓰기 시간(ms)</b>: 전체 이어쓰기 타임아웃</li>
                        </ul>
                    </div>
                    <div class="admin-help-card">
                        <div class="admin-help-card-title">운영 팁</div>
                        <ul>
                            <li>답변이 자주 끊기면 최대 토큰을 먼저 늘립니다.</li>
                            <li>그래도 끊기면 이어쓰기 횟수를 1씩 증가시킵니다.</li>
                            <li>지연이 길면 이어쓰기 시간 제한을 낮춰 체감 속도를 개선합니다.</li>
                            <li>입력을 비우면 서버 기본값이 자동 적용됩니다.</li>
                        </ul>
                    </div>
                </div>
            `,
        },
    };
    const selected = helpMap[key] || helpMap.runtime;
    titleEl.innerText = selected.title;
    bodyEl.innerHTML = selected.html;
    modal.classList.add("active");
}

window.openAdminAiHelpModal = openAdminAiHelpModal;
window.closeAdminAiHelpModal = closeAdminAiHelpModal;
window.exportAdminRagKeywordBlocklist = exportAdminRagKeywordBlocklist;
window.importAdminRagKeywordBlocklist = importAdminRagKeywordBlocklist;
window.handleAdminRagKeywordImport = handleAdminRagKeywordImport;
window.copyAdminAiApiLogDetail = copyAdminAiApiLogDetail;
window.deleteSignupUserFromAdmin = deleteSignupUserFromAdmin;
window.resetAdminAiSettingsToDefault = resetAdminAiSettingsToDefault;
window.openAdminAiSettingsHistoryModal = openAdminAiSettingsHistoryModal;
window.closeAdminAiSettingsHistoryModal = closeAdminAiSettingsHistoryModal;
window.restoreAdminAiSettingsVersion = restoreAdminAiSettingsVersion;
