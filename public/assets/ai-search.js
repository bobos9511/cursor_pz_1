(function () {
  const chatLog = document.getElementById("chatLog");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");
  const chatBoardType = document.getElementById("chatBoardType");
  const chatStateBadge = document.getElementById("chatStateBadge");
  const suggestionButtons = document.querySelectorAll(".suggestion-btn");
  const historyList = document.getElementById("historyList");
  const btnNewChat = document.getElementById("btnNewChat");

  function getCookie(name) {
    const key = `${encodeURIComponent(name)}=`;
    const chunks = document.cookie.split(";");
    for (let i = 0; i < chunks.length; i += 1) {
      const c = chunks[i].trim();
      if (c.startsWith(key)) return decodeURIComponent(c.slice(key.length));
    }
    return "";
  }

  const userScope = getCookie("knockUserScope") || "guest";
  const loginNonce = localStorage.getItem("knockLoginNonce") || "no-login";
  const activeKey = `knockAiActive:${userScope}:${loginNonce}`;
  const historyKey = `knockAiHistory:${userScope}`;
  let activeState = null;
  let historyState = [];

  function nowLabel() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}.${m}.${day} ${hh}:${mm}`;
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function defaultState() {
    return {
      id: `chat_${Date.now()}`,
      title: "새 대화",
      boardType: chatBoardType.value || "IT",
      draft: "",
      updatedAt: nowLabel(),
      messages: [{ role: "ai", text: "안녕하세요. 핵심 위주로 답변하는 AI 검색 채팅입니다." }],
    };
  }

  function saveActive() {
    if (!activeState) return;
    activeState.boardType = chatBoardType.value || "IT";
    activeState.draft = chatInput.value || "";
    activeState.updatedAt = nowLabel();
    saveJson(activeKey, activeState);
  }

  function upsertHistoryFromActive() {
    if (!activeState || !Array.isArray(activeState.messages) || activeState.messages.length < 2) return;
    const copy = {
      id: activeState.id,
      title: activeState.title || "지난 대화",
      boardType: activeState.boardType || "IT",
      updatedAt: activeState.updatedAt || nowLabel(),
      messages: activeState.messages.slice(0, 120),
    };
    const idx = historyState.findIndex((h) => h.id === copy.id);
    if (idx >= 0) historyState[idx] = copy;
    else historyState.unshift(copy);
    historyState = historyState.slice(0, 30);
    saveJson(historyKey, historyState);
    renderHistory();
  }

  function renderHistory() {
    if (!historyList) return;
    if (!historyState.length) {
      historyList.innerHTML = "<div class='history-empty'>저장된 지난 대화가 없습니다.</div>";
      return;
    }
    historyList.innerHTML = historyState
      .map((h) => {
        const title = String(h.title || "지난 대화").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const meta = `${h.updatedAt || "-"} · ${h.boardType || "IT"}`;
        return `<button type="button" class="history-item" data-history-id="${h.id}">
          <div class="history-title">${title}</div>
          <div class="history-meta">${meta}</div>
        </button>`;
      })
      .join("");
  }

  function appendMessage(role, text) {
    const item = document.createElement("div");
    item.className = `msg ${role}`;
    item.textContent = String(text || "");
    chatLog.appendChild(item);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  async function sendQuestion(question) {
    const payload = {
      title: `AI 검색: ${question.slice(0, 45)}`,
      content: question,
      boardType: chatBoardType.value || "IT",
    };
    const response = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      throw new Error((data && data.error) || "AI 요청에 실패했습니다.");
    }
    return (data && data.reply) || "응답이 비어 있습니다.";
  }

  function renderMessagesFromState() {
    chatLog.innerHTML = "";
    const msgs = (activeState && activeState.messages) || [];
    msgs.forEach((m) => appendMessage(m.role, m.text));
  }

  historyState = loadJson(historyKey, []);
  activeState = loadJson(activeKey, null) || defaultState();
  chatBoardType.value = activeState.boardType || "IT";
  chatInput.value = activeState.draft || "";
  renderMessagesFromState();
  renderHistory();

  if (btnNewChat) {
    btnNewChat.addEventListener("click", function () {
      upsertHistoryFromActive();
      activeState = defaultState();
      chatBoardType.value = activeState.boardType;
      chatInput.value = "";
      renderMessagesFromState();
      saveActive();
      chatInput.focus();
    });
  }

  if (historyList) {
    historyList.addEventListener("click", function (event) {
      const item = event.target.closest("[data-history-id]");
      if (!item) return;
      const id = item.getAttribute("data-history-id");
      const found = historyState.find((h) => h.id === id);
      if (!found) return;
      activeState = {
        id: `chat_${Date.now()}`,
        title: found.title || "불러온 대화",
        boardType: found.boardType || "IT",
        draft: "",
        updatedAt: nowLabel(),
        messages: Array.isArray(found.messages) ? found.messages : [],
      };
      if (!activeState.messages.length) activeState.messages = [{ role: "ai", text: "대화를 불러왔습니다." }];
      chatBoardType.value = activeState.boardType;
      chatInput.value = "";
      renderMessagesFromState();
      saveActive();
    });
  }

  chatInput.addEventListener("input", saveActive);
  chatBoardType.addEventListener("change", saveActive);

  suggestionButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      chatInput.value = btn.getAttribute("data-suggest") || "";
      saveActive();
      chatInput.focus();
    });
  });

  chatForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    const q = (chatInput.value || "").trim();
    if (!q) return;

    activeState.messages.push({ role: "user", text: q });
    if (!activeState.title || activeState.title === "새 대화") activeState.title = q.slice(0, 28);
    saveActive();
    appendMessage("user", q);
    chatInput.value = "";
    chatInput.focus();

    chatSendBtn.disabled = true;
    chatSendBtn.textContent = "답변 생성 중...";
    if (chatStateBadge) {
      chatStateBadge.className = "chat-state loading";
      chatStateBadge.textContent = "답변 생성중";
    }
    appendMessage("ai", "질문을 분석하고 있습니다...");

    try {
      const reply = await sendQuestion(q);
      const allAi = chatLog.querySelectorAll(".msg.ai");
      const loading = allAi[allAi.length - 1];
      if (loading) loading.textContent = reply;
      activeState.messages.push({ role: "ai", text: reply });
      saveActive();
      upsertHistoryFromActive();
    } catch (error) {
      const allAi = chatLog.querySelectorAll(".msg.ai");
      const loading = allAi[allAi.length - 1];
      const failText = `오류: ${error.message}`;
      if (loading) loading.textContent = failText;
      activeState.messages.push({ role: "ai", text: failText });
      saveActive();
      upsertHistoryFromActive();
    } finally {
      chatSendBtn.disabled = false;
      chatSendBtn.textContent = "질문하기";
      if (chatStateBadge) {
        chatStateBadge.className = "chat-state idle";
        chatStateBadge.textContent = "대기중";
      }
    }
  });
})();
