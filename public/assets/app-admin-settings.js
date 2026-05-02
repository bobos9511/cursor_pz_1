"use strict";

const ADMIN_AI_POST_KEYS = ["IT", "BIZ"];
let adminAiPostTabsInited = false;
let adminAiGenWired = false;
let adminSettingsMainTabsInited = false;
let adminRuntimeHumanHintWired = false;
let adminAiApiLogs = [];
let adminAiApiLogsPageSize = 10;
let adminAiApiLogsPage = 1;
let adminAiApiLogsFilter = "all";
let adminAiApiLogsSearchRaw = "";
let adminAiSettingsHistory = [];
let adminRuntimeValidationWired = false;
let adminRagBlocklistWired = false;

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

/** 서버 RUNTIME_CONTINUATION_MS_* 와 동일: 0·비움 → null(기본값), 그 외 100ms~1시간 */
const ADMIN_RUNTIME_CONTINUATION_MS_MIN = 100;
const ADMIN_RUNTIME_CONTINUATION_MS_MAX = 3600000;

function clampAdminContinuationRuntimeMsOrNull(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    const n = Math.round(Number(s));
    if (!Number.isFinite(n)) return null;
    if (n === 0) return null;
    return Math.min(
        ADMIN_RUNTIME_CONTINUATION_MS_MAX,
        Math.max(ADMIN_RUNTIME_CONTINUATION_MS_MIN, n),
    );
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

function normalizeRagBlocklistTokenOne(raw) {
    const oneLine = String(raw || "").replace(/\n/g, ",");
    const parsed = parseAdminKeywordBlocklist(oneLine);
    return parsed.length ? parsed[parsed.length - 1] : "";
}

function getRagKeywordBlocklistFromUI() {
    const listEl = document.getElementById("adminAi-runtime-ragKeywordBlocklist-list");
    if (!listEl) return [];
    const out = [];
    const seen = new Set();
    listEl.querySelectorAll(".admin-rag-keyword-item[data-rag-keyword]").forEach((li) => {
        const t = String(li.getAttribute("data-rag-keyword") || "").trim();
        if (t.length < 2 || seen.has(t)) return;
        seen.add(t);
        out.push(t);
    });
    return out;
}

function createRagKeywordListItemEl(token) {
    const li = document.createElement("li");
    li.className = "admin-rag-keyword-item";
    li.setAttribute("data-rag-keyword", token);
    const span = document.createElement("span");
    span.className = "admin-rag-keyword-text";
    span.textContent = token;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-outline admin-rag-keyword-remove";
    btn.textContent = "삭제";
    li.appendChild(span);
    li.appendChild(btn);
    return li;
}

function renderRagKeywordBlocklistUI(tokenList) {
    const listEl = document.getElementById("adminAi-runtime-ragKeywordBlocklist-list");
    if (!listEl) return;
    const merged = Array.isArray(tokenList)
        ? parseAdminKeywordBlocklist(tokenList.join("\n"))
        : parseAdminKeywordBlocklist(String(tokenList || ""));
    listEl.innerHTML = "";
    if (!merged.length) {
        const empty = document.createElement("li");
        empty.className = "admin-rag-keyword-empty";
        empty.setAttribute("role", "status");
        empty.textContent = "등록된 금칙어가 없습니다. 위 입력란에 추가하세요.";
        listEl.appendChild(empty);
        return;
    }
    merged.forEach((w) => listEl.appendChild(createRagKeywordListItemEl(w)));
}

function wireRagKeywordBlocklistEditorOnce() {
    if (adminRagBlocklistWired) return;
    const listEl = document.getElementById("adminAi-runtime-ragKeywordBlocklist-list");
    const addBtn = document.getElementById("adminAi-runtime-ragKeywordBlocklist-add");
    const input = document.getElementById("adminAi-runtime-ragKeywordBlocklist-input");
    if (!listEl || !addBtn || !input) return;
    adminRagBlocklistWired = true;
    const showEmptyIfNeeded = () => {
        if (!listEl.querySelector(".admin-rag-keyword-item")) {
            listEl.innerHTML = "";
            const empty = document.createElement("li");
            empty.className = "admin-rag-keyword-empty";
            empty.setAttribute("role", "status");
            empty.textContent = "등록된 금칙어가 없습니다. 위 입력란에 추가하세요.";
            listEl.appendChild(empty);
        }
    };
    const addOne = () => {
        const t = normalizeRagBlocklistTokenOne(input.value);
        if (!t) {
            showAlert("2글자 이상의 한글·영문·숫자만 추가할 수 있습니다.", "error");
            return;
        }
        const existing = getRagKeywordBlocklistFromUI();
        if (existing.includes(t)) {
            showAlert("이미 목록에 있습니다.", "error");
            return;
        }
        const emptyRow = listEl.querySelector(".admin-rag-keyword-empty");
        if (emptyRow) emptyRow.remove();
        listEl.appendChild(createRagKeywordListItemEl(t));
        input.value = "";
        input.focus();
    };
    addBtn.addEventListener("click", addOne);
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            addOne();
        }
    });
    listEl.addEventListener("click", (e) => {
        const btn = e.target && e.target.closest && e.target.closest(".admin-rag-keyword-remove");
        if (!btn) return;
        const li = btn.closest(".admin-rag-keyword-item");
        if (li) li.remove();
        showEmptyIfNeeded();
    });
    if (!listEl.querySelector(".admin-rag-keyword-item")) showEmptyIfNeeded();
}

