// ==========================================
        // 0. Custom Dialog Alert System
        // ==========================================
        let appDialogConfirmHandler = null;
        let appDialogCancelHandler = null;
        let systemNotificationPermissionRequested = false;
        let serverRecoveryTimer = null;
        let serverErrorPageActive = false;
        const SERVER_ERROR_RETRY_MS = 5000;

        function shouldOpenServerErrorPage(status) {
            const code = Number(status || 0);
            if (!Number.isFinite(code)) return false;
            return code === 403 || code === 502 || code === 503 || code === 504 || code >= 500;
        }

        function hideServerErrorPage() {
            const page = document.getElementById('serverErrorPage');
            if (page) page.classList.add('hidden');
            serverErrorPageActive = false;
            if (serverRecoveryTimer) {
                clearInterval(serverRecoveryTimer);
                serverRecoveryTimer = null;
            }
        }

        async function retryServerRecovery() {
            try {
                const res = await fetch('/api/health', { cache: 'no-store' });
                if (res.ok) {
                    location.reload();
                }
            } catch (_) {
                // keep waiting until server recovers
            }
        }
        window.retryServerRecovery = retryServerRecovery;

        function startServerRecoveryPolling() {
            if (serverRecoveryTimer) return;
            serverRecoveryTimer = setInterval(() => {
                void retryServerRecovery();
            }, SERVER_ERROR_RETRY_MS);
        }

        function openServerErrorPage(statusCode, message) {
            const page = document.getElementById('serverErrorPage');
            const loginPage = document.getElementById('loginPage');
            const appContainer = document.getElementById('appContainer');
            if (!page || !loginPage || !appContainer) return;
            const code = Number(statusCode || 0);
            const statusEl = document.getElementById('serverErrorStatus');
            const msgEl = document.getElementById('serverErrorMessage');
            if (statusEl) statusEl.innerText = `오류 코드: ${code > 0 ? code : '네트워크 오류'}`;
            if (msgEl) {
                const safeMsg = String(message || '').trim();
                msgEl.innerText = safeMsg || '서버 연결에 문제가 발생했습니다. 잠시 후 자동으로 다시 연결합니다.';
            }
            loginPage.style.display = 'none';
            appContainer.style.display = 'none';
            appContainer.style.visibility = 'visible';
            page.classList.remove('hidden');
            serverErrorPageActive = true;
            startServerRecoveryPolling();
        }

        function isMobileOsClient() {
            const ua = (navigator && navigator.userAgent) ? navigator.userAgent : '';
            return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
        }

        function isPageInBackground() {
            if (typeof document === 'undefined') return false;
            if (document.visibilityState && document.visibilityState !== 'visible') return true;
            if (typeof document.hasFocus === 'function' && !document.hasFocus()) return true;
            return false;
        }

        function canUseSystemNotificationApi() {
            return typeof window !== 'undefined' && typeof window.Notification !== 'undefined';
        }

        function getDefaultNotifyPolicy() {
            return {
                master: 'allow',
                level: 'all',
                timeMode: 'all',
                customStart: '09:00',
                customEnd: '18:00',
                excludeKeywords: [],
                includeKeywords: [],
            };
        }

        function normalizeKeywordList(text) {
            const parts = String(text || '')
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean);
            return Array.from(new Set(parts)).slice(0, 50);
        }

        function normalizeNotifyPolicy(raw) {
            const base = getDefaultNotifyPolicy();
            const src = raw && typeof raw === 'object' ? raw : {};
            const out = { ...base, ...src };
            out.master = out.master === 'block' ? 'block' : 'allow';
            out.level = out.level === 'important' ? 'important' : 'all';
            out.timeMode = out.timeMode === 'all' || out.timeMode === 'night' || out.timeMode === 'custom' ? out.timeMode : 'all';
            out.customStart = /^\d{2}:\d{2}$/.test(String(out.customStart || '')) ? String(out.customStart) : '09:00';
            out.customEnd = /^\d{2}:\d{2}$/.test(String(out.customEnd || '')) ? String(out.customEnd) : '18:00';
            out.excludeKeywords = Array.isArray(out.excludeKeywords) ? normalizeKeywordList(out.excludeKeywords.join(',')) : normalizeKeywordList(out.excludeKeywords);
            out.includeKeywords = Array.isArray(out.includeKeywords) ? normalizeKeywordList(out.includeKeywords.join(',')) : normalizeKeywordList(out.includeKeywords);
            return out;
        }

        function getCurrentNotifyPolicy() {
            const settings = appData && appData.settings ? appData.settings : {};
            return normalizeNotifyPolicy(settings.notifyPolicy);
        }

        function resolveNoticeLevelLocal(message, type, options = {}) {
            if (options.noticeLevel === 'important' || options.noticeLevel === 'general') return options.noticeLevel;
            const msg = String(message || '');
            const t = String(type || '');
            if (t === 'error' || msg.includes('오류') || msg.includes('실패')) return 'important';
            return 'general';
        }

        function toMinutes(hhmm) {
            const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/);
            if (!m) return null;
            const hh = Number(m[1]);
            const mm = Number(m[2]);
            if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
            return hh * 60 + mm;
        }

        function isNowInTimeRange(policy) {
            const now = new Date();
            const cur = now.getHours() * 60 + now.getMinutes();
            const workStart = 9 * 60;
            const workEnd = 18 * 60;
            if (policy.timeMode === 'all') return true;
            if (policy.timeMode === 'night') return cur >= workEnd || cur < workStart;
            if (policy.timeMode !== 'custom') return cur >= workStart && cur < workEnd;
            const s = toMinutes(policy.customStart);
            const e = toMinutes(policy.customEnd);
            if (s == null || e == null) return true;
            if (s === e) return true;
            if (s < e) return cur >= s && cur < e;
            return cur >= s || cur < e;
        }

        function shouldDeliverUserNotification(message, type = 'success', options = {}) {
            const policy = getCurrentNotifyPolicy();
            if (policy.master === 'block') return false;
            const level = resolveNoticeLevelLocal(message, type, options);
            if (policy.level === 'important' && level !== 'important') return false;
            if (!isNowInTimeRange(policy)) return false;
            const text = String(message || '').toLowerCase();
            if (policy.includeKeywords.length) {
                const hasInclude = policy.includeKeywords.some((k) => text.includes(String(k).toLowerCase()));
                if (!hasInclude) return false;
            }
            if (policy.excludeKeywords.length) {
                const hasExclude = policy.excludeKeywords.some((k) => text.includes(String(k).toLowerCase()));
                if (hasExclude) return false;
            }
            return true;
        }

        function shouldPreferSystemNotification(options = {}) {
            if (!canUseSystemNotificationApi()) return false;
            const osNotifyEnabled = !(appData && appData.settings && appData.settings.osNotify === false);
            if (!osNotifyEnabled) return false;
            const isMobile = isMobileOsClient();
            if (!isMobile) return true;
            const isAsyncOnly = options && options.asyncOnly === true;
            if (!isAsyncOnly) return false;
            const loggedOut = !currentLoginUser;
            const away = isPageInBackground();
            return loggedOut || away;
        }

        function maybeRequestSystemNotificationPermission() {
            if (!canUseSystemNotificationApi()) return;
            if (Notification.permission !== 'default') return;
            if (systemNotificationPermissionRequested) return;
            systemNotificationPermissionRequested = true;
            Notification.requestPermission().catch(() => {});
        }

        function showSystemNotification(message, type = 'success', options = {}) {
            if (!canUseSystemNotificationApi()) return false;
            if (Notification.permission !== 'granted') return false;
            const title = options.osTitle || (type === 'error' ? 'KNOCK 오류 알림' : 'KNOCK 알림');
            const body = String(message || '').replace(/\s+/g, ' ').trim();
            try {
                const n = new Notification(title, {
                    body: body || '새 알림이 도착했습니다.',
                    tag: options.osTag || `knock-${Date.now()}`,
                    renotify: false,
                    requireInteraction: options.requireInteraction === true,
                });
                n.onclick = () => {
                    try { window.focus(); } catch (_) {}
                    if (typeof options.onClick === 'function') {
                        options.onClick();
                    } else if (typeof window.openNotificationCenter === 'function') {
                        window.openNotificationCenter();
                    }
                    try { n.close(); } catch (_) {}
                };
                return true;
            } catch (_) {
                return false;
            }
        }

        function openAppDialog({ title = '알림', message = '', confirmText = '확인', cancelText = '취소', showCancel = false, onConfirm = null, onCancel = null }) {
            const modal = document.getElementById('appDialogModal');
            if (!modal) return;
            const titleEl = document.getElementById('appDialogTitle');
            const msgEl = document.getElementById('appDialogMessage');
            const cancelBtn = document.getElementById('appDialogCancelBtn');
            const confirmBtn = document.getElementById('appDialogConfirmBtn');

            if (titleEl) titleEl.innerText = title;
            if (msgEl) msgEl.innerText = message;
            if (confirmBtn) confirmBtn.innerText = confirmText;
            if (cancelBtn) {
                cancelBtn.innerText = cancelText;
                cancelBtn.style.display = showCancel ? 'inline-flex' : 'none';
            }

            appDialogConfirmHandler = onConfirm;
            appDialogCancelHandler = onCancel;
            modal.style.zIndex = '12050';
            modal.classList.add('active');
        }

        function closeAppDialog() {
            const modal = document.getElementById('appDialogModal');
            if (modal) modal.classList.remove('active');
            appDialogConfirmHandler = null;
            appDialogCancelHandler = null;
        }

        function onAppDialogConfirm() {
            const handler = appDialogConfirmHandler;
            closeAppDialog();
            if (typeof handler === 'function') handler();
        }

        function onAppDialogCancel() {
            const handler = appDialogCancelHandler;
            closeAppDialog();
            if (typeof handler === 'function') handler();
        }

        function showAlert(message, type = 'success', options = {}) {
            const container = document.getElementById('toastContainer');
            if (typeof window.recordNotificationEntry === 'function') {
                window.recordNotificationEntry(message, type, options);
            }
            if (!shouldDeliverUserNotification(message, type, options)) return;
            const wantsSystem = shouldPreferSystemNotification(options);
            if (wantsSystem && Notification.permission === 'default') {
                maybeRequestSystemNotificationPermission();
            }
            const systemShown = wantsSystem ? showSystemNotification(message, type, options) : false;
            const skipPageToast = wantsSystem && systemShown;
            if (!container || skipPageToast) return;

            const toast = document.createElement('div');
            toast.className = `toast-item ${type}`;
            const hasAction = typeof options.onClick === 'function';
            if (hasAction) toast.classList.add('clickable');
            const icon = type === 'success'
                ? '<svg class="icon icon-lg"><use href="#icon-check"></use></svg>'
                : '<svg class="icon icon-lg"><use href="#icon-info"></use></svg>';
            const actionText = hasAction ? (options.actionText || '바로가기') : '';

            toast.innerHTML = `
                <div class="flex items-center" style="gap: 10px;">
                    ${icon}
                    <span style="line-height: 1.4;">${String(message || '').replace(/\n/g, '<br>')}</span>
                </div>
                ${hasAction ? `<button class="btn btn-outline toast-action-btn">${actionText}</button>` : ''}
                <button class="toast-close" onclick="closeToast(this.parentElement)"><svg class="icon"><use href="#icon-close"></use></svg></button>
                <div class="toast-progress"></div>
            `;
            if (hasAction) {
                toast.addEventListener('click', (event) => {
                    const actionBtn = event.target && event.target.closest('.toast-action-btn');
                    const closeBtn = event.target && event.target.closest('.toast-close');
                    if (closeBtn || !actionBtn) return;
                    options.onClick();
                    closeToast(toast);
                });
            }
            container.appendChild(toast);
            const timer = setTimeout(() => { closeToast(toast); }, 3000);
            toast.dataset.timer = String(timer);
        }

        function closeToast(toast) {
            if (!toast) return;
            if (toast.dataset.timer) clearTimeout(Number(toast.dataset.timer));
            toast.style.animation = 'fadeOutToast 0.3s ease-out forwards';
            setTimeout(() => { if (toast.parentElement) toast.remove(); }, 280);
        }

        function showConfirm(message, onConfirm) {
            openAppDialog({ title: '확인', message, confirmText: '확인', cancelText: '취소', showCancel: true, onConfirm });
        }

        // ==========================================
        // 1. Data Initialization
        // ==========================================
        const MOCK_INITIAL_DATA = [];

        let appData = { posts: [], settings: { osNotify: true, initialView: 'ai-search', notifyPolicy: getDefaultNotifyPolicy() } };
        let currentRole = 'branch'; let currentBoardType = 'IT'; let currentPostId = null;
        let currentSessionIp = '';
        let boardCurrentPage = 1;
        let boardPageSize = 10;
        let dashCountPosts = [];
        let dashCountCurrentPage = 1;
        let dashCountPageSize = 10;
        let boardHelpCollapsed = false;
        let boardHelpEditing = false;
        let boardHelpSavedRange = null;
        let boardHelpJustSeenUpdated = false;
        let writeAttachmentItems = [];
        const aiExpandState = {};
        const aiRefreshingPostIds = new Set();
        const systemThemeMedia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
        let systemThemeListenerBound = false;
        let isApplyingHistoryRoute = false;
        let historyRouteInitialized = false;
        const USER_SCOPE_COOKIE = 'knockUserScope';
        const APP_DATA_SHARED_SCOPE = 'shared';
        const AI_SEARCH_HISTORY_KEY_PREFIX = 'knockAiHistory:';
        const AI_SEARCH_ACTIVE_KEY_PREFIX = 'knockAiActive:';
        const AI_REQUEST_TIMEOUT_MS = 60000;
        const AI_CHAT_REQUEST_TIMEOUT_MS = 60000;
        const AI_SYSTEM_USER_EMP_NO = '000000';
        const AI_SYSTEM_USER_NAME = 'AI';
        let signupUsers = [];
        let currentLoginUser = null;
        let pendingProfileImageData = '';
        let aiSearchActive = null;
        let aiSearchHistory = [];
        let aiSearchInitialized = false;
        let aiSearchIsLoading = false;
        let aiSearchPendingContinuation = null;
        const AI_FALLBACK_HTML = '<b>AI 분석 결과:</b><br>접수 내용 기반 분석 완료.';
        const initialRoute = (() => {
            try {
                const url = new URL(window.location.href);
                const page = String(url.searchParams.get('page') || '').toLowerCase();
                const board = String(url.searchParams.get('board') || '').toUpperCase();
                return { page, board };
            } catch (error) {
                return { page: '', board: '' };
            }
        })();
        let initialRouteApplied = false;

        const boardTitles = {
            'IT': { icon: '#icon-info', title: 'IT/오류 문의 게시판', label: 'IT/오류' },
            'BIZ': { icon: '#icon-book', title: '규정/상품 문의 게시판', label: '규정/상품' },
            'SYS': { icon: '#icon-lightbulb', title: 'KNOCK 개선 제안', label: 'KNOCK 개선' },
            'KNOW': { icon: '#icon-history', title: 'AI 지식 베이스', label: 'AI 지식 베이스' }
        };
        const KNOW_CATEGORY_LABEL = { IT: 'IT 매뉴얼', BIZ: '업무 매뉴얼' };
        const KNOW_STATUS = {
            PENDING: 'pending',
            APPROVED: 'approved',
            REJECTED: 'rejected',
        };

        const roleMatrix = {
            'branch': { write: ['IT', 'BIZ', 'SYS'], answer: [], name: '홍길동 대리', dept: '영업부', showKnow: false },
            'hq': { write: ['IT', 'SYS', 'KNOW'], answer: ['BIZ', 'KNOW'], name: '이본부 차장', dept: '여신기획부', showKnow: true },
            'it': { write: ['BIZ', 'SYS', 'KNOW'], answer: ['IT', 'SYS', 'KNOW'], name: '김전산 책임', dept: 'IT금융개발부', showKnow: true }
        };

        function resolveInitialViewForRole() {
            if (initialRouteApplied) return null;
            const page = initialRoute.page;
            if (!page || page === 'login') return null;
            if (page === 'board') {
                const requested = initialRoute.board || currentBoardType || 'IT';
                const allowedBoards = roleMatrix[currentRole].write || [];
                const board = allowedBoards.includes(requested) ? requested : (allowedBoards[0] || 'IT');
                return { viewId: 'list', boardType: board };
            }
            if (page === 'dashboard') return { viewId: 'dashboard', boardType: null };
            return null;
        }
        function getPreferredInitialView() {
            const v = appData && appData.settings ? String(appData.settings.initialView || 'ai-search') : 'ai-search';
            return v === 'dashboard' ? 'dashboard' : 'ai-search';
        }

        function buildRouteState(viewId, boardType = null, postId = null) {
            const state = { page: 'app', viewId: String(viewId || 'dashboard') };
            if (boardType) state.boardType = String(boardType);
            if (postId != null) state.postId = Number(postId);
            return state;
        }

        function syncHistoryRoute(viewId, boardType = null, postId = null, replace = false) {
            if (isApplyingHistoryRoute) return;
            const state = buildRouteState(viewId, boardType, postId);
            if (replace) history.replaceState(state, '');
            else history.pushState(state, '');
        }

        function applyHistoryRoute(state) {
            if (!state || state.page !== 'app' || !state.viewId) return false;
            isApplyingHistoryRoute = true;
            try {
                if (state.viewId === 'detail') {
                    const targetBoardType = state.boardType || currentBoardType || 'IT';
                    switchView('list', targetBoardType, { fromHistory: true, skipHistory: true });
                    if (state.postId != null) openDetail(Number(state.postId), targetBoardType, { fromHistory: true, skipHistory: true });
                    return true;
                }
                switchView(state.viewId, state.boardType || null, { fromHistory: true, skipHistory: true });
                return true;
            } finally {
                isApplyingHistoryRoute = false;
            }
        }

        function setupHistoryNavigation() {
            if (historyRouteInitialized) return;
            historyRouteInitialized = true;
            window.addEventListener('popstate', (event) => {
                if (!currentLoginUser) return;
                const handled = applyHistoryRoute(event.state);
                if (!handled) switchView('dashboard', null, { fromHistory: true, skipHistory: true });
            });
        }

        function getCurrentDateTime() {
            const now = new Date();
            return now.getFullYear() + '.' + String(now.getMonth() + 1).padStart(2, '0') + '.' + String(now.getDate()).padStart(2, '0') + ' ' + 
                   String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        }
        function getCurrentThemeMode() {
            const mode = appData && appData.settings ? String(appData.settings.themeMode || 'system') : 'system';
            return mode === 'light' || mode === 'dark' || mode === 'system' ? mode : 'system';
        }
        function resolveThemeFromMode(mode) {
            const m = String(mode || 'system');
            if (m === 'light') return 'light';
            if (m === 'dark') return 'dark';
            return systemThemeMedia && systemThemeMedia.matches ? 'dark' : 'light';
        }
        function applyThemeMode(mode) {
            const resolved = resolveThemeFromMode(mode);
            document.documentElement.setAttribute('data-theme', resolved);
            document.body.setAttribute('data-theme', resolved);
            localStorage.setItem('knock-theme-mode', String(mode || 'system'));
            localStorage.setItem('knock-theme-resolved', resolved);
            const radios = document.querySelectorAll('input[name="themeMode"]');
            radios.forEach((el) => {
                el.checked = el.value === String(mode || 'system');
            });
        }
        function bindSystemThemeListenerOnce() {
            if (systemThemeListenerBound || !systemThemeMedia) return;
            systemThemeListenerBound = true;
            const handler = () => {
                const mode = getCurrentThemeMode();
                if (mode === 'system') applyThemeMode('system');
            };
            if (typeof systemThemeMedia.addEventListener === 'function') {
                systemThemeMedia.addEventListener('change', handler);
            } else if (typeof systemThemeMedia.addListener === 'function') {
                systemThemeMedia.addListener(handler);
            }
        }
        function getKnowCategoryLabel(category) {
            return KNOW_CATEGORY_LABEL[category] || '-';
        }
        function normalizeKnowStatus(statusRaw) {
            const s = String(statusRaw || '').toLowerCase().trim();
            if (s === KNOW_STATUS.APPROVED || s === 'trained') return KNOW_STATUS.APPROVED;
            if (s === KNOW_STATUS.REJECTED || s === 'error') return KNOW_STATUS.REJECTED;
            if (s === KNOW_STATUS.PENDING || s === 'ready') return KNOW_STATUS.PENDING;
            return KNOW_STATUS.PENDING;
        }
        function getKnowStatusMeta(statusRaw) {
            const s = normalizeKnowStatus(statusRaw);
            if (s === KNOW_STATUS.APPROVED) return { value: KNOW_STATUS.APPROVED, label: '승인', badgeClass: 'bg-trained' };
            if (s === KNOW_STATUS.REJECTED) return { value: KNOW_STATUS.REJECTED, label: '불승인', badgeClass: 'bg-error' };
            return { value: KNOW_STATUS.PENDING, label: '미승인', badgeClass: 'bg-ready' };
        }
        function normalizeKnowPostStatuses(posts) {
            if (!Array.isArray(posts)) return;
            posts.forEach((p) => {
                if (!p || p.type !== 'KNOW') return;
                p.status = normalizeKnowStatus(p.status);
            });
        }
        function getNextPostIdByType(boardType) {
            const scoped = (appData.posts || []).filter((p) => p && p.type === boardType);
            if (!scoped.length) return 1;
            return Math.max(...scoped.map((p) => Number(p.id) || 0)) + 1;
        }
        function getPostByIdAndType(id, typeHint = currentBoardType) {
            const targetId = Number(id);
            if (!Number.isFinite(targetId)) return null;
            const byType = (appData.posts || []).find((p) => Number(p.id) === targetId && (!typeHint || p.type === typeHint));
            if (byType) return byType;
            return (appData.posts || []).find((p) => Number(p.id) === targetId) || null;
        }
        function getPostIndexByIdAndType(id, typeHint = currentBoardType) {
            const targetId = Number(id);
            if (!Number.isFinite(targetId)) return -1;
            let idx = (appData.posts || []).findIndex((p) => Number(p.id) === targetId && (!typeHint || p.type === typeHint));
            if (idx >= 0) return idx;
            return (appData.posts || []).findIndex((p) => Number(p.id) === targetId);
        }
        function getBoardDisplayLabel(post) {
            if (!post) return '-';
            if (post.type === 'KNOW') return getKnowCategoryLabel(post.knowCategory);
            return boardTitles[post.type] ? boardTitles[post.type].label : post.type;
        }
        function getCurrentActorName() {
            if (currentLoginUser) {
                const nm = (currentLoginUser.name || '').trim();
                const pos = (currentLoginUser.position || '').trim();
                const full = `${nm}${pos ? ` ${pos}` : ''}`.trim();
                if (full) return full;
            }
            return roleMatrix[currentRole].name;
        }
        function getCurrentActorNameToken() {
            const actor = getCurrentActorName();
            return (actor || '').split(' ')[0];
        }
        function escapeHtml(text) {
            return String(text || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }
        function normalizeDisplayText(value, fallback = '-') {
            const cleaned = String(value || '')
                .replace(/�+/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            return cleaned || fallback;
        }
        function normalizeProfileImageData(rawValue) {
            const value = String(rawValue || '').trim();
            if (!value) return '';
            if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value)) return '';
            return value;
        }
        function getUserInitial(nameRaw) {
            const name = String(nameRaw || '').replace(/\s+/g, '');
            return name ? name.slice(0, 1) : 'U';
        }
        function getAvatarGradient(seedRaw) {
            const seed = String(seedRaw || '');
            let hash = 0;
            for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
            const gradients = [
                'linear-gradient(135deg, #4f46e5, #06b6d4)',
                'linear-gradient(135deg, #7c3aed, #ec4899)',
                'linear-gradient(135deg, #2563eb, #10b981)',
                'linear-gradient(135deg, #0ea5e9, #14b8a6)',
                'linear-gradient(135deg, #f59e0b, #ef4444)',
                'linear-gradient(135deg, #8b5cf6, #3b82f6)',
            ];
            return gradients[hash % gradients.length];
        }
        function findSignupUserByWriter(writerRaw) {
            const writer = String(writerRaw || '').trim();
            if (!writer) return null;
            const token = writer.split(/\s+/)[0] || writer;
            if (!token) return null;
            return signupUsers.find((u) => String(u && u.name || '').trim() === token) || null;
        }
        function getUserAvatarMarkup(user, nameText, options = {}) {
            const className = String(options.className || 'user-avatar');
            const imageData = normalizeProfileImageData(user && user.profileImage);
            const initial = escapeHtml(getUserInitial(nameText));
            if (imageData) {
                return `<span class="${className}"><img src="${imageData}" alt="프로필"></span>`;
            }
            const seed = String((user && (user.employeeNo || user.name)) || nameText || 'avatar');
            const bg = getAvatarGradient(seed);
            return `<span class="${className}" style="background:${bg};">${initial}</span>`;
        }
        function renderWriterWithAvatar(writerRaw, options = {}) {
            const writerText = normalizeDisplayText(writerRaw, '-');
            const user = findSignupUserByWriter(writerText);
            const avatarMarkup = getUserAvatarMarkup(user, writerText, { className: options.avatarClassName || 'writer-avatar' });
            const wrapperClass = String(options.wrapperClass || 'writer-cell');
            return `<span class="${wrapperClass}">${avatarMarkup}<span class="writer-name">${escapeHtml(writerText)}</span></span>`;
        }
        function sanitizeSignupUserRecord(user) {
            if (!user || typeof user !== 'object') return null;
            const out = {
                ...user,
                name: normalizeDisplayText(user.name, '사용자'),
                deptName: normalizeDisplayText(user.deptName, '-'),
                deptCode: normalizeDisplayText(user.deptCode, '-'),
                position: normalizeDisplayText(user.position, ''),
                grade: normalizeDisplayText(user.grade, ''),
                employeeNo: normalizeDisplayText(user.employeeNo, ''),
                role: normalizeDisplayText(user.role, 'branch'),
                extNo: normalizeDisplayText(user.extNo, '8-0000'),
                faxNo: normalizeDisplayText(user.faxNo, '02-0000-0000'),
                mobileNo: normalizeDisplayText(user.mobileNo, '010-0000-0000'),
                profileImage: normalizeProfileImageData(user.profileImage),
            };
            if (user.isAdmin === true) out.isAdmin = true;
            else if (user.isAdmin === false) out.isAdmin = false;
            else delete out.isAdmin;
            return out;
        }

        function isAiSystemUser(user) {
            if (!user) return false;
            return String(user.employeeNo || '') === AI_SYSTEM_USER_EMP_NO;
        }

        function getVisibleSignupUsers() {
            return signupUsers.filter((u) => !isAiSystemUser(u));
        }

        function formatSignupUserLastAccess(user) {
            if (!user) return '-';
            if (user.isOnline === true) return '접속중';
            const ts = Number(user.lastAccessAt || 0);
            if (!Number.isFinite(ts) || ts <= 0) return '-';
            const diffMs = Math.max(0, Date.now() - ts);
            const minMs = 60 * 1000;
            const hourMs = 60 * minMs;
            const dayMs = 24 * hourMs;
            if (diffMs < minMs) return '1분전';
            if (diffMs < hourMs) return `${Math.floor(diffMs / minMs)}분전`;
            if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)}시간전`;
            return `${Math.floor(diffMs / dayMs)}일전`;
        }

        async function markSignupUserLoginState(employeeNo, isOnline) {
            const targetEmpNo = String(employeeNo || '');
            if (!targetEmpNo || targetEmpNo === AI_SYSTEM_USER_EMP_NO) return;
            const now = Date.now();
            let changed = false;
            signupUsers = signupUsers.map((u) => {
                if (!u || isAiSystemUser(u)) return u;
                const isTarget = String(u.employeeNo || '') === targetEmpNo;
                const nextOnline = isTarget ? !!isOnline : false;
                const prevOnline = !!u.isOnline;
                const next = { ...u };
                if (prevOnline !== nextOnline) {
                    next.isOnline = nextOnline;
                    changed = true;
                }
                if (isTarget) {
                    next.lastAccessAt = now;
                    changed = true;
                }
                return next;
            });
            if (!changed) return;
            await saveSignupUsers();
        }

        function buildAiSystemUserRecord() {
            return sanitizeSignupUserRecord({
                id: 900000,
                name: AI_SYSTEM_USER_NAME,
                employeeNo: AI_SYSTEM_USER_EMP_NO,
                deptName: 'AI 플랫폼',
                deptCode: '0000',
                grade: '시스템',
                position: 'RAG 엔진',
                role: 'it',
                extNo: '8-0000',
                faxNo: '02-0000-0000',
                mobileNo: '010-0000-0000',
                isAdmin: true,
                createdAt: getCurrentDateTime()
            });
        }

        function ensureAiSystemUserInSignupUsers() {
            const idx = signupUsers.findIndex((u) => isAiSystemUser(u));
            const aiUser = buildAiSystemUserRecord();
            if (idx >= 0) {
                const prev = signupUsers[idx];
                const next = { ...aiUser, id: prev.id || aiUser.id, createdAt: prev.createdAt || aiUser.createdAt };
                const changed = JSON.stringify(prev) !== JSON.stringify(next);
                signupUsers[idx] = next;
                return changed;
            }
            signupUsers.unshift(aiUser);
            return true;
        }

        function stripHtmlForRag(rawHtml) {
            return String(rawHtml || '')
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function summarizeRagAnswer(answerText) {
            const text = String(answerText || '').replace(/\s+/g, ' ').trim();
            if (!text) return '';
            if (text.length <= 140) return text;
            return `${text.slice(0, 140).trim()}...`;
        }

        const DEFAULT_RAG_KEYWORD_BLOCKLIST = [
            '대해',
            '대한',
            '관련',
            '관한',
            '기반',
            '통해',
            '위해',
            '경우',
            '사항',
            '부분',
            '방식',
            '정보',
            '요청',
            '처리',
            '확인',
            '정리',
            '설명',
            '설명해줘',
            '설명해주세요',
            '설명해',
            '알려줘',
            '알려주세요',
            '말해줘',
            '말해주세요',
            '보여줘',
            '보여주세요',
            '가능',
            '부탁',
            '참고',
            '및',
            '등',
            '또는',
            '그리고',
            '하지만',
            '즉',
            '예시',
            '예를들어',
            '아래',
            '위',
            '해당',
            '이것',
            '저것',
            '그것',
            '무엇',
            '어떻게',
            '왜',
            '언제',
            '어디',
            'please',
            'pls',
            'kindly',
            'about',
            'regarding',
            'explain',
            'tell',
            'show',
            '내용',
            '문의',
            '질문',
            '답변',
        ];
        let ragKeywordBlocklist = new Set(DEFAULT_RAG_KEYWORD_BLOCKLIST);

        function normalizeKnowKeywordToken(rawToken) {
            return String(rawToken || '')
                .toLowerCase()
                .replace(/[^\w가-힣]/g, '')
                .trim();
        }

        function applyRuntimeRagKeywordBlocklist(rawList) {
            const list = Array.isArray(rawList)
                ? rawList
                : String(rawList || '').split(/[,\n]/g);
            const next = new Set();
            list.forEach((item) => {
                const token = normalizeKnowKeywordToken(item);
                if (!token || token.length < 2) return;
                next.add(token);
            });
            ragKeywordBlocklist = next.size > 0 ? next : new Set(DEFAULT_RAG_KEYWORD_BLOCKLIST);
        }
        window.applyRuntimeRagKeywordBlocklist = applyRuntimeRagKeywordBlocklist;

        function splitAndSanitizeKnowKeywords(rawKeywords) {
            const parts = String(rawKeywords || '')
                .split(',')
                .map((part) => String(part || '').replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            const kept = [];
            const blocked = [];
            const seen = new Set();
            parts.forEach((token) => {
                const normalized = normalizeKnowKeywordToken(token);
                if (!normalized) return;
                if (normalized.length < 2 || ragKeywordBlocklist.has(normalized)) {
                    blocked.push(token);
                    return;
                }
                if (seen.has(normalized)) return;
                seen.add(normalized);
                kept.push(token);
            });
            return { kept, blocked };
        }

        function extractRagKeywords(questionText, answerText) {
            const raw = `${String(questionText || '')} ${String(answerText || '')}`
                .toLowerCase()
                .replace(/[^a-z0-9가-힣\s]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (!raw) return '';
            const stop = new Set(['그리고', '하지만', '에서', '으로', '입니다', '있습니다', '합니다', '대한', '관련', '문의', '질문', '답변', 'the', 'and', 'for', 'with', 'that', 'this']);
            const counts = new Map();
            raw.split(' ').forEach((token) => {
                const t = token.trim();
                if (!t || t.length < 2 || stop.has(t) || ragKeywordBlocklist.has(t)) return;
                counts.set(t, (counts.get(t) || 0) + 1);
            });
            return Array.from(counts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map((item) => item[0])
                .join(', ');
        }

        function createAutoRagKnowledgeFromQA(question, answer, options = {}) {
            const questionText = String(question || '').replace(/\s+/g, ' ').trim();
            const answerText = String(answer || '').replace(/\s+/g, ' ').trim();
            if (!questionText || !answerText || answerText.length < 20) return false;
            const sourceType = String(options.sourceType || 'AI').toUpperCase();
            const sourceRef = String(options.sourceRef || `${Date.now()}`);
            const autoRagKey = `${sourceType}:${sourceRef}`;
            const existing = (appData.posts || []).find((p) =>
                p &&
                p.type === 'KNOW' &&
                p.meta &&
                p.meta.autoGenerated === true &&
                String(p.meta.autoRagKey || '') === autoRagKey
            );
            if (existing) return false;
            const knowCategory = options.boardType === 'IT' ? 'IT' : 'BIZ';
            const now = getCurrentDateTime();
            const nextId = getNextPostIdByType('KNOW');
            const cleanQuestion = questionText.slice(0, 300);
            const cleanAnswer = answerText.slice(0, 4000);
            const summary = summarizeRagAnswer(cleanAnswer);
            const keywords = extractRagKeywords(cleanQuestion, cleanAnswer);
            const sourceLabel = String(options.sourceLabel || 'AI Chat 도움이 됐어요');
            const content = `<div><b>Q.</b> ${escapeHtml(cleanQuestion)}</div><div style="margin-top:8px;"><b>A.</b><br>${escapeHtml(cleanAnswer).replace(/\n/g, '<br>')}</div>`;
            const meta = {
                knowQuestion: cleanQuestion,
                knowAnswer: cleanAnswer,
                knowMemo: 'AI 자동 수집 학습자료',
                knowKeywords: keywords,
                knowSource: sourceLabel,
                knowSummary: summary,
                autoGenerated: true,
                autoRagKey,
                generatedBy: AI_SYSTEM_USER_NAME,
                generatedByEmpNo: AI_SYSTEM_USER_EMP_NO
            };
            appData.posts.unshift({
                id: nextId,
                type: 'KNOW',
                knowCategory,
                title: `[AI자동학습] ${cleanQuestion.slice(0, 48)}`,
                writer: AI_SYSTEM_USER_NAME,
                datetime: now,
                ip: getDummyIp(),
                status: KNOW_STATUS.PENDING,
                content,
                aiContent: '',
                answer: '',
                meta,
                addInfoList: [],
                thread: [],
                attachments: []
            });
            saveData();
            return true;
        }

        /** 플랫폼 관리자(관리자 설정). isAdmin === true 로 명시된 계정만 허용합니다. */
        function resolveUserIsAdmin(user) {
            if (!user) return false;
            return user.isAdmin === true;
        }

        function currentUserHasAdminAccess() {
            return resolveUserIsAdmin(currentLoginUser);
        }
        function getDummyIp() { return '10.124.' + Math.floor(Math.random() * 255) + '.' + Math.floor(Math.random() * 255); }
        function goToAiSearchPage() {
            const aiView = document.getElementById('view-ai-search');
            if (aiView) switchView('ai-search');
            else window.location.href = '/ai-search.html';
        }
        function setCookie(name, value, days = 365) {
            const d = new Date();
            d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
            document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
        }
        function getCookie(name) {
            const key = `${encodeURIComponent(name)}=`;
            const parts = document.cookie.split(';');
            for (let i = 0; i < parts.length; i++) {
                const c = parts[i].trim();
                if (c.startsWith(key)) return decodeURIComponent(c.substring(key.length));
            }
            return '';
        }
        function nowDateTimeLabel() {
            const d = new Date();
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            return `${y}.${m}.${day} ${hh}:${mm}`;
        }
        // AI 채팅(히스토리/인삿말/전송) 기능은 app-ai-search.js로 분리됨.
        function getAppDataUserScope() {
            return APP_DATA_SHARED_SCOPE;
        }
        function getLegacyUserScope() {
            if (currentLoginUser && currentLoginUser.employeeNo) return String(currentLoginUser.employeeNo);
            const cookieScope = getCookie(USER_SCOPE_COOKIE);
            return cookieScope || 'guest';
        }
        async function fetchJson(url, options = {}) {
            try {
                const response = await fetch(url, options);
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    const errorMessage = (data && data.error) || '서버 요청에 실패했습니다.';
                    if (shouldOpenServerErrorPage(response.status)) {
                        openServerErrorPage(response.status, errorMessage);
                    }
                    const err = new Error(errorMessage);
                    err.statusCode = Number(response.status || 0);
                    throw err;
                }
                if (serverErrorPageActive) hideServerErrorPage();
                return data;
            } catch (error) {
                if (error && shouldOpenServerErrorPage(error.statusCode)) throw error;
                // Network-level failure (offline, DNS, reset)
                if (error && String(error.name || '') === 'TypeError') {
                    openServerErrorPage(0, '서버와 연결할 수 없습니다. 네트워크 또는 서버 상태를 확인하세요.');
                }
                throw error;
            }
        }
        async function loadAppDataFromServer() {
            const scope = encodeURIComponent(getAppDataUserScope());
            const data = await fetchJson(`/api/db/app-data?scope=${scope}`);
            const sharedAppData = data && data.appData ? data.appData : { posts: [], settings: { osNotify: true, initialView: 'ai-search', notifyPolicy: getDefaultNotifyPolicy() } };
            const hasSharedPosts = Array.isArray(sharedAppData.posts) && sharedAppData.posts.length > 0;
            if (hasSharedPosts) return sharedAppData;

            // 과거 사용자별 scope에 저장된 데이터를 공용 scope로 1회 자동 마이그레이션
            const legacyScope = getLegacyUserScope();
            if (!legacyScope || legacyScope === APP_DATA_SHARED_SCOPE) return sharedAppData;
            try {
                const legacy = await fetchJson(`/api/db/app-data?scope=${encodeURIComponent(legacyScope)}`);
                const legacyAppData = legacy && legacy.appData ? legacy.appData : null;
                const hasLegacyPosts = !!(legacyAppData && Array.isArray(legacyAppData.posts) && legacyAppData.posts.length > 0);
                if (hasLegacyPosts) {
                    appData = legacyAppData;
                    saveData();
                    showAlert('기존 사용자별 게시 데이터를 공용 데이터로 자동 전환했습니다.', 'success');
                    return legacyAppData;
                }
            } catch (error) {
                console.error('legacy scope migration skipped:', error);
            }
            return sharedAppData;
        }
        function saveData() {
            const scope = encodeURIComponent(getAppDataUserScope());
            fetchJson(`/api/db/app-data?scope=${scope}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ appData })
            }).catch((error) => {
                console.error('saveData failed:', error);
                showAlert('서버 저장에 실패했습니다.', 'error');
            });
        }
        async function loadSharedBoardHelpMap() {
            try {
                const data = await fetchJson('/api/db/board-help');
                return (data && data.boardHelpMap && typeof data.boardHelpMap === 'object') ? data.boardHelpMap : {};
            } catch (error) {
                console.error('loadSharedBoardHelpMap failed:', error);
                return {};
            }
        }
        function saveSharedBoardHelpMap(map) {
            fetchJson('/api/db/board-help', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ boardHelpMap: map || {} })
            }).catch((error) => {
                console.error('saveSharedBoardHelpMap failed:', error);
                showAlert('공용 도움말 저장에 실패했습니다.', 'error');
            });
        }

        // 관리자 설정(프롬프트/권한) 기능은 app-admin-settings.js로 분리됨.

        function formatAttachmentSize(bytes) {
            const n = Number(bytes) || 0;
            if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
            if (n >= 1024) return `${Math.round(n / 1024)}KB`;
            return `${n}B`;
        }

        function renderKnowDetailTemplate(post) {
            const meta = post.meta || {};
            const q = meta.knowQuestion || post.title || '-';
            const a = meta.knowAnswer || '-';
            const memo = meta.knowMemo || '-';
            const summary = meta.knowSummary || '-';
            const keywords = meta.knowKeywords || '-';
            const source = meta.knowSource || '-';
            const domain = getKnowCategoryLabel(post.knowCategory);
            const attachmentHtml = Array.isArray(post.attachments) && post.attachments.length > 0
                ? post.attachments.map(att => `<li class="know-detail-attach-item">${att.name || '첨부파일'} (${formatAttachmentSize(att.size)})</li>`).join('')
                : '<li class="know-detail-attach-empty">첨부파일 없음</li>';

            return `
                <div class="know-detail-stack">
                    <div class="know-detail-banner">
                        <span class="badge bg-ready know-detail-domain-badge">${domain}</span>
                        <span class="rag-chip know-detail-rag-chip">RAG 학습 데이터</span>
                    </div>
                    <div class="know-detail-card">
                        <div class="know-detail-card-label">요약</div>
                        <div class="know-detail-card-value">${summary}</div>
                    </div>
                    <div class="know-detail-card">
                        <div class="know-detail-card-label">키워드</div>
                        <div class="know-detail-card-value know-detail-card-value-sm">${keywords}</div>
                    </div>
                    <div class="know-detail-card">
                        <div class="know-detail-card-label">출처</div>
                        <div class="know-detail-card-value know-detail-card-value-sm">${source}</div>
                    </div>
                    <div class="know-detail-card">
                        <div class="know-detail-card-label">질문 (Q)</div>
                        <div class="know-detail-card-value know-detail-card-q">${q}</div>
                    </div>
                    <div class="know-detail-card">
                        <div class="know-detail-card-label">답변 (A)</div>
                        <div class="know-detail-card-value know-detail-card-a">${a}</div>
                    </div>
                    <div class="know-detail-card">
                        <div class="know-detail-card-label">비고</div>
                        <div class="know-detail-card-value">${memo}</div>
                    </div>
                    <div class="know-detail-card">
                        <div class="know-detail-card-label">첨부파일</div>
                        <ul class="know-detail-attach-list">${attachmentHtml}</ul>
                    </div>
                </div>
            `;
        }

        function renderWriteAttachmentList() {
            const box = document.getElementById('writeAttachmentList');
            if (!box) return;
            if (!Array.isArray(writeAttachmentItems) || writeAttachmentItems.length === 0) {
                box.innerHTML = '첨부된 파일이 없습니다.';
                return;
            }
            box.innerHTML = writeAttachmentItems.map(item => `
                <div class="flex items-center justify-between" style="padding:6px 8px; border:1px solid #e2e8f0; border-radius:6px; margin-top:6px; background:#f8fafc;">
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:8px;">${escapeHtml(item.name)} (${formatAttachmentSize(item.size)})</span>
                    <button type="button" class="btn btn-outline" style="padding:2px 7px; font-size:11px;" onclick="removeWriteAttachmentItem('${item.id}')">삭제</button>
                </div>
            `).join('');
        }

        function removeWriteAttachmentItem(itemId) {
            writeAttachmentItems = writeAttachmentItems.filter(item => item.id !== itemId);
            renderWriteAttachmentList();
        }

        function handleWriteAttachments(fileList) {
            const files = Array.from(fileList || []);
            files.forEach(file => {
                const dup = writeAttachmentItems.some(item => item.name === file.name && Number(item.size) === Number(file.size));
                if (dup) return;
                writeAttachmentItems.push({
                    id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    name: file.name,
                    size: Number(file.size) || 0
                });
            });
            const fileInput = document.getElementById('writeAttachments');
            if (fileInput) fileInput.value = '';
            renderWriteAttachmentList();
        }

        async function initApp() {
            try {
                appData = await loadAppDataFromServer();
            } catch (error) {
                console.error('initApp load failed:', error);
                appData.posts = [...MOCK_INITIAL_DATA];
                showAlert('서버 데이터 로드에 실패해 기본 데이터로 시작합니다.', 'error');
            }
            try {
                const aiSettingsData = await fetchJson('/api/db/ai-settings');
                const runtime = aiSettingsData && aiSettingsData.aiSettings && aiSettingsData.aiSettings.runtime
                    ? aiSettingsData.aiSettings.runtime
                    : {};
                applyRuntimeRagKeywordBlocklist(runtime.ragKeywordBlocklist);
            } catch (error) {
                console.error('load rag keyword blocklist failed:', error);
                applyRuntimeRagKeywordBlocklist([]);
            }
            normalizeKnowPostStatuses(appData.posts);
            if (!appData.settings || typeof appData.settings !== 'object') appData.settings = { osNotify: true, initialView: 'ai-search', notifyPolicy: getDefaultNotifyPolicy() };
            if (typeof appData.settings.osNotify !== 'boolean') appData.settings.osNotify = true;
            if (!appData.settings.themeMode) appData.settings.themeMode = 'system';
            if (appData.settings.initialView !== 'dashboard' && appData.settings.initialView !== 'ai-search') appData.settings.initialView = 'ai-search';
            appData.settings.notifyPolicy = normalizeNotifyPolicy(appData.settings.notifyPolicy);
            if (!appData.settings.boardHelp || typeof appData.settings.boardHelp !== 'object') appData.settings.boardHelp = {};
            const sharedBoardHelp = await loadSharedBoardHelpMap();
            const localBoardHelp = appData.settings.boardHelp || {};
            let migrated = false;
            Object.keys(localBoardHelp).forEach((k) => {
                if (!sharedBoardHelp[k]) {
                    sharedBoardHelp[k] = localBoardHelp[k];
                    migrated = true;
                }
            });
            if (migrated) saveSharedBoardHelpMap(sharedBoardHelp);
            appData.settings.boardHelp = { ...sharedBoardHelp };
            
            if(document.getElementById('setOsNotify')) document.getElementById('setOsNotify').checked = appData.settings.osNotify !== false;
            const notifyPolicy = getCurrentNotifyPolicy();
            const notifyMasterEl = document.querySelector(`input[name="notifyMasterMode"][value="${notifyPolicy.master}"]`);
            const notifyLevelEl = document.querySelector(`input[name="notifyLevelMode"][value="${notifyPolicy.level}"]`);
            const notifyTimeEl = document.querySelector(`input[name="notifyTimeMode"][value="${notifyPolicy.timeMode}"]`);
            if (notifyMasterEl) notifyMasterEl.checked = true;
            if (notifyLevelEl) notifyLevelEl.checked = true;
            if (notifyTimeEl) notifyTimeEl.checked = true;
            const notifyTimeStartEl = document.getElementById('setNotifyTimeStart');
            const notifyTimeEndEl = document.getElementById('setNotifyTimeEnd');
            const notifyExcludeEl = document.getElementById('setNotifyExcludeKeywords');
            const notifyIncludeEl = document.getElementById('setNotifyIncludeKeywords');
            if (notifyTimeStartEl) notifyTimeStartEl.value = notifyPolicy.customStart;
            if (notifyTimeEndEl) notifyTimeEndEl.value = notifyPolicy.customEnd;
            if (notifyExcludeEl) notifyExcludeEl.value = notifyPolicy.excludeKeywords.join(', ');
            if (notifyIncludeEl) notifyIncludeEl.value = notifyPolicy.includeKeywords.join(', ');
            const initialViewEl = document.querySelector(`input[name="initialView"][value="${getPreferredInitialView()}"]`);
            if (initialViewEl) initialViewEl.checked = true;
            applyThemeMode(appData.settings.themeMode || 'system');
            bindSystemThemeListenerOnce();
            applyDashboardWidgetOrder();
            initSidebarNavTooltips();
            bindSidebarHoverTooltipEvents();
            applySidebarTooltipState();
            updateSidebarToggleButton();
            setupEditorPasteAsPlainText();
            initializeAiSearchView();
            
            changeRole(); 
        }
        function initSidebarNavTooltips() {
            document.querySelectorAll('#sidebar .nav-item').forEach((item) => {
                const label = (item.querySelector('.nav-text')?.innerText || '').trim();
                item.setAttribute('data-tooltip', label);
            });
        }
        function ensureSidebarHoverTooltip() {
            let tooltip = document.getElementById('sidebarHoverTooltip');
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.id = 'sidebarHoverTooltip';
                tooltip.className = 'sidebar-hover-tooltip';
                document.body.appendChild(tooltip);
            }
            return tooltip;
        }
        function bindSidebarHoverTooltipEvents() {
            const tooltip = ensureSidebarHoverTooltip();
            const sidebar = document.getElementById('sidebar');
            document.querySelectorAll('#sidebar .nav-item').forEach((item) => {
                if (item.dataset.tooltipBound === '1') return;
                item.dataset.tooltipBound = '1';

                item.addEventListener('mousemove', (event) => {
                    if (!sidebar || !sidebar.classList.contains('collapsed')) return;
                    const label = item.getAttribute('data-tooltip') || '';
                    if (!label) return;
                    tooltip.innerText = label;
                    tooltip.style.left = `${event.clientX + 8}px`;
                    tooltip.style.top = `${event.clientY}px`;
                    tooltip.classList.add('visible');
                });
                item.addEventListener('mouseleave', () => {
                    tooltip.classList.remove('visible');
                });
            });
        }
        function applySidebarTooltipState() {
            const sidebar = document.getElementById('sidebar');
            const isCollapsed = !!sidebar && sidebar.classList.contains('collapsed');
            const hoverTooltip = ensureSidebarHoverTooltip();
            if (!isCollapsed) hoverTooltip.classList.remove('visible');
            document.querySelectorAll('#sidebar .nav-item').forEach((item) => {
                item.removeAttribute('title');
            });
        }

        // --- 테스트용 회원가입 ---
        async function loadSignupUsers() {
            try {
                const data = await fetchJson('/api/db/signup-users');
                const sourceUsers = Array.isArray(data && data.signupUsers) ? data.signupUsers : [];
                const hadLegacyContactGap = sourceUsers.some((u) => {
                    if (!u || typeof u !== 'object') return false;
                    const extNo = String(u.extNo || '').trim();
                    const faxNo = String(u.faxNo || '').trim();
                    const mobileNo = String(u.mobileNo || '').trim();
                    return !extNo || !faxNo || !mobileNo;
                });
                signupUsers = sourceUsers.map(sanitizeSignupUserRecord).filter(Boolean);
                const changed = ensureAiSystemUserInSignupUsers() || hadLegacyContactGap;
                if (changed) saveSignupUsers();
            } catch (error) {
                console.error('loadSignupUsers failed:', error);
                signupUsers = [];
                showAlert('회원 데이터 로드에 실패했습니다.', 'error');
            }
        }

        function saveSignupUsers(options = {}) {
            const rethrow = !!options.rethrow;
            ensureAiSystemUserInSignupUsers();
            return fetchJson('/api/db/signup-users', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ signupUsers })
            }).catch((error) => {
                console.error('saveSignupUsers failed:', error);
                showAlert('회원 데이터 저장에 실패했습니다.', 'error');
                if (rethrow) throw error;
            });
        }

        function updateSignupSavedCount() {
            const countEl = document.getElementById('signupSavedCount');
            if (countEl) countEl.innerText = `저장된 회원: ${getVisibleSignupUsers().length}명`;
        }

        function getRoleDisplayName(role) {
            if (role === 'branch') return '영업점';
            if (role === 'hq') return '본부';
            if (role === 'it') return 'IT';
            return String(role || '-');
        }

        function normalizeSignupEmpNo(raw, doPad) {
            const digits = String(raw || '').replace(/\D/g, '').slice(0, 6);
            return doPad ? digits.padStart(6, '0') : digits;
        }

        function formatSignupEmpNoInput() {
            const el = document.getElementById('signupEmpNo');
            if (!el) return;
            el.value = normalizeSignupEmpNo(el.value, false);
        }

        function padSignupEmpNo() {
            const el = document.getElementById('signupEmpNo');
            if (!el) return;
            el.value = normalizeSignupEmpNo(el.value, true);
        }

        function normalizeDeptCode(raw, doPad) {
            const digits = String(raw || '').replace(/\D/g, '').slice(0, 4);
            return doPad ? digits.padStart(4, '0') : digits;
        }

        function formatDeptCodeInput() {
            const el = document.getElementById('signupDeptCode');
            if (!el) return;
            el.value = normalizeDeptCode(el.value, false);
        }

        function padDeptCodeInput() {
            const el = document.getElementById('signupDeptCode');
            if (!el) return;
            el.value = normalizeDeptCode(el.value, true);
        }

        function resetSignupForm() {
            const formDefaults = {
                signupOriginalEmpNo: '',
                signupName: '',
                signupEmpNo: '',
                signupDeptName: '',
                signupDeptCode: '',
                signupGrade: '3급',
                signupPosition: '대리',
                signupRole: 'branch',
                signupExtNo: '8-0000',
                signupFaxNo: '02-0000-0000',
                signupMobileNo: '010-0000-0000'
            };
            Object.entries(formDefaults).forEach(([id, value]) => {
                const el = document.getElementById(id);
                if (el) el.value = value;
            });
            const adm = document.getElementById('signupIsAdmin');
            if (adm) adm.checked = false;
        }

        function openSignupModal() {
            loadSignupUsers();
            updateSignupSavedCount();
            resetSignupForm();
            document.getElementById('signupModal').classList.add('active');
            setTimeout(() => {
                const first = document.getElementById('signupName');
                if (first) first.focus();
            }, 50);
        }

        function closeSignupModal() {
            document.getElementById('signupModal').classList.remove('active');
        }

        function openLoginTestToolsModal() {
            document.getElementById('loginTestToolsModal').classList.add('active');
        }

        function closeLoginTestToolsModal() {
            document.getElementById('loginTestToolsModal').classList.remove('active');
        }

        function openMemberListFromTestTools() {
            closeLoginTestToolsModal();
            openMemberListModal();
        }

        function openSignupFromTestTools() {
            closeLoginTestToolsModal();
            openSignupModal();
        }

        function submitSignup() {
            padSignupEmpNo();
            padDeptCodeInput();

            const name = (document.getElementById('signupName').value || '').trim();
            const empNo = document.getElementById('signupEmpNo').value;
            const deptName = (document.getElementById('signupDeptName').value || '').trim();
            const deptCode = document.getElementById('signupDeptCode').value;
            const grade = document.getElementById('signupGrade').value;
            const position = document.getElementById('signupPosition').value;
            const role = document.getElementById('signupRole').value;
            const extNo = (document.getElementById('signupExtNo').value || '').trim() || '8-0000';
            const faxNo = (document.getElementById('signupFaxNo').value || '').trim() || '02-0000-0000';
            const mobileNo = (document.getElementById('signupMobileNo').value || '').trim() || '010-0000-0000';
            const originalEmpNo = (document.getElementById('signupOriginalEmpNo').value || '').trim();

            if (!name || !empNo || !deptName || !deptCode) {
                showAlert('필수 항목(이름, 직원번호, 부서명, 부서코드)을 입력해주세요.', 'error');
                return;
            }
            if (!extNo) {
                showAlert('내선번호는 필수 항목입니다.', 'error');
                return;
            }

            const user = {
                id: Date.now(),
                name,
                employeeNo: empNo,
                deptName,
                deptCode,
                grade,
                position,
                role,
                extNo,
                faxNo,
                mobileNo,
                isAdmin: !!(document.getElementById('signupIsAdmin') && document.getElementById('signupIsAdmin').checked),
                createdAt: getCurrentDateTime()
            };
            if (String(user.employeeNo) === AI_SYSTEM_USER_EMP_NO) {
                showAlert('직원번호 000000은 AI 시스템 계정으로 예약되어 있습니다.', 'error');
                return;
            }
            const duplicateIdx = signupUsers.findIndex((u) => u.employeeNo === user.employeeNo && u.employeeNo !== originalEmpNo);
            if (duplicateIdx > -1) {
                showAlert('이미 등록된 직원번호입니다.', 'error');
                return;
            }
            const editingIdx = signupUsers.findIndex((u) => u.employeeNo === originalEmpNo);
            if (editingIdx > -1) {
                const prev = signupUsers[editingIdx];
                signupUsers[editingIdx] = { ...prev, ...user, id: prev.id, createdAt: prev.createdAt };
            } else {
                const sameEmpIdx = signupUsers.findIndex((u) => u.employeeNo === user.employeeNo);
                if (sameEmpIdx > -1) {
                    const prev = signupUsers[sameEmpIdx];
                    signupUsers[sameEmpIdx] = { ...prev, ...user, id: prev.id, createdAt: prev.createdAt };
                } else signupUsers.unshift(user);
            }
            saveSignupUsers();
            updateSignupSavedCount();
            renderMemberList();
            if (typeof renderAdminPermissionsPanel === 'function') {
                renderAdminPermissionsPanel();
            }
            closeSignupModal();
            showAlert('회원가입 정보가 서버에 저장되었습니다.', 'success');
        }

        function openSignupModalForEdit(employeeNo) {
            const target = signupUsers.find((u) => String(u.employeeNo) === String(employeeNo));
            if (!target || isAiSystemUser(target)) return;
            resetSignupForm();
            const formValues = {
                signupOriginalEmpNo: target.employeeNo || '',
                signupName: target.name || '',
                signupEmpNo: target.employeeNo || '',
                signupDeptName: target.deptName || '',
                signupDeptCode: target.deptCode || '',
                signupGrade: target.grade || '기타',
                signupPosition: target.position || '대리',
                signupRole: target.role || 'branch',
                signupExtNo: target.extNo || '8-0000',
                signupFaxNo: target.faxNo || '02-0000-0000',
                signupMobileNo: target.mobileNo || '010-0000-0000',
            };
            Object.entries(formValues).forEach(([id, value]) => {
                const el = document.getElementById(id);
                if (el) el.value = value;
            });
            const adm = document.getElementById('signupIsAdmin');
            if (adm) adm.checked = !!resolveUserIsAdmin(target);
            document.getElementById('signupModal').classList.add('active');
        }
        window.openSignupModalForEdit = openSignupModalForEdit;

        function openMemberListModal() {
            loadSignupUsers();
            renderMemberList();
            document.getElementById('memberListModal').classList.add('active');
        }

        function closeMemberListModal() {
            document.getElementById('memberListModal').classList.remove('active');
        }

        function updateProfileImagePreview() {
            const preview = document.getElementById('profileImagePreview');
            if (!preview) return;
            const activeUser = currentLoginUser || roleMatrix[currentRole];
            const nameText = normalizeDisplayText(activeUser && activeUser.name, '사용자');
            const rawImage = pendingProfileImageData === '__REMOVE__'
                ? ''
                : (pendingProfileImageData || (activeUser && activeUser.profileImage));
            const imageData = normalizeProfileImageData(rawImage);
            if (imageData) {
                preview.innerHTML = `<span class="profile-image-preview-avatar"><img src="${imageData}" alt="프로필"></span>`;
                return;
            }
            const initial = escapeHtml(getUserInitial(nameText));
            const gradient = getAvatarGradient(String((activeUser && (activeUser.employeeNo || activeUser.name)) || 'profile'));
            preview.innerHTML = `<span class="profile-image-preview-avatar" style="background:${gradient};">${initial}</span>`;
        }

        function openProfileImageModal() {
            if (!currentLoginUser || !currentLoginUser.employeeNo) {
                showAlert('로그인 사용자만 프로필 사진을 등록할 수 있습니다.', 'error');
                return;
            }
            pendingProfileImageData = '';
            const input = document.getElementById('profileImageInput');
            if (input) input.value = '';
            updateProfileImagePreview();
            const modal = document.getElementById('profileImageModal');
            if (modal) modal.classList.add('active');
        }

        function closeProfileImageModal() {
            const modal = document.getElementById('profileImageModal');
            if (modal) modal.classList.remove('active');
            pendingProfileImageData = '';
        }

        function handleProfileImageFileChange(event) {
            const file = event && event.target && event.target.files && event.target.files[0];
            if (!file) {
                pendingProfileImageData = '';
                updateProfileImagePreview();
                return;
            }
            if (!/^image\//.test(file.type || '')) {
                showAlert('이미지 파일만 업로드할 수 있습니다.', 'error');
                event.target.value = '';
                return;
            }
            if (file.size > 2 * 1024 * 1024) {
                showAlert('이미지는 2MB 이하만 등록할 수 있습니다.', 'error');
                event.target.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                pendingProfileImageData = normalizeProfileImageData(reader.result);
                updateProfileImagePreview();
            };
            reader.onerror = () => showAlert('이미지 파일을 읽지 못했습니다.', 'error');
            reader.readAsDataURL(file);
        }

        function removeProfileImage() {
            pendingProfileImageData = '__REMOVE__';
            const input = document.getElementById('profileImageInput');
            if (input) input.value = '';
            updateProfileImagePreview();
        }

        async function saveProfileImage() {
            if (!currentLoginUser || !currentLoginUser.employeeNo) return;
            const targetEmpNo = String(currentLoginUser.employeeNo);
            const targetIdx = signupUsers.findIndex((u) => String(u && u.employeeNo || '') === targetEmpNo);
            if (targetIdx < 0) {
                showAlert('사용자 정보를 찾을 수 없습니다.', 'error');
                return;
            }
            const nextImage = pendingProfileImageData === '__REMOVE__'
                ? ''
                : normalizeProfileImageData(pendingProfileImageData || currentLoginUser.profileImage);
            signupUsers[targetIdx] = sanitizeSignupUserRecord({ ...signupUsers[targetIdx], profileImage: nextImage });
            await saveSignupUsers();
            currentLoginUser = signupUsers[targetIdx];
            changeRole();
            filterBoardList();
            if (currentPostId != null) {
                const post = getPostByIdAndType(currentPostId, currentBoardType);
                if (post) openDetail(post.id, post.type, { fromHistory: true, skipHistory: true });
            }
            closeProfileImageModal();
            showAlert('프로필 사진이 저장되었습니다.', 'success');
        }
        window.openProfileImageModal = openProfileImageModal;
        window.closeProfileImageModal = closeProfileImageModal;
        window.handleProfileImageFileChange = handleProfileImageFileChange;
        window.removeProfileImage = removeProfileImage;
        window.saveProfileImage = saveProfileImage;

        function renderMemberList() {
            const wrap = document.getElementById('memberListContainer');
            const summary = document.getElementById('memberListSummary');
            if (!wrap || !summary) return;
            const visibleUsers = getVisibleSignupUsers();
            summary.innerText = `저장된 회원: ${visibleUsers.length}명`;

            if (visibleUsers.length === 0) {
                wrap.innerHTML = '<div class="text-center p-20" style="color:#94a3b8;">저장된 회원이 없습니다. 먼저 회원가입을 진행해주세요.</div>';
                return;
            }

            wrap.innerHTML = `
                <table style="width:100%; border-collapse:collapse; font-size:13px;">
                    <thead style="position:sticky; top:0; background:#f8fafc; z-index:1;">
                        <tr>
                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:left;">이름</th>
                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:left;">직원번호</th>
                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:left;">부서명</th>
                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:left;">부서코드</th>
                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:left;">직급/직책</th>
                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:left;">업무 역할</th>
                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:left;">최근 접속</th>
                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:center;">플랫폼 관리</th>
                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:center; width:170px;">관리</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${visibleUsers.map(u => `
                            <tr>
                                <td style="padding:10px; border-bottom:1px solid #f1f5f9;">${u.name}</td>
                                <td style="padding:10px; border-bottom:1px solid #f1f5f9;">${u.employeeNo}</td>
                                <td style="padding:10px; border-bottom:1px solid #f1f5f9;">${u.deptName}</td>
                                <td style="padding:10px; border-bottom:1px solid #f1f5f9;">${u.deptCode}</td>
                                <td style="padding:10px; border-bottom:1px solid #f1f5f9;">${u.grade} / ${u.position}</td>
                                <td style="padding:10px; border-bottom:1px solid #f1f5f9;">${getRoleDisplayName(u.role)}</td>
                                <td style="padding:10px; border-bottom:1px solid #f1f5f9;">${formatSignupUserLastAccess(u)}</td>
                                <td style="padding:10px; border-bottom:1px solid #f1f5f9; text-align:center;">${resolveUserIsAdmin(u) ? '예' : '아니오'}</td>
                                <td style="padding:10px; border-bottom:1px solid #f1f5f9; text-align:center;">
                                    <button class="btn btn-primary" style="padding:6px 10px; font-size:12px;" onclick="loginByMemberId(${u.id})">선택 로그인</button>
                                    <button class="btn btn-outline" style="padding:6px 10px; font-size:12px; margin-left:6px;" onclick="deleteSignupUser(${u.id})" ${isAiSystemUser(u) ? 'disabled title="AI 시스템 계정은 삭제할 수 없습니다."' : ''}>삭제</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }

        function loginByMemberId(memberId) {
            const user = signupUsers.find(u => u.id === memberId);
            if (!user) {
                showAlert('선택한 회원 정보를 찾을 수 없습니다.', 'error');
                return;
            }
            currentLoginUser = user;
            const loginEmpNo = document.getElementById('loginEmpNo');
            if (loginEmpNo) loginEmpNo.value = user.employeeNo;
            closeMemberListModal();
            doLogin({ skipAuthValidation: true });
        }

        function deleteSignupUser(memberId) {
            const user = signupUsers.find(u => u.id === memberId);
            if (!user) return;
            if (isAiSystemUser(user)) {
                showAlert('AI 시스템 계정은 삭제할 수 없습니다.', 'error');
                return;
            }
            showConfirm(`[${user.name}] 회원 정보를 삭제하시겠습니까?`, () => {
                signupUsers = signupUsers.filter(u => u.id !== memberId);
                saveSignupUsers();
                updateSignupSavedCount();
                renderMemberList();
                showAlert('회원 정보가 삭제되었습니다.', 'success');
            });
        }

        function clearAllSignupUsers() {
            if (signupUsers.length === 0) return;
            showConfirm('저장된 회원 정보를 모두 삭제하시겠습니까?', () => {
                signupUsers = signupUsers.filter((u) => isAiSystemUser(u));
                currentLoginUser = null;
                saveSignupUsers();
                updateSignupSavedCount();
                renderMemberList();
                showAlert('전체 회원 정보가 삭제되었습니다.', 'success');
            });
        }

        // 에디터 선택 상태 리스너
        document.addEventListener('selectionchange', () => {
            const selection = window.getSelection();
            if(selection.rangeCount > 0) {
                let node = selection.anchorNode;
                if(node && node.nodeType === 3) node = node.parentNode;
                const editor = node ? node.closest('.editor-content') : null;
                if(editor) {
                    const toolbar = editor.previousElementSibling;
                    if(toolbar && toolbar.classList.contains('editor-toolbar')) {
                        ['bold', 'italic', 'underline'].forEach(cmd => {
                            const btn = toolbar.querySelector(`.editor-btn[data-cmd="${cmd}"]`);
                            if(btn) {
                                if(document.queryCommandState(cmd)) btn.classList.add('active');
                                else btn.classList.remove('active');
                            }
                        });
                    }
                }
            }
        });

        // --- 로그인 ---
        function normalizeEmployeeNo(raw, doPad) {
            const digits = String(raw || '').replace(/\D/g, '').slice(0, 6);
            return doPad ? digits.padStart(6, '0') : digits;
        }

        function formatEmployeeNoInput() {
            const empInput = document.getElementById('loginEmpNo');
            if (!empInput) return;
            empInput.value = normalizeEmployeeNo(empInput.value, false);
        }

        function padEmployeeNo() {
            const empInput = document.getElementById('loginEmpNo');
            if (!empInput) return;
            empInput.value = normalizeEmployeeNo(empInput.value, true);
        }

        async function doLogin(options = {}) { 
            hideServerErrorPage();
            padEmployeeNo();
            await loadSignupUsers();
            const empNo = (document.getElementById('loginEmpNo').value || '').trim();
            const authTypeEl = document.querySelector('input[name="auth"]:checked');
            const authType = authTypeEl ? authTypeEl.value : 'pwd';
            const authInput = (document.getElementById('authInput').value || '').trim();
            const skipAuthValidation = !!options.skipAuthValidation;

            if (!empNo) {
                showAlert('직원번호를 입력하거나 회원목록에서 선택해주세요.', 'error');
                return;
            }
            if (empNo === AI_SYSTEM_USER_EMP_NO) {
                showAlert('AI 시스템 계정으로는 로그인할 수 없습니다.', 'error');
                return;
            }
            if (!skipAuthValidation && authType === 'pwd' && !authInput) {
                showAlert('비밀번호를 입력해주세요.', 'error');
                return;
            }
            if (!skipAuthValidation && authType === 'motp' && !authInput) {
                showAlert('MOTP 번호를 입력해주세요.', 'error');
                return;
            }
            if (!skipAuthValidation && authType === 'vein') {
                document.getElementById('veinModal').classList.add('active');
                return;
            }

            if (!currentLoginUser || currentLoginUser.employeeNo !== empNo) {
                currentLoginUser = signupUsers.find(u => u.employeeNo === empNo) || null;
            }
            if (!currentLoginUser) {
                showAlert('저장된 회원이 아닙니다. 회원가입 후 이용해주세요.', 'error');
                return;
            }
            await markSignupUserLoginState(currentLoginUser.employeeNo, true);
            currentLoginUser = signupUsers.find(u => u.employeeNo === empNo) || currentLoginUser;

            currentRole = currentLoginUser.role || 'branch';
            if (currentLoginUser.employeeNo) setCookie(USER_SCOPE_COOKIE, currentLoginUser.employeeNo);
            localStorage.setItem('knockLoginNonce', String(Date.now()));
            aiSearchInitialized = false;
            aiSearchActive = null;
            aiSearchHistory = [];
            if (!currentSessionIp) currentSessionIp = getDummyIp();
            document.getElementById('loginPage').style.display = 'none'; 
            const appContainer = document.getElementById('appContainer');
            appContainer.style.visibility = 'hidden';
            appContainer.style.display = 'flex';
            appContainer.classList.remove('page-intro');
            void appContainer.offsetWidth;
            appContainer.classList.add('page-intro');
            await initApp();
            const preferredInitialView = getPreferredInitialView();
            if (preferredInitialView === 'dashboard') {
                switchView('dashboard');
                setTimeout(updateHeaderActionOverflow, 0);
                setupHistoryNavigation();
                syncHistoryRoute('dashboard', null, null, true);
            } else {
                goToAiSearchPage();
                setTimeout(updateHeaderActionOverflow, 0);
                setupHistoryNavigation();
                syncHistoryRoute('ai-search', null, null, true);
            }
            requestAnimationFrame(() => { appContainer.style.visibility = 'visible'; });
        }
        function doLogout() {
            hideServerErrorPage();
            const logoutEmpNo = currentLoginUser && currentLoginUser.employeeNo ? String(currentLoginUser.employeeNo) : '';
            if (logoutEmpNo) {
                markSignupUserLoginState(logoutEmpNo, false).catch((error) => {
                    console.error('markSignupUserLoginState(logout) failed:', error);
                });
            }
            clearCookie(USER_SCOPE_COOKIE);
            localStorage.setItem('knockLoginNonce', String(Date.now()));
            aiSearchInitialized = false;
            aiSearchActive = null;
            aiSearchHistory = [];
            document.getElementById('loginPage').style.display = 'flex';
            const appContainer = document.getElementById('appContainer');
            appContainer.style.display = 'none';
            appContainer.style.visibility = 'visible';
            closeHeaderProfileOverlay();
            currentLoginUser = null;
        }
        function saveSettings() {
            const osNotifyEl = document.getElementById('setOsNotify');
            const themeEl = document.querySelector('input[name="themeMode"]:checked');
            const initialViewEl = document.querySelector('input[name="initialView"]:checked');
            const notifyMasterEl = document.querySelector('input[name="notifyMasterMode"]:checked');
            const notifyLevelEl = document.querySelector('input[name="notifyLevelMode"]:checked');
            const notifyTimeEl = document.querySelector('input[name="notifyTimeMode"]:checked');
            const notifyTimeStartEl = document.getElementById('setNotifyTimeStart');
            const notifyTimeEndEl = document.getElementById('setNotifyTimeEnd');
            const notifyExcludeEl = document.getElementById('setNotifyExcludeKeywords');
            const notifyIncludeEl = document.getElementById('setNotifyIncludeKeywords');
            if (!appData.settings || typeof appData.settings !== 'object') appData.settings = {};
            appData.settings.osNotify = !(osNotifyEl && !osNotifyEl.checked);
            appData.settings.themeMode = themeEl ? String(themeEl.value || 'system') : 'system';
            appData.settings.initialView = initialViewEl && initialViewEl.value === 'dashboard' ? 'dashboard' : 'ai-search';
            appData.settings.notifyPolicy = normalizeNotifyPolicy({
                master: notifyMasterEl && notifyMasterEl.value === 'block' ? 'block' : 'allow',
                level: notifyLevelEl && notifyLevelEl.value === 'important' ? 'important' : 'all',
                timeMode: notifyTimeEl ? String(notifyTimeEl.value || 'all') : 'all',
                customStart: notifyTimeStartEl ? String(notifyTimeStartEl.value || '09:00') : '09:00',
                customEnd: notifyTimeEndEl ? String(notifyTimeEndEl.value || '18:00') : '18:00',
                excludeKeywords: normalizeKeywordList(notifyExcludeEl ? notifyExcludeEl.value : ''),
                includeKeywords: normalizeKeywordList(notifyIncludeEl ? notifyIncludeEl.value : ''),
            });
            applyThemeMode(appData.settings.themeMode);
            saveData();
            showAlert('설정이 저장되었습니다.', 'success');
        }
        function clearCookie(name) {
            document.cookie = `${encodeURIComponent(name)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
        }
        function confirmResetTestDatabase() {
            showConfirm('테스트 DB를 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.', resetTestDatabase);
        }
        function resetTestDatabase() {
            fetchJson('/api/db/reset', { method: 'POST' })
                .then(() => {
                    clearCookie(USER_SCOPE_COOKIE);
                    appData = { posts: [], settings: { osNotify: true, initialView: 'ai-search', notifyPolicy: getDefaultNotifyPolicy() } };
                    signupUsers = [];
                    currentSessionIp = '';
                    doLogout();
                    showAlert('서버 DB 초기화가 완료되었습니다.', 'success');
                })
                .catch((error) => {
                    console.error('resetTestDatabase failed:', error);
                    showAlert('서버 DB 초기화에 실패했습니다.', 'error');
                });
        }
        function toggleHeaderProfileOverlay(event) {
            if (event) event.stopPropagation();
            closeHeaderActionsLayer();
            const overlay = document.getElementById('headerProfileOverlay');
            if (!overlay) return;
            overlay.classList.toggle('active');
        }
        function closeHeaderProfileOverlay() {
            const overlay = document.getElementById('headerProfileOverlay');
            if (overlay) overlay.classList.remove('active');
        }
        function closeHeaderActionsLayer() {
            const layer = document.getElementById('headerActionsLayer');
            if (layer) layer.classList.remove('active');
        }
        function toggleHeaderActionsLayer(event) {
            if (event) event.stopPropagation();
            closeHeaderProfileOverlay();
            const layer = document.getElementById('headerActionsLayer');
            if (!layer) return;
            layer.classList.toggle('active');
        }
        function updateHeaderActionOverflow() {
            const right = document.querySelector('.header-right');
            const moreBtn = document.getElementById('headerActionsMoreBtn');
            if (!right || !moreBtn) return;
            closeHeaderActionsLayer();
            const targets = Array.from(right.querySelectorAll('[data-overflow-target="true"]'));
            targets.forEach((el) => el.classList.remove('hidden'));
            moreBtn.classList.add('hidden');
            const visibleTargets = targets.filter((el) => !!el && el.offsetParent !== null);
            if (!visibleTargets.length) return;
            if (right.scrollWidth <= right.clientWidth) return;
            moreBtn.classList.remove('hidden');
            const sortedHideOrder = [...visibleTargets].sort(
                (a, b) => Number(b.dataset.overflowPriority || 0) - Number(a.dataset.overflowPriority || 0),
            );
            for (const el of sortedHideOrder) {
                el.classList.add('hidden');
                if (right.scrollWidth <= right.clientWidth) break;
            }
            if (right.scrollWidth > right.clientWidth) {
                moreBtn.classList.add('hidden');
            }
        }
        
        function changeAuthType(type) {
            const input = document.getElementById('authInput');
            const icon = document.getElementById('authIcon');
            if(type === 'pwd') {
                input.disabled = false; input.type = 'password'; input.placeholder = '비밀번호 입력';
            } else if (type === 'motp') {
                input.disabled = false; input.type = 'text'; input.placeholder = 'MOTP 숫자 6자리 입력';
            } else if (type === 'vein') {
                input.disabled = true; input.value = ''; input.placeholder = '지정맥 인증 진행 중...';
                document.getElementById('veinModal').classList.add('active');
            }
            if(type !== 'vein') input.focus();
        }

        function cancelVein() { document.getElementById('veinModal').classList.remove('active'); document.querySelector('input[value="pwd"]').checked = true; changeAuthType('pwd'); }

        // --- 뷰 제어 ---
        function toggleSidebarPC() {
            if (window.matchMedia('(max-width: 1024px)').matches) {
                const topNav = document.getElementById('topNavMobile');
                if (topNav) topNav.classList.toggle('collapsed');
                updateSidebarToggleButton();
                const listViewMobile = document.getElementById('view-list');
                if (listViewMobile && listViewMobile.classList.contains('active')) {
                    setTimeout(syncBoardListCardMode, 0);
                }
                return;
            }
            const sidebar = document.getElementById('sidebar');
            if (!sidebar) return;
            const icon = document.getElementById('sidebarToggleIcon');
            if (icon) icon.classList.add('animating');
            sidebar.classList.toggle('collapsed');
            applySidebarTooltipState();
            updateSidebarToggleButton();
            if (icon) setTimeout(() => icon.classList.remove('animating'), 180);
            setTimeout(renderCSSCharts, 300);
            const listView = document.getElementById('view-list');
            if (listView && listView.classList.contains('active')) {
                setTimeout(syncBoardListCardMode, 0);
                setTimeout(syncBoardListCardMode, 320);
            }
        }
        function updateSidebarToggleButton() {
            const btn = document.getElementById('sidebarToggleBtn');
            const iconUse = document.querySelector('#sidebarToggleIcon use');
            if (!btn || !iconUse) return;
            const isMobile = window.matchMedia('(max-width: 1024px)').matches;
            if (isMobile) {
                const topNav = document.getElementById('topNavMobile');
                const collapsed = !!topNav && topNav.classList.contains('collapsed');
                iconUse.setAttribute('href', collapsed ? '#icon-bars' : '#icon-chevron-down');
                btn.setAttribute('title', collapsed ? '상단 메뉴 펼치기' : '상단 메뉴 접기');
                return;
            }
            const sidebar = document.getElementById('sidebar');
            if (!sidebar) return;
            const collapsed = sidebar.classList.contains('collapsed');
            iconUse.setAttribute('href', collapsed ? '#icon-bars' : '#icon-chevron-left');
            btn.setAttribute('title', collapsed ? '메뉴 펼치기' : '메뉴 접기');
        }

        // --- Dashboard Widgets / Charts ---
        let dashboardEditMode = false;
        let draggedWidget = null;
        const DASH_WIDGET_ORDER_KEY = 'knockDashboardWidgetOrderV1';

        function getDashboardWidgetOrderKey() {
            return `${DASH_WIDGET_ORDER_KEY}_${currentRole}`;
        }

        function saveDashboardWidgetOrder() {
            const container = document.getElementById('dashboardWidgetContainer');
            if (!container) return;
            const order = Array.from(container.querySelectorAll('.draggable-widget'))
                .map(widget => widget.id)
                .filter(Boolean);
            localStorage.setItem(getDashboardWidgetOrderKey(), JSON.stringify(order));
        }

        function applyDashboardWidgetOrder() {
            const container = document.getElementById('dashboardWidgetContainer');
            if (!container) return;
            const stored = localStorage.getItem(getDashboardWidgetOrderKey());
            if (!stored) return;

            try {
                const order = JSON.parse(stored);
                if (!Array.isArray(order)) return;
                order.forEach((widgetId) => {
                    const widget = document.getElementById(widgetId);
                    if (widget && widget.parentElement === container) container.appendChild(widget);
                });
            } catch (e) {
                // ignore broken localStorage data and keep default order
            }
        }

        function renderCSSCharts() {
            const trendHost = document.getElementById('mainTrendChart');
            if (trendHost) drawTrendChart(trendHost);

            const pieHost = document.getElementById('mainPieChart');
            if (pieHost) drawPieChart(pieHost);
        }
        function getChartHostSize(host, minW = 320, minH = 220) {
            const rect = host.getBoundingClientRect();
            if (rect.width > 10 && rect.height > 10) {
                return { width: Math.max(minW, Math.floor(rect.width)), height: Math.max(minH, Math.floor(rect.height)) };
            }
            const parent = host.parentElement;
            const pw = parent ? parent.clientWidth : 0;
            const ph = parent ? parent.clientHeight : 0;
            return {
                width: Math.max(minW, (pw ? pw - 20 : 520)),
                height: Math.max(minH, (ph ? ph - 18 : 280))
            };
        }

        function parsePostDate(datetimeStr) {
            // expected: "YYYY.MM.DD HH:MM"
            if (!datetimeStr || typeof datetimeStr !== 'string') return null;
            const m = datetimeStr.match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
            if (!m) return null;
            const year = parseInt(m[1], 10);
            const month = parseInt(m[2], 10) - 1;
            const day = parseInt(m[3], 10);
            const hour = parseInt(m[4], 10);
            const minute = parseInt(m[5], 10);
            return new Date(year, month, day, hour, minute, 0, 0);
        }

        function startOfDay(date) {
            return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
        }

        function getDashboardPostsForCharts() {
            const posts = Array.isArray(appData.posts) ? appData.posts : [];
            const nonKnow = posts.filter(p => p && p.type && p.type !== 'KNOW');
            if (currentRole === 'branch') {
                const myName = roleMatrix[currentRole].name.split(' ')[0];
                return nonKnow.filter(p => (p.writer || '').includes(myName));
            }
            return nonKnow;
        }

        function getLastNDaysLabels(n) {
            const labels = [];
            const now = new Date();
            for (let i = n - 1; i >= 0; i--) {
                const d = new Date(now);
                d.setDate(now.getDate() - i);
                labels.push(`${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`);
            }
            return labels;
        }

        function computeTrendSeries(nDays = 7) {
            const posts = getDashboardPostsForCharts();
            const now = new Date();
            const day0 = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (nDays - 1)));
            const buckets = new Array(nDays).fill(0);

            posts.forEach((p) => {
                const dt = parsePostDate(p.datetime);
                if (!dt) return;
                const day = startOfDay(dt);
                const diffDays = Math.floor((day.getTime() - day0.getTime()) / (24 * 60 * 60 * 1000));
                if (diffDays >= 0 && diffDays < nDays) buckets[diffDays] += 1;
            });

            return buckets;
        }

        function computePieShares() {
            const posts = getDashboardPostsForCharts();
            const counts = { IT: 0, BIZ: 0, SYS: 0 };
            posts.forEach((p) => {
                if (p.type === 'IT' || p.type === 'BIZ' || p.type === 'SYS') counts[p.type] += 1;
            });
            const total = counts.IT + counts.BIZ + counts.SYS;
            if (total === 0) return { IT: 0, BIZ: 0, SYS: 0 };
            return {
                IT: Math.round((counts.IT / total) * 100),
                BIZ: Math.round((counts.BIZ / total) * 100),
                SYS: Math.max(0, 100 - Math.round((counts.IT / total) * 100) - Math.round((counts.BIZ / total) * 100)),
            };
        }

        function drawTrendChart(host) {
            host.classList.add('chart-host');
            const { width, height } = getChartHostSize(host, 320, 220);
            const values = computeTrendSeries(7);
            const labels = getLastNDaysLabels(7);
            const maxVal = Math.max(...values, 1);
            const padX = 34, padTop = 18, padBottom = 30;
            const chartW = width - padX * 2;
            const chartH = height - padTop - padBottom;
            const points = values.map((val, i) => {
                const x = padX + (chartW * i / (values.length - 1));
                const y = padTop + chartH - ((val / maxVal) * (chartH * 0.88));
                return { x, y, val };
            });
            const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
            const grid = Array.from({ length: 5 }).map((_, i) => {
                const y = padTop + (chartH * i / 4);
                return `<line x1="${padX}" y1="${y.toFixed(1)}" x2="${(padX + chartW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`;
            }).join('');
            const dots = points.map((p, i) =>
                `<circle class="trend-dot js-trend-point" data-label="${labels[i]}" data-value="${p.val}" data-idx="${i}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#005BAC"/>
                 <text x="${(p.x - 14).toFixed(1)}" y="${(height - 10).toFixed(1)}" font-size="11" fill="#64748b">${labels[i]}</text>`
            ).join('');
            host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
                ${grid}
                <path class="js-trend-line" d="${pathD}" fill="none" stroke="#005BAC" stroke-width="3" />
                ${dots}
            </svg>
            <div class="chart-tooltip" id="trendChartTooltip"></div>`;

            const tooltip = host.querySelector('#trendChartTooltip');
            const pointEls = host.querySelectorAll('.js-trend-point');
            pointEls.forEach((point) => {
                const idx = Number(point.getAttribute('data-idx') || 0);
                point.style.animationDelay = `${idx * 0.07}s`;
                point.addEventListener('mousemove', (event) => {
                    if (!tooltip) return;
                    const rect = host.getBoundingClientRect();
                    tooltip.style.left = `${event.clientX - rect.left}px`;
                    tooltip.style.top = `${event.clientY - rect.top}px`;
                    tooltip.innerHTML = `<b>${point.getAttribute('data-label')}</b><br>문의 ${point.getAttribute('data-value')}건`;
                    tooltip.classList.add('visible');
                });
                point.addEventListener('mouseleave', () => {
                    if (tooltip) tooltip.classList.remove('visible');
                });
            });

            const line = host.querySelector('.js-trend-line');
            if (line) {
                const totalLength = line.getTotalLength();
                line.style.setProperty('--path-len', totalLength.toFixed(1));
                line.style.strokeDasharray = `${totalLength.toFixed(1)}`;
                line.style.strokeDashoffset = `${totalLength.toFixed(1)}`;
                line.style.animation = 'trendPathDraw 0.9s ease forwards';
            }
        }

        function drawPieChart(host) {
            host.classList.add('chart-host');
            const shares = computePieShares();
            const data = [
                { label: 'IT', value: shares.IT, color: '#005BAC' },
                { label: '업무', value: shares.BIZ, color: '#60a5fa' },
                { label: '개선', value: shares.SYS, color: '#c084fc' }
            ];
            const total = data.reduce((sum, d) => sum + d.value, 0);
            const size = 188;
            const center = 94;
            const radius = 80;
            const innerRadius = 44;
            const toRad = (deg) => (deg - 90) * Math.PI / 180;
            const arcPath = (startDeg, endDeg) => {
                const largeArc = endDeg - startDeg > 180 ? 1 : 0;
                const x1 = center + radius * Math.cos(toRad(startDeg));
                const y1 = center + radius * Math.sin(toRad(startDeg));
                const x2 = center + radius * Math.cos(toRad(endDeg));
                const y2 = center + radius * Math.sin(toRad(endDeg));
                const ix1 = center + innerRadius * Math.cos(toRad(endDeg));
                const iy1 = center + innerRadius * Math.sin(toRad(endDeg));
                const ix2 = center + innerRadius * Math.cos(toRad(startDeg));
                const iy2 = center + innerRadius * Math.sin(toRad(startDeg));
                return [
                    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
                    `A ${radius} ${radius} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
                    `L ${ix1.toFixed(2)} ${iy1.toFixed(2)}`,
                    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix2.toFixed(2)} ${iy2.toFixed(2)}`,
                    'Z'
                ].join(' ');
            };
            let accDeg = 0;
            const slices = data.map((d, i) => {
                const angle = total > 0 ? (d.value / total) * 360 : 0;
                const start = accDeg;
                const end = accDeg + angle;
                accDeg = end;
                return `<path class="pie-slice js-pie-slice" data-label="${d.label}" data-value="${d.value}" d="${arcPath(start, end)}" fill="${d.color}" style="animation-delay:${(i * 0.08).toFixed(2)}s;"></path>`;
            }).join('');
            host.innerHTML = `
                <div style="height:100%;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:4px 10px 4px 4px;">
                    <div style="position:relative;flex-shrink:0;width:${size}px;height:${size}px;">
                        <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="시스템 점유 비중 차트">
                            ${slices}
                        </svg>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:10px;min-width:120px;">
                        ${data.map(d => `<div class="js-pie-legend" data-label="${d.label}" data-value="${d.value}" style="display:flex;align-items:center;gap:8px;font-size:13px;color:#334155;"><span style="width:12px;height:12px;border-radius:3px;background:${d.color};display:inline-block;"></span><b>${d.label}</b> ${d.value}%</div>`).join('')}
                    </div>
                </div>
                <div class="chart-tooltip" id="pieChartTooltip"></div>
            `;

            const tooltip = host.querySelector('#pieChartTooltip');
            const showTooltip = (event, label, value) => {
                if (!tooltip) return;
                const rect = host.getBoundingClientRect();
                tooltip.style.left = `${event.clientX - rect.left}px`;
                tooltip.style.top = `${event.clientY - rect.top}px`;
                tooltip.innerHTML = `<b>${label}</b><br>점유율 ${value}%`;
                tooltip.classList.add('visible');
            };
            const hideTooltip = () => { if (tooltip) tooltip.classList.remove('visible'); };

            host.querySelectorAll('.js-pie-slice, .js-pie-legend').forEach((el) => {
                el.addEventListener('mousemove', (event) => {
                    showTooltip(event, el.getAttribute('data-label'), el.getAttribute('data-value'));
                });
                el.addEventListener('mouseleave', hideTooltip);
            });
        }

        function toggleDashboardEditMode() {
            dashboardEditMode = !dashboardEditMode;
            const view = document.getElementById('view-dashboard');
            if (view) view.classList.toggle('dashboard-editing', dashboardEditMode);
            const button = document.querySelector('#view-dashboard button.btn.btn-outline');
            const widgets = document.querySelectorAll('#dashboardWidgetContainer .draggable-widget');
            const handles = document.querySelectorAll('#dashboardWidgetContainer .drag-handle');

            handles.forEach(handle => handle.classList.toggle('hidden', !dashboardEditMode));
            widgets.forEach(widget => {
                widget.draggable = dashboardEditMode;
                widget.style.cursor = dashboardEditMode ? 'grab' : 'default';
                widget.style.outline = dashboardEditMode ? '1px dashed #93c5fd' : 'none';
                widget.style.outlineOffset = dashboardEditMode ? '2px' : '0';
            });

            if (button) button.innerText = dashboardEditMode ? '편집 완료' : '위젯 편집';
            if (!dashboardEditMode) saveDashboardWidgetOrder();
            showAlert(dashboardEditMode ? '위젯 편집 모드가 활성화되었습니다.' : '위젯 편집 모드가 종료되었습니다.', 'success');
        }

        document.addEventListener('dragstart', (event) => {
            if (!dashboardEditMode) return;
            const target = event.target.closest('.draggable-widget');
            if (!target) return;
            draggedWidget = target;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', target.id || '');
            target.style.opacity = '0.5';
        });

        document.addEventListener('dragend', (event) => {
            const target = event.target.closest('.draggable-widget');
            if (target) target.style.opacity = '1';
            draggedWidget = null;
            if (dashboardEditMode) saveDashboardWidgetOrder();
        });

        document.addEventListener('dragover', (event) => {
            if (!dashboardEditMode) return;
            const container = document.getElementById('dashboardWidgetContainer');
            const overWidget = event.target.closest('.draggable-widget');
            if (!container || !draggedWidget || !overWidget || overWidget === draggedWidget) return;
            event.preventDefault();
            const rect = overWidget.getBoundingClientRect();
            const insertAfter = event.clientY > rect.top + rect.height / 2;
            if (insertAfter) container.insertBefore(draggedWidget, overWidget.nextSibling);
            else container.insertBefore(draggedWidget, overWidget);
        });

        function changeRole() {
            const activeUser = currentLoginUser || roleMatrix[currentRole];
            const roleNameRaw = roleMatrix[currentRole].name || '';
            const roleNameParts = roleNameRaw.split(' ');
            const defaultNameOnly = roleNameParts[0] || roleNameRaw;
            const defaultPosition = roleNameParts.slice(1).join(' ') || '';
            const activeName = currentLoginUser
                ? normalizeDisplayText(activeUser.name || defaultNameOnly, defaultNameOnly || '사용자')
                : normalizeDisplayText(defaultNameOnly, '사용자');
            const activePosition = currentLoginUser
                ? normalizeDisplayText(activeUser.position || '', '')
                : normalizeDisplayText(defaultPosition, '');
            const activeDept = normalizeDisplayText(activeUser.deptName || activeUser.dept || roleMatrix[currentRole].dept || '-', '-');
            const userDisplay = `${activeName}${activePosition ? ' ' + activePosition : ''}`;
            const deptDisplay = `${activeDept}(${normalizeDisplayText(activeUser.deptCode || '-', '-')})`;
            const mbUser = document.getElementById('mobileUserName');
            if(mbUser) mbUser.innerText = userDisplay;
            
            const orgLabel = currentRole === 'branch' ? '영업점' : (currentRole === 'hq' ? '본부' : 'IT');
            const rName = currentUserHasAdminAccess() ? `${orgLabel} · 관리` : orgLabel;
            const hoverText = document.getElementById('headerProfileHoverText');
            if (hoverText) hoverText.innerText = `${userDisplay} | ${deptDisplay}`;
            const headerRoleChip = document.getElementById('headerRoleChip');
            if (headerRoleChip) headerRoleChip.innerText = rName;
            const overlayUserDisplay = document.getElementById('overlayUserDisplay');
            if (overlayUserDisplay) overlayUserDisplay.innerText = userDisplay;
            const overlayUserDept = document.getElementById('overlayUserDept');
            if (overlayUserDept) overlayUserDept.innerText = deptDisplay;
            const overlayProfileInitial = document.getElementById('overlayProfileInitial');
            if (overlayProfileInitial) {
                const imageData = normalizeProfileImageData(activeUser.profileImage);
                if (imageData) {
                    overlayProfileInitial.style.background = '';
                    overlayProfileInitial.innerHTML = `<img src="${imageData}" alt="프로필">`;
                } else {
                    const initial = escapeHtml(getUserInitial(activeName));
                    const gradient = getAvatarGradient(String(activeUser.employeeNo || activeName || 'overlay'));
                    overlayProfileInitial.innerHTML = initial;
                    overlayProfileInitial.style.background = gradient;
                }
            }
            const overlayEmployeeNo = document.getElementById('overlayEmployeeNo');
            if (overlayEmployeeNo) overlayEmployeeNo.innerText = activeUser.employeeNo || '-';
            const overlayExtNo = document.getElementById('overlayExtNo');
            if (overlayExtNo) overlayExtNo.innerText = normalizeDisplayText(activeUser.extNo, '8-0000');
            const overlayFaxNo = document.getElementById('overlayFaxNo');
            if (overlayFaxNo) overlayFaxNo.innerText = normalizeDisplayText(activeUser.faxNo, '02-0000-0000');
            const overlayMobileNo = document.getElementById('overlayMobileNo');
            if (overlayMobileNo) overlayMobileNo.innerText = normalizeDisplayText(activeUser.mobileNo, '010-0000-0000');
            const overlaySessionInfo = document.getElementById('overlaySessionInfo');
            if (overlaySessionInfo) overlaySessionInfo.innerText = `IP ${currentSessionIp || '-'}`;
            const overlayGreetingText = document.getElementById('overlayGreetingText');
            if (overlayGreetingText) {
                const greet = '안녕하세요. IBK KNOCK입니다.';
                overlayGreetingText.innerText = greet;
            }

            applyDashboardWidgetOrder();

            document.querySelectorAll('.hq-it-only').forEach(el => {
                if(roleMatrix[currentRole].showKnow) { el.classList.remove('hidden'); el.classList.add('flex'); }
                else { el.classList.add('hidden'); el.classList.remove('flex'); }
            });

            document.querySelectorAll('.platform-admin-only').forEach(el => {
                if (currentUserHasAdminAccess()) {
                    el.classList.remove('hidden');
                    if (el.classList.contains('top-nav-item')) el.classList.add('flex');
                } else {
                    el.classList.add('hidden');
                    if (el.classList.contains('top-nav-item')) el.classList.remove('flex');
                }
            });

            if (currentRole === 'branch' && currentBoardType === 'KNOW') { switchView('dashboard'); return; }
            const preferred = resolveInitialViewForRole();
            if (preferred) {
                initialRouteApplied = true;
                switchView(preferred.viewId, preferred.boardType);
                return;
            }
            switchView(getPreferredInitialView());
        }

        function updatePermissionsUI() {
            const rules = roleMatrix[currentRole];
            const listWriteBtn = document.getElementById('listWriteBtn');
            if (listWriteBtn) {
                listWriteBtn.style.display = rules.write.includes(currentBoardType) ? 'inline-flex' : 'none';
                if(currentBoardType === 'KNOW') document.getElementById('listWriteBtnText').innerText = '지식 등록';
                else document.getElementById('listWriteBtnText').innerText = '신규 접수';
            }
        }
        function getBoardHelpTextByType(type) {
            const cfg = getBoardHelpConfigByType(type);
            return cfg.text;
        }
        function getBoardHelpConfigByType(type) {
            const shared = loadSharedBoardHelpMap();
            const local = (appData.settings && appData.settings.boardHelp) ? appData.settings.boardHelp : {};
            const map = { ...local, ...shared };
            const raw = map[type];
            if (raw && typeof raw === 'object') {
                const text = String(raw.text || raw.html || '').trim();
                const html = String(raw.html || '').trim();
                return {
                    text,
                    html,
                    hasContent: !!String(text || html).replace(/<[^>]+>/g, '').trim(),
                    updatedAt: Number(raw.updatedAt || 0)
                };
            }
            const legacyText = String(raw || '').trim();
            return { text: legacyText, html: '', hasContent: !!legacyText, updatedAt: 0 };
        }
        function getBoardHelpUiState() {
            if (!appData.settings || typeof appData.settings !== 'object') appData.settings = { osNotify: true, initialView: 'ai-search', notifyPolicy: getDefaultNotifyPolicy() };
            if (!appData.settings.boardHelpUi || typeof appData.settings.boardHelpUi !== 'object') appData.settings.boardHelpUi = {};
            const ui = appData.settings.boardHelpUi;
            if (!ui.collapsedByType || typeof ui.collapsedByType !== 'object') ui.collapsedByType = {};
            if (!ui.seenAtByType || typeof ui.seenAtByType !== 'object') ui.seenAtByType = {};
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
            const normalized = String(text || '').trim();
            if (!normalized) return '';
            const SOFT_BR_TOKEN = '__BOARD_HELP_SOFT_BR__';
            const normalizedHtml = normalized
                .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
                .replace(/\son\w+="[^"]*"/gi, '')
                .replace(/\son\w+='[^']*'/gi, '');
            const withLineBreaks = normalizedHtml
                .replace(/<br\s*\/?>/gi, SOFT_BR_TOKEN)
                .replace(/<\/(div|p|li|h[1-6])>/gi, '\n')
                .replace(/<(div|p|li|h[1-6])[^>]*>/gi, '')
                .replace(new RegExp(SOFT_BR_TOKEN, 'g'), '<br>');
            const lines = withLineBreaks
                .split('\n')
                .map(s => s.trim());
            return lines.map(s => {
                if (!s || s.replace(/<[^>]+>/g, '').trim().length === 0) return `<div class="board-help-line empty"></div>`;
                return `<div class="board-help-line"><span class="board-help-bullet"></span><span class="board-help-line-text">${renderBoardHelpStatusTokens(s)}</span></div>`;
            }).join('');
        }
        function getBoardHelpStatusMeta(rawLabel) {
            const label = String(rawLabel || '').trim();
            const map = {
                '접수대기': { cls: 'wait' },
                '접수/대기': { cls: 'wait' },
                '처리중': { cls: 'wait' },
                '추가답변': { cls: 'moreInfo' },
                '추가정보요청': { cls: 'moreInfo' },
                '답변완료': { cls: 'done' },
                '조치완료': { cls: 'done' },
                'AI채택': { cls: 'aiSolved' },
                '학습대기': { cls: 'ready' },
                '학습완료': { cls: 'trained' },
                '오류': { cls: 'error' },
                '미승인': { cls: 'ready' },
                '승인': { cls: 'trained' },
                '불승인': { cls: 'error' }
            };
            return map[label] || { cls: '' };
        }
        function renderBoardHelpStatusTokens(htmlText) {
            return String(htmlText || '').replace(/\[\$([^\]]+)\]/g, (_, raw) => {
                const label = String(raw || '').trim();
                if (!label) return '';
                const meta = getBoardHelpStatusMeta(label);
                const cls = meta.cls ? ` ${meta.cls}` : '';
                return `<span class="board-help-status-chip${cls}">${escapeHtml(label)}</span>`;
            });
        }
        function applyBoardHelpSelectionStyle(styleName, value) {
            const editor = document.getElementById('boardHelpEditor');
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

                const span = document.createElement('span');
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
            const boldBtn = document.getElementById('boardHelpWeightBold');
            const toBold = !(boldBtn && boldBtn.classList.contains('active'));
            applyBoardHelpSelectionStyle('fontWeight', toBold ? '700' : '400');
        }
        function rgbToHex(color) {
            if (!color) return '';
            if (color.startsWith('#')) return color;
            if (/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(color) || color === 'transparent') return '';
            const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
            if (!m) return '';
            const toHex = (n) => Number(n).toString(16).padStart(2, '0');
            return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
        }
        function syncBoardHelpSelectionControls() {
            const editor = document.getElementById('boardHelpEditor');
            if (!editor) return;
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) return;
            const range = selection.getRangeAt(0);
            if (!editor.contains(range.commonAncestorContainer)) return;
            let node = selection.anchorNode || range.commonAncestorContainer;
            if (node && node.nodeType === 3) node = node.parentElement;
            if (!node || !(node instanceof Element)) return;
            const st = window.getComputedStyle(node);
            const colorEl = document.getElementById('boardHelpTextColor');
            const bgEl = document.getElementById('boardHelpBgColor');
            const boldBtn = document.getElementById('boardHelpWeightBold');
            const c = rgbToHex(st.color || '');
            const bg = rgbToHex(st.backgroundColor || '');
            const fw = parseInt(st.fontWeight || '400', 10);
            if (colorEl && c) colorEl.value = c;
            if (bgEl && bg) bgEl.value = bg;
            if (boldBtn) boldBtn.classList.toggle('active', fw >= 600);
        }
        function bindBoardHelpEditorEvents() {
            const editor = document.getElementById('boardHelpEditor');
            if (!editor || editor.dataset.bound === '1') return;
            editor.dataset.bound = '1';
            ['mouseup', 'keyup'].forEach(evt => {
                editor.addEventListener(evt, () => {
                    const selection = window.getSelection();
                    if (selection && selection.rangeCount > 0) {
                        const r = selection.getRangeAt(0);
                        if (editor.contains(r.commonAncestorContainer) && !r.collapsed) boardHelpSavedRange = r.cloneRange();
                    }
                    syncBoardHelpSelectionControls();
                });
            });
            document.addEventListener('selectionchange', () => {
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
            if (currentRole !== 'it') return;
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
            if (currentRole !== 'it') return;
            if (!appData.settings || typeof appData.settings !== 'object') appData.settings = { osNotify: true, initialView: 'ai-search', notifyPolicy: getDefaultNotifyPolicy() };
            if (!appData.settings.boardHelp || typeof appData.settings.boardHelp !== 'object') appData.settings.boardHelp = {};
            const sharedMap = loadSharedBoardHelpMap();
            const editor = document.getElementById('boardHelpEditor');
            const nextHtml = editor ? String(editor.innerHTML || '').trim() : '';
            const nextText = editor ? String(editor.innerText || '').trim() : '';
            if (nextText) {
                const payload = {
                    text: nextText,
                    html: nextHtml,
                    updatedAt: Date.now()
                };
                appData.settings.boardHelp[currentBoardType] = payload;
                sharedMap[currentBoardType] = payload;
            }
            else {
                delete appData.settings.boardHelp[currentBoardType];
                delete sharedMap[currentBoardType];
            }
            saveSharedBoardHelpMap(sharedMap);
            saveData();
            boardHelpEditing = false;
            boardHelpSavedRange = null;
            renderBoardHelpCard();
            showAlert('게시판 도움말이 저장되었습니다.', 'success');
        }
        function renderBoardHelpCard() {
            const card = document.getElementById('boardHelpCard');
            if (!card) return;
            const helpConfig = getBoardHelpConfigByType(currentBoardType);
            const helpText = helpConfig.text;
            const isItAdmin = currentRole === 'it';
            const shouldShow = isItAdmin || !!helpConfig.hasContent;
            if (!shouldShow) {
                card.classList.add('hidden');
                return;
            }
            card.classList.remove('hidden');
            const body = document.getElementById('boardHelpBody');
            const toggleBtn = document.getElementById('boardHelpToggleBtn');
            const editBtn = document.getElementById('boardHelpEditBtn');
            const newBadge = document.getElementById('boardHelpNewBadge');
            const textEl = document.getElementById('boardHelpText');
            const emptyEl = document.getElementById('boardHelpEmpty');
            const editorWrap = document.getElementById('boardHelpEditorWrap');
            const editor = document.getElementById('boardHelpEditor');
            const ui = getBoardHelpUiState();
            const seenAt = Number((ui.seenAtByType || {})[currentBoardType] || 0);
            let isNew = helpConfig.updatedAt > seenAt && helpConfig.updatedAt > 0;

            if (editBtn) editBtn.classList.toggle('hidden', !isItAdmin);
            if (toggleBtn) {
                toggleBtn.classList.toggle('collapsed', boardHelpCollapsed);
                toggleBtn.classList.toggle('hidden', boardHelpEditing);
            }
            if (!boardHelpCollapsed && isNew) {
                const changed = markBoardHelpSeen(currentBoardType, helpConfig.updatedAt);
                if (changed) boardHelpJustSeenUpdated = true;
                isNew = false;
            }
            if (newBadge) newBadge.classList.toggle('hidden', !isNew);
            if (body) body.classList.toggle('hidden', boardHelpCollapsed);
            if (boardHelpCollapsed) return;

            if (textEl) {
                textEl.innerHTML = formatBoardHelpText(helpConfig.html || helpText);
                textEl.classList.toggle('hidden', !helpText || boardHelpEditing);
                textEl.classList.toggle('updated-highlight', boardHelpJustSeenUpdated && !boardHelpEditing);
                if (boardHelpJustSeenUpdated && !boardHelpEditing) {
                    setTimeout(() => {
                        boardHelpJustSeenUpdated = false;
                        const target = document.getElementById('boardHelpText');
                        if (target) target.classList.remove('updated-highlight');
                    }, 1300);
                }
            }
            if (body) body.style.background = '';
            if (emptyEl) emptyEl.classList.toggle('hidden', !!helpText || boardHelpEditing);
            if (editorWrap) editorWrap.classList.toggle('hidden', !boardHelpEditing);
            if (editor && boardHelpEditing) {
                editor.innerHTML = helpConfig.html || escapeHtml(helpText).replace(/\n/g, '<br>');
                bindBoardHelpEditorEvents();
                syncBoardHelpSelectionControls();
            }
        }

        function switchView(viewId, boardType = null, options = {}) {
            const fromHistory = !!options.fromHistory;
            const skipHistory = !!options.skipHistory;
            if (boardHelpEditing) {
                const changingListBoard = viewId === 'list' && boardType && boardType !== currentBoardType;
                const leavingListView = viewId !== 'list';
                if (changingListBoard || leavingListView) {
                    showConfirm('도움말 편집 내용이 저장되지 않습니다. 계속 진행하시겠습니까?', () => {
                        boardHelpEditing = false;
                        boardHelpSavedRange = null;
                        switchView(viewId, boardType, options);
                    });
                    return;
                }
            }
            if (viewId === 'admin-settings' && !currentUserHasAdminAccess()) {
                showAlert('플랫폼 관리자 권한이 필요합니다.', 'error');
                return;
            }
            document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.top-nav-item').forEach(el => el.classList.remove('active'));

            if (viewId === 'list') {
                if(boardType) currentBoardType = boardType;
                boardCurrentPage = 1;
                document.getElementById('view-list').classList.add('active');
                const navId = `nav-list-${currentBoardType.toLowerCase()}`;
                if(document.getElementById(navId)) document.getElementById(navId).classList.add('active');
                const topNavId = `topnav-list-${currentBoardType.toLowerCase()}`;
                if(document.getElementById(topNavId)) document.getElementById(topNavId).classList.add('active');
                
                const knowRagBadge = currentBoardType === 'KNOW'
                    ? '<span class="board-rag-badge">RAG 학습</span>'
                    : '';
                document.getElementById('boardMainTitle').innerHTML = `<span style="display:inline-flex; align-items:center; gap:8px;"><svg class="icon"><use href="${boardTitles[currentBoardType].icon}"></use></svg><span>${boardTitles[currentBoardType].title}</span>${knowRagBadge}</span>`;
                boardHelpEditing = false;
                boardHelpCollapsed = !!(getBoardHelpUiState().collapsedByType[currentBoardType]);
                renderBoardHelpCard();
                
                const filterSelect = document.getElementById('boardStatusFilter');
                const knowFilter = document.getElementById('boardKnowCategoryFilter');
                if (currentBoardType === 'KNOW') filterSelect.innerHTML = '<option value="all">상태 전체</option><option value="pending">미승인</option><option value="approved">승인</option><option value="rejected">불승인</option>';
                else if (currentBoardType === 'SYS') filterSelect.innerHTML = '<option value="all">상태 전체</option><option value="wait">접수대기</option><option value="moreInfo">추가답변</option><option value="done">답변완료</option>';
                else filterSelect.innerHTML = '<option value="all">상태 전체</option><option value="wait">접수대기</option><option value="moreInfo">추가답변</option><option value="done">답변완료</option><option value="aiSolved">AI채택</option>';

                document.getElementById('boardStatusFilter').value = 'all'; document.getElementById('boardKeywordInput').value = '';
                if (knowFilter) {
                    knowFilter.value = 'all';
                    if (currentBoardType === 'KNOW') knowFilter.classList.remove('hidden');
                    else knowFilter.classList.add('hidden');
                }
                filterBoardList();
            } else if (viewId === 'write') {
                if(!boardType) {
                    const writes = roleMatrix[currentRole].write.filter(t => t !== 'KNOW');
                    if(writes.length > 0) boardType = writes[0];
                }
                document.getElementById('view-write').classList.add('active');
                resetWriteForm(boardType);
            } else {
                const target = document.getElementById(`view-${viewId}`);
                if(target) target.classList.add('active');
                const navId = `nav-${viewId}`;
                if(document.getElementById(navId)) document.getElementById(navId).classList.add('active');
                const topNavId = `topnav-${viewId}`;
                if(document.getElementById(topNavId)) document.getElementById(topNavId).classList.add('active');
                if (viewId === 'ai-search') initializeAiSearchView();
                if (viewId === 'admin-settings') {
                    wireAdminAiGenControlsOnce();
                    initAdminAiPostTabsOnce();
                    initAdminSettingsMainTabsOnce();
                    void (async () => {
                        await loadSignupUsers();
                        await loadAdminAiSettingsView();
                        renderAdminPermissionsPanel();
                        selectAdminSettingsMainTab('ai');
                    })();
                }
            }

            if (viewId === 'dashboard') {
                document.getElementById('dashTitle').innerText = currentRole === 'branch' ? '나의 현황판' : '전행 종합 현황판';
                updateDashStats();
                renderDashboardLists();
                setTimeout(renderCSSCharts, 50); 
            }
            if (viewId === 'list') setTimeout(syncBoardListCardMode, 0);
            if (!fromHistory && !skipHistory) {
                const routeBoardType = viewId === 'list' ? currentBoardType : null;
                syncHistoryRoute(viewId, routeBoardType, null, false);
            }
        }

        // --- Dashboard Update ---
        function updateDashStats() {
            const myName = getCurrentActorNameToken();
            const myQs = appData.posts.filter(p => p.writer.includes(myName) && p.type !== 'KNOW');
            const totalPosts = appData.posts.filter(p => p.type !== 'KNOW');
            
            if(currentRole === 'branch') {
                document.getElementById('dashDataBranch').classList.remove('hidden');
                document.getElementById('dashDataHQ').classList.add('hidden');
                
                const elWait = document.getElementById('statWait');
                const elDone = document.getElementById('statDone');
                const elTotal = document.getElementById('statTotal');
                const elAiRate = document.getElementById('statAiAdoptRate');
                
                if(elWait) elWait.innerText = myQs.filter(p => p.status === 'wait' || p.status === 'ing' || p.status === 'moreInfo').length;
                if(elDone) elDone.innerText = myQs.filter(p => p.status === 'done' || p.aiSolved).length;
                if(elTotal) elTotal.innerText = myQs.length;
                if(elAiRate) {
                    const myAiRate = myQs.length > 0 ? ((myQs.filter(p => p.aiSolved).length / myQs.length) * 100).toFixed(1) : '0.0';
                    elAiRate.innerText = `${myAiRate}%`;
                }
            } else {
                document.getElementById('dashDataBranch').classList.add('hidden');
                document.getElementById('dashDataHQ').classList.remove('hidden');
                const hqWait = totalPosts.filter(p => p.status === 'wait' || p.status === 'ing').length;
                const hqMore = totalPosts.filter(p => p.status === 'moreInfo').length;
                const today = new Date();
                const todayKey = `${today.getFullYear()}.${String(today.getMonth()+1).padStart(2,'0')}.${String(today.getDate()).padStart(2,'0')}`;
                const hqDoneToday = totalPosts.filter(p => (p.status === 'done' || p.aiSolved) && (p.datetime || '').startsWith(todayKey)).length;
                const hqAiRate = totalPosts.length > 0 ? ((totalPosts.filter(p => p.aiSolved).length / totalPosts.length) * 100).toFixed(1) : '0.0';
                const elHqWait = document.getElementById('hqStatWait');
                const elHqMore = document.getElementById('hqStatMoreInfo');
                const elHqDoneToday = document.getElementById('hqStatDoneToday');
                const elHqAiRate = document.getElementById('hqStatAiRate');
                if (elHqWait) elHqWait.innerText = hqWait;
                if (elHqMore) elHqMore.innerText = hqMore;
                if (elHqDoneToday) elHqDoneToday.innerText = hqDoneToday;
                if (elHqAiRate) elHqAiRate.innerText = `${hqAiRate}%`;
            }
        }

        function getDashCountConfig(metricKey) {
            const today = new Date();
            const todayKey = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
            const myName = getCurrentActorNameToken();
            const baseMine = appData.posts.filter(p => p.type !== 'KNOW' && p.writer.includes(myName));
            const baseAll = appData.posts.filter(p => p.type !== 'KNOW');
            const map = {
                branchWait: { title: '접수/대기 문의 목록', posts: baseMine.filter(p => p.status === 'wait' || p.status === 'ing' || p.status === 'moreInfo') },
                branchDone: { title: '조치/해결 완료 목록', posts: baseMine.filter(p => p.status === 'done' || p.aiSolved) },
                branchTotal: { title: '나의 문의 누적 목록', posts: baseMine },
                hqWait: { title: '전행 미결/접수 목록', posts: baseAll.filter(p => p.status === 'wait' || p.status === 'ing') },
                hqMoreInfo: { title: '추가정보 요청(대기) 목록', posts: baseAll.filter(p => p.status === 'moreInfo') },
                hqDoneToday: { title: '금일 조치 완료 목록', posts: baseAll.filter(p => (p.status === 'done' || p.aiSolved) && (p.datetime || '').startsWith(todayKey)) }
            };
            return map[metricKey] || null;
        }

        function openDashCountModal(metricKey) {
            const config = getDashCountConfig(metricKey);
            if (!config) return;
            dashCountPosts = [...config.posts].sort((a, b) => b.id - a.id);
            dashCountCurrentPage = 1;
            const titleEl = document.getElementById('dashCountModalTitle');
            if (titleEl) titleEl.innerText = config.title;
            const sel = document.getElementById('dashCountPageSize');
            if (sel) sel.value = String(dashCountPageSize);
            renderDashCountModalTable();
            document.getElementById('dashCountModal').classList.add('active');
        }

        function closeDashCountModal() {
            document.getElementById('dashCountModal').classList.remove('active');
        }

        function changeDashCountPageSize() {
            const sel = document.getElementById('dashCountPageSize');
            dashCountPageSize = parseInt(sel.value, 10) || 10;
            dashCountCurrentPage = 1;
            renderDashCountModalTable();
        }

        function changeDashCountPage(delta) {
            dashCountCurrentPage = Math.max(1, dashCountCurrentPage + delta);
            renderDashCountModalTable();
        }

        function openDetailFromDashCount(id, postType) {
            closeDashCountModal();
            openDetail(id, postType);
        }

        function renderDashCountModalTable() {
            const tbody = document.getElementById('dashCountModalTbody');
            if (!tbody) return;

            const totalCount = dashCountPosts.length;
            const totalPages = Math.max(1, Math.ceil(totalCount / dashCountPageSize));
            if (dashCountCurrentPage > totalPages) dashCountCurrentPage = totalPages;
            const startIdx = (dashCountCurrentPage - 1) * dashCountPageSize;
            const paged = dashCountPosts.slice(startIdx, startIdx + dashCountPageSize);

            if (paged.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="padding:30px; color:#94a3b8;">해당 조건의 게시물이 없습니다.</td></tr>`;
            } else {
                tbody.innerHTML = paged.map(post => {
                    const boardLabel = boardTitles[post.type] ? boardTitles[post.type].label : post.type;
                    const status = post.aiSolved ? 'AI채택' : (post.status === 'wait' || post.status === 'ing' ? '접수대기' : (post.status === 'moreInfo' ? '추가답변' : '답변완료'));
                    const dateTxt = (post.datetime || '').substring(0, 10);
                    return `<tr onclick="openDetailFromDashCount(${post.id}, '${post.type}')">
                        <td>${post.id}</td>
                        <td>${boardLabel}</td>
                        <td class="text-left"><span class="truncate">${post.title || '-'}</span></td>
                        <td>${post.writer || '-'}</td>
                        <td>${status}</td>
                        <td>${dateTxt}</td>
                    </tr>`;
                }).join('');
            }

            const pageCurrent = document.getElementById('dashCountPageCurrent');
            const prevBtn = document.getElementById('dashCountPrevBtn');
            const nextBtn = document.getElementById('dashCountNextBtn');
            if (pageCurrent) pageCurrent.innerText = `${dashCountCurrentPage} / ${totalPages}`;
            if (prevBtn) prevBtn.disabled = dashCountCurrentPage <= 1 || totalCount === 0;
            if (nextBtn) nextBtn.disabled = dashCountCurrentPage >= totalPages || totalCount === 0;
        }
        
        let dashQStatus = 'wait'; let dashAStatus = 'wait';
        function changeDashTab(type, status, el) {
            el.parentElement.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active')); el.classList.add('active');
            if(type === 'q') dashQStatus = status; if(type === 'a') dashAStatus = status;
            renderDashboardLists();
        }
        function getPostStatusBadge(post) {
            if (post.aiSolved) return '<span class="badge bg-ai" style="font-size:11px; padding:2px 8px;">AI 채택</span>';
            if (post.status === 'wait' || post.status === 'ing') return '<span class="badge bg-wait" style="font-size:11px; padding:2px 8px;">접수대기</span>';
            if (post.status === 'moreInfo') return '<span class="badge bg-moreInfo" style="font-size:11px; padding:2px 8px;">추가답변</span>';
            return '<span class="badge bg-done" style="font-size:11px; padding:2px 8px;">답변완료</span>';
        }
        function renderDashFeedCard(post, mode) {
            const shortDate = post.datetime ? post.datetime.substring(5, 16) : '';
            const writerName = post.writer ? post.writer.split(' ')[0] : '-';
            const chip = getBoardDisplayLabel(post);
            const subLeft = mode === 'question' ? `등록자 ${writerName}` : `요청자 ${writerName}`;
            return `
                <div class="dash-feed-item" onclick="switchView('list','${post.type}'); openDetail(${post.id}, '${post.type}')">
                    <div class="dash-feed-top">
                        <div class="dash-feed-meta">
                            <span class="dash-type-chip">${chip}</span>
                            ${getPostStatusBadge(post)}
                        </div>
                        <span style="font-size:12px; color:#94a3b8;">${shortDate}</span>
                    </div>
                    <div class="dash-feed-title truncate">${post.title}</div>
                    <div class="dash-feed-sub">
                        <span class="dash-sub-left">${subLeft}</span>
                        <span>#${post.id}</span>
                    </div>
                </div>
            `;
        }
        function ensurePostThread(post) {
            if (!post) return [];
            if (!Array.isArray(post.thread)) post.thread = [];
            // Legacy data migration: answer/addInfoList -> thread
            if (post.thread.length === 0) {
                if (post.answer && post.answer.trim()) {
                    post.thread.push({
                        role: 'manager',
                        action: post.status === 'moreInfo' ? 'request' : 'answer',
                        content: post.answer,
                        datetime: post.datetime || getCurrentDateTime()
                    });
                }
                if (Array.isArray(post.addInfoList)) {
                    post.addInfoList.forEach((info) => {
                        if (info && info.content) {
                            post.thread.push({
                                role: 'requester',
                                action: 'reply',
                                content: info.content,
                                datetime: info.datetime || getCurrentDateTime()
                            });
                        }
                    });
                }
            }
            return post.thread;
        }
        function getManagerRequestCount(post) {
            const thread = ensurePostThread(post);
            return thread.filter(item => item.role === 'manager' && item.action === 'request').length;
        }
        function renderThreadTimeline(post) {
            const thread = ensurePostThread(post);
            if (thread.length === 0) return '';
            let requestStep = 0;
            return `<div style="margin-top:20px; border-top:1px dashed #ccc; padding-top:15px;">${
                thread.map((item) => {
                    const isManager = item.role === 'manager';
                    const isRequest = isManager && item.action === 'request';
                    if (isRequest) requestStep += 1;
                    const title = isManager
                        ? (item.action === 'knowError'
                            ? '지식 학습 상태 변경'
                            : (isRequest ? `담당자 ${requestStep}차 추가 요청` : '담당자 답변'))
                        : '질의자 추가 정보';
                    const icon = isManager ? '#icon-info' : '#icon-user';
                    const boxBg = isManager ? '#fff7ed' : '#f8fafc';
                    const border = isManager ? '#fed7aa' : '#dbeafe';
                    const color = isManager ? '#9a3412' : '#1e40af';
                    return `<div style="background:${boxBg}; border:1px solid ${border}; padding:15px; margin-bottom:10px; border-radius:6px;">
                        <p style="font-size:12px; color:${color}; margin-bottom:10px; font-weight:bold;">
                            <svg class="icon"><use href="${icon}"></use></svg> ${title} (${item.datetime || ''})
                        </p>
                        <div>${item.content || ''}</div>
                    </div>`;
                }).join('')
            }</div>`;
        }
        function normalizeGlobalId(value) {
            return (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        }
        function formatCustomerValue(meta) {
            const type = meta.custType || '';
            const val1 = (meta.custVal1 || '').replace(/\D/g, '');
            const val2 = (meta.custVal2 || '').replace(/\D/g, '');
            if (type.includes('고객번호') || type === 'CUST') {
                if (val1.length === 9) return `${val1.slice(0, 3)}-${val1.slice(3)}`;
                return meta.custVal1 || '-';
            }
            if (type.includes('계좌번호') || type === 'ACCT') {
                if (val1.length === 16) return `${val1.slice(0,3)}-${val1.slice(3,9)}-${val1.slice(9,11)}-${val1.slice(11,16)}`;
                if (val1.length === 14) return `${val1.slice(0,3)}-${val1.slice(3,9)}-${val1.slice(9,11)}-${val1.slice(11,14)}`;
                return meta.custVal1 || '-';
            }
            if (type.includes('품의번호') || type === 'APPR') {
                const appr = meta.custVal1 || '-';
                const seq = meta.custVal2 || '-';
                return `${appr} / ${seq}`;
            }
            return `${meta.custVal1 || ''} ${meta.custVal2 || ''}`.trim() || '-';
        }
        function renderDashboardLists() {
            const myName = getCurrentActorNameToken();
            let myQs = appData.posts.filter(p => p.writer.includes(myName) && p.type !== 'KNOW');
            if(dashQStatus === 'wait') myQs = myQs.filter(p => p.status === 'wait' || p.status === 'ing' || p.status === 'moreInfo');
            else myQs = myQs.filter(p => p.status === 'done' || p.aiSolved);
            
            const qBox = document.getElementById('dashMyQuestions');
            if(qBox) {
                if(myQs.length === 0) qBox.innerHTML = '<div class="dash-empty">내역이 없습니다.</div>';
                else qBox.innerHTML = `<div class="dash-feed">${myQs.map(p => renderDashFeedCard(p, 'question')).join('')}</div>`;
            }

            const aBox = document.getElementById('dashMyAnswers');
            const secondaryTitle = document.getElementById('dashSecondaryTitle');
            const tabWait = document.getElementById('dashATabWait');
            const tabDone = document.getElementById('dashATabDone');
            if(aBox) {
                if(currentRole === 'branch') {
                    if (secondaryTitle) secondaryTitle.innerText = '추가답변 요청 내 게시물 현황';
                    let myRequested = appData.posts.filter(p => p.writer.includes(myName) && p.type !== 'KNOW' && p.status === 'moreInfo');
                    if (tabWait) tabWait.innerText = `추가요청 건 (${myRequested.length})`;
                    if (tabDone) tabDone.classList.add('hidden');
                    dashAStatus = 'wait';

                    if(myRequested.length === 0) aBox.innerHTML = '<div class="dash-empty">내역이 없습니다.</div>';
                    else aBox.innerHTML = `<div class="dash-feed">${myRequested.map(p => renderDashFeedCard(p, 'question')).join('')}</div>`;
                } else {
                    if (secondaryTitle) secondaryTitle.innerText = '나의 조치 할 일 (담당자용)';
                    if (tabWait) tabWait.innerText = '미결/진행중';
                    if (tabDone) { tabDone.innerText = '조치완료'; tabDone.classList.remove('hidden'); }

                    const canAnsTypes = roleMatrix[currentRole].answer.filter(t => t !== 'KNOW');
                    if(canAnsTypes.length === 0) {
                        aBox.innerHTML = '<div class="dash-empty">답변 권한이 없습니다.</div>';
                        return;
                    }
                    let myAs = appData.posts.filter(p => canAnsTypes.includes(p.type));
                    if(dashAStatus === 'wait') myAs = myAs.filter(p => p.status === 'wait' || p.status === 'ing' || p.status === 'moreInfo');
                    else myAs = myAs.filter(p => p.status === 'done' || p.aiSolved);

                    if(myAs.length === 0) aBox.innerHTML = '<div class="dash-empty">내역이 없습니다.</div>';
                    else aBox.innerHTML = `<div class="dash-feed">${myAs.map(p => renderDashFeedCard(p, 'answer')).join('')}</div>`;
                }
            }
        }

        // --- 게시판 리스트 ---
        function changeBoardPageSize() {
            const sel = document.getElementById('boardPageSizeSelect');
            boardPageSize = parseInt(sel.value, 10) || 10;
            boardCurrentPage = 1;
            filterBoardList();
        }
        function changeBoardPage(delta) {
            boardCurrentPage = Math.max(1, boardCurrentPage + delta);
            filterBoardList();
        }
        function renderBoardPageNumbers(totalPages) {
            const box = document.getElementById('boardPageNumbers');
            if (!box) return;
            const maxButtons = 7;
            let start = Math.max(1, boardCurrentPage - Math.floor(maxButtons / 2));
            let end = Math.min(totalPages, start + maxButtons - 1);
            if ((end - start + 1) < maxButtons) start = Math.max(1, end - maxButtons + 1);

            let html = '';
            for (let p = start; p <= end; p++) {
                const active = p === boardCurrentPage;
                const style = active
                    ? 'background: var(--ibk-blue); color: #fff; border-color: var(--ibk-blue);'
                    : 'background: #fff; color: #334155; border-color: #cbd5e1;';
                html += `<button class="btn btn-outline" style="padding:4px 8px; min-width:32px; ${style}" onclick="goBoardPage(${p})">${p}</button>`;
            }
            box.innerHTML = html;
        }
        function goBoardPage(page) {
            boardCurrentPage = page;
            filterBoardList();
        }
        function syncBoardListCardMode() {
            const viewList = document.getElementById('view-list');
            if (!viewList) return;
            const wrap = viewList.querySelector('.table-wrap');
            if (!wrap) return;
            const shouldCard = window.innerWidth <= 1024 || wrap.clientWidth < 800;
            viewList.classList.toggle('list-card-mode', shouldCard);
        }
        function syncBoardToolbarCompactMode() {
            const viewList = document.getElementById('view-list');
            if (!viewList) return;
            const toolbar = viewList.querySelector('.panel > .flex.items-center.justify-between.p-20');
            const rightTools = toolbar ? toolbar.querySelector('.flex.items-center.gap-10.flex-1.justify-end') : null;
            const moreBtn = document.getElementById('boardToolsMoreBtn');
            const layer = document.getElementById('boardToolsLayer');
            const writeBtn = document.getElementById('listWriteBtn');
            const layerWriteBtn = document.getElementById('boardToolsLayerWriteBtn');
            const layerWriteText = document.getElementById('boardToolsLayerWriteText');
            const layerDeleteBtn = document.getElementById('boardToolsLayerDeleteBtn');
            const deleteBtn = document.getElementById('btnDeleteSelected');
            if (!toolbar || !rightTools || !moreBtn || !layer) return;
            const compact = window.innerWidth <= 1180;
            viewList.classList.toggle('board-tools-compact', compact);
            viewList.classList.toggle('board-tools-know', currentBoardType === 'KNOW');
            if (!compact) {
                moreBtn.classList.add('hidden');
                layer.classList.add('hidden');
                return;
            }
            moreBtn.classList.remove('hidden');
            const writeVisible = !!(writeBtn && writeBtn.style.display !== 'none' && !writeBtn.classList.contains('hidden'));
            if (layerWriteBtn) layerWriteBtn.classList.toggle('hidden', !writeVisible);
            if (layerWriteText && writeBtn) layerWriteText.innerText = (document.getElementById('listWriteBtnText') || writeBtn).innerText || '신규 접수';
            const deleteVisible = !!(deleteBtn && !deleteBtn.disabled && !deleteBtn.classList.contains('hidden'));
            if (layerDeleteBtn) {
                layerDeleteBtn.classList.toggle('hidden', !deleteVisible);
                layerDeleteBtn.disabled = !deleteVisible;
            }
        }
        function syncBoardLayoutModes() {
            syncBoardListCardMode();
            syncBoardToolbarCompactMode();
        }
        function closeBoardToolsLayer() {
            const layer = document.getElementById('boardToolsLayer');
            if (layer) layer.classList.add('hidden');
        }
        function toggleBoardToolsLayer(event) {
            if (event) event.stopPropagation();
            const layer = document.getElementById('boardToolsLayer');
            if (!layer) return;
            syncBoardToolbarCompactMode();
            layer.classList.toggle('hidden');
        }
        window.closeBoardToolsLayer = closeBoardToolsLayer;
        window.toggleBoardToolsLayer = toggleBoardToolsLayer;
        function filterBoardList() {
            const st = document.getElementById('boardStatusFilter').value;
            const knowCategory = document.getElementById('boardKnowCategoryFilter').value;
            const kw = document.getElementById('boardKeywordInput').value.toLowerCase();
            let filtered = appData.posts.filter(p => p.type === currentBoardType).sort((a,b) => b.id - a.id);

            if (st !== 'all') {
                if (currentBoardType === 'KNOW') filtered = filtered.filter((p) => normalizeKnowStatus(p.status) === st);
                else if (st === 'aiSolved') filtered = filtered.filter(p => p.aiSolved);
                else filtered = filtered.filter(p => p.status === st && !p.aiSolved);
            }
            if (currentBoardType === 'KNOW' && knowCategory !== 'all') {
                filtered = filtered.filter(p => (p.knowCategory || '') === knowCategory);
            }
            if (kw) filtered = filtered.filter(p => p.title.toLowerCase().includes(kw) || p.content.toLowerCase().includes(kw) || p.writer.toLowerCase().includes(kw));
            
            // 관리자면 다중 삭제 버튼 활성화 및 체크박스 렌더링
            const adminTools = document.getElementById('adminListTools');
            const thCheck = document.getElementById('thCheck');
            const colCheck = document.getElementById('colCheck');
            const isIT = (currentRole === 'it');
            
            if (isIT) {
                adminTools.classList.remove('hidden'); thCheck.classList.remove('hidden'); colCheck.classList.remove('hidden');
                document.getElementById('checkAll').checked = false;
                updateDeleteBtnState();
            } else {
                adminTools.classList.add('hidden'); thCheck.classList.add('hidden'); colCheck.classList.add('hidden');
            }

            const tbody = document.getElementById('boardGridBody');
            const pageInfo = document.getElementById('boardPageInfo');
            const pageCurrent = document.getElementById('boardPageCurrent');
            const prevBtn = document.getElementById('boardPrevBtn');
            const nextBtn = document.getElementById('boardNextBtn');
            const totalCount = filtered.length;
            const totalPages = Math.max(1, Math.ceil(totalCount / boardPageSize));
            if (boardCurrentPage > totalPages) boardCurrentPage = totalPages;
            const startIdx = (boardCurrentPage - 1) * boardPageSize;
            const endIdx = Math.min(startIdx + boardPageSize, totalCount);
            const pageItems = filtered.slice(startIdx, endIdx);
            if (pageInfo) {
                if (totalCount === 0) pageInfo.innerText = '총 0건';
                else pageInfo.innerText = `총 ${totalCount}건 · ${startIdx + 1}-${endIdx} 표시`;
            }
            if (pageCurrent) pageCurrent.innerText = `${boardCurrentPage} / ${totalPages}`;
            if (prevBtn) prevBtn.disabled = boardCurrentPage <= 1 || totalCount === 0;
            if (nextBtn) nextBtn.disabled = boardCurrentPage >= totalPages || totalCount === 0;
            renderBoardPageNumbers(totalPages);

            if (filtered.length === 0) { 
                let cols = isIT ? 6 : 5;
                tbody.innerHTML = `<tr><td colspan="${cols}" style="padding: 30px; color:#999;">데이터가 없습니다.</td></tr>`;
                setTimeout(syncBoardLayoutModes, 0);
                return; 
            }

            tbody.innerHTML = pageItems.map(item => {
                let badge = '';
                if (currentBoardType === 'KNOW') {
                    const knowMeta = getKnowStatusMeta(item.status);
                    badge = `<span class="badge ${knowMeta.badgeClass}">${knowMeta.label}</span>`;
                } else {
                    if (item.aiSolved) badge = '<span class="badge bg-ai">AI 채택</span>';
                    else if(item.status === 'wait') badge = '<span class="badge bg-wait">접수대기</span>';
                    else if(item.status === 'moreInfo') badge = '<span class="badge bg-moreInfo">추가답변</span>';
                    else badge = '<span class="badge bg-done">답변완료</span>';
                }
                
                let chkTd = isIT ? `<td class="mobile-check-cell" onclick="event.stopPropagation();"><input type="checkbox" class="chk-box post-chk" value="${item.id}" onchange="updateDeleteBtnState()"></td>` : '';
                const knowCatBadge = currentBoardType === 'KNOW'
                    ? `<span class="badge bg-ready badge-domain">${getKnowCategoryLabel(item.knowCategory)}</span>`
                    : '';
                return `<tr onclick="openDetail(${item.id})"><td>${item.id}</td>${chkTd}<td>${badge}</td><td class="text-left font-bold">${knowCatBadge}${item.title}</td><td>${renderWriterWithAvatar(item.writer)}</td><td>${item.datetime}</td></tr>`;
            }).join('');
            setTimeout(syncBoardLayoutModes, 0);
        }

        function toggleAllChecks() {
            const isChecked = document.getElementById('checkAll').checked;
            document.querySelectorAll('.post-chk').forEach(chk => chk.checked = isChecked);
            updateDeleteBtnState();
        }

        function updateDeleteBtnState() {
            const checkedBoxes = document.querySelectorAll('.post-chk:checked');
            const btn = document.getElementById('btnDeleteSelected');
            if(btn) {
                if(checkedBoxes.length > 0) {
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btn.style.cursor = 'pointer';
                } else {
                    btn.disabled = true;
                    btn.style.opacity = '0.5';
                    btn.style.cursor = 'not-allowed';
                }
            }
        }

        function deleteSelectedPosts() {
            const checked = document.querySelectorAll('.post-chk:checked');
            if(checked.length === 0) { showAlert('삭제할 항목을 선택하세요.', 'error'); return; }
            showConfirm(`${checked.length}개의 게시물을 삭제하시겠습니까?`, () => {
                const idsToDelete = Array.from(checked).map(c => parseInt(c.value));
                appData.posts = appData.posts.filter((p) => !(p.type === currentBoardType && idsToDelete.includes(Number(p.id))));
                saveData();
                showAlert(`${checked.length}개의 항목이 삭제되었습니다.`, 'success');
                filterBoardList();
            });
        }

        // --- 상세보기 ---
        function openDetail(id, typeHint = currentBoardType, options = {}) {
            const fromHistory = !!options.fromHistory;
            const skipHistory = !!options.skipHistory;
            const post = getPostByIdAndType(id, typeHint);
            if(!post) return;
            currentPostId = Number(post.id);
            currentBoardType = post.type;

            document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
            document.getElementById('view-detail').classList.add('active');

            document.getElementById('dtlBoardTypeLabel').innerText = getBoardDisplayLabel(post);
            document.getElementById('dtlTitle').innerText = post.title;
            document.getElementById('dtlPostId').innerText = post.id;
            document.getElementById('dtlWriter').innerHTML = renderWriterWithAvatar(post.writer, { avatarClassName: 'writer-avatar detail', wrapperClass: 'writer-cell detail' });
            document.getElementById('dtlTime').innerText = post.datetime;
            document.getElementById('dtlIp').innerText = `IP: ${post.ip}`;
            
            const badgeEl = document.getElementById('dtlStatus');
            if (post.type === 'KNOW') {
                const knowMeta = getKnowStatusMeta(post.status);
                badgeEl.className = `badge ${knowMeta.badgeClass}`;
                badgeEl.innerText = knowMeta.label;
            } else {
                if (post.aiSolved) { badgeEl.className = 'badge bg-ai'; badgeEl.innerText = 'AI 채택'; }
                else if (post.status === 'wait') { badgeEl.className = 'badge bg-wait'; badgeEl.innerText = '접수대기'; }
                else if (post.status === 'moreInfo') { badgeEl.className = 'badge bg-moreInfo'; badgeEl.innerText = '추가답변(요청)'; }
                else { badgeEl.className = 'badge bg-done'; badgeEl.innerText = '답변완료'; }
            }
            
            // 메타
            const metaBox = document.getElementById('dtlMetaBox');
            const hasMeta = !!(
                (post.meta && (post.meta.gid || post.meta.custType || post.meta.custVal1 || post.meta.custVal2 || post.meta.errCode || post.meta.errMsg || post.meta.knowErrorMemo || post.meta.knowQuestion || post.meta.knowAnswer || post.meta.knowMemo))
                || (Array.isArray(post.attachments) && post.attachments.length > 0)
            );
            if (post.type === 'KNOW') {
                metaBox.classList.add('hidden');
            } else if(hasMeta) {
                metaBox.classList.remove('hidden');
                let mHtml = '<div class="meta-field-title">추가 입력 정보</div><div class="meta-grid">';
                if(post.meta.gid) {
                    mHtml += `<div class="meta-item"><div class="meta-item-label">표준 글로벌ID</div><div class="meta-item-value">${post.meta.gid}</div></div>`;
                }
                if(post.meta.custType || post.meta.custVal1 || post.meta.custVal2) {
                    const custTypeText = post.meta.custType || '고객정보';
                    const custFormatted = formatCustomerValue(post.meta);
                    mHtml += `<div class="meta-item"><div class="meta-item-label">${custTypeText}</div><div class="meta-item-value">${custFormatted}</div></div>`;
                }
                if(post.meta.errCode) {
                    mHtml += `<div class="meta-item"><div class="meta-item-label">오류코드</div><div class="meta-item-value code">${post.meta.errCode}</div></div>`;
                }
                if(post.meta.errMsg) {
                    mHtml += `<div class="meta-item" style="grid-column: 1 / -1;"><div class="meta-item-label">오류내용</div><div class="meta-item-value">${post.meta.errMsg}</div></div>`;
                }
                if(post.type === 'KNOW' && post.meta.knowErrorMemo) {
                    mHtml += `<div class="meta-item" style="grid-column: 1 / -1;"><div class="meta-item-label">불승인 관리자 의견</div><div class="meta-item-value">${post.meta.knowErrorMemo}</div></div>`;
                }
                if (Array.isArray(post.attachments) && post.attachments.length > 0) {
                    mHtml += `<div class="meta-item" style="grid-column: 1 / -1;"><div class="meta-item-label">첨부파일</div><div class="meta-item-value">${post.attachments.map(att => `${att.name || '첨부파일'} (${formatAttachmentSize(att.size)})`).join('<br>')}</div></div>`;
                }
                mHtml += '</div>';
                metaBox.innerHTML = mHtml;
            } else { metaBox.classList.add('hidden'); }
            const editHistoryBtn = document.getElementById('dtlEditHistoryBtn');
            const editHistoryBadge = document.getElementById('dtlEditHistoryBadge');
            const editHistoryCount = Array.isArray(post.editHistory) ? post.editHistory.length : 0;
            if (editHistoryBtn) editHistoryBtn.classList.toggle('hidden', editHistoryCount <= 0);
            if (editHistoryBadge) {
                editHistoryBadge.classList.toggle('hidden', editHistoryCount <= 0);
                editHistoryBadge.innerText = editHistoryCount > 0 ? String(editHistoryCount) : '';
            }

            // 본문 + 추가질의/답변 이력
            if (post.type === 'KNOW') {
                document.getElementById('dtlContent').innerHTML = renderKnowDetailTemplate(post);
            } else {
                let fullContent = post.content;
                fullContent += renderThreadTimeline(post);
                document.getElementById('dtlContent').innerHTML = fullContent;
            }
            
            // AI 패널
            const aiWrap = document.getElementById('dtlAiWrap');
            if(post.type === 'SYS' || post.type === 'KNOW') { aiWrap.classList.add('hidden'); } 
            else { 
                aiWrap.classList.remove('hidden'); 
                document.getElementById('aiPanelContent').innerHTML = renderAiContentWithToggle(post.aiContent, `detail-${post.id}`);
            }
            
            const thread = ensurePostThread(post);
            const lastManagerEntry = [...thread].reverse().find(item => item.role === 'manager');
            document.getElementById('dtlAnswerText').innerHTML = lastManagerEntry ? lastManagerEntry.content : (post.answer || '');

            // 수정/삭제 권한: IT관리자 이거나, 본인이 쓴 글(이름 매칭)일 때만
            const myName = getCurrentActorNameToken(); // 홍길동
            const isWriter = post.writer.includes(myName);
            const isITAdmin = (currentRole === 'it');
            const crudBtns = document.getElementById('crudBtns');
            
            if(isITAdmin || (isWriter && post.status !== 'done' && post.status !== 'trained' && !post.aiSolved)) {
                crudBtns.classList.remove('hidden');
            } else {
                crudBtns.classList.add('hidden');
            }
            const aiConvertBtn = document.getElementById('btnConvertAiSolved');
            const aiRefreshBtn = document.getElementById('btnRefreshAiReply');
            const aiActionRow = document.getElementById('aiActionRow');
            const aiHistoryBtn = document.getElementById('btnAiReplyHistory');
            if (aiConvertBtn && aiRefreshBtn && aiActionRow) {
                const writerAiActions = isWriter && post.status === 'wait' && !post.aiSolved && (post.type === 'IT' || post.type === 'BIZ');
                const adminCanRegenerateAi = currentUserHasAdminAccess() && !post.aiSolved && (post.type === 'IT' || post.type === 'BIZ');
                const showAiActionRow = writerAiActions || adminCanRegenerateAi;
                aiActionRow.classList.toggle('hidden', !showAiActionRow);
                aiConvertBtn.classList.toggle('hidden', !writerAiActions);
                const aiReady = hasAdoptableAiReply(post);
                aiConvertBtn.disabled = !writerAiActions || !aiReady;
                aiConvertBtn.title = !writerAiActions ? '' : (aiReady ? '' : 'AI 답변이 정상 생성된 후 채택할 수 있습니다.');
                const isRefreshing = aiRefreshingPostIds.has(post.id);
                const canRefresh = writerAiActions || adminCanRegenerateAi;
                aiRefreshBtn.disabled = isRefreshing || !canRefresh;
                aiRefreshBtn.innerHTML = isRefreshing
                    ? '<svg class="icon"><use href="#icon-info"></use></svg> 생성 중...'
                    : '<svg class="icon"><use href="#icon-search"></use></svg> 새로운 답변 생성';
            }
            if (aiHistoryBtn) {
                const hist = post && post.meta && Array.isArray(post.meta.aiReplyHistory) ? post.meta.aiReplyHistory : [];
                aiHistoryBtn.classList.toggle('hidden', !hist.length);
            }

            const formBox = document.getElementById('answerFormBox');
            const doneWrap = document.getElementById('completedAnswerWrap');
            const addInfoBox = document.getElementById('addInfoBox');
            const knowStatusBox = document.getElementById('knowStatusBox');
            formBox.classList.add('hidden'); doneWrap.classList.add('hidden'); addInfoBox.classList.add('hidden');
            if (knowStatusBox) knowStatusBox.classList.add('hidden');

            if (post.type === 'KNOW') {
                if (currentRole === 'it' && knowStatusBox) {
                    knowStatusBox.classList.remove('hidden');
                    const sel = document.getElementById('knowStatusSelect');
                    sel.value = normalizeKnowStatus(post.status);
                    document.getElementById('knowErrorMemoInput').value = (post.meta && post.meta.knowErrorMemo) ? post.meta.knowErrorMemo : '';
                    toggleKnowErrorMemo();
                }
            } else if (post.aiSolved || post.status === 'done' || post.status === 'moreInfo') {
                if(!post.aiSolved && post.answer) {
                    doneWrap.classList.remove('hidden');
                    if(post.status === 'moreInfo') {
                        const reqCount = getManagerRequestCount(post);
                        doneWrap.querySelector('summary span').innerHTML = `<svg class="icon"><use href="#icon-info"></use></svg> 담당자 ${reqCount}차 답변 (추가 정보 요청)`;
                        doneWrap.querySelector('summary').style.color = 'var(--warning)';
                        doneWrap.querySelector('summary').style.background = '#fffbeb';
                        doneWrap.style.borderColor = 'var(--warning)';
                    } else {
                        doneWrap.querySelector('summary span').innerHTML = '<svg class="icon"><use href="#icon-check"></use></svg> 공식 답변 및 조치 결과';
                        doneWrap.querySelector('summary').style.color = 'var(--success)';
                        doneWrap.querySelector('summary').style.background = '#ecfdf5';
                        doneWrap.style.borderColor = 'var(--success)';
                    }
                }
                
                // 추가 정보 요청 상태 && 본인이면 추가답변 입력폼 노출
                if (post.status === 'moreInfo' && isWriter) {
                    addInfoBox.classList.remove('hidden');
                    document.getElementById('addInfoInput').value = '';
                }
            } else {
                // 답변 권한이 있으면 (관리자)
                if (roleMatrix[currentRole].answer.includes(post.type)) {
                    formBox.classList.remove('hidden'); document.getElementById('answerInput').innerHTML = '<p><br></p>';
                    const replies = post.type === 'IT' ? ['KCB망 점검 중입니다.', '재기동 조치 완료.'] : ['추가 증빙 서류를 첨부해 주세요.', '해당 건은 처리가 불가합니다.'];
                    document.getElementById('quickReplyChips').innerHTML = replies.map(r => `<span class="badge" style="border:1px solid #ccc; background:#fff; color:#444; cursor:pointer;" onclick="insertTemplate('${r}')">${r}</span>`).join('');
                }
            }

            const inlineSimilarWrap = document.getElementById('dtlInlineSimilarWrap');
            const inlineSimilarList = document.getElementById('dtlInlineSimilarList');
            if (inlineSimilarWrap && inlineSimilarList) {
                const showInlineSimilar = post.type === 'IT' || post.type === 'BIZ';
                inlineSimilarWrap.classList.toggle('hidden', !showInlineSimilar);
                if (showInlineSimilar) {
                    const similarPosts = appData.posts
                        .filter((p) => p.type === post.type && p.id !== post.id)
                        .slice(0, 5);
                    if (!similarPosts.length) {
                        inlineSimilarList.innerHTML = '<div class="dtl-similar-empty">유사한 질문이 없습니다.</div>';
                    } else {
                        inlineSimilarList.innerHTML = similarPosts.map((p) => {
                            const raw = String(p.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                            const snippet = raw ? escapeHtml(raw.slice(0, 90)) : '내용 요약 없음';
                            return `<button type="button" class="dtl-similar-card" onclick="openDetail(${p.id}, '${p.type}')">
                                <div class="dtl-similar-card-title">${escapeHtml(p.title || '(제목 없음)')}</div>
                                <div class="dtl-similar-card-snippet">${snippet}</div>
                                <div class="dtl-similar-card-meta">${escapeHtml(p.writer || '-')} · ${escapeHtml(p.datetime || '-')}</div>
                            </button>`;
                        }).join('');
                    }
                }
            }
            if (!fromHistory && !skipHistory) {
                syncHistoryRoute('detail', post.type, post.id, false);
            }
        }

        function deletePost() {
            showConfirm('삭제하시겠습니까?', () => {
                appData.posts = appData.posts.filter((p) => !(Number(p.id) === Number(currentPostId) && p.type === currentBoardType));
                saveData();
                showAlert('삭제되었습니다.', 'success');
                switchView('list', currentBoardType);
            });
        }

        function editPost() {
            const post = getPostByIdAndType(currentPostId, currentBoardType);
            switchView('write', post.type);
            document.getElementById('writePageTitle').innerText = '수정 모드';
            document.getElementById('editPostId').value = post.id;
            
            if(post.type === 'KNOW') setWriteFormForKNOW(post.knowCategory);
            else selectWriteCategory(post.type);

            document.getElementById('writeTitle').value = post.title.replace('[AI채택] ', '');
            document.getElementById('writeContent').innerHTML = post.content;
            if (post.type === 'KNOW') {
                document.getElementById('writeKnowDomain').value = post.knowCategory || '';
                document.getElementById('writeKnowQuestion').value = (post.meta && post.meta.knowQuestion) || post.title || '';
                document.getElementById('writeKnowAnswer').value = (post.meta && post.meta.knowAnswer) || (post.content || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
                document.getElementById('writeKnowMemo').value = (post.meta && post.meta.knowMemo) || '';
                const kw = document.getElementById('writeKnowKeywords'); if (kw) kw.value = (post.meta && post.meta.knowKeywords) || '';
                const src = document.getElementById('writeKnowSource'); if (src) src.value = (post.meta && post.meta.knowSource) || '';
                const sum = document.getElementById('writeKnowSummary'); if (sum) sum.value = (post.meta && post.meta.knowSummary) || '';
            }
            writeAttachmentItems = Array.isArray(post.attachments)
                ? post.attachments.map(att => ({
                    id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    name: att.name || '첨부파일',
                    size: Number(att.size) || 0
                }))
                : [];
            renderWriteAttachmentList();

            // 기존 메타 정보(게시판별 추가 입력항목) 수정폼에 복원
            const meta = post.meta || {};
            if (post.type === 'IT') {
                document.getElementById('writeGid').value = normalizeGlobalId(meta.gid || '');
                document.getElementById('writeErrCode').value = meta.errCode || '';
                document.getElementById('writeErrMsg').value = meta.errMsg || '';
            }
            if (post.type === 'IT' || post.type === 'BIZ') {
                const custTypeSelect = document.getElementById('writeCustType');
                const savedType = (meta.custType || '').trim();
                const custTypeMap = {
                    '고객번호': 'CUST',
                    '계좌번호': 'ACCT',
                    '품의번호': 'APPR',
                    'CUST': 'CUST',
                    'ACCT': 'ACCT',
                    'APPR': 'APPR'
                };
                custTypeSelect.value = custTypeMap[savedType] || '';
                changeCustType();
                document.getElementById('writeCustVal1').value = meta.custVal1 || '';
                document.getElementById('writeCustVal2').value = meta.custVal2 || '';
            }

            document.getElementById('writeCategoryArea').style.pointerEvents = 'none';
            document.getElementById('writeCategoryArea').style.opacity = '0.5';
        }

        // --- 글쓰기 / 수정 (동적 폼 제어) ---
        function resetWriteForm(boardType) {
            document.getElementById('editPostId').value = '';
            document.getElementById('writeTitle').value = '';
            document.getElementById('writeContent').innerHTML = '<p><br></p>';
            document.getElementById('writeKnowQuestion').value = '';
            document.getElementById('writeKnowAnswer').value = '';
            document.getElementById('writeKnowMemo').value = '';
            document.getElementById('writeKnowDomain').value = '';
            const kw = document.getElementById('writeKnowKeywords'); if (kw) kw.value = '';
            const src = document.getElementById('writeKnowSource'); if (src) src.value = '';
            const sum = document.getElementById('writeKnowSummary'); if (sum) sum.value = '';
            document.getElementById('writePageTitle').innerText = boardType === 'KNOW' ? '지식정보 등록요청' : '문의 접수';
            document.getElementById('writeCategoryArea').style.pointerEvents = 'auto';
            document.getElementById('writeCategoryArea').style.opacity = '1';
            
            // 필드 초기화
            document.getElementById('writeGid').value = '';
            document.getElementById('writeCustType').value = '';
            document.getElementById('writeCustVal1').value = '';
            document.getElementById('writeCustVal2').value = '';
            document.getElementById('writeErrCode').value = '';
            document.getElementById('writeErrMsg').value = '';
            const fileInput = document.getElementById('writeAttachments');
            if (fileInput) fileInput.value = '';
            writeAttachmentItems = [];
            renderWriteAttachmentList();
            changeCustType();

            currentBoardType = boardType;
            if (boardType === 'KNOW') setWriteFormForKNOW('');
            else { setWriteFormForNormal(); selectWriteCategory(boardType); }
        }

        function setWriteFormForNormal() {
            document.getElementById('writeCategoryLabel').innerText = '게시판 선택';
            const rules = roleMatrix[currentRole].write.filter(t => t !== 'KNOW');
            let html = '';
            ['IT', 'BIZ', 'SYS'].forEach(t => {
                const isHide = rules.includes(t) ? '' : 'hidden';
                const label = t==='IT' ? 'IT / 전산 오류' : t==='BIZ' ? '규정 / 업무 문의' : 'KNOCK 개선 제안';
                html += `<div id="btn-cat-${t}" class="${isHide} btn btn-outline write-category-btn" onclick="selectWriteCategory('${t}')">${label}</div>`;
            });
            document.getElementById('writeCategoryButtons').innerHTML = html;
            document.getElementById('writeCategoryArea').style.display = 'block';
            document.getElementById('field-know-qa').classList.add('hidden');
            document.getElementById('lblWriteTitle').style.display = 'block';
            document.getElementById('lblWriteTitle').innerHTML = '제목 <span style="color:var(--danger)">*</span>';
            document.getElementById('writeTitle').parentElement.style.display = 'block';
            document.getElementById('lblWriteContent').innerHTML = '상세 내용 (이미지 임베딩 지원) <span style="color:var(--danger)">*</span>';
            document.getElementById('writeContent').parentElement.parentElement.style.display = 'block';
        }

        function setWriteFormForKNOW(subType = '') {
            document.getElementById('writeCategoryArea').style.display = 'none';
            document.getElementById('field-know-qa').classList.remove('hidden');
            document.getElementById('field-know-qa').classList.add('flex');
            document.getElementById('lblWriteTitle').style.display = 'block';
            document.getElementById('lblWriteTitle').innerHTML = '제목 <span style="color:var(--danger)">*</span>';
            document.getElementById('writeTitle').parentElement.style.display = 'block';
            document.getElementById('writeContent').parentElement.parentElement.style.display = 'none';
            document.getElementById('writeKnowDomain').value = (subType === 'IT' || subType === 'BIZ') ? subType : '';
        }
        function selectKnowCategory(type) {
            const area = document.getElementById('writeCategoryArea');
            if (!area) return;
            area.dataset.knowType = type;
            const itBtn = document.getElementById('btn-know-it');
            const bizBtn = document.getElementById('btn-know-biz');
            [itBtn, bizBtn].forEach(btn => {
                if (!btn) return;
                btn.classList.remove('is-active');
            });
            const activeBtn = type === 'BIZ' ? bizBtn : itBtn;
            if (activeBtn) {
                activeBtn.classList.add('is-active');
            }
        }

        function selectWriteCategory(type) {
            currentBoardType = type;
            document.querySelectorAll('#writeCategoryButtons > div').forEach((btn) => {
                btn.classList.remove('is-active');
            });
            const el = document.getElementById(`btn-cat-${type}`);
            if (el) el.classList.add('is-active');

            document.getElementById('field-gid').classList.add('hidden');
            document.getElementById('field-cust').classList.add('hidden');
            document.getElementById('field-err').classList.add('hidden');

            if(type === 'IT') {
                document.getElementById('field-gid').classList.remove('hidden'); document.getElementById('field-gid').classList.add('flex');
                document.getElementById('field-cust').classList.remove('hidden'); document.getElementById('field-cust').classList.add('flex');
                document.getElementById('field-err').classList.remove('hidden'); document.getElementById('field-err').classList.add('flex');
            } else if (type === 'BIZ') {
                document.getElementById('field-cust').classList.remove('hidden'); document.getElementById('field-cust').classList.add('flex');
            }
        }

        function changeCustType() {
            const val = document.getElementById('writeCustType').value;
            const input1 = document.getElementById('writeCustVal1');
            const input2 = document.getElementById('writeCustVal2');
            input1.value = ''; input2.value = '';
            if(val === '') { input1.disabled = true; input1.placeholder = '유형 선택'; input2.classList.add('hidden'); }
            else if(val === 'CUST') { input1.disabled = false; input1.placeholder = '고객번호 9자리'; input1.maxLength = 9; input2.classList.add('hidden'); }
            else if(val === 'ACCT') { input1.disabled = false; input1.placeholder = '계좌번호 최대 16자리'; input1.maxLength = 16; input2.classList.add('hidden'); }
            else if(val === 'APPR') { input1.disabled = false; input1.placeholder = '품의번호 9자리'; input1.maxLength = 9; input2.classList.remove('hidden'); input2.classList.add('block'); input2.maxLength = 7; }
        }
        function toggleKnowErrorMemo() {
            const select = document.getElementById('knowStatusSelect');
            const wrap = document.getElementById('knowErrorMemoWrap');
            if (!select || !wrap) return;
            wrap.classList.toggle('hidden', select.value !== KNOW_STATUS.REJECTED);
        }
        function saveKnowStatus() {
            const idx = getPostIndexByIdAndType(currentPostId, currentBoardType);
            if (idx < 0) return;
            if (currentRole !== 'it') { showAlert('IT 관리자만 상태를 변경할 수 있습니다.', 'error'); return; }
            const post = appData.posts[idx];
            if (post.type !== 'KNOW') return;
            const status = normalizeKnowStatus(document.getElementById('knowStatusSelect').value);
            const memo = document.getElementById('knowErrorMemoInput').value.trim();
            if (status === KNOW_STATUS.REJECTED && !memo) { showAlert('불승인 사유(관리자 의견)를 입력해주세요.', 'error'); return; }

            post.status = status;
            if (!post.meta) post.meta = {};
            post.meta.knowErrorMemo = status === KNOW_STATUS.REJECTED ? memo : '';
            if (status === KNOW_STATUS.REJECTED) {
                ensurePostThread(post).push({
                    role: 'manager',
                    action: 'knowError',
                    content: `지식 불승인 사유: ${memo}`,
                    datetime: getCurrentDateTime()
                });
            }
            saveData();
            showAlert('지식베이스 상태가 변경되었습니다.', 'success');
            openDetail(currentPostId);
        }

        function formatDoc(cmd, value=null, targetId) { 
            const el = document.getElementById(targetId);
            if(el){ 
                el.focus(); 
                document.execCommand(cmd, false, value); 
                const event = new Event('selectionchange');
                document.dispatchEvent(event);
            }
        }

        function changeFontSize(size, targetId) {
            const el = document.getElementById(targetId);
            if(el) {
                el.focus(); document.execCommand("fontSize", false, "7"); 
                const fontElements = el.getElementsByTagName("font");
                for (let i = 0; i < fontElements.length; i++) {
                    if (fontElements[i].size == "7") { fontElements[i].removeAttribute("size"); fontElements[i].style.fontSize = size; }
                }
            }
        }
        function insertLink(targetId) {
            const el = document.getElementById(targetId);
            if (!el) return;
            const url = prompt('링크 주소를 입력하세요 (예: intranet/help/doc)');
            if (!url) return;
            let safe = url.trim();
            if (!/^https?:\/\//i.test(safe)) safe = `https://${safe}`;
            el.focus();
            document.execCommand('createLink', false, safe);
        }
        function setupEditorPasteAsPlainText() {
            document.querySelectorAll('.editor-content').forEach((editor) => {
                if (editor.dataset.pasteInit === '1') return;
                editor.dataset.pasteInit = '1';
                editor.addEventListener('paste', (event) => {
                    const text = (event.clipboardData || window.clipboardData).getData('text');
                    if (!text) return;
                    event.preventDefault();
                    document.execCommand('insertText', false, text);
                });
            });
        }

        function insertOfflineMedia(type, targetId) {
            const el = document.getElementById(targetId); if(!el) return; el.focus();
            if(type === 'image') {
                const svg = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='200'%3E%3Crect width='100%25' height='100%25' fill='%23e2e8f0'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='16' fill='%2364748b' text-anchor='middle' dominant-baseline='middle'%3EOffline Image Placeholder%3C/text%3E%3C/svg%3E";
                document.execCommand('insertHTML', false, `<br><img src="${svg}"><br>`);
            }
        }

        // 게시물 AI 답변(생성/이력/토글) 기능은 app-post-ai.js로 분리됨.

        async function triggerSubmit() {
            let title = document.getElementById('writeTitle').value.trim();
            let content = document.getElementById('writeContent').innerHTML.trim();
            if (currentBoardType === 'KNOW') {
                const knowDomain = document.getElementById('writeKnowDomain').value;
                const q = document.getElementById('writeKnowQuestion').value.trim();
                const a = document.getElementById('writeKnowAnswer').value.trim();
                if (!knowDomain) { showAlert('학습분류 도메인을 선택해주세요.', 'error'); return; }
                if (!title || !q || !a) { showAlert('제목, 질문내용, 답변내용을 모두 입력해주세요.', 'error'); return; }
                content = `<div><b>Q.</b> ${escapeHtml(q)}</div><div style="margin-top:8px;"><b>A.</b><br>${escapeHtml(a).replace(/\n/g, '<br>')}</div>`;
                const memo = document.getElementById('writeKnowMemo').value.trim();
                const keywords = (document.getElementById('writeKnowKeywords')?.value || '').trim();
                const source = (document.getElementById('writeKnowSource')?.value || '').trim();
                const summary = (document.getElementById('writeKnowSummary')?.value || '').trim();
                if (memo) content += `<div style="margin-top:12px; color:#475569;"><b>추가 의견/별첨:</b><br>${escapeHtml(memo).replace(/\n/g, '<br>')}</div>`;
                if (keywords) content += `<div style="margin-top:12px; color:#475569;"><b>키워드:</b> ${escapeHtml(keywords)}</div>`;
                if (source) content += `<div style="margin-top:8px; color:#475569;"><b>출처:</b> ${escapeHtml(source)}</div>`;
                if (summary) content += `<div style="margin-top:8px; color:#475569;"><b>요약:</b> ${escapeHtml(summary).replace(/\n/g, '<br>')}</div>`;
            } else if(!title || content === '<p><br></p>' || !content) {
                showAlert('제목과 본문을 입력해주세요.', 'error');
                return;
            }
            
            if(document.getElementById('editPostId').value || currentBoardType === 'SYS' || currentBoardType === 'KNOW') {
                savePost(false); return;
            }

            await savePost(false);
        }

        async function savePost(isAiSolved) {
            const editId = document.getElementById('editPostId').value;
            let title = document.getElementById('writeTitle').value;
            let content = document.getElementById('writeContent').innerHTML;

            const meta = {};
            const attachments = writeAttachmentItems.map(item => ({ name: item.name, size: Number(item.size) || 0 }));
            if(currentBoardType === 'IT') {
                meta.gid = normalizeGlobalId(document.getElementById('writeGid').value);
                meta.errCode = document.getElementById('writeErrCode').value;
                meta.errMsg = document.getElementById('writeErrMsg').value;
            }
            if(currentBoardType === 'IT' || currentBoardType === 'BIZ') {
                const cType = document.getElementById('writeCustType');
                meta.custType = cType.options[cType.selectedIndex].text;
                meta.custVal1 = document.getElementById('writeCustVal1').value;
                meta.custVal2 = document.getElementById('writeCustVal2').value;
            }
            if (currentBoardType === 'KNOW') {
                const knowDomain = document.getElementById('writeKnowDomain').value;
                const q = document.getElementById('writeKnowQuestion').value.trim();
                const a = document.getElementById('writeKnowAnswer').value.trim();
                const memo = document.getElementById('writeKnowMemo').value.trim();
                const keywordsInput = document.getElementById('writeKnowKeywords');
                const rawKeywords = (keywordsInput?.value || '').trim();
                const source = (document.getElementById('writeKnowSource')?.value || '').trim();
                const summary = (document.getElementById('writeKnowSummary')?.value || '').trim();
                if (!knowDomain) {
                    showAlert('학습분류 도메인을 선택해주세요.', 'error');
                    return;
                }
                if (!title || !q || !a) {
                    showAlert('제목, 질문내용, 답변내용을 모두 입력해주세요.', 'error');
                    return;
                }
                const parsedKeywords = splitAndSanitizeKnowKeywords(rawKeywords);
                if (parsedKeywords.blocked.length > 0) {
                    showAlert(`등록할 수 없는 키워드가 포함되어 있습니다: ${parsedKeywords.blocked.join(', ')}`, 'error');
                    return;
                }
                const keywords = parsedKeywords.kept.join(', ');
                if (keywordsInput) keywordsInput.value = keywords;
                meta.knowQuestion = q;
                meta.knowAnswer = a;
                meta.knowMemo = memo;
                meta.knowKeywords = keywords;
                meta.knowSource = source;
                meta.knowSummary = summary;
                content = `<div><b>Q.</b> ${escapeHtml(q)}</div><div style="margin-top:8px;"><b>A.</b><br>${escapeHtml(a).replace(/\n/g, '<br>')}</div>`;
                if (memo) content += `<div style="margin-top:12px; color:#475569;"><b>추가 의견/별첨:</b><br>${escapeHtml(memo).replace(/\n/g, '<br>')}</div>`;
                if (keywords) content += `<div style="margin-top:12px; color:#475569;"><b>키워드:</b> ${escapeHtml(keywords)}</div>`;
                if (source) content += `<div style="margin-top:8px; color:#475569;"><b>출처:</b> ${escapeHtml(source)}</div>`;
                if (summary) content += `<div style="margin-top:8px; color:#475569;"><b>요약:</b> ${escapeHtml(summary).replace(/\n/g, '<br>')}</div>`;
            }

            if (editId) { 
                const idx = getPostIndexByIdAndType(editId, currentBoardType);
                if(idx > -1) {
                    if (!Array.isArray(appData.posts[idx].editHistory)) appData.posts[idx].editHistory = [];
                    appData.posts[idx].editHistory.push({
                        datetime: getCurrentDateTime(),
                        editor: getCurrentActorName()
                    });
                    appData.posts[idx].title = title;
                    appData.posts[idx].content = content;
                    appData.posts[idx].meta = meta;
                    appData.posts[idx].attachments = attachments;
                }
                showAlert('수정되었습니다.', 'success');
            } else { 
                const newId = getNextPostIdByType(currentBoardType);
                const dt = getCurrentDateTime(); const ipStr = getDummyIp();
                
                if (currentBoardType === 'KNOW') {
                    const knowCat = (document.getElementById('writeKnowDomain').value || '').trim();
                    if (!knowCat) {
                        showAlert('학습분류(도메인)를 선택해주세요.', 'error');
                        return;
                    }
                    appData.posts.unshift({
                        id: newId, type: 'KNOW', knowCategory: knowCat, title: title, writer: getCurrentActorName(), 
                        datetime: dt, ip: ipStr, status: KNOW_STATUS.PENDING, content: content, aiContent: '', answer: '', meta: meta, addInfoList: [], thread: [], attachments
                    });
                    showAlert('미승인 상태로 지식베이스에 등록되었습니다.', 'success');
                } else if (isAiSolved) {
                    const aiSolvedContentText = stripHtmlForRag(content || '');
                    const aiSolvedAnswerText = stripHtmlForRag(AI_FALLBACK_HTML);
                    appData.posts.unshift({
                        id: newId, type: currentBoardType, title: '[AI채택] ' + title, writer: getCurrentActorName(), 
                        datetime: dt, ip: ipStr, status: 'done', aiSolved: true, content: content, 
                        aiContent: AI_FALLBACK_HTML, answer: '질의자가 AI 추천 답변을 통해 스스로 문제를 해결(채택)하여 자동 종결 등록된 건입니다.', meta: meta, addInfoList: [], thread: [], attachments
                    });
                    createAutoRagKnowledgeFromQA(aiSolvedContentText || title || '', aiSolvedAnswerText, {
                        sourceType: 'POST',
                        sourceRef: String(newId),
                        boardType: currentBoardType,
                        sourceLabel: `게시물 AI답변채택 #${newId}`
                    });
                    showAlert('AI 답변 채택 완료! 자동 처리되었습니다.', 'success');
                } else {
                    let aiContentHtml = AI_FALLBACK_HTML;
                    if (!isAiSolved && (currentBoardType === 'IT' || currentBoardType === 'BIZ')) {
                        aiContentHtml = makeAiPendingHtml();
                    }
                    appData.posts.unshift({
                        id: newId, type: currentBoardType, title: title, writer: getCurrentActorName(), 
                        datetime: dt, ip: ipStr, status: 'wait', aiSolved: false, content: content, 
                        aiContent: aiContentHtml, answer: '', meta: meta, addInfoList: [], thread: [], attachments
                    });
                    showAlert('문의가 정상 접수되었습니다.', 'success');
                    if (currentBoardType === 'IT' || currentBoardType === 'BIZ') {
                        queueAsyncAiAnswerForPost(
                            newId,
                            currentBoardType,
                            String(title || '').trim(),
                            stripHtmlToPlainText(content),
                            { strictContext: true }
                        );
                    }
                }
            }
            saveData(); switchView('list', currentBoardType);
        }

        function insertTemplate(text) { const editor = document.getElementById('answerInput'); editor.innerHTML += (editor.innerHTML === '' || editor.innerHTML === '<p><br></p>') ? text : '<br>' + text; }
        
        function submitAnswer() {
            const editor = document.getElementById('answerInput');
            if(!editor.innerHTML.trim() || editor.innerHTML === '<p><br></p>') { showAlert('답변 내용을 입력하세요.', 'error'); return; }
            
            const ansStatus = document.querySelector('input[name="ansStatus"]:checked').value; 
            const val = editor.innerHTML; 
            const idx = getPostIndexByIdAndType(currentPostId, currentBoardType);
            
            if(idx > -1) { 
                const post = appData.posts[idx];
                ensurePostThread(post).push({
                    role: 'manager',
                    action: ansStatus === 'moreInfo' ? 'request' : 'answer',
                    content: val,
                    datetime: getCurrentDateTime()
                });
                appData.posts[idx].answer = val; 
                appData.posts[idx].status = ansStatus; 
                saveData(); showAlert('답변이 성공적으로 등록되었습니다.', 'success'); switchView('list', appData.posts[idx].type); 
            }
        }

        function submitAddInfo() {
            const val = document.getElementById('addInfoInput').value.trim();
            if(!val) { showAlert('추가 내용을 입력해주세요.', 'error'); return; }
            
            const idx = getPostIndexByIdAndType(currentPostId, currentBoardType);
            if(idx > -1) {
                if(!appData.posts[idx].addInfoList) appData.posts[idx].addInfoList = [];
                const nowText = getCurrentDateTime();
                appData.posts[idx].addInfoList.push({ datetime: nowText, content: val });
                ensurePostThread(appData.posts[idx]).push({
                    role: 'requester',
                    action: 'reply',
                    content: val,
                    datetime: nowText
                });
                appData.posts[idx].status = 'wait'; 
                saveData(); showAlert('추가 정보가 등록되었습니다.', 'success'); openDetail(currentPostId); 
            }
        }

        function convertPostToAiSolved() {
            const idx = getPostIndexByIdAndType(currentPostId, currentBoardType);
            if (idx < 0) return;
            const post = appData.posts[idx];
            const myName = getCurrentActorNameToken();
            const isWriter = (post.writer || '').includes(myName);
            if (!isWriter || post.status !== 'wait' || post.aiSolved || (post.type !== 'IT' && post.type !== 'BIZ')) {
                showAlert('AI 답변 채택으로 전환할 수 없는 상태입니다.', 'error');
                return;
            }
            showConfirm('이 문의를 AI 답변 채택으로 처리하시겠습니까?', () => {
                post.aiSolved = true;
                post.status = 'done';
                if (!post.title.startsWith('[AI채택] ')) post.title = '[AI채택] ' + post.title;
                if (!post.answer || !post.answer.trim()) {
                    post.answer = '질의자가 AI 추천 답변을 채택하여 자동 처리한 건입니다.';
                }
                ensurePostThread(post).push({
                    role: 'requester',
                    action: 'aiSolved',
                    content: '작성자가 AI 답변 채택으로 종결 처리했습니다.',
                    datetime: getCurrentDateTime()
                });
                const qa = stripHtmlForRag(post.content || '');
                const aiAnswer = stripHtmlForRag(post.aiContent || '');
                createAutoRagKnowledgeFromQA(qa || post.title || '', aiAnswer, {
                    sourceType: 'POST',
                    sourceRef: String(post.id || ''),
                    boardType: post.type,
                    sourceLabel: `게시물 AI답변채택 #${post.id || '-'}`
                });
                saveData();
                showAlert('AI 답변 채택으로 변경되었습니다.', 'success');
                openDetail(currentPostId);
            });
        }

        // --- Integrated Search & Similar Modals ---
        function executeIntegratedSearch() { 
            const kw = document.getElementById('headerSearchInput').value;
            document.getElementById('modalSearchInput').value = kw;
            document.getElementById('headerSearchInput').value = '';
            showIntegratedSearchModal(); 
            performModalSearch('header'); 
        }
        function getIntegratedSearchSortValue() {
            const sortEl = document.getElementById('integratedSearchSort');
            return sortEl ? String(sortEl.value || 'latest') : 'latest';
        }
        function clearIntegratedSearchInput() {
            const input = document.getElementById('modalSearchInput');
            if (input) input.value = '';
            performModalSearch('clear');
            if (input) input.focus();
        }
        function applyIntegratedRelatedKeyword(keyword) {
            const input = document.getElementById('modalSearchInput');
            if (!input) return;
            input.value = String(keyword || '').trim();
            performModalSearch('related');
            input.focus();
        }
        const INTEGRATED_SEARCH_STATS_KEY = 'knock-integrated-search-stats-v1';
        let integratedSearchKeywordStats = null;
        let integratedSearchLastTrack = { keyword: '', at: 0 };
        function loadIntegratedSearchKeywordStats() {
            if (Array.isArray(integratedSearchKeywordStats)) return integratedSearchKeywordStats;
            try {
                const raw = localStorage.getItem(INTEGRATED_SEARCH_STATS_KEY);
                const parsed = JSON.parse(raw || '[]');
                integratedSearchKeywordStats = Array.isArray(parsed)
                    ? parsed
                          .map((it) => ({
                              keyword: String((it && it.keyword) || '').trim(),
                              count: Math.max(0, Number((it && it.count) || 0)),
                              updatedAt: Number((it && it.updatedAt) || 0),
                          }))
                          .filter((it) => it.keyword && it.count > 0)
                          .slice(0, 500)
                    : [];
            } catch (_) {
                integratedSearchKeywordStats = [];
            }
            return integratedSearchKeywordStats;
        }
        function saveIntegratedSearchKeywordStats() {
            try {
                localStorage.setItem(INTEGRATED_SEARCH_STATS_KEY, JSON.stringify(loadIntegratedSearchKeywordStats().slice(0, 500)));
            } catch (_) {}
        }
        function extractIntegratedQueryTokens(text) {
            const parts = String(text || '')
                .toLowerCase()
                .replace(/[^a-z0-9가-힣\s]/g, ' ')
                .split(/\s+/)
                .filter(Boolean);
            const seen = new Set();
            const tokens = [];
            parts.forEach((part) => {
                const normalized = normalizeKnowKeywordToken(part);
                if (!normalized || normalized.length < 2 || ragKeywordBlocklist.has(normalized)) return;
                if (seen.has(normalized)) return;
                seen.add(normalized);
                tokens.push(normalized);
            });
            return tokens;
        }
        function trackIntegratedSearchKeyword(rawKeyword) {
            const now = Date.now();
            const tokens = extractIntegratedQueryTokens(rawKeyword);
            if (!tokens.length) return;
            const mergedKey = tokens.join(' ');
            if (integratedSearchLastTrack.keyword === mergedKey && now - integratedSearchLastTrack.at < 1200) {
                return;
            }
            integratedSearchLastTrack = { keyword: mergedKey, at: now };
            const list = loadIntegratedSearchKeywordStats();
            tokens.forEach((keyword) => {
                const idx = list.findIndex((it) => it.keyword === keyword);
                if (idx >= 0) {
                    list[idx].count += 1;
                    list[idx].updatedAt = now;
                    return;
                }
                list.push({ keyword, count: 1, updatedAt: now });
            });
            integratedSearchKeywordStats = list
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .slice(0, 500);
            saveIntegratedSearchKeywordStats();
        }
        function getIntegratedSearchKeywordRanking(limit = 5) {
            return loadIntegratedSearchKeywordStats()
                .filter((it) => {
                    const normalized = normalizeKnowKeywordToken(it.keyword);
                    return normalized && normalized.length >= 2 && !ragKeywordBlocklist.has(normalized);
                })
                .sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt)
                .slice(0, Math.max(1, Number(limit) || 5))
                .map((it) => [it.keyword, it.count]);
        }
        function extractIntegratedTokensFromText(text) {
            return String(text || '')
                .toLowerCase()
                .replace(/[^a-z0-9가-힣\s]/g, ' ')
                .split(/\s+/)
                .map((t) => normalizeKnowKeywordToken(t))
                .filter((t) => t && t.length >= 2 && !ragKeywordBlocklist.has(t));
        }
        function buildIntegratedKeywordCounts(posts) {
            const counts = new Map();
            (posts || []).forEach((p) => {
                const merged = `${p && p.title ? p.title : ''} ${p && p.content ? String(p.content).replace(/<[^>]*>?/gm, ' ') : ''}`;
                extractIntegratedTokensFromText(merged).forEach((t) => {
                    counts.set(t, (counts.get(t) || 0) + 1);
                });
            });
            return counts;
        }
        function renderIntegratedSearchInsights(keyword, matchedPosts = []) {
            const rankingEl = document.getElementById('integratedKeywordRanking');
            const relatedEl = document.getElementById('integratedRelatedKeywords');
            if (!rankingEl || !relatedEl) return;
            const counts = buildIntegratedKeywordCounts(appData.posts || []);
            const top = getIntegratedSearchKeywordRanking(5);
            rankingEl.innerHTML = `<div style="font-weight:800; color:var(--text-dark); margin-bottom:6px;">검색어 순위</div>${
                top.length
                    ? `<div class="integrated-ranking-board">${
                          top
                              .map(
                                  ([k, c], i) => `
                            <div class="integrated-ranking-row" style="animation-delay:${i * 90}ms;">
                                <span class="integrated-ranking-rank">${i + 1}</span>
                                <span class="integrated-ranking-keyword">${escapeHtml(k)}</span>
                                <span class="integrated-ranking-count">${c}</span>
                            </div>`,
                              )
                              .join('')
                      }</div>`
                    : '<span style="color:var(--text-light);">데이터 없음</span>'
            }`;
            const kw = String(keyword || '').trim().toLowerCase();
            const relatedCounts = kw && matchedPosts.length > 0 ? buildIntegratedKeywordCounts(matchedPosts) : counts;
            const rel = kw
                ? Array.from(relatedCounts.entries())
                      .filter(([k]) => (k.includes(kw) || kw.includes(k)) && k !== kw)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 8)
                : top.slice(0, 8);
            relatedEl.innerHTML = `<div style="font-weight:800; color:var(--text-dark); margin-bottom:4px;">연관검색어</div>${
                rel.length
                    ? rel
                          .map(([k, c]) => {
                              const safeJs = String(k).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
                              return `<button type="button" class="btn btn-outline integrated-search-chip" style="margin-right:6px; margin-bottom:4px;" onclick="applyIntegratedRelatedKeyword('${safeJs}')">${escapeHtml(k)} <span style="opacity:.75;">(${c})</span></button>`;
                          })
                          .join('')
                    : '<span style="color:var(--text-light);">연관 키워드 없음</span>'
            }`;
        }
        function showIntegratedSearchModal() {
            document.getElementById('integratedSearchModal').classList.add('active');
            renderIntegratedSearchInsights(document.getElementById('modalSearchInput').value || '', []);
            setTimeout(() => document.getElementById('modalSearchInput').focus(), 100);
        }
        function closeIntegratedSearchModal() { document.getElementById('integratedSearchModal').classList.remove('active'); }
        function performModalSearch(trigger = 'manual') {
            const raw = document.getElementById('modalSearchInput').value || '';
            const kw = raw.toLowerCase().trim();
            const resContainer = document.getElementById('integratedSearchResults');
            const sort = getIntegratedSearchSortValue();
            if (kw && trigger !== 'sort' && trigger !== 'clear' && trigger !== 'init') {
                trackIntegratedSearchKeyword(raw);
            }
            renderIntegratedSearchInsights(raw, []);
            if (!kw) { resContainer.innerHTML = '<div class="text-center p-20" style="color:#999;">검색어를 입력하세요.</div>'; return; }
            
            const results = appData.posts
                .map((p) => {
                    const title = String(p.title || '').toLowerCase();
                    const content = String(p.content || '').replace(/<[^>]*>?/gm, ' ').toLowerCase();
                    const writer = String(p.writer || '').toLowerCase();
                    let score = 0;
                    if (title.includes(kw)) score += 5;
                    if (content.includes(kw)) score += 2;
                    if (writer.includes(kw)) score += 1;
                    return { post: p, score };
                })
                .filter((x) => x.score > 0);
            results.sort((a, b) => {
                if (sort === 'views') {
                    const va = Number(a.post.views || (a.post.meta && a.post.meta.views) || 0);
                    const vb = Number(b.post.views || (b.post.meta && b.post.meta.views) || 0);
                    return vb - va || b.post.id - a.post.id;
                }
                if (sort === 'relevance') return b.score - a.score || b.post.id - a.post.id;
                return b.post.id - a.post.id;
            });
            renderIntegratedSearchInsights(raw, results.map((x) => x.post));
            if (results.length === 0) { resContainer.innerHTML = '<div class="text-center p-20" style="color:#999;">결과가 없습니다.</div>'; return; }

            resContainer.innerHTML = '<ul class="integrated-search-result-list">' + results.map(({ post: p, score }) => {
                const stripped = p.content.replace(/<[^>]*>?/gm, ''); 
                let badge = '';
                if (p.type === 'KNOW') {
                    const knowMeta = getKnowStatusMeta(p.status);
                    badge = `<span class="badge ${knowMeta.badgeClass}" style="font-size:10px; padding:2px 6px;">${knowMeta.label}</span>`;
                } else {
                    if (p.aiSolved) badge = '<span class="badge bg-ai" style="font-size:10px; padding:2px 6px;">AI 채택</span>';
                    else if(p.status === 'wait') badge = '<span class="badge bg-wait" style="font-size:10px; padding:2px 6px;">접수대기</span>';
                    else if(p.status === 'moreInfo') badge = '<span class="badge bg-moreInfo" style="font-size:10px; padding:2px 6px;">추가답변</span>';
                    else badge = '<span class="badge bg-done" style="font-size:10px; padding:2px 6px;">답변완료</span>';
                }
                return `<li class="integrated-search-result-item" onclick="goFromIntegratedSearch(${p.id}, '${p.type}')">
                    <div class="flex items-center justify-between mb-10"><div class="flex items-center gap-10"><span style="font-weight:bold; color:var(--text-gray); font-size:12px;">[${getBoardDisplayLabel(p)}]</span>${badge}</div><span style="font-size:12px; color:var(--text-light);">${p.datetime.substring(0, 10)}</span></div>
                    <div style="font-weight:bold; color:#60a5fa; font-size:15px; margin-bottom:5px;">${p.title}</div>
                    <div style="font-size:13px; color:var(--text-gray);" class="truncate">${stripped}</div>
                    <div style="margin-top:6px; font-size:11px; color:var(--text-light);">관련도 점수: ${score}</div>
                </li>`;
            }).join('') + '</ul>';
        }
        function goFromIntegratedSearch(id, postType) {
            closeIntegratedSearchModal(); document.getElementById('headerSearchInput').value = '';
            const post = getPostByIdAndType(id, postType || currentBoardType);
            if (!post) return;
            if(post) currentBoardType = post.type;
            openDetail(id, post.type);
        }

        function openSimilarPostModal(id) {
            const post = getPostByIdAndType(id, currentBoardType);
            if(!post) return;
            document.getElementById('simTitle').innerText = post.title;
            document.getElementById('simWriter').innerText = post.writer;
            document.getElementById('simDatetime').innerText = post.datetime;
            document.getElementById('simIp').innerText = `IP: ${post.ip}`;
            document.getElementById('simContent').innerHTML = post.content;
            
            const aiWrap = document.getElementById('simAiWrap');
            if(post.type === 'SYS') aiWrap.style.display = 'none';
            else { aiWrap.style.display = 'block'; document.getElementById('simAiContent').innerHTML = renderAiContentWithToggle(post.aiContent, `similar-${post.id}`); }

            const adminWrap = document.getElementById('simAdminWrap');
            const thread = ensurePostThread(post);
            const lastManagerEntry = [...thread].reverse().find(item => item.role === 'manager');
            if (post.aiSolved || !lastManagerEntry) adminWrap.style.display = 'none'; 
            else {
                adminWrap.style.display = 'block';
                document.getElementById('simAdminAnswer').innerHTML = lastManagerEntry.content || '';
            }
            document.getElementById('similarPostModal').classList.add('active');
        }
        function closeSimilarPostModal() { document.getElementById('similarPostModal').classList.remove('active'); }

        function openEditHistoryModal() {
            const modal = document.getElementById('editHistoryModal');
            const body = document.getElementById('editHistoryModalBody');
            if (!modal || !body) return;
            const post = getPostByIdAndType(currentPostId, currentBoardType);
            const hist = post && Array.isArray(post.editHistory) ? [...post.editHistory].reverse() : [];
            if (!hist.length) {
                body.innerHTML = '<div class="text-center p-20" style="color:#94a3b8;">수정 이력이 없습니다.</div>';
                modal.classList.add('active');
                return;
            }
            body.innerHTML = `
                <div class="meta-field-group" style="margin-bottom:0;">
                    <div class="meta-field-title">총 ${hist.length}건</div>
                    <div class="meta-grid">
                        ${hist
                            .map(
                                (h) => `<div class="meta-item">
                                    <div class="meta-item-label">${escapeHtml(h.datetime || '-')}</div>
                                    <div class="meta-item-value">${escapeHtml(h.editor || '-')} 수정</div>
                                </div>`,
                            )
                            .join('')}
                    </div>
                </div>
            `;
            modal.classList.add('active');
        }
        function closeEditHistoryModal() {
            const modal = document.getElementById('editHistoryModal');
            if (modal) modal.classList.remove('active');
        }
        function getActiveModalOverlays() {
            return Array.from(document.querySelectorAll('.modal-overlay.active'));
        }
        function closeModalOverlayElement(modalEl) {
            if (!modalEl) return;
            modalEl.classList.remove('active');
            if (modalEl.id === 'appDialogModal') {
                appDialogConfirmHandler = null;
                appDialogCancelHandler = null;
            }
        }
        function closeTopMostActiveModal() {
            const activeModals = getActiveModalOverlays();
            if (!activeModals.length) return false;
            const topModal = activeModals
                .map((el) => ({ el, z: Number(window.getComputedStyle(el).zIndex) || 0 }))
                .sort((a, b) => b.z - a.z)[0];
            closeModalOverlayElement(topModal.el);
            return true;
        }
        window.addEventListener('resize', () => {
            closeHeaderActionsLayer();
            updateHeaderActionOverflow();
            const dashView = document.getElementById('view-dashboard');
            if (dashView && dashView.classList.contains('active')) {
                setTimeout(renderCSSCharts, 80);
            }
            const listView = document.getElementById('view-list');
            if (listView && listView.classList.contains('active')) {
                syncBoardLayoutModes();
            }
        });
        document.addEventListener('click', () => {
            closeHeaderActionsLayer();
            closeBoardToolsLayer();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            closeTopMostActiveModal();
        });
        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (!target.classList.contains('modal-overlay')) return;
            if (!target.classList.contains('active')) return;
            closeModalOverlayElement(target);
        });

        async function bootstrapSession() {
            await loadSignupUsers();
            const scopedEmpNo = getCookie(USER_SCOPE_COOKIE);
            if (!scopedEmpNo) return;
            const matched = signupUsers.find(u => String(u.employeeNo) === String(scopedEmpNo));
            if (!matched || isAiSystemUser(matched)) {
                clearCookie(USER_SCOPE_COOKIE);
                return;
            }
            currentLoginUser = matched;
            const loginEmpNo = document.getElementById('loginEmpNo');
            if (loginEmpNo) loginEmpNo.value = matched.employeeNo;
            await doLogin({ skipAuthValidation: true });
            if (history && history.state && history.state.page === 'app') {
                applyHistoryRoute(history.state);
            } else {
                const preferredInitialView = getPreferredInitialView();
                syncHistoryRoute(preferredInitialView === 'dashboard' ? 'dashboard' : 'ai-search', null, null, true);
            }
        }

        bootstrapSession();