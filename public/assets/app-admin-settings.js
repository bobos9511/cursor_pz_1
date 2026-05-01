"use strict";

const ADMIN_AI_POST_KEYS = ["IT", "BIZ"];
let adminAiPostTabsInited = false;
let adminAiGenWired = false;
let adminSettingsMainTabsInited = false;

function clampAdminAiGen01(v) {
    const n = Math.round(Number(v) * 10) / 10;
    if (!Number.isFinite(n)) return 0.1;
    return Math.min(1, Math.max(0, n));
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
    const key = tab === "perms" ? "perms" : "ai";
    document.querySelectorAll(".admin-main-tab-btn").forEach((b) => {
        const on = b.getAttribute("data-admin-tab") === key;
        b.classList.toggle("btn-primary", on);
        b.classList.toggle("btn-outline", !on);
    });
    const aiPanel = document.getElementById("admin-settings-panel-ai");
    const permPanel = document.getElementById("admin-settings-panel-perms");
    if (aiPanel) aiPanel.classList.toggle("hidden", key !== "ai");
    if (permPanel) permPanel.classList.toggle("hidden", key !== "perms");
}

function toggleSignupUserAdminFlag(empNo, checked) {
    const u = signupUsers.find((x) => String(x.employeeNo) === String(empNo));
    if (!u) return;
    u.isAdmin = !!checked;
}

function renderAdminPermissionsPanel() {
    const mount = document.getElementById("adminPermissionsMount");
    if (!mount) return;
    if (!signupUsers.length) {
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
                    ${signupUsers
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
