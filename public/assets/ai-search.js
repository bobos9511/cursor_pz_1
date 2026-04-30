(function () {
  const chatLog = document.getElementById("chatLog");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");
  const chatBoardType = document.getElementById("chatBoardType");

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

  appendMessage("ai", "안녕하세요. 핵심 위주로 답변하는 AI 검색 채팅입니다.");

  chatForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    const q = (chatInput.value || "").trim();
    if (!q) return;

    appendMessage("user", q);
    chatInput.value = "";
    chatInput.focus();

    chatSendBtn.disabled = true;
    chatSendBtn.textContent = "답변 생성 중...";
    appendMessage("ai", "질문을 분석하고 있습니다...");

    try {
      const reply = await sendQuestion(q);
      const allAi = chatLog.querySelectorAll(".msg.ai");
      const loading = allAi[allAi.length - 1];
      if (loading) loading.textContent = reply;
    } catch (error) {
      const allAi = chatLog.querySelectorAll(".msg.ai");
      const loading = allAi[allAi.length - 1];
      if (loading) loading.textContent = `오류: ${error.message}`;
    } finally {
      chatSendBtn.disabled = false;
      chatSendBtn.textContent = "질문하기";
    }
  });
})();
