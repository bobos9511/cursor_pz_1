"use strict";

const notificationCenterState = {
    items: [],
    unreadCount: 0,
    viewMode: "time",
    levelMode: "all",
    filterDraftViewMode: "time",
    filterDraftLevelMode: "all",
    stackOpen: {},
    /** 미확인(unread) · 확인(read) 알림 구역 펼침 상태 */
    sectionExpanded: { unread: true, read: true },
    seq: 1,
};
const NOTIFICATION_CENTER_STORAGE_KEY = "knock-notification-center-v1";
const NOTIFICATION_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
let notificationSyncTimer = null;
let notificationServerLoaded = false;
/** 모바일 알림 전체화면 진입 직전 화면 복귀용 { viewId, boardType?, postId? } */
let notificationCenterReturnRoute = null;
let notificationCenterResizeTimer = null;

function pruneNotificationRetention(items, now = Date.now()) {
    const minAt = now - NOTIFICATION_RETENTION_MS;
    return (Array.isArray(items) ? items : []).filter((it) => Number(it && it.at) >= minAt);
}

function getNotificationScopeFromCookie() {
    const src = String((typeof document !== "undefined" && document.cookie) || "");
    if (!src) return "guest";
    const parts = src.split(";");
    for (const part of parts) {
        const idx = part.indexOf("=");
        if (idx <= 0) continue;
        const key = decodeURIComponent(part.slice(0, idx).trim());
        if (key !== "knockUserScope") continue;
        const value = decodeURIComponent(part.slice(idx + 1).trim());
        return value || "guest";
    }
    return "guest";
}

function sanitizeNotificationItemsForTransport(items) {
    return pruneNotificationRetention(items)
        .slice(0, 300)
        .map((it) => {
            const ak = String(it.actionKind || "").trim().slice(0, 40);
            const ae = String(it.actionEmpNo || "")
                .trim()
                .slice(0, 32)
                .replace(/[^0-9A-Za-z]/g, "");
            const o = {
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
                actionText: String(it.actionText || "바로가기"),
            };
            if (ak === "adminPermRequest" && ae) {
                o.actionKind = "adminPermRequest";
                o.actionEmpNo = ae;
            }
            return o;
        });
}

function hydrateNotificationItemFromTransport(it) {
    const base = { ...it };
    if (it.actionKind === "adminPermRequest" && it.actionEmpNo) {
        const emp = String(it.actionEmpNo);
        base.hasAction = true;
        base.actionText = String(it.actionText || "권한 부여로 이동");
        base.onClick = () => {
            if (typeof window.navigateAdminPermHighlight === "function") window.navigateAdminPermHighlight(emp);
        };
    } else {
        base.hasAction = !!it.hasAction && typeof it.onClick === "function";
        base.onClick = typeof it.onClick === "function" ? it.onClick : null;
    }
    return base;
}

async function loadNotificationCenterStateFromServer() {
    const scope = getNotificationScopeFromCookie();
    if (!scope || scope === "guest") return;
    try {
        const res = await fetch(`/api/db/notifications?scope=${encodeURIComponent(scope)}`);
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        const loaded = sanitizeNotificationItemsForTransport(data && data.items);
        if (!loaded.length) {
            notificationServerLoaded = true;
            return;
        }
        notificationCenterState.items = loaded
            .map((it) => hydrateNotificationItemFromTransport(it))
            .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
            .slice(0, 300);
        recalcNotificationUnreadCount();
        updateNotificationBadge();
        renderNotificationCenterBody();
        notificationServerLoaded = true;
    } catch (_) {}
}

