(async function () {
  const loginForm = document.getElementById("loginForm");
  const savedUsersWrap = document.getElementById("savedUsers");
  const logoutBtn = document.getElementById("logoutBtn");
  const currentSessionEl = document.getElementById("currentSession");

  function renderSession() {
    const user = getSessionUser();
    if (!user) {
      currentSessionEl.textContent = "현재 로그인: 없음";
      return;
    }
    currentSessionEl.textContent = `현재 로그인: ${user.name} (${user.employeeNo})`;
  }

  function renderSavedUsers(users) {
    if (!users.length) {
      savedUsersWrap.innerHTML = "<div class='muted'>저장된 사용자 없음</div>";
      return;
    }
    savedUsersWrap.innerHTML = users
      .map((user) => {
        const label = `${escapeHtml(user.name || "-")} / ${escapeHtml(user.employeeNo || "-")} / ${escapeHtml(user.role || "branch")}`;
        return `<button class="btn" data-login-emp="${escapeHtml(user.employeeNo || "")}">${label}</button>`;
      })
      .join(" ");
  }

  let signupUsers = await loadSignupUsers();
  renderSavedUsers(signupUsers);
  renderSession();

  savedUsersWrap.addEventListener("click", function (event) {
    const btn = event.target.closest("[data-login-emp]");
    if (!btn) return;
    const empNo = btn.getAttribute("data-login-emp");
    const user = signupUsers.find((u) => String(u.employeeNo) === String(empNo));
    if (!user) return;
    setSessionUser(user);
    renderSession();
    window.location.href = "/dashboard.html";
  });

  loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    const employeeNo = String(document.getElementById("employeeNo").value || "").trim();
    const name = String(document.getElementById("name").value || "").trim();
    const deptName = String(document.getElementById("deptName").value || "").trim();
    const role = String(document.getElementById("role").value || "branch").trim();

    if (!employeeNo || !name) {
      alert("직원번호와 이름을 입력해주세요.");
      return;
    }

    let user = signupUsers.find((u) => String(u.employeeNo) === employeeNo);
    if (!user) {
      user = { employeeNo, name, deptName, role };
      signupUsers.push(user);
      await saveSignupUsers(signupUsers);
    }
    setSessionUser(user);
    renderSession();
    window.location.href = "/dashboard.html";
  });

  logoutBtn.addEventListener("click", function () {
    clearSessionUser();
    renderSession();
  });
})();
