const APP_SCOPE = "shared";
const SESSION_KEY = "knockSessionUser";

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data && data.error) || "요청 실패");
  }
  return data;
}

async function loadSignupUsers() {
  const data = await fetchJson("/api/db/signup-users");
  return Array.isArray(data.signupUsers) ? data.signupUsers : [];
}

async function saveSignupUsers(signupUsers) {
  await fetchJson("/api/db/signup-users", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signupUsers }),
  });
}

async function loadAppData() {
  const data = await fetchJson(`/api/db/app-data?scope=${encodeURIComponent(APP_SCOPE)}`);
  const appData = data && data.appData ? data.appData : { posts: [], settings: {} };
  if (!Array.isArray(appData.posts)) appData.posts = [];
  if (!appData.settings || typeof appData.settings !== "object") appData.settings = {};
  return appData;
}

async function saveAppData(appData) {
  await fetchJson(`/api/db/app-data?scope=${encodeURIComponent(APP_SCOPE)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appData }),
  });
}

function setSessionUser(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user || null));
}

function getSessionUser() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function clearSessionUser() {
  localStorage.removeItem(SESSION_KEY);
}

function requireSession(redirectPath = "/login.html") {
  const user = getSessionUser();
  if (!user) {
    window.location.href = redirectPath;
    return null;
  }
  return user;
}

function formatDateTime(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${y}.${m}.${d} ${hh}:${mm}`;
}