async function flushNotificationCenterStateToServer() {
    const scope = getNotificationScopeFromCookie();
    if (!scope || scope === "guest") return;
    try {
        await fetch(`/api/db/notifications?scope=${encodeURIComponent(scope)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: sanitizeNotificationItemsForTransport(notificationCenterState.items) }),
        });
    } catch (_) {}
}

function scheduleNotificationCenterSync() {
    if (notificationSyncTimer) clearTimeout(notificationSyncTimer);
    notificationSyncTimer = setTimeout(() => {
        notificationSyncTimer = null;
        void flushNotificationCenterStateToServer();
    }, 250);
}

function persistNotificationCenterState() {
    try {
        const sanitized = sanitizeNotificationItemsForTransport(notificationCenterState.items);
        notificationCenterState.items = sanitized.map((it) => hydrateNotificationItemFromTransport(it));
        const safeItems = notificationCenterState.items.slice(0, 300);
        const se = notificationCenterState.sectionExpanded || { unread: true, read: true };
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
                sectionExpanded: {
                    unread: se.unread !== false,
                    read: se.read !== false,
                },
            })
        );
    } catch (_) {}
    if (notificationServerLoaded) scheduleNotificationCenterSync();
}

function restoreNotificationCenterState() {
    try {
        const raw = localStorage.getItem(NOTIFICATION_CENTER_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return;
        const loaded = Array.isArray(parsed.items) ? parsed.items : [];
        notificationCenterState.items = pruneNotificationRetention(loaded)
            .map((it) => {
                const raw = {
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
                    actionText: String((it && it.actionText) || "바로가기"),
                };
                const ak = String((it && it.actionKind) || "").trim();
                const ae = String((it && it.actionEmpNo) || "")
                    .trim()
                    .slice(0, 32)
                    .replace(/[^0-9A-Za-z]/g, "");
                if (ak === "adminPermRequest" && ae) {
                    raw.actionKind = "adminPermRequest";
                    raw.actionEmpNo = ae;
                }
                return hydrateNotificationItemFromTransport(raw);
            })
            .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
            .slice(0, 300);
        notificationCenterState.seq = Math.max(1, Number(parsed.seq || notificationCenterState.items.length + 1));
        notificationCenterState.viewMode = parsed.viewMode === "topic" ? "topic" : "time";
        notificationCenterState.levelMode =
            parsed.levelMode === "important" ? "important" : parsed.levelMode === "general" ? "general" : "all";
        notificationCenterState.filterDraftViewMode = notificationCenterState.viewMode;
        notificationCenterState.filterDraftLevelMode = notificationCenterState.levelMode;
        const se = parsed.sectionExpanded;
        if (se && typeof se === "object") {
            notificationCenterState.sectionExpanded = {
                unread: se.unread !== false,
                read: se.read !== false,
            };
        } else {
            notificationCenterState.sectionExpanded = { unread: true, read: true };
        }
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
    const mobBadge = document.getElementById("mobileHeaderNotificationBadge");
    const hide = isNotificationCenterUiOpen() || Number(notificationCenterState.unreadCount || 0) <= 0;
    const n = Number(notificationCenterState.unreadCount || 0);
    const text = String(Math.min(n, 99));
    [badge, mobBadge].forEach((el) => {
        if (!el) return;
        if (hide) {
            el.classList.add("hidden");
            return;
        }
        el.classList.remove("hidden");
        el.textContent = text;
    });
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
    const active = getNotificationActiveFilterCount();
    const html =
        active > 0
            ? `<svg class="icon" aria-hidden="true"><use href="#icon-cog"></use></svg> 필터 (${active})`
            : `<svg class="icon" aria-hidden="true"><use href="#icon-cog"></use></svg> 필터`;
    document.querySelectorAll(".js-noti-filter-btn").forEach((btn) => {
        btn.innerHTML = html;
    });
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
            (document.getElementById(`nav-list-${board.toLowerCase()}`) || document.getElementById(`mbnav-list-${board.toLowerCase()}`))
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

/** 세션·접속 등 동일 출처 모아보기용 클러스터 키 (저장된 pageKey보다 메시지 휴리스틱 우선) */
function resolveNotificationClusterKey(it) {
    const pk = String((it && it.pageKey) || "").toLowerCase();
    if (pk === "page:session") return { pageKey: "page:session", pageLabel: "세션" };
    const msg = String((it && it.message) || "");
    if (
        /세션/.test(msg) ||
        /자동\s*로그아웃|로그아웃까지/.test(msg) ||
        /다른\s*브라우저|기기에서\s*이미\s*접속|접속\s*전환/.test(msg) ||
        /서버로부터\s*세션/.test(msg)
    ) {
        return { pageKey: "page:session", pageLabel: "세션" };
    }
    return {
        pageKey: String((it && it.pageKey) || "page:unknown"),
        pageLabel: String((it && it.pageLabel) || "기타"),
    };
}

function clusterNotificationItems(list) {
    const order = [];
    const byKey = new Map();
    list.forEach((it) => {
        const meta = resolveNotificationClusterKey(it);
        const key = meta.pageKey;
        if (!byKey.has(key)) {
            byKey.set(key, { key, pageLabel: meta.pageLabel, items: [] });
            order.push(key);
        } else if (meta.pageLabel && meta.pageLabel !== "기타") {
            const bucket = byKey.get(key);
            if (!bucket.pageLabel || bucket.pageLabel === "기타") bucket.pageLabel = meta.pageLabel;
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
    if (pageKey === "page:session" || pageLabel.includes("세션")) return "세션";
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
    const singleClass = !compact && options.single ? " noti-item--single" : "";
    const readClass = it.isRead ? "noti-item-read" : "noti-item-unread";
    const sourceLabel = resolveNotificationSourceLabel(it);
    const readChip = it.isRead
        ? '<span class="noti-topic-chip noti-status-chip">확인됨</span>'
        : '<span class="noti-topic-chip important noti-status-chip">신규</span>';
    const sourceChip = `<span class="noti-topic-chip noti-source-chip">${escapeHtml(sourceLabel)}</span>`;
    const levelTopicChip = `<span class="noti-topic-chip ${it.level === "important" ? "important" : ""}">${it.level === "important" ? "중요" : "일반"} · ${escapeHtml(it.topic)}</span>`;
    const actionBtn = it.hasAction
        ? `<button type="button" class="btn btn-outline noti-item-cta" onclick="runNotificationAction('${it.id}')">${escapeHtml(it.actionText || "바로가기")}</button>`
        : "";
    if (compact) {
        const kickerParts = [sourceLabel, it.topic];
        if (it.level === "important") kickerParts.push("중요");
        if (!it.isRead) kickerParts.push("미확인");
        const kicker = kickerParts.map((p) => escapeHtml(String(p))).join(" · ");
        return `
        <div class="noti-item ${readClass} noti-item-compact">
            <div class="noti-item-compact-head">
                <span class="noti-item-meta">${escapeHtml(it.atLabel)}</span>
                <button type="button" class="noti-item-del" onclick="deleteNotificationItem('${it.id}')">삭제</button>
            </div>
            <div class="noti-item-kicker">${kicker}</div>
            <div class="noti-item-msg">${escapeHtml(it.message).replace(/\n/g, "<br>")}</div>
            ${it.hasAction ? `<div class="noti-item-actions noti-item-actions--compact">${actionBtn}</div>` : ""}
        </div>`;
    }
    return `
        <div class="noti-item ${readClass}${singleClass}">
            <div class="noti-item-top">
                <div class="noti-item-meta">
                    <span class="noti-item-kind noti-item-kind--single">개별 알림</span>
                    <span class="noti-item-meta-time">${escapeHtml(it.atLabel)}</span>
                </div>
                <div class="noti-item-source-row">
                    ${sourceChip}
                    ${readChip}
                    ${levelTopicChip}
                </div>
            </div>
            <div class="noti-item-msg">${escapeHtml(it.message).replace(/\n/g, "<br>")}</div>
            <div class="noti-item-actions">
                ${actionBtn}
                <button type="button" class="btn btn-outline noti-item-cta" onclick="deleteNotificationItem('${it.id}')">삭제</button>
            </div>
        </div>
    `;
}

function renderNotificationStack(cluster) {
    const stackId = String(cluster.items[0] && cluster.items[0].id ? cluster.items[0].id : cluster.key);
    const expanded = !!notificationCenterState.stackOpen[stackId];
    const latest = cluster.items[0];
    const n = cluster.items.length;
    return `
        <div class="noti-stack ${expanded ? "expanded" : ""}">
            <button type="button" class="noti-stack-head" onclick="toggleNotificationStack('${stackId}')" aria-expanded="${expanded}" title="${expanded ? "접기" : "펼치기"}">
                <div class="noti-stack-head-main">
                    <span class="noti-stack-kind-badge">동일 출처 묶음</span>
                    <span class="noti-stack-title">${escapeHtml(formatNotificationGroupTitle(cluster.pageLabel || latest.pageLabel || latest.topic || "알림"))}</span>
                    <span class="noti-stack-sub">${n}건</span>
                </div>
                <span class="noti-stack-toggle" aria-hidden="true">
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

function toggleNotificationSection(sectionKey) {
    const k = String(sectionKey || "");
    if (k !== "unread" && k !== "read") return;
    if (!notificationCenterState.sectionExpanded || typeof notificationCenterState.sectionExpanded !== "object") {
        notificationCenterState.sectionExpanded = { unread: true, read: true };
    }
    notificationCenterState.sectionExpanded[k] = !notificationCenterState.sectionExpanded[k];
    renderNotificationCenterBody();
    persistNotificationCenterState();
}

window.toggleNotificationSection = toggleNotificationSection;

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
                    if (cluster.items.length === 1) return renderNotificationItemCard(cluster.items[0], { single: true });
                    return renderNotificationStack(cluster);
                })
                .join("");
            return `<div class="noti-group"><div class="noti-group-title">${escapeHtml(groupKey)}</div>${rows}</div>`;
        })
        .join("");
}

