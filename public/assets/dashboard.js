(async function () {
  const user = requireSession();
  if (!user) return;

  document.getElementById("whoami").textContent = `${user.name} (${user.employeeNo})`;
  const refreshBtn = document.getElementById("refreshBtn");
  const kpiTotal = document.getElementById("kpiTotal");
  const kpiIt = document.getElementById("kpiIt");
  const kpiBiz = document.getElementById("kpiBiz");
  const kpiSys = document.getElementById("kpiSys");
  const kpiAiDone = document.getElementById("kpiAiDone");
  const recentTbody = document.getElementById("recentTbody");

  async function render() {
    const appData = await loadAppData();
    const rows = Array.isArray(appData.posts) ? appData.posts : [];
    kpiTotal.textContent = String(rows.length);
    kpiIt.textContent = String(rows.filter((p) => p.type === "IT").length);
    kpiBiz.textContent = String(rows.filter((p) => p.type === "BIZ").length);
    kpiSys.textContent = String(rows.filter((p) => p.type === "SYS").length);
    kpiAiDone.textContent = String(rows.filter((p) => !!p.aiContent).length);

    const recent = rows.slice().sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 10);
    if (!recent.length) {
      recentTbody.innerHTML = "<tr><td colspan='6' class='muted'>최근 게시물이 없습니다.</td></tr>";
      return;
    }
    recentTbody.innerHTML = recent
      .map((post) => {
        const ai = post.aiError ? "실패" : post.aiContent ? "완료" : "대기";
        return `
          <tr>
            <td>${post.id}</td>
            <td>${escapeHtml(post.type || "-")}</td>
            <td>${escapeHtml(post.title || "-")}</td>
            <td>${escapeHtml(post.writer || "-")}</td>
            <td>${escapeHtml(post.datetime || "-")}</td>
            <td>${ai}</td>
          </tr>
        `;
      })
      .join("");
  }

  refreshBtn.addEventListener("click", render);
  await render();
})();
