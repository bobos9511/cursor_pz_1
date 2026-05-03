"use strict";

let boardHelpCollapsed = false;
let boardHelpEditing = false;
let boardHelpSavedRange = null;
let boardHelpJustSeenUpdated = false;

async function loadSharedBoardHelpMap() {
    try {
        const data = await fetchJson("/api/db/board-help");
        return data && data.boardHelpMap && typeof data.boardHelpMap === "object" ? data.boardHelpMap : {};
    } catch (error) {
        console.error("loadSharedBoardHelpMap failed:", error);
        return {};
    }
}

function saveSharedBoardHelpMap(map) {
    fetchJson("/api/db/board-help", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardHelpMap: map || {} }),
    }).catch((error) => {
        console.error("saveSharedBoardHelpMap failed:", error);
        showAlert("공용 도움말 저장에 실패했습니다.", "error");
    });
}

function getBoardHelpTextByType(type) {
    const cfg = getBoardHelpConfigByType(type);
    return cfg.text;
}

function getBoardHelpConfigByType(type) {
    const shared = loadSharedBoardHelpMap();
    const local = appData.settings && appData.settings.boardHelp ? appData.settings.boardHelp : {};
    const map = { ...local, ...shared };
    const raw = map[type];
    if (raw && typeof raw === "object") {
        const text = String(raw.text || raw.html || "").trim();
        const html = String(raw.html || "").trim();
        return {
            text,
            html,
            hasContent: !!String(text || html)
                .replace(/<[^>]+>/g, "")
                .trim(),
            updatedAt: Number(raw.updatedAt || 0),
        };
    }
    const legacyText = String(raw || "").trim();
    return { text: legacyText, html: "", hasContent: !!legacyText, updatedAt: 0 };
}

function getBoardHelpUiState() {
    if (!appData.settings || typeof appData.settings !== "object") {
        appData.settings = { osNotify: true, notifyPolicy: getDefaultNotifyPolicy() };
    }
    if (!appData.settings.boardHelpUi || typeof appData.settings.boardHelpUi !== "object") appData.settings.boardHelpUi = {};
    const ui = appData.settings.boardHelpUi;
    if (!ui.collapsedByType || typeof ui.collapsedByType !== "object") ui.collapsedByType = {};
    if (!ui.seenAtByType || typeof ui.seenAtByType !== "object") ui.seenAtByType = {};
    return ui;
}

function setBoardHelpCollapsedState(type, collapsed) {
    const ui = getBoardHelpUiState();
    ui.collapsedByType[type] = !!collapsed;
    saveData();
}

function markBoardHelpSeen(type, updatedAt) {
    const ui = getBoardHelpUiState();
    if ((ui.seenAtByType[type] || 0) >= updatedAt) return false;
    ui.seenAtByType[type] = updatedAt;
    saveData();
    return true;
}

function formatBoardHelpText(text) {
    const normalized = String(text || "").trim();
    if (!normalized) return "";
    const SOFT_BR_TOKEN = "__BOARD_HELP_SOFT_BR__";
    const normalizedHtml = normalized
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
        .replace(/\son\w+="[^"]*"/gi, "")
        .replace(/\son\w+='[^']*'/gi, "");
    const withLineBreaks = normalizedHtml
        .replace(/<br\s*\/?>/gi, SOFT_BR_TOKEN)
        .replace(/<\/(div|p|li|h[1-6])>/gi, "\n")
        .replace(/<(div|p|li|h[1-6])[^>]*>/gi, "")
        .replace(new RegExp(SOFT_BR_TOKEN, "g"), "<br>");
    const lines = withLineBreaks.split("\n").map((s) => s.trim());
    return lines
        .map((s) => {
            if (!s || s.replace(/<[^>]+>/g, "").trim().length === 0) return `<div class="board-help-line empty"></div>`;
            return `<div class="board-help-line"><span class="board-help-bullet"></span><span class="board-help-line-text">${renderBoardHelpStatusTokens(s)}</span></div>`;
        })
        .join("");
}

function getBoardHelpStatusMeta(rawLabel) {
    const label = String(rawLabel || "").trim();
    const map = {
        접수대기: { cls: "wait" },
        "접수/대기": { cls: "wait" },
        처리중: { cls: "wait" },
        추가답변: { cls: "moreInfo" },
        추가정보요청: { cls: "moreInfo" },
        답변완료: { cls: "done" },
        조치완료: { cls: "done" },
        AI채택: { cls: "aiSolved" },
        학습대기: { cls: "ready" },
        학습완료: { cls: "trained" },
        오류: { cls: "error" },
        미승인: { cls: "ready" },
        승인: { cls: "trained" },
        불승인: { cls: "error" },
    };
    return map[label] || { cls: "" };
}

