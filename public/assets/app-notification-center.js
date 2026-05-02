"use strict";

const notificationCenterState = {
    items: [],
    unreadCount: 0,
    viewMode: "time",
    levelMode: "all",
    filterDraftViewMode: "time",
    filterDraftLevelMode: "all",
    stackOpen: {},
    seq: 1,
};
const NOTIFICATION_CENTER_STORAGE_KEY = "knock-notification-center-v1";

function persistNotificationCenterState() {
    try {
        const safeItems = notificationCenterState.items.slice(0, 300).map((it) => ({
            id: String(it.id || ""),
            message: String(it.message || ""),
            type: String(it.type || "success"),
            topic: String(it.topic || "일반"),
            level: it.level === "important" ? "important" : "general",
            at: Number(it.at || Date.now()),
            atLabel: String(it.atLabel || ""),
            dateLabel: String(it.dateLabel || ""),
            timeBand: String(it.timeBand || ""),
            pageKey: String(it.pageKey || "page:unknown"),
            pageLabel: String(it.pageLabel || "기타"),
            isRead: !!it.isRead,
            hasAction: false,
            onClick: null,
            actionText: String(it.actionText || "바로가기"),
        }));
        localStorage.setItem(
            NOTIFICATION_CENTER_STORAGE_KEY,
            JSON.stringify({
                items: safeItems,
                seq: Number(notificationCenterState.seq || 1),
                viewMode: notificationCenterState.viewMode === "topic" ? "topic" : "time",
                levelMode:
                    notificationCenterState.levelMode === "important"
                        ? "important"
                        : notificationCenterState.levelMode === "general"
                          ? "general"
                          : "all",
            })
        );
    } catch (_) {}
}

