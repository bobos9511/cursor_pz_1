(async function () {
  const user = requireSession();
  if (!user) return;

  const whoami = document.getElementById("whoami");
  const postForm = document.getElementById("postForm");
  const tbody = document.getElementById("postTbody");
  const filterType = document.getElementById("filterType");
  const refreshBtn = document.getElementById("refreshBtn");
  const aiCheckbox = document.getElementById("withAi");

  whoami.textContent = `${user.name} (${user.employeeNo})`;

  let appData = await loadAppData();
  let rows = Array.isArray(appData.posts) ? appData.posts : [];

  function nextId() {
    return rows.length ? Math.max(...rows.map((p) => Number(p.id) || 0)) + 1 : 1;
  }

  function statusBadge(post) {
    if (post.aiError) return "<span class='badge err'>AI 실패</span>";
    if (post.aiContent) return "<span class='badge ok'>AI 완료</span>";
    return "<span class='badge wait'>대기</span>";
  }

  function renderPosts() {
    const type = filterType.value;
    const filtered = rows
      .filter((p) => (type === "ALL" ? true : p.type === type))
      .sort((a, b) => Number(b.id) - Number(a.id));

    if (!filtered.length) {
      tbody.innerHTML = "<tr><td colspan='8' class='muted'>게시물이 없습니다.</td></tr>";
      return;
    }

    tbody.innerHTML = filtered
      .map((post) => {
        const aiPreview = post.aiContent
          ? escapeHtml(String(post.aiContent).replace(/<[^>]+>/g, "").slice(0, 80))
          : post.aiError
            ? escapeHtml(post.aiError)
            : "-";
        return `
          <tr>
            <td>${post.id}</td>
            <td>${escapeHtml(post.type)}</td>
            <td>${escapeHtml(post.title)}</td>
            <td>${escapeHtml(post.writer || "-")}</td>
            <td>${escapeHtml(post.datetime || "-")}</td>
            <td>${statusBadge(post)}</td>
            <td>${aiPreview}</td>
            <td><button class="btn" data-view="${post.id}">보기</button></td>
          </tr>
        `;
      })
      .join("");
  }

  async function requestAiReply(post) {
    const data = await fetchJson("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: post.title,
        content: post.contentPlain || "",
        boardType: post.type,
      }),
    });
    return String(data.reply || "").trim();
  }

  postForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    const type = String(document.getElementById("type").value || "IT");
    const title = String(document.getElementById("title").value || "").trim();
    const content = String(document.getElementById("content").value || "").trim();
    if (!title || !content) {
      alert("제목/내용을 입력해주세요.");
      return;
    }

    const post = {
      id: nextId(),
      type,
      title,
      contentPlain: content,
      writer: user.name,
      datetime: formatDateTime(),
      aiContent: "",
      aiError: "",
    };
    rows.push(post);
    appData.posts = rows;
    await saveAppData(appData);
    renderPosts();
    postForm.reset();

    if (!aiCheckbox.checked || !(type === "IT" || type === "BIZ")) return;
    try {
      const reply = await requestAiReply(post);
      post.aiContent = reply;
      post.aiError = "";
    } catch (error) {
      post.aiError = error.message;
    }
    await saveAppData(appData);
    renderPosts();
  });

  refreshBtn.addEventListener("click", async function () {
    appData = await loadAppData();
    rows = Array.isArray(appData.posts) ? appData.posts : [];
    renderPosts();
  });

  filterType.addEventListener("change", renderPosts);

  tbody.addEventListener("click", function (event) {
    const btn = event.target.closest("[data-view]");
    if (!btn) return;
    const id = Number(btn.getAttribute("data-view"));
    const post = rows.find((p) => Number(p.id) === id);
    if (!post) return;
    const details = [
      `제목: ${post.title}`,
      `유형: ${post.type}`,
      `작성자: ${post.writer || "-"}`,
      `작성시각: ${post.datetime || "-"}`,
      "",
      `[본문]`,
      post.contentPlain || "-",
      "",
      `[AI 답변]`,
      post.aiContent || `(없음) ${post.aiError || ""}`,
    ].join("\n");
    alert(details);
  });

  renderPosts();
})();
