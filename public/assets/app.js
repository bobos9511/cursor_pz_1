// ==========================================
        // 0. Custom Dialog Alert System
        // ==========================================
        let appDialogConfirmHandler = null;
        let appDialogCancelHandler = null;

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
            if (!container) return;

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
                    const closeBtn = event.target && event.target.closest('.toast-close');
                    if (closeBtn) return;
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

        let appData = { posts: [], settings: { notify: true, sms: false } };
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
        let aiRefreshingPostId = null;
        const USER_SCOPE_COOKIE = 'knockUserScope';
        const APP_DATA_SHARED_SCOPE = 'shared';
        const AI_SEARCH_HISTORY_KEY_PREFIX = 'knockAiHistory:';
        const AI_SEARCH_ACTIVE_KEY_PREFIX = 'knockAiActive:';
        let signupUsers = [];
        let currentLoginUser = null;
        let aiSearchActive = null;
        let aiSearchHistory = [];
        let aiSearchInitialized = false;
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
            'SYS': { icon: '#icon-lightbulb', title: '노크 개선 제안 게시판', label: '개선제안' },
            'KNOW': { icon: '#icon-history', title: 'AI 지식베이스 관리', label: 'AI지식' }
        };
        const KNOW_CATEGORY_LABEL = { IT: 'IT 매뉴얼', BIZ: '업무 매뉴얼' };

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

        function getCurrentDateTime() {
            const now = new Date();
            return now.getFullYear() + '.' + String(now.getMonth() + 1).padStart(2, '0') + '.' + String(now.getDate()).padStart(2, '0') + ' ' + 
                   String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        }
        function getKnowCategoryLabel(category) {
            return KNOW_CATEGORY_LABEL[category] || '-';
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
        function sanitizeSignupUserRecord(user) {
            if (!user || typeof user !== 'object') return null;
            return {
                ...user,
                name: normalizeDisplayText(user.name, '사용자'),
                deptName: normalizeDisplayText(user.deptName, '-'),
                deptCode: normalizeDisplayText(user.deptCode, '-'),
                position: normalizeDisplayText(user.position, ''),
                grade: normalizeDisplayText(user.grade, ''),
                employeeNo: normalizeDisplayText(user.employeeNo, ''),
                role: normalizeDisplayText(user.role, 'branch')
            };
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
        function getLoginNonce() {
            return localStorage.getItem('knockLoginNonce') || 'no-login';
        }
        function getAiSearchStorageKeyBase() {
            const scope = getCookie(USER_SCOPE_COOKIE) || 'guest';
            return { activeKey: `${AI_SEARCH_ACTIVE_KEY_PREFIX}${scope}:${getLoginNonce()}`, historyKey: `${AI_SEARCH_HISTORY_KEY_PREFIX}${scope}` };
        }
        function loadJsonFromStorage(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : fallback;
            } catch (error) {
                return fallback;
            }
        }
        function saveJsonToStorage(key, value) {
            localStorage.setItem(key, JSON.stringify(value));
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
        function makeDefaultAiSearchState() {
            const boardTypeEl = document.getElementById('aiSearchBoardType');
            return {
                id: `chat_${Date.now()}`,
                title: '새 대화',
                boardType: boardTypeEl ? (boardTypeEl.value || 'IT') : 'IT',
                draft: '',
                updatedAt: nowDateTimeLabel(),
                messages: [{ role: 'ai', text: '안녕하세요. 핵심 위주로 답변하는 AI 검색 채팅입니다.' }]
            };
        }
        function saveAiSearchActiveState() {
            if (!aiSearchActive) return;
            const inputEl = document.getElementById('aiSearchInput');
            const boardTypeEl = document.getElementById('aiSearchBoardType');
            aiSearchActive.draft = inputEl ? (inputEl.value || '') : '';
            aiSearchActive.boardType = boardTypeEl ? (boardTypeEl.value || 'IT') : 'IT';
            aiSearchActive.updatedAt = nowDateTimeLabel();
            const keys = getAiSearchStorageKeyBase();
            saveJsonToStorage(keys.activeKey, aiSearchActive);
        }
        function renderAiSearchMessages() {
            const logEl = document.getElementById('aiSearchLog');
            if (!logEl) return;
            logEl.innerHTML = '';
            const messages = aiSearchActive && Array.isArray(aiSearchActive.messages) ? aiSearchActive.messages : [];
            messages.forEach((msg) => {
                const role = msg && msg.role === 'user' ? 'user' : 'ai';
                const text = String(msg && msg.text ? msg.text : '');
                const item = document.createElement('div');
                item.className = `ai-search-msg ${role}`;
                item.innerHTML = role === 'user' ? escapeHtml(text).replace(/\n/g, '<br>') : text;
                logEl.appendChild(item);
            });
            logEl.scrollTop = logEl.scrollHeight;
        }
        function renderAiSearchHistory() {
            const listEl = document.getElementById('aiSearchHistoryList');
            if (!listEl) return;
            if (!aiSearchHistory.length) {
                listEl.innerHTML = '<div class="ai-search-history-empty">저장된 지난 대화가 없습니다.</div>';
                return;
            }
            listEl.innerHTML = aiSearchHistory.map((h) => {
                const title = escapeHtml(String(h.title || '지난 대화'));
                const meta = `${escapeHtml(String(h.updatedAt || '-'))} · ${escapeHtml(String(h.boardType || 'IT'))}`;
                return `<button type="button" class="ai-search-history-item" onclick="loadAiSearchConversation('${escapeHtml(String(h.id || ''))}')"><div class="ai-search-history-title">${title}</div><div class="ai-search-history-meta">${meta}</div></button>`;
            }).join('');
        }
        function upsertAiSearchHistoryFromActive() {
            if (!aiSearchActive || !Array.isArray(aiSearchActive.messages) || aiSearchActive.messages.length < 2) return;
            const copy = {
                id: aiSearchActive.id,
                title: aiSearchActive.title || '지난 대화',
                boardType: aiSearchActive.boardType || 'IT',
                updatedAt: aiSearchActive.updatedAt || nowDateTimeLabel(),
                messages: aiSearchActive.messages.slice(0, 120)
            };
            const idx = aiSearchHistory.findIndex((h) => h.id === copy.id);
            if (idx >= 0) aiSearchHistory[idx] = copy;
            else aiSearchHistory.unshift(copy);
            aiSearchHistory = aiSearchHistory.slice(0, 30);
            const keys = getAiSearchStorageKeyBase();
            saveJsonToStorage(keys.historyKey, aiSearchHistory);
            renderAiSearchHistory();
        }
        function setAiSearchStateBadge(isLoading) {
            const badgeEl = document.getElementById('aiSearchStateBadge');
            if (!badgeEl) return;
            badgeEl.className = isLoading ? 'badge bg-ai' : 'badge bg-ready';
            badgeEl.innerText = isLoading ? '답변 생성중' : '대기중';
        }
        function initializeAiSearchView() {
            if (aiSearchInitialized) return;
            const logEl = document.getElementById('aiSearchLog');
            const inputEl = document.getElementById('aiSearchInput');
            const boardTypeEl = document.getElementById('aiSearchBoardType');
            const keys = getAiSearchStorageKeyBase();
            aiSearchHistory = loadJsonFromStorage(keys.historyKey, []);
            aiSearchActive = loadJsonFromStorage(keys.activeKey, null) || makeDefaultAiSearchState();
            if (boardTypeEl) boardTypeEl.value = aiSearchActive.boardType || 'IT';
            if (inputEl) inputEl.value = aiSearchActive.draft || '';
            renderAiSearchMessages();
            renderAiSearchHistory();
            if (inputEl) inputEl.addEventListener('input', saveAiSearchActiveState);
            if (boardTypeEl) boardTypeEl.addEventListener('change', saveAiSearchActiveState);
            if (logEl) logEl.addEventListener('click', () => setAiSearchStateBadge(false));
            aiSearchInitialized = true;
        }
        function startNewAiSearchChat() {
            upsertAiSearchHistoryFromActive();
            aiSearchActive = makeDefaultAiSearchState();
            const boardTypeEl = document.getElementById('aiSearchBoardType');
            const inputEl = document.getElementById('aiSearchInput');
            if (boardTypeEl) boardTypeEl.value = aiSearchActive.boardType || 'IT';
            if (inputEl) inputEl.value = '';
            renderAiSearchMessages();
            saveAiSearchActiveState();
            setAiSearchStateBadge(false);
            if (inputEl) inputEl.focus();
        }
        function loadAiSearchConversation(conversationId) {
            const found = aiSearchHistory.find((h) => String(h.id) === String(conversationId));
            if (!found) return;
            aiSearchActive = {
                id: `chat_${Date.now()}`,
                title: found.title || '불러온 대화',
                boardType: found.boardType || 'IT',
                draft: '',
                updatedAt: nowDateTimeLabel(),
                messages: Array.isArray(found.messages) ? found.messages : []
            };
            if (!aiSearchActive.messages.length) aiSearchActive.messages = [{ role: 'ai', text: '대화를 불러왔습니다.' }];
            const boardTypeEl = document.getElementById('aiSearchBoardType');
            const inputEl = document.getElementById('aiSearchInput');
            if (boardTypeEl) boardTypeEl.value = aiSearchActive.boardType;
            if (inputEl) inputEl.value = '';
            renderAiSearchMessages();
            saveAiSearchActiveState();
            setAiSearchStateBadge(false);
        }
        function setAiSearchPrompt(promptText) {
            const inputEl = document.getElementById('aiSearchInput');
            if (!inputEl) return;
            inputEl.value = String(promptText || '');
            saveAiSearchActiveState();
            inputEl.focus();
        }
        async function submitAiSearchQuestion() {
            const inputEl = document.getElementById('aiSearchInput');
            const boardTypeEl = document.getElementById('aiSearchBoardType');
            const sendBtn = document.getElementById('aiSearchSendBtn');
            if (!inputEl || !boardTypeEl || !sendBtn) return;
            const question = String(inputEl.value || '').trim();
            if (!question) return;
            if (!aiSearchActive) aiSearchActive = makeDefaultAiSearchState();
            aiSearchActive.messages.push({ role: 'user', text: question });
            if (!aiSearchActive.title || aiSearchActive.title === '새 대화') aiSearchActive.title = question.slice(0, 28);
            inputEl.value = '';
            saveAiSearchActiveState();
            renderAiSearchMessages();
            setAiSearchStateBadge(true);
            sendBtn.disabled = true;
            sendBtn.innerText = '생성중...';
            try {
                const result = await requestAiPreview({ title: `AI 검색: ${question.slice(0, 45)}`, content: question, boardType: boardTypeEl.value || 'IT' });
                const replyHtml = result.ok ? result.replyHtml : `<span style="color:#b91c1c;">오류: ${escapeHtml(result.errorMessage || 'AI 요청 실패')}</span>`;
                aiSearchActive.messages.push({ role: 'ai', text: replyHtml });
                saveAiSearchActiveState();
                upsertAiSearchHistoryFromActive();
                renderAiSearchMessages();
            } finally {
                sendBtn.disabled = false;
                sendBtn.innerText = '질문하기';
                setAiSearchStateBadge(false);
            }
        }
        function getAppDataUserScope() {
            return APP_DATA_SHARED_SCOPE;
        }
        function getLegacyUserScope() {
            if (currentLoginUser && currentLoginUser.employeeNo) return String(currentLoginUser.employeeNo);
            const cookieScope = getCookie(USER_SCOPE_COOKIE);
            return cookieScope || 'guest';
        }
        async function fetchJson(url, options = {}) {
            const response = await fetch(url, options);
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error((data && data.error) || '서버 요청에 실패했습니다.');
            }
            return data;
        }
        async function loadAppDataFromServer() {
            const scope = encodeURIComponent(getAppDataUserScope());
            const data = await fetchJson(`/api/db/app-data?scope=${scope}`);
            const sharedAppData = data && data.appData ? data.appData : { posts: [], settings: { notify: true, sms: false } };
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
            const domain = getKnowCategoryLabel(post.knowCategory);
            const attachmentHtml = Array.isArray(post.attachments) && post.attachments.length > 0
                ? post.attachments.map(att => `<li style="padding:6px 10px; border:1px solid #e2e8f0; border-radius:8px; background:#fff;">${att.name || '첨부파일'} (${formatAttachmentSize(att.size)})</li>`).join('')
                : '<li style="color:#94a3b8;">첨부파일 없음</li>';

            return `
                <div style="display:flex; flex-direction:column; gap:14px;">
                    <div style="border:1px solid #dbeafe; border-radius:10px; background:#f8fbff; padding:12px;">
                        <span class="badge bg-ready" style="font-size:11px;">${domain}</span>
                        <span style="margin-left:8px; font-size:12px; color:#64748b;">지식정보 등록 템플릿</span>
                    </div>
                    <div style="border:1px solid #e2e8f0; border-radius:10px; background:#fff; padding:14px;">
                        <div style="font-size:12px; color:#64748b; font-weight:700; margin-bottom:8px;">질문 (Q)</div>
                        <div style="font-size:15px; color:#0f172a; line-height:1.65;">${q}</div>
                    </div>
                    <div style="border:1px solid #e2e8f0; border-radius:10px; background:#fff; padding:14px;">
                        <div style="font-size:12px; color:#64748b; font-weight:700; margin-bottom:8px;">답변 (A)</div>
                        <div style="font-size:14px; color:#0f172a; line-height:1.75; white-space:pre-line;">${a}</div>
                    </div>
                    <div style="border:1px solid #e2e8f0; border-radius:10px; background:#fff; padding:14px;">
                        <div style="font-size:12px; color:#64748b; font-weight:700; margin-bottom:8px;">비고</div>
                        <div style="font-size:14px; color:#334155; line-height:1.7; white-space:pre-line;">${memo}</div>
                    </div>
                    <div style="border:1px solid #e2e8f0; border-radius:10px; background:#fff; padding:14px;">
                        <div style="font-size:12px; color:#64748b; font-weight:700; margin-bottom:8px;">첨부파일</div>
                        <ul style="margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:8px;">${attachmentHtml}</ul>
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
            if (!appData.settings || typeof appData.settings !== 'object') appData.settings = { notify: true, sms: false };
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
            
            if(document.getElementById('setNotify')) document.getElementById('setNotify').checked = appData.settings.notify;
            if(document.getElementById('setSms')) document.getElementById('setSms').checked = appData.settings.sms;
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
                signupUsers = Array.isArray(data && data.signupUsers)
                    ? data.signupUsers.map(sanitizeSignupUserRecord).filter(Boolean)
                    : [];
            } catch (error) {
                console.error('loadSignupUsers failed:', error);
                signupUsers = [];
                showAlert('회원 데이터 로드에 실패했습니다.', 'error');
            }
        }

        function saveSignupUsers() {
            fetchJson('/api/db/signup-users', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ signupUsers })
            }).catch((error) => {
                console.error('saveSignupUsers failed:', error);
                showAlert('회원 데이터 저장에 실패했습니다.', 'error');
            });
        }

        function updateSignupSavedCount() {
            const countEl = document.getElementById('signupSavedCount');
            if (countEl) countEl.innerText = `저장된 회원: ${signupUsers.length}명`;
        }

        function getRoleDisplayName(role) {
            if (role === 'branch') return '영업점';
            if (role === 'hq') return '본부';
            return 'IT관리자';
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
                signupName: '',
                signupEmpNo: '',
                signupDeptName: '',
                signupDeptCode: '',
                signupGrade: '3급',
                signupPosition: '대리',
                signupRole: 'branch'
            };
            Object.entries(formDefaults).forEach(([id, value]) => {
                const el = document.getElementById(id);
                if (el) el.value = value;
            });
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

            if (!name || !empNo || !deptName || !deptCode) {
                showAlert('필수 항목(이름, 직원번호, 부서명, 부서코드)을 입력해주세요.', 'error');
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
                createdAt: getCurrentDateTime()
            };
            const existsIdx = signupUsers.findIndex(u => u.employeeNo === user.employeeNo);
            if (existsIdx > -1) signupUsers[existsIdx] = { ...signupUsers[existsIdx], ...user };
            else signupUsers.unshift(user);
            saveSignupUsers();
            updateSignupSavedCount();
            closeSignupModal();
            showAlert('회원가입 정보가 서버에 저장되었습니다.', 'success');
        }

        function openMemberListModal() {
            loadSignupUsers();
            renderMemberList();
            document.getElementById('memberListModal').classList.add('active');
        }

        function closeMemberListModal() {
            document.getElementById('memberListModal').classList.remove('active');
        }

        function renderMemberList() {
            const wrap = document.getElementById('memberListContainer');
            const summary = document.getElementById('memberListSummary');
            if (!wrap || !summary) return;
            summary.innerText = `저장된 회원: ${signupUsers.length}명`;

            if (signupUsers.length === 0) {
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
                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:left;">권한</th>
                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:center; width:170px;">관리</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${signupUsers.map(u => `
                            <tr>
                                <td style="padding:10px; border-bottom:1px solid #f1f5f9;">${u.name}</td>
                                <td style="padding:10px; border-bottom:1px solid #f1f5f9;">${u.employeeNo}</td>
                                <td style="padding:10px; border-bottom:1px solid #f1f5f9;">${u.deptName}</td>
                                <td style="padding:10px; border-bottom:1px solid #f1f5f9;">${u.deptCode}</td>
                                <td style="padding:10px; border-bottom:1px solid #f1f5f9;">${u.grade} / ${u.position}</td>
                                <td style="padding:10px; border-bottom:1px solid #f1f5f9;">${getRoleDisplayName(u.role)}</td>
                                <td style="padding:10px; border-bottom:1px solid #f1f5f9; text-align:center;">
                                    <button class="btn btn-primary" style="padding:6px 10px; font-size:12px;" onclick="loginByMemberId(${u.id})">선택 로그인</button>
                                    <button class="btn btn-outline" style="padding:6px 10px; font-size:12px; margin-left:6px;" onclick="deleteSignupUser(${u.id})">삭제</button>
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
                signupUsers = [];
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

            currentRole = currentLoginUser.role || 'branch';
            if (currentLoginUser.employeeNo) setCookie(USER_SCOPE_COOKIE, currentLoginUser.employeeNo);
            localStorage.setItem('knockLoginNonce', String(Date.now()));
            aiSearchInitialized = false;
            aiSearchActive = null;
            aiSearchHistory = [];
            if (!currentSessionIp) currentSessionIp = getDummyIp();
            document.getElementById('loginPage').style.display = 'none'; 
            const appContainer = document.getElementById('appContainer');
            appContainer.style.display = 'flex';
            appContainer.classList.remove('page-intro');
            void appContainer.offsetWidth;
            appContainer.classList.add('page-intro');
            await initApp();
            goToAiSearchPage();
        }
        function doLogout() {
            clearCookie(USER_SCOPE_COOKIE);
            localStorage.setItem('knockLoginNonce', String(Date.now()));
            aiSearchInitialized = false;
            aiSearchActive = null;
            aiSearchHistory = [];
            document.getElementById('loginPage').style.display = 'flex';
            document.getElementById('appContainer').style.display = 'none';
            closeHeaderProfileOverlay();
            currentLoginUser = null;
        }
        function saveSettings() {
            const notifyEl = document.getElementById('setNotify');
            const smsEl = document.getElementById('setSms');
            if (!appData.settings || typeof appData.settings !== 'object') appData.settings = {};
            appData.settings.notify = !!(notifyEl && notifyEl.checked);
            appData.settings.sms = !!(smsEl && smsEl.checked);
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
                    appData = { posts: [], settings: { notify: true, sms: false } };
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
            const overlay = document.getElementById('headerProfileOverlay');
            if (!overlay) return;
            overlay.classList.toggle('active');
        }
        function closeHeaderProfileOverlay() {
            const overlay = document.getElementById('headerProfileOverlay');
            if (overlay) overlay.classList.remove('active');
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
            if (window.matchMedia('(max-width: 768px)').matches) {
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
            const isMobile = window.matchMedia('(max-width: 768px)').matches;
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
            
            const rName = currentRole === 'branch' ? '영업점' : (currentRole === 'hq' ? '본부' : 'IT관리자');
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
                const initial = (activeName || '').replace(/\s+/g, '').slice(0, 2) || 'USER';
                overlayProfileInitial.innerText = initial;
            }
            const overlayEmployeeNo = document.getElementById('overlayEmployeeNo');
            if (overlayEmployeeNo) overlayEmployeeNo.innerText = activeUser.employeeNo || '-';
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

            if (currentRole === 'branch' && currentBoardType === 'KNOW') { switchView('dashboard'); return; }
            const preferred = resolveInitialViewForRole();
            if (preferred) {
                initialRouteApplied = true;
                switchView(preferred.viewId, preferred.boardType);
                return;
            }
            switchView('dashboard');
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
            if (!appData.settings || typeof appData.settings !== 'object') appData.settings = { notify: true, sms: false };
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
                '오류': { cls: 'error' }
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
            if (!appData.settings || typeof appData.settings !== 'object') appData.settings = { notify: true, sms: false };
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

        function switchView(viewId, boardType = null) {
            if (boardHelpEditing) {
                const changingListBoard = viewId === 'list' && boardType && boardType !== currentBoardType;
                const leavingListView = viewId !== 'list';
                if (changingListBoard || leavingListView) {
                    showConfirm('도움말 편집 내용이 저장되지 않습니다. 계속 진행하시겠습니까?', () => {
                        boardHelpEditing = false;
                        boardHelpSavedRange = null;
                        switchView(viewId, boardType);
                    });
                    return;
                }
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
                
                document.getElementById('boardMainTitle').innerHTML = `<span style="display:inline-flex; align-items:center; gap:8px;"><svg class="icon"><use href="${boardTitles[currentBoardType].icon}"></use></svg><span>${boardTitles[currentBoardType].title}</span></span>`;
                boardHelpEditing = false;
                boardHelpCollapsed = !!(getBoardHelpUiState().collapsedByType[currentBoardType]);
                renderBoardHelpCard();
                
                const filterSelect = document.getElementById('boardStatusFilter');
                const knowFilter = document.getElementById('boardKnowCategoryFilter');
                if (currentBoardType === 'KNOW') filterSelect.innerHTML = '<option value="all">상태 전체</option><option value="ready">학습대기</option><option value="trained">학습완료</option><option value="error">오류</option>';
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
                if (viewId === 'ai-search') {
                    initializeAiSearchView();
                    setAiSearchStateBadge(false);
                }
            }

            if (viewId === 'dashboard') {
                document.getElementById('dashTitle').innerText = currentRole === 'branch' ? '나의 현황판' : '전행 종합 현황판';
                updateDashStats();
                renderDashboardLists();
                setTimeout(renderCSSCharts, 50); 
            }
            if (viewId === 'list') setTimeout(syncBoardListCardMode, 0);
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

        function openDetailFromDashCount(id) {
            closeDashCountModal();
            openDetail(id);
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
                    return `<tr onclick="openDetailFromDashCount(${post.id})">
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
                <div class="dash-feed-item" onclick="switchView('list','${post.type}'); openDetail(${post.id})">
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
                            ? 'IT 관리자 상태변경'
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
            const shouldCard = window.innerWidth <= 768 || wrap.clientWidth < 800;
            viewList.classList.toggle('list-card-mode', shouldCard);
        }
        function filterBoardList() {
            const st = document.getElementById('boardStatusFilter').value;
            const knowCategory = document.getElementById('boardKnowCategoryFilter').value;
            const kw = document.getElementById('boardKeywordInput').value.toLowerCase();
            let filtered = appData.posts.filter(p => p.type === currentBoardType).sort((a,b) => b.id - a.id);

            if (st !== 'all') {
                if (st === 'aiSolved') filtered = filtered.filter(p => p.aiSolved);
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
                setTimeout(syncBoardListCardMode, 0);
                return; 
            }

            tbody.innerHTML = pageItems.map(item => {
                let badge = '';
                if (currentBoardType === 'KNOW') {
                    if(item.status === 'ready') badge = '<span class="badge bg-ready">학습대기</span>';
                    else if(item.status === 'trained') badge = '<span class="badge bg-trained">학습완료</span>';
                    else badge = '<span class="badge bg-error">오류</span>';
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
                return `<tr onclick="openDetail(${item.id})"><td>${item.id}</td>${chkTd}<td>${badge}</td><td class="text-left font-bold">${knowCatBadge}${item.title}</td><td>${item.writer}</td><td>${item.datetime}</td></tr>`;
            }).join('');
            setTimeout(syncBoardListCardMode, 0);
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
                appData.posts = appData.posts.filter(p => !idsToDelete.includes(p.id));
                saveData();
                showAlert(`${checked.length}개의 항목이 삭제되었습니다.`, 'success');
                filterBoardList();
            });
        }

        // --- 상세보기 ---
        function openDetail(id) {
            currentPostId = id;
            const post = appData.posts.find(p => p.id === id);
            if(!post) return;

            document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
            document.getElementById('view-detail').classList.add('active');

            document.getElementById('dtlBoardTypeLabel').innerText = getBoardDisplayLabel(post);
            document.getElementById('dtlTitle').innerText = post.title;
            document.getElementById('dtlPostId').innerText = post.id;
            document.getElementById('dtlWriter').innerText = post.writer;
            document.getElementById('dtlTime').innerText = post.datetime;
            document.getElementById('dtlIp').innerText = `IP: ${post.ip}`;
            
            const badgeEl = document.getElementById('dtlStatus');
            if (post.type === 'KNOW') {
                if(post.status === 'ready') { badgeEl.className = 'badge bg-ready'; badgeEl.innerText = '학습대기'; }
                else if(post.status === 'trained') { badgeEl.className = 'badge bg-trained'; badgeEl.innerText = '학습완료'; }
                else if(post.status === 'error') { badgeEl.className = 'badge bg-error'; badgeEl.innerText = '오류'; }
            } else {
                if (post.aiSolved) { badgeEl.className = 'badge bg-ai'; badgeEl.innerText = 'AI 채택'; }
                else if (post.status === 'wait') { badgeEl.className = 'badge bg-wait'; badgeEl.innerText = '접수대기'; }
                else if (post.status === 'moreInfo') { badgeEl.className = 'badge bg-moreInfo'; badgeEl.innerText = '추가답변(요청)'; }
                else { badgeEl.className = 'badge bg-done'; badgeEl.innerText = '답변완료'; }
            }
            
            // 메타
            const metaBox = document.getElementById('dtlMetaBox');
            const editHistoryBox = document.getElementById('dtlEditHistoryBox');
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
                    mHtml += `<div class="meta-item" style="grid-column: 1 / -1;"><div class="meta-item-label">학습오류 관리자 의견</div><div class="meta-item-value">${post.meta.knowErrorMemo}</div></div>`;
                }
                if (Array.isArray(post.attachments) && post.attachments.length > 0) {
                    mHtml += `<div class="meta-item" style="grid-column: 1 / -1;"><div class="meta-item-label">첨부파일</div><div class="meta-item-value">${post.attachments.map(att => `${att.name || '첨부파일'} (${formatAttachmentSize(att.size)})`).join('<br>')}</div></div>`;
                }
                mHtml += '</div>';
                metaBox.innerHTML = mHtml;
            } else { metaBox.classList.add('hidden'); }
            if (editHistoryBox) {
                if (Array.isArray(post.editHistory) && post.editHistory.length > 0) {
                    editHistoryBox.classList.remove('hidden');
                    const list = [...post.editHistory].reverse().map(h =>
                        `<div class="meta-item"><div class="meta-item-label">${h.datetime || '-'}</div><div class="meta-item-value">${h.editor || '-'} 수정</div></div>`
                    ).join('');
                    editHistoryBox.innerHTML = `<div class="meta-field-title">수정 이력</div><div class="meta-grid">${list}</div>`;
                } else {
                    editHistoryBox.classList.add('hidden');
                }
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
            if (aiConvertBtn && aiRefreshBtn && aiActionRow) {
                const canUseAiAction = isWriter && post.status === 'wait' && !post.aiSolved && (post.type === 'IT' || post.type === 'BIZ');
                aiActionRow.classList.toggle('hidden', !canUseAiAction);
                const aiReady = hasAdoptableAiReply(post);
                aiConvertBtn.disabled = !aiReady;
                aiConvertBtn.title = aiReady ? '' : 'AI 답변이 정상 생성된 후 채택할 수 있습니다.';
                const isRefreshing = aiRefreshingPostId === post.id;
                aiRefreshBtn.disabled = isRefreshing;
                aiRefreshBtn.innerHTML = isRefreshing
                    ? '<svg class="icon"><use href="#icon-info"></use></svg> AI 재생성 중...'
                    : '<svg class="icon"><use href="#icon-search"></use></svg> AI 답변 새로고침';
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
                    sel.value = (post.status === 'error') ? 'error' : 'trained';
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

            // 유사 질문 (우측)
            const similarPosts = appData.posts.filter(p => p.type === post.type && p.id !== post.id).slice(0, 3);
            let similarHtml = '';
            if(similarPosts.length > 0) {
                similarHtml = '<ul style="margin:0; padding:0;">' + similarPosts.map(p => {
                    return `<li style="padding: 15px; border-bottom: 1px solid #eee; cursor: pointer;" onmouseover="this.style.background='#f4f8fb'" onmouseout="this.style.background='#fff'" onclick="openDetail(${p.id})">
                        <div style="font-weight: bold; color: var(--ibk-blue); font-size: 13px;" class="truncate">${p.title}</div>
                    </li>`;
                }).join('') + '</ul>';
            } else { similarHtml = '<div style="padding: 20px; text-align: center; color: #999;">내역 없음</div>'; }
            document.getElementById('dtlSimilarList').innerHTML = similarHtml;
        }

        function deletePost() {
            showConfirm('삭제하시겠습니까?', () => {
                appData.posts = appData.posts.filter(p => p.id !== currentPostId);
                saveData();
                showAlert('삭제되었습니다.', 'success');
                switchView('list', currentBoardType);
            });
        }

        function editPost() {
            const post = appData.posts.find(p => p.id === currentPostId);
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
                const label = t==='IT' ? 'IT / 전산 오류' : t==='BIZ' ? '규정 / 업무 문의' : '기능 개선 제안';
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
                btn.style.background = '#fff';
                btn.style.color = '#444';
                btn.style.borderColor = '#ccc';
            });
            const activeBtn = type === 'BIZ' ? bizBtn : itBtn;
            if (activeBtn) {
                activeBtn.style.background = '#eef2ff';
                activeBtn.style.color = '#3730a3';
                activeBtn.style.borderColor = '#6366f1';
            }
        }

        function selectWriteCategory(type) {
            currentBoardType = type;
            document.querySelectorAll('#writeCategoryButtons > div').forEach(btn => { btn.style.background = '#fff'; btn.style.color = '#444'; btn.style.borderColor = '#ccc'; });
            const el = document.getElementById(`btn-cat-${type}`);
            if(el) { el.style.background = '#ebf5ff'; el.style.color = 'var(--ibk-blue)'; el.style.borderColor = 'var(--ibk-blue)'; }

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
            wrap.classList.toggle('hidden', select.value !== 'error');
        }
        function saveKnowStatus() {
            const idx = appData.posts.findIndex(p => p.id === currentPostId);
            if (idx < 0) return;
            if (currentRole !== 'it') { showAlert('IT 관리자만 상태를 변경할 수 있습니다.', 'error'); return; }
            const post = appData.posts[idx];
            if (post.type !== 'KNOW') return;
            const status = document.getElementById('knowStatusSelect').value;
            const memo = document.getElementById('knowErrorMemoInput').value.trim();
            if (status === 'error' && !memo) { showAlert('학습 오류 의견을 입력해주세요.', 'error'); return; }

            post.status = status;
            if (!post.meta) post.meta = {};
            post.meta.knowErrorMemo = status === 'error' ? memo : '';
            if (status === 'error') {
                ensurePostThread(post).push({
                    role: 'manager',
                    action: 'knowError',
                    content: `학습오류 사유: ${memo}`,
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

        function stripHtmlToPlainText(rawHtml) {
            const temp = document.createElement('div');
            temp.innerHTML = rawHtml || '';
            return (temp.textContent || temp.innerText || '').trim();
        }

        function formatAiReplyHtml(rawReply) {
            const escaped = escapeHtml(String(rawReply || ''));
            return escaped
                .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
                .replace(/\n/g, '<br>');
        }

        async function requestAiPreview({ title, content, boardType }) {
            try {
                const response = await fetch('/api/ai/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, content, boardType })
                });
                const data = await response.json();
                if (!response.ok || !data || !data.reply) {
                    throw new Error((data && data.error) || 'AI 응답을 가져오지 못했습니다.');
                }
                return { ok: true, replyHtml: formatAiReplyHtml(data.reply), errorMessage: '' };
            } catch (error) {
                console.error('AI preview request failed:', error);
                const reason = (error && error.message) ? error.message : 'AI 서버 통신 중 오류';
                return { ok: false, replyHtml: '', errorMessage: reason };
            }
        }

        function makeAiPendingHtml() {
            return '<b>AI 분석 결과:</b><br><span style="color:#64748b;">AI 답변 생성 중입니다. 잠시 후 자동 반영됩니다...</span>';
        }

        function makeAiErrorHtml(message) {
            const safe = escapeHtml(String(message || '원인 미상 오류'));
            return `<b>AI 분석 실패:</b><br><span style="color:#b91c1c;">${safe}</span><br><span style="color:#64748b;">(환경변수, 모델명, 쿼터를 확인해주세요)</span>`;
        }

        function hasAdoptableAiReply(post) {
            if (!post || post.aiSolved) return false;
            const aiText = stripHtmlToPlainText(post.aiContent || '');
            if (!aiText) return false;
            if (aiText.includes('AI 답변 생성 중입니다')) return false;
            if (aiText.includes('AI 분석 실패')) return false;
            return aiText.length >= 40;
        }

        function isAiContentLong(aiHtml) {
            return stripHtmlToPlainText(aiHtml).length > 220;
        }

        function renderAiContentWithToggle(aiHtml, stateKey) {
            const html = String(aiHtml || '');
            const canToggle = isAiContentLong(html);
            const expanded = !!aiExpandState[stateKey];
            const textClass = canToggle && !expanded ? 'ai-content-text collapsed' : 'ai-content-text';
            const toggleBtn = canToggle
                ? `<button class="ai-content-toggle-btn" onclick="toggleAiContentExpand('${stateKey}')">${expanded ? '짧게보기' : '전체보기'}</button>`
                : '';
            return `<div class="${textClass}">${html}</div>${toggleBtn}`;
        }

        function toggleAiContentExpand(stateKey) {
            aiExpandState[stateKey] = !aiExpandState[stateKey];
            if (stateKey.startsWith('detail-') && currentPostId != null) {
                openDetail(currentPostId);
                return;
            }
            if (stateKey.startsWith('similar-') && currentPostId != null) {
                openSimilarPostModal(currentPostId);
            }
        }

        function moveToPostDetail(postId) {
            const post = appData.posts.find(p => p.id === postId);
            if (!post) return;
            currentBoardType = post.type;
            switchView('list', post.type);
            openDetail(postId);
        }

        function formatPostAlertRef(post) {
            if (!post) return '게시물';
            const boardLabel = getBoardDisplayLabel(post);
            return `[${boardLabel} #${post.id}]`;
        }

        async function refreshCurrentPostAiReply() {
            const post = appData.posts.find(p => p.id === currentPostId);
            if (!post) return;
            if (post.aiSolved || post.status !== 'wait' || !(post.type === 'IT' || post.type === 'BIZ')) return;
            aiRefreshingPostId = post.id;
            openDetail(post.id);
            showAlert(`${formatPostAlertRef(post)} AI 답변을 다시 생성중입니다...`, 'success');
            try {
                await queueAsyncAiAnswerForPost(
                    post.id,
                    post.type,
                    String(post.title || '').trim(),
                    stripHtmlToPlainText(post.content || '')
                );
            } finally {
                aiRefreshingPostId = null;
                openDetail(post.id);
            }
        }

        async function queueAsyncAiAnswerForPost(postId, boardType, title, plainContent) {
            if (!(boardType === 'IT' || boardType === 'BIZ')) return;
            const result = await requestAiPreview({ title, content: plainContent, boardType });
            const idx = appData.posts.findIndex(p => p.id === postId);
            if (idx < 0) return;
            const post = appData.posts[idx];
            const postRef = formatPostAlertRef(post);

            if (result.ok) {
                const aiContentHtml = `<b>AI 분석 결과:</b><br>${result.replyHtml}`;
                appData.posts[idx].aiContent = aiContentHtml;
            } else {
                const failHtml = makeAiErrorHtml(result.errorMessage);
                appData.posts[idx].aiContent = failHtml;
            }
            saveData();
            const detailView = document.getElementById('view-detail');
            if (detailView && detailView.classList.contains('active') && currentPostId === postId) {
                document.getElementById('aiPanelContent').innerHTML = renderAiContentWithToggle(appData.posts[idx].aiContent, `detail-${postId}`);
            }
            if (result.ok) {
                showAlert(`${postRef} AI 답변이 등록되었습니다.`, 'success', {
                    actionText: '해당 게시물 보기',
                    onClick: () => moveToPostDetail(postId)
                });
            } else {
                showAlert(`${postRef} AI 답변 생성에 실패했습니다. AI 패널의 실패 사유를 확인해주세요.`, 'error', {
                    actionText: '해당 게시물 보기',
                    onClick: () => moveToPostDetail(postId)
                });
            }
        }

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
                if (memo) content += `<div style="margin-top:12px; color:#475569;"><b>추가 의견/별첨:</b><br>${escapeHtml(memo).replace(/\n/g, '<br>')}</div>`;
            } else if(!title || content === '<p><br></p>' || !content) {
                showAlert('제목과 본문을 입력해주세요.', 'error');
                return;
            }
            
            if(document.getElementById('editPostId').value || currentBoardType === 'SYS' || currentBoardType === 'KNOW') {
                savePost(false); return;
            }

            await savePost(false);
        }

        function closeAiModal() { document.getElementById('aiSubmitModal').classList.remove('active'); }

        async function savePost(isAiSolved) {
            closeAiModal();
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
                if (!knowDomain) {
                    showAlert('학습분류 도메인을 선택해주세요.', 'error');
                    return;
                }
                if (!title || !q || !a) {
                    showAlert('제목, 질문내용, 답변내용을 모두 입력해주세요.', 'error');
                    return;
                }
                meta.knowQuestion = q;
                meta.knowAnswer = a;
                meta.knowMemo = memo;
                content = `<div><b>Q.</b> ${escapeHtml(q)}</div><div style="margin-top:8px;"><b>A.</b><br>${escapeHtml(a).replace(/\n/g, '<br>')}</div>`;
                if (memo) content += `<div style="margin-top:12px; color:#475569;"><b>추가 의견/별첨:</b><br>${escapeHtml(memo).replace(/\n/g, '<br>')}</div>`;
            }

            if (editId) { 
                const idx = appData.posts.findIndex(p => p.id == editId);
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
                const newId = appData.posts.length > 0 ? Math.max(...appData.posts.map(p => p.id)) + 1 : 1;
                const dt = getCurrentDateTime(); const ipStr = getDummyIp();
                
                if (currentBoardType === 'KNOW') {
                    const knowCat = (document.getElementById('writeKnowDomain').value || '').trim();
                    if (!knowCat) {
                        showAlert('학습분류(도메인)를 선택해주세요.', 'error');
                        return;
                    }
                    appData.posts.unshift({
                        id: newId, type: 'KNOW', knowCategory: knowCat, title: title, writer: getCurrentActorName(), 
                        datetime: dt, ip: ipStr, status: 'ready', content: content, aiContent: '', answer: '', meta: meta, addInfoList: [], thread: [], attachments
                    });
                    showAlert('학습 대기 상태로 지식베이스에 등록되었습니다.', 'success');
                } else if (isAiSolved) {
                    appData.posts.unshift({
                        id: newId, type: currentBoardType, title: '[AI채택] ' + title, writer: getCurrentActorName(), 
                        datetime: dt, ip: ipStr, status: 'done', aiSolved: true, content: content, 
                        aiContent: document.getElementById('modalAiContent').innerHTML || AI_FALLBACK_HTML, answer: '질의자가 AI 추천 답변을 통해 스스로 문제를 해결(채택)하여 자동 종결 등록된 건입니다.', meta: meta, addInfoList: [], thread: [], attachments
                    });
                    showAlert('AI 답변 채택 완료! 자동 처리되었습니다.', 'success');
                } else {
                    let aiContentHtml = document.getElementById('modalAiContent').innerHTML || AI_FALLBACK_HTML;
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
                            stripHtmlToPlainText(content)
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
            const idx = appData.posts.findIndex(p => p.id === currentPostId);
            
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
            
            const idx = appData.posts.findIndex(p => p.id === currentPostId);
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
            const idx = appData.posts.findIndex(p => p.id === currentPostId);
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
            performModalSearch(); 
        }
        function showIntegratedSearchModal() { document.getElementById('integratedSearchModal').classList.add('active'); setTimeout(() => document.getElementById('modalSearchInput').focus(), 100); }
        function closeIntegratedSearchModal() { document.getElementById('integratedSearchModal').classList.remove('active'); }
        function performModalSearch() {
            const kw = document.getElementById('modalSearchInput').value.toLowerCase();
            const resContainer = document.getElementById('integratedSearchResults');
            if (!kw.trim()) { resContainer.innerHTML = '<div class="text-center p-20" style="color:#999;">검색어를 입력하세요.</div>'; return; }
            
            const results = appData.posts.filter(p => p.title.toLowerCase().includes(kw) || p.content.toLowerCase().includes(kw)).sort((a,b) => b.id - a.id);
            if (results.length === 0) { resContainer.innerHTML = '<div class="text-center p-20" style="color:#999;">결과가 없습니다.</div>'; return; }

            resContainer.innerHTML = '<ul style="margin:0; padding:0;">' + results.map(p => {
                const stripped = p.content.replace(/<[^>]*>?/gm, ''); 
                let badge = '';
                if (p.type === 'KNOW') {
                    if(p.status === 'ready') badge = '<span class="badge bg-ready" style="font-size:10px; padding:2px 6px;">학습대기</span>';
                    else if(p.status === 'trained') badge = '<span class="badge bg-trained" style="font-size:10px; padding:2px 6px;">학습완료</span>';
                    else badge = '<span class="badge bg-error" style="font-size:10px; padding:2px 6px;">오류</span>';
                } else {
                    if (p.aiSolved) badge = '<span class="badge bg-ai" style="font-size:10px; padding:2px 6px;">AI 채택</span>';
                    else if(p.status === 'wait') badge = '<span class="badge bg-wait" style="font-size:10px; padding:2px 6px;">접수대기</span>';
                    else if(p.status === 'moreInfo') badge = '<span class="badge bg-moreInfo" style="font-size:10px; padding:2px 6px;">추가답변</span>';
                    else badge = '<span class="badge bg-done" style="font-size:10px; padding:2px 6px;">답변완료</span>';
                }
                return `<li style="padding: 15px 20px; border-bottom: 1px solid #eee; cursor: pointer;" onmouseover="this.style.background='#f4f8fb'" onmouseout="this.style.background='#fff'" onclick="goFromIntegratedSearch(${p.id})">
                    <div class="flex items-center justify-between mb-10"><div class="flex items-center gap-10"><span style="font-weight:bold; color:#666; font-size:12px;">[${getBoardDisplayLabel(p)}]</span>${badge}</div><span style="font-size:12px; color:#999;">${p.datetime.substring(0, 10)}</span></div>
                    <div style="font-weight:bold; color:var(--ibk-blue); font-size:15px; margin-bottom:5px;">${p.title}</div>
                    <div style="font-size:13px; color:#666;" class="truncate">${stripped}</div>
                </li>`;
            }).join('') + '</ul>';
        }
        function goFromIntegratedSearch(id) {
            closeIntegratedSearchModal(); document.getElementById('headerSearchInput').value = '';
            const post = appData.posts.find(p => p.id === id);
            if(post) currentBoardType = post.type;
            openDetail(id);
        }

        function openSimilarPostModal(id) {
            const post = appData.posts.find(p => p.id === id);
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
        window.addEventListener('resize', () => {
            const dashView = document.getElementById('view-dashboard');
            if (dashView && dashView.classList.contains('active')) {
                setTimeout(renderCSSCharts, 80);
            }
            const listView = document.getElementById('view-list');
            if (listView && listView.classList.contains('active')) {
                syncBoardListCardMode();
            }
        });

        async function bootstrapSession() {
            await loadSignupUsers();
            const scopedEmpNo = getCookie(USER_SCOPE_COOKIE);
            if (!scopedEmpNo) return;
            const matched = signupUsers.find(u => String(u.employeeNo) === String(scopedEmpNo));
            if (!matched) return;
            currentLoginUser = matched;
            const loginEmpNo = document.getElementById('loginEmpNo');
            if (loginEmpNo) loginEmpNo.value = matched.employeeNo;
            await doLogin({ skipAuthValidation: true });
        }

        bootstrapSession();