function restoreNotificationCenterState() {
    try {
        const raw = localStorage.getItem(NOTIFICATION_CENTER_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return;
        const loaded = Array.isArray(parsed.items) ? parsed.items : [];
        notificationCenterState.items = loaded
            .map((it) => ({
                id: String((it && it.id) || `noti_${Date.now()}_${Math.random().toString(16).slice(2)}`),
                message: String((it && it.message) || ""),
                type: String((it && it.type) || "success"),
                topic: String((it && it.topic) || "일반"),
                level: (it && it.level) === "important" ? "important" : "general",
                at: Number((it && it.at) || Date.now()),
                atLabel: String((it && it.atLabel) || ""),
                dateLabel: String((it && it.dateLabel) || ""),
                timeBand: String((it && it.timeBand) || ""),
                pageKey: String((it && it.pageKey) || "page:unknown"),
                pageLabel: String((it && it.pageLabel) || "기타"),
                isRead: !!(it && it.isRead),
                hasAction: false,
                onClick: null,
                actionText: String((it && it.actionText) || "바로가기"),
            }))
            .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
            .slice(0, 300);
        notificationCenterState.seq = Math.max(1, Number(parsed.seq || notificationCenterState.items.length + 1));
        notificationCenterState.viewMode = parsed.viewMode === "topic" ? "topic" : "time";
        notificationCenterState.levelMode =
            parsed.levelMode === "important" ? "important" : parsed.levelMode === "general" ? "general" : "all";
        notificationCenterState.filterDraftViewMode = notificationCenterState.viewMode;
        notificationCenterState.filterDraftLevelMode = notificationCenterState.levelMode;
        recalcNotificationUnreadCount();
    } catch (_) {}
}

function resolveNotificationTopic(message) {
    const m = String(message || "");
    if (m.includes("AI")) return "AI";
    if (m.includes("권한") || m.includes("관리자")) return "권한";
    if (m.includes("지식") || m.includes("RAG")) return "지식";
    if (m.includes("설정")) return "설정";
    if (m.includes("오류") || m.includes("실패")) return "오류";
    if (m.includes("문의") || m.includes("게시물")) return "게시물";
    return "일반";
}

function resolveNoticeLevel(message, type, options = {}) {
    if (options.noticeLevel === "important" || options.noticeLevel === "general") return options.noticeLevel;
    const msg = String(message || "");
    const t = String(type || "");
    // 기본 규칙: 오류/실패는 중요, 그 외는 일반
    if (t === "error" || msg.includes("오류") || msg.includes("실패")) return "important";
    return "general";
}

function resolveTimeBand(d) {
    const h = d.getHours();
    if (h < 6) return "야간";
    if (h < 12) return "오전";
    if (h < 18) return "오후";
    return "야간";
}

function fmtDateTime(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}.${m}.${day} ${hh}:${mm}`;
}

function updateNotificationBadge() {
    const badge = document.getElementById("headerNotificationBadge");
    const modal = document.getElementById("notificationCenterModal");
    if (!badge) return;
    if (modal && modal.classList.contains("active")) {
        badge.classList.add("hidden");
        return;
    }
    const n = Number(notificationCenterState.unreadCount || 0);
    if (n <= 0) {
        badge.classList.add("hidden");
        return;
    }
    badge.classList.remove("hidden");
    badge.textContent = String(Math.min(n, 99));
}

function recalcNotificationUnreadCount() {
    notificationCenterState.unreadCount = notificationCenterState.items.filter((it) => !it.isRead).length;
}

function getNotificationActiveFilterCount() {
    let count = 0;
    if (notificationCenterState.viewMode !== "time") count += 1;
    if (notificationCenterState.levelMode !== "all") count += 1;
    return count;
}

function updateNotificationFilterButton() {
    const btn = document.getElementById("notiFilterBtn");
    if (!btn) return;
    const active = getNotificationActiveFilterCount();
    btn.innerHTML =
        active > 0
            ? `<svg class="icon"><use href="#icon-cog"></use></svg> 필터 (${active})`
            : `<svg class="icon"><use href="#icon-cog"></use></svg> 필터`;
}

function syncNotificationFilterModalButtons() {
    const viewTime = document.getElementById("notiFilterViewTime");
    const viewTopic = document.getElementById("notiFilterViewTopic");
    if (viewTime && viewTopic) {
        const timeOn = notificationCenterState.filterDraftViewMode === "time";
        viewTime.classList.toggle("btn-primary", timeOn);
        viewTime.classList.toggle("btn-outline", !timeOn);
        viewTopic.classList.toggle("btn-primary", !timeOn);
        viewTopic.classList.toggle("btn-outline", timeOn);
    }
    const all = document.getElementById("notiFilterLevelAll");
    const imp = document.getElementById("notiFilterLevelImportant");
    const gen = document.getElementById("notiFilterLevelGeneral");
    if (all && imp && gen) {
        const allOn = notificationCenterState.filterDraftLevelMode === "all";
        const impOn = notificationCenterState.filterDraftLevelMode === "important";
        const genOn = notificationCenterState.filterDraftLevelMode === "general";
        all.classList.toggle("btn-primary", allOn);
        all.classList.toggle("btn-outline", !allOn);
        imp.classList.toggle("btn-primary", impOn);
        imp.classList.toggle("btn-outline", !impOn);
        gen.classList.toggle("btn-primary", genOn);
        gen.classList.toggle("btn-outline", !genOn);
    }
}

function makeSafePageSlug(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9\-_.:]/g, "")
        .trim();
}

function prettifyViewId(viewId) {
    const raw = String(viewId || "").replace(/^view-/, "").trim();
    if (!raw) return "기타";
    return raw
        .split("-")
        .map((v) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : ""))
        .join(" ");
}

function getCurrentPageContextFallback() {
    const active = document.querySelector(".view-section.active");
    const viewId = active && active.id ? String(active.id).replace(/^view-/, "") : "";
    if (!viewId) return { pageKey: "page:unknown", pageLabel: "기타" };
    if (viewId === "list") {
        const board = typeof currentBoardType !== "undefined" ? String(currentBoardType || "") : "";
        const navText =
            (document.getElementById(`nav-list-${board.toLowerCase()}`) || document.getElementById(`topnav-list-${board.toLowerCase()}`))
                ?.innerText || "";
        const pageLabel = navText.trim() || `게시판 ${board || ""}`.trim();
        return { pageKey: `page:list:${board || "all"}`.toLowerCase(), pageLabel };
    }
    return { pageKey: `page:${makeSafePageSlug(viewId) || "unknown"}`, pageLabel: prettifyViewId(viewId) };
}

function resolvePageContextFromMessage(message, fallback) {
    const msg = String(message || "");
    const boardRefMatch = msg.match(/^\[([^\]#]+)\s*#\d+\]/);
    if (boardRefMatch && boardRefMatch[1]) {
        const label = boardRefMatch[1].trim();
        return { pageKey: `page:board:${makeSafePageSlug(label) || "unknown"}`, pageLabel: label };
    }
    return fallback;
}

function clusterNotificationItems(list) {
    const order = [];
    const byKey = new Map();
    list.forEach((it) => {
        const key = String(it.pageKey || "page:unknown");
        if (!byKey.has(key)) {
            byKey.set(key, { key, pageLabel: String(it.pageLabel || "기타"), items: [] });
            order.push(key);
        }
        byKey.get(key).items.push(it);
    });
    return order.map((k) => byKey.get(k));
}

function formatNotificationGroupTitle(label) {
    const base = String(label || "").trim() || "기타";
    if (base.endsWith("알림")) return base;
    return `${base} 관련 알림`;
}

function resolveNotificationSourceLabel(it) {
    const pageLabel = String((it && it.pageLabel) || "").trim();
    const pageKey = String((it && it.pageKey) || "").toLowerCase();
    if (pageLabel.includes("AI Chat") || pageLabel.includes("AI채팅") || pageKey.includes("ai-search")) return "AI채팅";
    if (pageLabel.includes("AI 지식") || pageKey.includes("know")) return "AI지식베이스";
    if (pageLabel.includes("대시보드") || pageKey.includes("dashboard")) return "대시보드";
    if (pageLabel.includes("설정") || pageKey.includes("settings")) return "설정";
    if (pageLabel.includes("게시판") || pageKey.includes("list")) return "게시판";
    if (pageLabel) return pageLabel;
    return "일반";
}

function renderNotificationItemCard(it, options = {}) {
    const compact = !!options.compact;
    const readClass = it.isRead ? "noti-item-read" : "noti-item-unread";
    const sourceLabel = resolveNotificationSourceLabel(it);
    const readChip = it.isRead
        ? '<span class="noti-topic-chip noti-status-chip">확인됨</span>'
        : '<span class="noti-topic-chip important noti-status-chip">신규</span>';
    const sourceChip = `<span class="noti-topic-chip noti-source-chip">${escapeHtml(sourceLabel)}</span>`;
    const levelTopicChip = `<span class="noti-topic-chip ${it.level === "important" ? "important" : ""}">${it.level === "important" ? "중요" : "일반"} · ${escapeHtml(it.topic)}</span>`;
    const actionBtn = it.hasAction
        ? `<button class="btn btn-outline" style="padding:5px 10px; font-size:12px;" onclick="runNotificationAction('${it.id}')">${escapeHtml(it.actionText || "바로가기")}</button>`
        : "";
    return `
        <div class="noti-item ${readClass}${compact ? " noti-item-compact" : ""}">
            <div class="noti-item-top">
                <div class="noti-item-meta">${escapeHtml(it.atLabel)}</div>
                <div class="noti-item-source-row">
                    ${sourceChip}
                    ${readChip}
                    ${levelTopicChip}
                </div>
            </div>
            <div class="noti-item-msg">${escapeHtml(it.message).replace(/\n/g, "<br>")}</div>
            <div class="noti-item-actions">
                ${actionBtn}
                <button class="btn btn-outline" style="padding:5px 10px; font-size:12px;" onclick="deleteNotificationItem('${it.id}')">삭제</button>
            </div>
        </div>
    `;
}

function renderNotificationStack(cluster) {
    const stackId = String(cluster.items[0] && cluster.items[0].id ? cluster.items[0].id : cluster.key);
    const expanded = !!notificationCenterState.stackOpen[stackId];
    const latest = cluster.items[0];
    return `
        <div class="noti-stack ${expanded ? "expanded" : ""}">
            <button type="button" class="noti-stack-head" onclick="toggleNotificationStack('${stackId}')">
                <div class="noti-stack-head-left">
                    <span class="noti-stack-icon-wrap" aria-hidden="true">
                        <svg class="icon"><use href="#icon-list"></use></svg>
                    </span>
                    <div class="noti-stack-head-text">
                        <span class="noti-stack-title">${escapeHtml(formatNotificationGroupTitle(cluster.pageLabel || latest.pageLabel || latest.topic || "알림"))}</span>
                        <span class="noti-stack-count">${cluster.items.length}건 모아보기</span>
                    </div>
                </div>
                <span class="noti-stack-toggle" title="${expanded ? "접기" : "펼치기"}">
                    <svg class="icon"><use href="#icon-chevron-down"></use></svg>
                </span>
            </button>
            <div class="noti-stack-body">
                ${cluster.items.map((it) => renderNotificationItemCard(it, { compact: true })).join("")}
            </div>
        </div>
    `;
}

function toggleNotificationStack(stackId) {
    const key = String(stackId || "");
    if (!key) return;
    notificationCenterState.stackOpen[key] = !notificationCenterState.stackOpen[key];
    renderNotificationCenterBody();
}

function sortNotificationsByTimeDesc(arr) {
    return [...arr].sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
}

/** 시간/토픽 탭 기준 그룹 HTML (미확인·확인 구역 공통) */
function buildNotificationGroupedRows(list) {
    const groups = new Map();
    list.forEach((it) => {
        const key = notificationCenterState.viewMode === "topic" ? it.topic : `${it.dateLabel} · ${it.timeBand}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
    });
    return Array.from(groups.entries())
        .map(([groupKey, grouped]) => {
            const rows = clusterNotificationItems(grouped)
                .map((cluster) => {
                    if (!cluster || !Array.isArray(cluster.items) || cluster.items.length === 0) return "";
                    if (cluster.items.length === 1) return renderNotificationItemCard(cluster.items[0]);
                    return renderNotificationStack(cluster);
                })
                .join("");
            return `<div class="noti-group"><div class="noti-group-title">${escapeHtml(groupKey)}</div>${rows}</div>`;
        })
        .join("");
}