function renderBoardHelpStatusTokens(htmlText) {
    return String(htmlText || "").replace(/\[\$([^\]]+)\]/g, (_, raw) => {
        const label = String(raw || "").trim();
        if (!label) return "";
        const meta = getBoardHelpStatusMeta(label);
        const cls = meta.cls ? ` ${meta.cls}` : "";
        return `<span class="board-help-status-chip${cls}">${escapeHtml(label)}</span>`;
    });
}

function applyBoardHelpSelectionStyle(styleName, value) {
    const editor = document.getElementById("boardHelpEditor");
    if (!editor) return;
    const selection = window.getSelection();
    let range = null;
    if (selection && selection.rangeCount > 0) {
        const liveRange = selection.getRangeAt(0);
        if (editor.contains(liveRange.commonAncestorContainer) && !liveRange.collapsed) range = liveRange;
    }
    if (!range && boardHelpSavedRange) {
        range = boardHelpSavedRange.cloneRange();
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }
    if (!range || range.collapsed) return;
    const newRange = applyStyleToTextRange(editor, range, styleName, value);
    if (!newRange) return;
    selection.removeAllRanges();
    selection.addRange(newRange);
    boardHelpSavedRange = newRange.cloneRange();
    editor.focus();
    syncBoardHelpSelectionControls();
}

function applyStyleToTextRange(editor, sourceRange, styleName, value) {
    const range = sourceRange.cloneRange();
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    while (walker.nextNode()) {
        const txt = walker.currentNode;
        if (!txt || !txt.nodeValue || !txt.nodeValue.length) continue;
        if (range.intersectsNode(txt)) nodes.push(txt);
    }
    if (!nodes.length) return null;

    const wrapped = [];
    nodes.forEach((node) => {
        let start = 0;
        let end = node.nodeValue.length;
        if (node === range.startContainer) start = range.startOffset;
        if (node === range.endContainer) end = range.endOffset;
        if (start >= end) return;

        let target = node;
        if (end < target.nodeValue.length) target.splitText(end);
        if (start > 0) target = target.splitText(start);
        if (!target.nodeValue || !target.nodeValue.length) return;

        const span = document.createElement("span");
        span.style[styleName] = value;
        target.parentNode.insertBefore(span, target);
        span.appendChild(target);
        wrapped.push(span);
    });

    if (!wrapped.length) return null;
    const newRange = document.createRange();
    newRange.setStartBefore(wrapped[0]);
    newRange.setEndAfter(wrapped[wrapped.length - 1]);
    return newRange;
}

function toggleBoardHelpFontWeight() {
    const boldBtn = document.getElementById("boardHelpWeightBold");
    const toBold = !(boldBtn && boldBtn.classList.contains("active"));
    applyBoardHelpSelectionStyle("fontWeight", toBold ? "700" : "400");
}

function rgbToHex(color) {
    if (!color) return "";
    if (color.startsWith("#")) return color;
    if (/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(color) || color === "transparent") return "";
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!m) return "";
    const toHex = (n) => Number(n).toString(16).padStart(2, "0");
    return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
}

function syncBoardHelpSelectionControls() {
    const editor = document.getElementById("boardHelpEditor");
    if (!editor) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    let node = selection.anchorNode || range.commonAncestorContainer;
    if (node && node.nodeType === 3) node = node.parentElement;
    if (!node || !(node instanceof Element)) return;
    const st = window.getComputedStyle(node);
    const colorEl = document.getElementById("boardHelpTextColor");
    const bgEl = document.getElementById("boardHelpBgColor");
    const boldBtn = document.getElementById("boardHelpWeightBold");
    const c = rgbToHex(st.color || "");
    const bg = rgbToHex(st.backgroundColor || "");
    const fw = parseInt(st.fontWeight || "400", 10);
    if (colorEl && c) colorEl.value = c;
    if (bgEl && bg) bgEl.value = bg;
    if (boldBtn) boldBtn.classList.toggle("active", fw >= 600);
}

function bindBoardHelpEditorEvents() {
    const editor = document.getElementById("boardHelpEditor");
    if (!editor || editor.dataset.bound === "1") return;
    editor.dataset.bound = "1";
    ["mouseup", "keyup"].forEach((evt) => {
        editor.addEventListener(evt, () => {
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                const r = selection.getRangeAt(0);
                if (editor.contains(r.commonAncestorContainer) && !r.collapsed) boardHelpSavedRange = r.cloneRange();
            }
            syncBoardHelpSelectionControls();
        });
    });
    document.addEventListener("selectionchange", () => {
        if (!boardHelpEditing) return;
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            const r = selection.getRangeAt(0);
            if (editor.contains(r.commonAncestorContainer) && !r.collapsed) boardHelpSavedRange = r.cloneRange();
        }
        syncBoardHelpSelectionControls();
    });
}