function isNotificationCenterUiOpen() {
    const modal = document.getElementById("notificationCenterModal");
    const page = document.getElementById("view-notifications");
    return !!(modal && modal.classList.contains("active")) || !!(page && page.classList.contains("active"));
}

function getNotificationCenterBodyTargets() {
    const page = document.getElementById("view-notifications");
    const modal = document.getElementById("notificationCenterModal");
    if (page && page.classList.contains("active")) {
        const b = document.getElementById("notificationCenterPageBody");
        return b ? [b] : [];
    }
    if (modal && modal.classList.contains("active")) {
        const b = document.getElementById("notificationCenterBody");
        return b ? [b] : [];
    }
    const bModal = document.getElementById("notificationCenterBody");
    if (bModal) return [bModal];
    const bPage = document.getElementById("notificationCenterPageBody");
    return bPage ? [bPage] : [];
}

function renderNotificationCenterBody() {
    const bodies = getNotificationCenterBodyTargets();
    if (!bodies.length) return;
    const items = notificationCenterState.items.filter((it) => {
        if (notificationCenterState.levelMode === "important") return it.level === "important";
        if (notificationCenterState.levelMode === "general") return it.level !== "important";
        return true;
    });
    if (!items.length) {
        const emptyHtml = '<div class="noti-empty">표시할 알림이 없습니다.</div>';
        bodies.forEach((body) => {
            body.innerHTML = emptyHtml;
        });
        return;
    }

    const unreadList = sortNotificationsByTimeDesc(items.filter((it) => !it.isRead));
    const readList = sortNotificationsByTimeDesc(items.filter((it) => it.isRead));

    const exp = notificationCenterState.sectionExpanded || { unread: true, read: true };
    const unreadOpen = exp.unread !== false;
    const readOpen = exp.read !== false;

    const sections = [];
    if (unreadList.length) {
        sections.push(
            `<div class="noti-section noti-section-unread${unreadOpen ? "" : " noti-section-collapsed"}" role="region" aria-label="미확인 알림">
                <div class="noti-section-bundled">
                    <button type="button" class="noti-section-head noti-section-toggle" onclick="toggleNotificationSection('unread')" aria-expanded="${unreadOpen}" aria-controls="notiSectionUnreadBody">
                        <span class="noti-section-head-main">
                            <span class="noti-section-label">미확인 알림</span>
                            <span class="noti-section-count">${unreadList.length}</span>
                        </span>
                        <span class="noti-section-chevron" aria-hidden="true">
                            <svg class="icon"><use href="#icon-chevron-down"></use></svg>
                        </span>
                    </button>
                    <div id="notiSectionUnreadBody" class="noti-section-content">
                        ${buildNotificationGroupedRows(unreadList)}
                    </div>
                </div>
            </div>`
        );
    }
    if (readList.length) {
        sections.push(
            `<div class="noti-section noti-section-read${readOpen ? "" : " noti-section-collapsed"}" role="region" aria-label="확인한 알림">
                <div class="noti-section-bundled">
                    <button type="button" class="noti-section-head noti-section-toggle" onclick="toggleNotificationSection('read')" aria-expanded="${readOpen}" aria-controls="notiSectionReadBody">
                        <span class="noti-section-head-main">
                            <span class="noti-section-label">확인한 알림</span>
                            <span class="noti-section-count">${readList.length}</span>
                        </span>
                        <span class="noti-section-chevron" aria-hidden="true">
                            <svg class="icon"><use href="#icon-chevron-down"></use></svg>
                        </span>
                    </button>
                    <div id="notiSectionReadBody" class="noti-section-content">
                        ${buildNotificationGroupedRows(readList)}
                    </div>
                </div>
            </div>`
        );
    }

    const inner = sections.length ? sections.join("") : '<div class="noti-empty">표시할 알림이 없습니다.</div>';
    bodies.forEach((body) => {
        body.innerHTML = inner;
    });
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

function captureNotificationCenterReturnRoute() {
    notificationCenterReturnRoute = null;
    try {
        const active = document.querySelector(".view-section.active");
        if (!active || active.id === "view-notifications") return;
        if (active.id === "view-detail") {
            const postId = typeof currentPostId !== "undefined" ? currentPostId : null;
            const boardType = typeof currentBoardType !== "undefined" ? currentBoardType : null;
            if (postId != null) {
                notificationCenterReturnRoute = { viewId: "detail", boardType, postId };
            }
            return;
        }
        if (active.id === "view-list") {
            const boardType = typeof currentBoardType !== "undefined" ? currentBoardType : null;
            notificationCenterReturnRoute = { viewId: "list", boardType };
            return;
        }
        const m = /^view-(.+)$/.exec(active.id || "");
        if (m && m[1]) notificationCenterReturnRoute = { viewId: m[1], boardType: null };
    } catch (_) {
        notificationCenterReturnRoute = null;
    }
}

function restoreNotificationCenterReturnRoute() {
    const route = notificationCenterReturnRoute;
    notificationCenterReturnRoute = null;
    if (route && route.viewId === "detail" && route.postId != null && typeof openDetail === "function") {
        openDetail(route.postId, route.boardType || undefined, { skipHistory: true });
        return true;
    }
    if (route && route.viewId && typeof switchView === "function") {
        switchView(route.viewId, route.boardType || null, { skipHistory: true });
        return true;
    }
    return false;
}

function migrateNotificationPageToDesktopModal() {
    const page = document.getElementById("view-notifications");
    if (!page || !page.classList.contains("active")) return;
    const modal = document.getElementById("notificationCenterModal");
    const restored = restoreNotificationCenterReturnRoute();
    if (!restored && typeof switchView === "function") {
        switchView(typeof getPreferredInitialView === "function" ? getPreferredInitialView() : "dashboard", null, {
            skipHistory: true,
        });
    }
    if (modal) modal.classList.add("active");
    renderNotificationCenterBody();
    updateNotificationBadge();
    updateNotificationFilterButton();
}

/** PC에서 알림 모달만 열린 채로 창을 줄여 모바일이 되면: 모달 닫고 전체화면 알림 페이지로 */
function migrateNotificationModalToMobilePage() {
    const modal = document.getElementById("notificationCenterModal");
    if (!modal || !modal.classList.contains("active")) return;
    const page = document.getElementById("view-notifications");
    modal.classList.remove("active");
    closeNotificationFilterModal();
    if (page && page.classList.contains("active")) {
        renderNotificationCenterBody();
        updateNotificationFilterButton();
        updateNotificationBadge();
        return;
    }
    captureNotificationCenterReturnRoute();
    if (typeof switchView === "function") {
        switchView("notifications");
    }
    renderNotificationCenterBody();
    updateNotificationFilterButton();
    updateNotificationBadge();
}

function onWindowResizeNotificationCenterLayout() {
    if (typeof window.matchMedia !== "function") return;
    clearTimeout(notificationCenterResizeTimer);
    notificationCenterResizeTimer = setTimeout(() => {
        if (window.matchMedia("(min-width: 1025px)").matches) {
            migrateNotificationPageToDesktopModal();
        } else {
            migrateNotificationModalToMobilePage();
        }
    }, 100);
}

function openNotificationCenter() {
    const isMobile = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 1024px)").matches;
    const modal = document.getElementById("notificationCenterModal");
    if (isMobile) {
        if (modal) modal.classList.remove("active");
        captureNotificationCenterReturnRoute();
        if (typeof switchView === "function") {
            switchView("notifications");
        }
        renderNotificationCenterBody();
        updateNotificationFilterButton();
        updateNotificationBadge();
        return;
    }
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
    const page = document.getElementById("view-notifications");
    if (page && page.classList.contains("active")) {
        const restored = restoreNotificationCenterReturnRoute();
        if (!restored && typeof switchView === "function") {
            const next = typeof getPreferredInitialView === "function" ? getPreferredInitialView() : "dashboard";
            switchView(next, null, { skipHistory: true });
        }
    }
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
    let pageKey = String(options.pageKey || resolvedPage.pageKey || fallbackPage.pageKey || "page:unknown");
    let pageLabel = String(options.pageLabel || resolvedPage.pageLabel || fallbackPage.pageLabel || "기타");
    const ck = resolveNotificationClusterKey({ message, pageKey, pageLabel });
    pageKey = ck.pageKey;
    pageLabel = ck.pageLabel;
    const topic =
        pageKey === "page:session" ? "세션" : resolveNotificationTopic(message);
    const item = {
        id,
        message: String(message || ""),
        type: String(type || "success"),
        topic,
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
    notificationCenterState.items = pruneNotificationRetention(notificationCenterState.items).slice(0, 300);
    recalcNotificationUnreadCount();
    updateNotificationBadge();
    persistNotificationCenterState();
};

restoreNotificationCenterState();
void loadNotificationCenterStateFromServer();
updateNotificationBadge();

window.closeNotificationCenter = closeNotificationCenter;

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        closeNotificationFilterModal();
        closeNotificationCenter();
    }
});

window.addEventListener("resize", onWindowResizeNotificationCenterLayout);