function renderNotificationCenterBody() {
    const body = document.getElementById("notificationCenterBody");
    if (!body) return;
    const items = notificationCenterState.items.filter((it) => {
        if (notificationCenterState.levelMode === "important") return it.level === "important";
        if (notificationCenterState.levelMode === "general") return it.level !== "important";
        return true;
    });
    if (!items.length) {
        body.innerHTML = '<div class="noti-empty">표시할 알림이 없습니다.</div>';
        return;
    }

    const unreadList = sortNotificationsByTimeDesc(items.filter((it) => !it.isRead));
    const readList = sortNotificationsByTimeDesc(items.filter((it) => it.isRead));

    const sections = [];
    if (unreadList.length) {
        sections.push(
            `<div class="noti-section noti-section-unread" role="region" aria-label="미확인 알림">
                <div class="noti-section-bundled">
                    <div class="noti-section-head">
                        <span class="noti-section-label">미확인 알림</span>
                        <span class="noti-section-count">${unreadList.length}</span>
                    </div>
                    <div class="noti-section-content">
                        ${buildNotificationGroupedRows(unreadList)}
                    </div>
                </div>
            </div>`
        );
    }
    if (readList.length) {
        sections.push(
            `<div class="noti-section noti-section-read" role="region" aria-label="확인한 알림">
                <div class="noti-section-bundled">
                    <div class="noti-section-head">
                        <span class="noti-section-label">확인한 알림</span>
                        <span class="noti-section-count">${readList.length}</span>
                    </div>
                    <div class="noti-section-content">
                        ${buildNotificationGroupedRows(readList)}
                    </div>
                </div>
            </div>`
        );
    }

    body.innerHTML = sections.length ? sections.join("") : '<div class="noti-empty">표시할 알림이 없습니다.</div>';
}