function toggleBoardHelpCard() {
    boardHelpCollapsed = !boardHelpCollapsed;
    setBoardHelpCollapsedState(currentBoardType, boardHelpCollapsed);
    renderBoardHelpCard();
}

function openBoardHelpEditor() {
    if (currentRole !== "it") return;
    boardHelpEditing = true;
    boardHelpCollapsed = false;
    renderBoardHelpCard();
}

function cancelBoardHelpEditor() {
    boardHelpEditing = false;
    boardHelpSavedRange = null;
    renderBoardHelpCard();
}

function saveBoardHelpEditor() {
    if (currentRole !== "it") return;
    if (!appData.settings || typeof appData.settings !== "object") {
        appData.settings = { osNotify: true, notifyPolicy: getDefaultNotifyPolicy() };
    }
    if (!appData.settings.boardHelp || typeof appData.settings.boardHelp !== "object") appData.settings.boardHelp = {};
    const sharedMap = loadSharedBoardHelpMap();
    const editor = document.getElementById("boardHelpEditor");
    const nextHtml = editor ? String(editor.innerHTML || "").trim() : "";
    const nextText = editor ? String(editor.innerText || "").trim() : "";
    if (nextText) {
        const payload = {
            text: nextText,
            html: nextHtml,
            updatedAt: Date.now(),
        };
        appData.settings.boardHelp[currentBoardType] = payload;
        sharedMap[currentBoardType] = payload;
    } else {
        delete appData.settings.boardHelp[currentBoardType];
        delete sharedMap[currentBoardType];
    }
    saveSharedBoardHelpMap(sharedMap);
    saveData();
    boardHelpEditing = false;
    boardHelpSavedRange = null;
    renderBoardHelpCard();
    showAlert("게시판 도움말이 저장되었습니다.", "success");
}

function renderBoardHelpCard() {
    const card = document.getElementById("boardHelpCard");
    if (!card) return;
    const helpConfig = getBoardHelpConfigByType(currentBoardType);
    const helpText = helpConfig.text;
    const isItAdmin = currentRole === "it";
    const shouldShow = isItAdmin || !!helpConfig.hasContent;
    if (!shouldShow) {
        card.classList.add("hidden");
        return;
    }
    card.classList.remove("hidden");
    const body = document.getElementById("boardHelpBody");
    const toggleBtn = document.getElementById("boardHelpToggleBtn");
    const editBtn = document.getElementById("boardHelpEditBtn");
    const newBadge = document.getElementById("boardHelpNewBadge");
    const textEl = document.getElementById("boardHelpText");
    const emptyEl = document.getElementById("boardHelpEmpty");
    const editorWrap = document.getElementById("boardHelpEditorWrap");
    const editor = document.getElementById("boardHelpEditor");
    const ui = getBoardHelpUiState();
    const seenAt = Number((ui.seenAtByType || {})[currentBoardType] || 0);
    let isNew = helpConfig.updatedAt > seenAt && helpConfig.updatedAt > 0;

    if (editBtn) editBtn.classList.toggle("hidden", !isItAdmin);
    if (toggleBtn) {
        toggleBtn.classList.toggle("collapsed", boardHelpCollapsed);
        toggleBtn.classList.toggle("hidden", boardHelpEditing);
    }
    if (!boardHelpCollapsed && isNew) {
        const changed = markBoardHelpSeen(currentBoardType, helpConfig.updatedAt);
        if (changed) boardHelpJustSeenUpdated = true;
        isNew = false;
    }
    if (newBadge) newBadge.classList.toggle("hidden", !isNew);
    if (body) body.classList.toggle("hidden", boardHelpCollapsed);
    if (boardHelpCollapsed) return;

    if (textEl) {
        textEl.innerHTML = formatBoardHelpText(helpConfig.html || helpText);
        textEl.classList.toggle("hidden", !helpText || boardHelpEditing);
        textEl.classList.toggle("updated-highlight", boardHelpJustSeenUpdated && !boardHelpEditing);
        if (boardHelpJustSeenUpdated && !boardHelpEditing) {
            setTimeout(() => {
                boardHelpJustSeenUpdated = false;
                const target = document.getElementById("boardHelpText");
                if (target) target.classList.remove("updated-highlight");
            }, 1300);
        }
    }
    if (body) body.style.background = "";
    if (emptyEl) emptyEl.classList.toggle("hidden", !!helpText || boardHelpEditing);
    if (editorWrap) editorWrap.classList.toggle("hidden", !boardHelpEditing);
    if (editor && boardHelpEditing) {
        editor.innerHTML = helpConfig.html || escapeHtml(helpText).replace(/\n/g, "<br>");
        bindBoardHelpEditorEvents();
        syncBoardHelpSelectionControls();
    }
}
