"use strict";

const notificationCenterState = {
    items: [],
    viewMode: "time",
    levelMode: "all",
    seq: 1,
};

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
    if (!badge) return;
    const n = notificationCenterState.items.length;
    if (n <= 0) {
        badge.classList.add("hidden");
        return;
    }
    badge.classList.remove("hidden");
    badge.textContent = String(Math.min(n, 99));
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

    const groups = new Map();
    items.forEach((it) => {
        const key = notificationCenterState.viewMode === "topic" ? it.topic : `${it.dateLabel} · ${it.timeBand}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
    });

    body.innerHTML = Array.from(groups.entries())
        .map(([groupKey, list]) => {
            const rows = list
                .map((it) => {
                    const actionBtn = it.hasAction
                        ? `<button class="btn btn-outline" style="padding:5px 10px; font-size:12px;" onclick="runNotificationAction('${it.id}')">${escapeHtml(it.actionText || "바로가기")}</button>`
                        : "";
                    return `
                        <div class="noti-item">
                            <div class="noti-item-top">
                                <div class="noti-item-meta">${escapeHtml(it.atLabel)}</div>
                                <div class="noti-topic-chip ${it.level === "important" ? "important" : ""}">${it.level === "important" ? "중요" : "일반"} · ${escapeHtml(it.topic)}</div>
                            </div>
                            <div class="noti-item-msg">${escapeHtml(it.message).replace(/\n/g, "<br>")}</div>
                            <div class="noti-item-actions">
                                ${actionBtn}
                                <button class="btn btn-outline" style="padding:5px 10px; font-size:12px;" onclick="deleteNotificationItem('${it.id}')">삭제</button>
                            </div>
                        </div>
                    `;
                })
                .join("");
            return `<div class="noti-group"><div class="noti-group-title">${escapeHtml(groupKey)}</div>${rows}</div>`;
        })
        .join("");
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
    renderNotificationCenterBody();
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
    renderNotificationCenterBody();
}

function openNotificationCenter() {
    const modal = document.getElementById("notificationCenterModal");
    if (!modal) return;
    renderNotificationCenterBody();
    modal.classList.add("active");
}

function closeNotificationCenter() {
    const modal = document.getElementById("notificationCenterModal");
    if (modal) modal.classList.remove("active");
}

function deleteNotificationItem(id) {
    notificationCenterState.items = notificationCenterState.items.filter((it) => String(it.id) !== String(id));
    updateNotificationBadge();
    renderNotificationCenterBody();
}

function clearAllNotifications() {
    if (!notificationCenterState.items.length) return;
    showConfirm("알림을 모두 삭제하시겠습니까?", () => {
        notificationCenterState.items = [];
        updateNotificationBadge();
        renderNotificationCenterBody();
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
        hasAction: typeof options.onClick === "function",
        onClick: typeof options.onClick === "function" ? options.onClick : null,
        actionText: options.actionText || "바로가기",
    };
    notificationCenterState.items.unshift(item); // 최근 알림 상단
    notificationCenterState.items = notificationCenterState.items.slice(0, 300);
    updateNotificationBadge();
};

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeNotificationCenter();
});