function setNotificationViewMode(mode) {
    notificationCenterState.viewMode = mode === "topic" ? "topic" : "time";
    const t1 = document.getElementById("notiTabTime");
    const t2 = document.getElementById("notiTabTopic");
    if (t1 && t2) {
        const timeOn = notificationCenterState.viewMode === "time";
        t1.classList.toggle("btn-primary", timeOn);
        t1.classList.toggle("btn-outline", !timeOn);
        t2.classList.toggle("btn-primary", !timeOn);
        t2.classList.toggle("btn-outline", timeOn);
    }
    updateNotificationFilterButton();
    renderNotificationCenterBody();
    persistNotificationCenterState();
}

function setNotificationLevelMode(mode) {
    notificationCenterState.levelMode = mode === "important" ? "important" : mode === "general" ? "general" : "all";
    const a = document.getElementById("notiLevelAll");
    const i = document.getElementById("notiLevelImportant");
    const g = document.getElementById("notiLevelGeneral");
    if (a && i && g) {
        const allOn = notificationCenterState.levelMode === "all";
        const impOn = notificationCenterState.levelMode === "important";
        const genOn = notificationCenterState.levelMode === "general";
        a.classList.toggle("btn-primary", allOn);
        a.classList.toggle("btn-outline", !allOn);
        i.classList.toggle("btn-primary", impOn);
        i.classList.toggle("btn-outline", !impOn);
        g.classList.toggle("btn-primary", genOn);
        g.classList.toggle("btn-outline", !genOn);
    }
    updateNotificationFilterButton();
    renderNotificationCenterBody();
    persistNotificationCenterState();
}