function exportAdminRagKeywordBlocklist() {
    const list = getRagKeywordBlocklistFromUI();
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
        renderRagKeywordBlocklistUI(list);
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
    if (raw === "0") {
        hintEl.innerHTML = '<span class="admin-ms-hint-chip">0 = 서버 기본값 사용</span>';
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
            chatMaxContinuationRuntimeMs: clampAdminContinuationRuntimeMsOrNull(
                document.getElementById("adminAi-runtime-chatMaxContinuationRuntimeMs")?.value,
            ),
            postMaxContinuationRuntimeMs: clampAdminContinuationRuntimeMsOrNull(
                document.getElementById("adminAi-runtime-postMaxContinuationRuntimeMs")?.value,
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
            ragKeywordBlocklist: getRagKeywordBlocklistFromUI(),
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

function setAdminGenParamMsg(numId, message) {
    const el = document.getElementById(`${numId}-msg`);
    if (el) el.textContent = message || "";
}

function wireAdminAiGenControlsOnce() {
    if (adminAiGenWired) return;
    adminAiGenWired = true;
    document.querySelectorAll(".admin-ai-gen-range").forEach((range) => {
        range.addEventListener("input", () => {
            const v = clampAdminAiGen01(range.value);
            range.value = String(v);
            const num = document.getElementById(`${range.id}-num`);
            if (num) {
                num.value = String(v);
                setAdminGenParamMsg(num.id, "");
            }
        });
    });
    document.querySelectorAll(".admin-ai-gen-num").forEach((num) => {
        const syncFromNum = () => {
            const rawTrim = String(num.value ?? "").trim();
            const rawNum = Number(rawTrim);
            let msg = "";
            if (rawTrim !== "") {
                if (!Number.isFinite(rawNum)) msg = "숫자만 입력할 수 있습니다.";
                else if (rawNum < 0 || rawNum > 1) msg = "0 이상 1 이하만 입력할 수 있습니다.";
            }
            const v = clampAdminAiGen01(num.value);
            num.value = String(v);
            setAdminGenParamMsg(num.id, msg);
            const rangeId = num.id.replace(/-num$/, "");
            const range = document.getElementById(rangeId);
            if (range) range.value = String(v);
        };
        num.addEventListener("input", syncFromNum);
        num.addEventListener("change", syncFromNum);
    });
}

function wireAdminRuntimeValidationOnce() {
    if (adminRuntimeValidationWired) return;
    adminRuntimeValidationWired = true;
    const fields = [
        { id: "adminAi-runtime-chatMaxOutputTokens", min: 50, max: 8192 },
        { id: "adminAi-runtime-postMaxOutputTokens", min: 50, max: 8192 },
        { id: "adminAi-runtime-chatMaxContinuations", min: 0, max: 200 },
        { id: "adminAi-runtime-postMaxContinuations", min: 0, max: 200 },
        { id: "adminAi-runtime-ragMaxCandidates", min: 1, max: 10 },
        { id: "adminAi-runtime-ragMinOverlapTokens", min: 1, max: 10 },
        { id: "adminAi-runtime-ragMinScore", min: 0, max: 100 },
        { id: "adminAi-runtime-ragRelativeCutoffPct", min: 0, max: 100 },
    ];
    fields.forEach(({ id, min, max }) => {
        const el = document.getElementById(id);
        if (!el) return;
        const errEl = document.getElementById(`${id}-validation`);
        const apply = (isBlur) => {
            const raw = String(el.value ?? "").trim();
            el.classList.remove("admin-input-invalid");
            if (!raw) {
                if (errEl) errEl.textContent = "";
                return;
            }
            const n = Number(raw);
            if (!Number.isFinite(n)) {
                if (isBlur) {
                    el.classList.add("admin-input-invalid");
                    if (errEl) errEl.textContent = "숫자만 입력할 수 있습니다.";
                }
                return;
            }
            const rounded = Math.round(n);
            if (rounded < min || rounded > max) {
                const clamped = Math.min(max, Math.max(min, rounded));
                el.value = String(clamped);
                if (errEl) errEl.textContent = `허용 범위는 ${min}~${max}입니다. 범위에 맞게 조정했습니다.`;
            } else {
                if (rounded !== n) el.value = String(rounded);
                if (errEl) errEl.textContent = "";
            }
        };
        el.addEventListener("input", () => apply(false));
        el.addEventListener("blur", () => apply(true));
    });
    const continuationMsIds = [
        "adminAi-runtime-chatMaxContinuationRuntimeMs",
        "adminAi-runtime-postMaxContinuationRuntimeMs",
    ];
    continuationMsIds.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const errEl = document.getElementById(`${id}-validation`);
        const syncMsHint = () => updateAdminRuntimeHumanHint(id);
        const apply = (isBlur) => {
            const raw = String(el.value ?? "").trim();
            el.classList.remove("admin-input-invalid");
            if (!raw || raw === "0") {
                if (errEl) errEl.textContent = "";
                syncMsHint();
                return;
            }
            const n = Number(raw);
            if (!Number.isFinite(n)) {
                if (isBlur) {
                    el.classList.add("admin-input-invalid");
                    if (errEl) errEl.textContent = "숫자만 입력할 수 있습니다.";
                }
                syncMsHint();
                return;
            }
            const rounded = Math.round(n);
            if (rounded < 0) {
                el.value = "0";
                if (errEl) errEl.textContent = "";
                syncMsHint();
                return;
            }
            if (rounded > ADMIN_RUNTIME_CONTINUATION_MS_MAX) {
                el.value = String(ADMIN_RUNTIME_CONTINUATION_MS_MAX);
                if (errEl)
                    errEl.textContent = `최대 ${ADMIN_RUNTIME_CONTINUATION_MS_MAX.toLocaleString("ko-KR")}ms까지 설정할 수 있습니다.`;
                syncMsHint();
                return;
            }
            if (isBlur && rounded > 0 && rounded < ADMIN_RUNTIME_CONTINUATION_MS_MIN) {
                if (errEl)
                    errEl.textContent = `저장 시 최소 ${ADMIN_RUNTIME_CONTINUATION_MS_MIN}ms로 맞춰집니다. 기본 설정을 쓰려면 0으로 두세요.`;
            } else if (errEl) errEl.textContent = "";
            if (rounded !== n) el.value = String(rounded);
            syncMsHint();
        };
        el.addEventListener("input", () => apply(false));
        el.addEventListener("blur", () => apply(true));
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
        const runtimeList = Array.isArray(runtime.ragKeywordBlocklist) ? runtime.ragKeywordBlocklist : [];
        renderRagKeywordBlocklistUI(runtimeList);
        wireRagKeywordBlocklistEditorOnce();
        if (typeof window.applyRuntimeRagKeywordBlocklist === "function") {
            window.applyRuntimeRagKeywordBlocklist(runtimeList);
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
            <div class="admin-ai-settings-version-card"><b>AI 상세설정</b><span>chat ${r.chatMaxOutputTokens ?? "-"} / post ${r.postMaxOutputTokens ?? "-"}</span></div>
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
    wireAdminRuntimeValidationOnce();
    wireRagKeywordBlocklistEditorOnce();
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

function resolveAiApiLogFilterGroup(boardType) {
    const t = String(boardType || "").toUpperCase();
    if (t === "CHAT") return "chat";
    if (t === "IT" || t === "BIZ") return "post";
    return "other";
}

function resolveAiApiLogDisplayLabel(boardType) {
    const t = String(boardType || "").toUpperCase();
    if (t === "CHAT") return "AI채팅";
    if (t === "IT") return "IT문의";
    if (t === "BIZ") return "규정문의";
    if (!t) return "기타";
    return `기타 (${t})`;
}

function matchesAdminAiApiLogsSearch(log, q) {
    const needle = String(q || "").trim().toLowerCase();
    if (!needle) return true;
    const hay = [
        log.title,
        log.contentPreview,
        log.promptText,
        log.model,
        log.boardType,
        resolveAiApiLogDisplayLabel(log.boardType),
    ]
        .map((x) => String(x || "").toLowerCase())
        .join(" ");
    return hay.includes(needle);
}

function getAdminAiApiLogsFiltered() {
    const q = adminAiApiLogsSearchRaw;
    const f = adminAiApiLogsFilter;
    return adminAiApiLogs.filter((log) => {
        if (f !== "all") {
            const g = resolveAiApiLogFilterGroup(log.boardType);
            const want = f === "chat" ? "chat" : f === "post" ? "post" : "other";
            if (g !== want) return false;
        }
        return matchesAdminAiApiLogsSearch(log, q);
    });
}

function setAdminAiApiLogsFilter(value) {
    const v = String(value || "all");
    adminAiApiLogsFilter = ["all", "chat", "post", "other"].includes(v) ? v : "all";
    adminAiApiLogsPage = 1;
    renderAdminAiApiLogsList();
}

function setAdminAiApiLogsSearch(value) {
    adminAiApiLogsSearchRaw = String(value || "");
    adminAiApiLogsPage = 1;
    renderAdminAiApiLogsList();
}

function getAdminAiApiLogsResolvedPageSize() {
    const n = Number(adminAiApiLogsPageSize);
    return [10, 30, 50, 100].includes(n) ? n : 10;
}

/** 검색창을 매 렌더마다 innerHTML로 갈아끼우면 IME·포커스가 끊겨 한 글자 입력에 멈춘 것처럼 보임 → 툴바는 고정 마운트에 한 번만 생성 */
function ensureAdminAiApiLogsToolbar() {
    const host = document.getElementById("adminAiApiLogsToolbarHost");
    if (!host || host.dataset.bound === "1") return;
    const f = adminAiApiLogsFilter;
    const pageSize = getAdminAiApiLogsResolvedPageSize();
    const qEsc = escapeHtml(adminAiApiLogsSearchRaw);
    host.innerHTML = `
        <div class="admin-ai-logs-toolbar">
            <div class="admin-ai-logs-toolbar-inner">
                <div class="admin-ai-logs-field">
                    <label class="admin-ai-logs-field-label" for="adminAiLogsFilterSelect">구분</label>
                    <select id="adminAiLogsFilterSelect" class="input admin-ai-logs-filter-select" onchange="setAdminAiApiLogsFilter(this.value)">
                        <option value="all" ${f === "all" ? "selected" : ""}>전체</option>
                        <option value="chat" ${f === "chat" ? "selected" : ""}>AI채팅</option>
                        <option value="post" ${f === "post" ? "selected" : ""}>AI답변(게시판 단위)</option>
                        <option value="other" ${f === "other" ? "selected" : ""}>기타</option>
                    </select>
                </div>
                <div class="admin-ai-logs-field admin-ai-logs-field-search">
                    <label class="admin-ai-logs-field-label" for="adminAiLogsSearchInput">검색</label>
                    <input id="adminAiLogsSearchInput" type="search" class="input admin-ai-logs-search-input" placeholder="제목·프롬프트·미리보기" value="${qEsc}" autocomplete="off">
                </div>
                <div class="admin-ai-logs-field admin-ai-logs-field-pagesize">
                    <label class="admin-ai-logs-field-label" for="adminAiLogsPageSizeSelect">페이지당</label>
                    <select id="adminAiLogsPageSizeSelect" class="input admin-ai-logs-page-size" onchange="changeAdminAiApiLogPageSize(this.value)">
                        <option value="10" ${pageSize === 10 ? "selected" : ""}>10개</option>
                        <option value="30" ${pageSize === 30 ? "selected" : ""}>30개</option>
                        <option value="50" ${pageSize === 50 ? "selected" : ""}>50개</option>
                        <option value="100" ${pageSize === 100 ? "selected" : ""}>100개</option>
                    </select>
                </div>
            </div>
        </div>`;
    host.dataset.bound = "1";
    const searchInput = document.getElementById("adminAiLogsSearchInput");
    if (searchInput) {
        searchInput.addEventListener("input", function adminAiLogsSearchInputHandler() {
            adminAiApiLogsSearchRaw = this.value;
            adminAiApiLogsPage = 1;
            renderAdminAiApiLogsList();
        });
    }
}

function syncAdminAiApiLogsToolbarFromState() {
    const f = adminAiApiLogsFilter;
    const filterSel = document.getElementById("adminAiLogsFilterSelect");
    if (filterSel) filterSel.value = f;
    const pageSize = getAdminAiApiLogsResolvedPageSize();
    const psSel = document.getElementById("adminAiLogsPageSizeSelect");
    if (psSel) psSel.value = String(pageSize);
    const searchInput = document.getElementById("adminAiLogsSearchInput");
    if (searchInput && document.activeElement !== searchInput) {
        searchInput.value = adminAiApiLogsSearchRaw;
    }
}

function renderAdminAiApiLogsList() {
    const mount = document.getElementById("adminAiApiLogsList");
    const summary = document.getElementById("adminAiApiLogsSummary");
    const toolbarHost = document.getElementById("adminAiApiLogsToolbarHost");
    if (!mount || !summary) return;
    const allTotal = adminAiApiLogs.length;
    if (!allTotal) {
        summary.innerText = "요청 기록: 0건";
        if (toolbarHost) {
            toolbarHost.innerHTML = "";
            delete toolbarHost.dataset.bound;
        }
        mount.innerHTML = '<div class="text-center p-20" style="color:#94a3b8;">로그가 없습니다.</div>';
        return;
    }
    ensureAdminAiApiLogsToolbar();
    syncAdminAiApiLogsToolbarFromState();
    const filteredLogs = getAdminAiApiLogsFiltered();
    const total = filteredLogs.length;
    const pageSize = getAdminAiApiLogsResolvedPageSize();
    const totalPages = total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
    adminAiApiLogsPage = Math.min(totalPages, Math.max(1, Number(adminAiApiLogsPage) || 1));
    const startIndex = total > 0 ? (adminAiApiLogsPage - 1) * pageSize : 0;
    const endIndex = total > 0 ? Math.min(total, startIndex + pageSize) : 0;
    const pageItems = total > 0 ? filteredLogs.slice(startIndex, endIndex) : [];
    let summaryPrefix = `요청 기록: ${total}건`;
    if (total !== allTotal) summaryPrefix += ` (전체 ${allTotal}건 중)`;
    summary.innerText = `${summaryPrefix} (표시 ${total > 0 ? startIndex + 1 : 0}~${endIndex}, 페이지 ${adminAiApiLogsPage}/${totalPages})`;
    const tableBlock =
        total > 0
            ? `<table class="admin-ai-logs-table">
            <thead>
                <tr>
                    <th style="width:170px;">요청시각</th>
                    <th style="width:120px;">구분</th>
                    <th>요청 제목</th>
                    <th style="width:110px;">결과</th>
                </tr>
            </thead>
            <tbody>
                ${pageItems
                    .map((log) => {
                        const title = escapeHtml(String(log.title || "(제목 없음)"));
                        const board = escapeHtml(resolveAiApiLogDisplayLabel(log.boardType));
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
        </table>`
            : '<div class="text-center p-20" style="color:#94a3b8;">조건에 맞는 로그가 없습니다.</div>';
    const paginationBlock =
        total > 0
            ? `<div class="admin-ai-logs-pagination">
            <button type="button" class="btn btn-outline admin-ai-logs-page-btn" onclick="goAdminAiApiLogPage(1)" ${adminAiApiLogsPage <= 1 ? "disabled" : ""}>처음</button>
            <button type="button" class="btn btn-outline admin-ai-logs-page-btn" onclick="goAdminAiApiLogPage(${adminAiApiLogsPage - 1})" ${adminAiApiLogsPage <= 1 ? "disabled" : ""}>이전</button>
            <span class="admin-ai-logs-page-status">${adminAiApiLogsPage} / ${totalPages}</span>
            <button type="button" class="btn btn-outline admin-ai-logs-page-btn" onclick="goAdminAiApiLogPage(${adminAiApiLogsPage + 1})" ${adminAiApiLogsPage >= totalPages ? "disabled" : ""}>다음</button>
            <button type="button" class="btn btn-outline admin-ai-logs-page-btn" onclick="goAdminAiApiLogPage(${totalPages})" ${adminAiApiLogsPage >= totalPages ? "disabled" : ""}>마지막</button>
        </div>`
            : "";
    mount.innerHTML = `${tableBlock}${paginationBlock}`;
}

function changeAdminAiApiLogPageSize(value) {
    const next = Number(value);
    adminAiApiLogsPageSize = [10, 30, 50, 100].includes(next) ? next : 10;
    adminAiApiLogsPage = 1;
    renderAdminAiApiLogsList();
}

function goAdminAiApiLogPage(page) {
    const filteredLen = getAdminAiApiLogsFiltered().length;
    const totalPages =
        filteredLen > 0 ? Math.max(1, Math.ceil(filteredLen / Math.max(1, Number(adminAiApiLogsPageSize) || 10))) : 1;
    adminAiApiLogsPage = Math.min(totalPages, Math.max(1, Number(page) || 1));
    renderAdminAiApiLogsList();
}

async function loadAdminAiApiLogsView() {
    try {
        const data = await fetchJson("/api/db/ai-api-logs");
        adminAiApiLogs = Array.isArray(data && data.logs) ? data.logs : [];
        adminAiApiLogsPage = 1;
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
            adminAiApiLogsPage = 1;
            adminAiApiLogsFilter = "all";
            adminAiApiLogsSearchRaw = "";
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
        return { boardType, boardLabel: "IT문의", settingsLabel: "AI답변 설정(IT)", isChat: false };
    }
    if (boardType === "BIZ") {
        return { boardType, boardLabel: "규정문의", settingsLabel: "AI답변 설정(규정/상품)", isChat: false };
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

function closeAdminAiHelpModal() {}

function openAdminAiHelpModal() {}
window.exportAdminRagKeywordBlocklist = exportAdminRagKeywordBlocklist;
window.importAdminRagKeywordBlocklist = importAdminRagKeywordBlocklist;
window.handleAdminRagKeywordImport = handleAdminRagKeywordImport;
window.openAdminAiHelpModal = openAdminAiHelpModal;
window.closeAdminAiHelpModal = closeAdminAiHelpModal;
window.copyAdminAiApiLogDetail = copyAdminAiApiLogDetail;
window.changeAdminAiApiLogPageSize = changeAdminAiApiLogPageSize;
window.goAdminAiApiLogPage = goAdminAiApiLogPage;
window.setAdminAiApiLogsFilter = setAdminAiApiLogsFilter;
window.setAdminAiApiLogsSearch = setAdminAiApiLogsSearch;
window.deleteSignupUserFromAdmin = deleteSignupUserFromAdmin;
window.resetAdminAiSettingsToDefault = resetAdminAiSettingsToDefault;
window.openAdminAiSettingsHistoryModal = openAdminAiSettingsHistoryModal;
window.closeAdminAiSettingsHistoryModal = closeAdminAiSettingsHistoryModal;
window.restoreAdminAiSettingsVersion = restoreAdminAiSettingsVersion;