function openNotificationFilterModal() {
    notificationCenterState.filterDraftViewMode = notificationCenterState.viewMode;
    notificationCenterState.filterDraftLevelMode = notificationCenterState.levelMode;
    syncNotificationFilterModalButtons();
    const modal = document.getElementById("notificationFilterModal");
    if (modal) modal.classList.add("active");
}

function closeNotificationFilterModal() {
    const modal = document.getElementById("notificationFilterModal");
    if (modal) modal.classList.remove("active");
}

function setNotificationFilterViewMode(mode) {
    notificationCenterState.filterDraftViewMode = mode === "topic" ? "topic" : "time";
    syncNotificationFilterModalButtons();
}

function setNotificationFilterLevelMode(mode) {
    notificationCenterState.filterDraftLevelMode =
        mode === "important" ? "important" : mode === "general" ? "general" : "all";
    syncNotificationFilterModalButtons();
}

function applyNotificationFilters() {
    setNotificationViewMode(notificationCenterState.filterDraftViewMode);
    setNotificationLevelMode(notificationCenterState.filterDraftLevelMode);
    closeNotificationFilterModal();
}

function resetNotificationFilters() {
    notificationCenterState.filterDraftViewMode = "time";
    notificationCenterState.filterDraftLevelMode = "all";
    setNotificationViewMode("time");
    setNotificationLevelMode("all");
    syncNotificationFilterModalButtons();
}

function openNotificationCenter() {
    const modal = document.getElementById("notificationCenterModal");
    if (!modal) return;
    modal.classList.add("active");
    renderNotificationCenterBody();
    updateNotificationBadge();
    updateNotificationFilterButton();
}

function closeNotificationCenter() {
    const modal = document.getElementById("notificationCenterModal");
    if (modal) modal.classList.remove("active");
    closeNotificationFilterModal();
    notificationCenterState.items.forEach((it) => {
        it.isRead = true;
    });
    recalcNotificationUnreadCount();
    updateNotificationBadge();
    persistNotificationCenterState();
}

function deleteNotificationItem(id) {
    notificationCenterState.items = notificationCenterState.items.filter((it) => String(it.id) !== String(id));
    recalcNotificationUnreadCount();
    updateNotificationBadge();
    renderNotificationCenterBody();
    persistNotificationCenterState();
}

function clearAllNotifications() {
    if (!notificationCenterState.items.length) return;
    showConfirm("알림을 모두 삭제하시겠습니까?", () => {
        notificationCenterState.items = [];
        notificationCenterState.unreadCount = 0;
        updateNotificationBadge();
        renderNotificationCenterBody();
        persistNotificationCenterState();
    });
}

function runNotificationAction(id) {
    const it = notificationCenterState.items.find((x) => String(x.id) === String(id));
    if (!it || typeof it.onClick !== "function") return;
    it.onClick();
}

window.recordNotificationEntry = function recordNotificationEntry(message, type = "success", options = {}) {
    const now = new Date();
    const id = `noti_${Date.now()}_${notificationCenterState.seq++}`;
    const fallbackPage = getCurrentPageContextFallback();
    const resolvedPage = resolvePageContextFromMessage(message, fallbackPage);
    const pageKey = String(options.pageKey || resolvedPage.pageKey || fallbackPage.pageKey || "page:unknown");
    const pageLabel = String(options.pageLabel || resolvedPage.pageLabel || fallbackPage.pageLabel || "기타");
    const item = {
        id,
        message: String(message || ""),
        type: String(type || "success"),
        topic: resolveNotificationTopic(message),
        level: resolveNoticeLevel(message, type, options),
        at: now.getTime(),
        atLabel: fmtDateTime(now),
        dateLabel: now.toLocaleDateString("ko-KR"),
        timeBand: resolveTimeBand(now),
        pageKey,
        pageLabel,
        isRead: false,
        hasAction: typeof options.onClick === "function",
        onClick: typeof options.onClick === "function" ? options.onClick : null,
        actionText: options.actionText || "바로가기",
    };
    notificationCenterState.items.unshift(item); // 최근 알림 상단
    notificationCenterState.items = notificationCenterState.items.slice(0, 300);
    recalcNotificationUnreadCount();
    updateNotificationBadge();
    persistNotificationCenterState();
};

restoreNotificationCenterState();
updateNotificationBadge();

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        closeNotificationFilterModal();
        closeNotificationCenter();
    }
});
