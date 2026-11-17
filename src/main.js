
import "./style.css";
import { io } from "socket.io-client";

const SERVER_URL = "https://gapyar-server.onrender.com";
const TOKEN_KEY = "gapyar_token";

const app = document.querySelector("#app");

let token = localStorage.getItem(TOKEN_KEY);
let currentUser = null;
let authMode = "login";
let authMessage = "";
let authLoading = false;

let chats = [];
let selectedChatId = null;
let activeTab = "chats";
let activeFilter = "all";
let searchText = "";
let socket = null;
let lastRoomId = null;
let busy = false;

const seenMessages = new Set();

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function getTime(value = new Date()) {
  return new Date(value).toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function selectedChat() {
  return chats.find(chat => chat.id === selectedChatId);
}

async function api(path, options = {}) {
  const response = await fetch(`${SERVER_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    token = null;
    currentUser = null;
    localStorage.removeItem(TOKEN_KEY);
    if (socket) socket.disconnect();
    showAuth();
    throw new Error("نشست شما منقضی شده است. دوباره وارد شوید.");
  }

  if (!response.ok) {
    throw new Error(data.error || data.message || "خطایی رخ داد.");
  }

  return data;
}

function showAuth() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  app.innerHTML = `
    <main class="auth-page" dir="rtl">
      <div class="auth-card">
        <div class="auth-logo">گ</div>
        <h1>گپ‌یار</h1>
        <p class="auth-subtitle">پیام‌رسان ساده و سریع شما</p>

        <div class="auth-tabs">
          <button type="button" class="${authMode === "login" ? "active" : ""}" data-auth-mode="login">ورود</button>
          <button type="button" class="${authMode === "register" ? "active" : ""}" data-auth-mode="register">ثبت‌نام</button>
        </div>

        <form id="auth-form">
          <label for="auth-username">نام کاربری</label>
          <input id="auth-username" name="username" type="text"
            placeholder="مثلاً amir123" minlength="3" maxlength="20"
            pattern="[a-zA-Z0-9_]+" autocomplete="username" required />

          <label for="auth-password">رمز عبور</label>
          <input id="auth-password" name="password" type="password"
            placeholder="حداقل ۸ کاراکتر" minlength="8"
            autocomplete="${authMode === "login" ? "current-password" : "new-password"}" required />

          <p class="auth-message" id="auth-message">${escapeHTML(authMessage)}</p>
          <button class="auth-submit" type="submit" ${authLoading ? "disabled" : ""}>
            ${authLoading ? "لطفاً صبر کن..." : authMode === "login" ? "ورود به حساب" : "ساخت حساب"}
          </button>
        </form>

        <p class="auth-hint">نام کاربری فقط شامل حروف انگلیسی، عدد و _ باشد.</p>
      </div>
    </main>
  `;
}

async function authRequest(endpoint, username, password) {
  const response = await fetch(`${SERVER_URL}/api/auth/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || data.message || "اطلاعات واردشده درست نیست.");
  }

  return data;
}

async function handleAuthSubmit(form) {
  if (authLoading) return;

  const username = form.elements.username.value.trim().toLowerCase();
  const password = form.elements.password.value;

  authLoading = true;
  authMessage = "";
  showAuth();

  try {
    const result = await authRequest(
      authMode === "login" ? "login" : "register",
      username,
      password
    );

    if (!result.token) throw new Error("پاسخ سرور معتبر نیست.");

    token = result.token;
    localStorage.setItem(TOKEN_KEY, token);
    currentUser = result.user || { username };
    authLoading = false;

    await startApp();
  } catch (error) {
    authLoading = false;
    authMessage = error.message;
    showAuth();
  }
}

async function checkSession() {
  if (!token) return false;

  try {
    const data = await api("/api/auth/me");
    currentUser = data.user;
    return true;
  } catch {
    token = null;
    currentUser = null;
    localStorage.removeItem(TOKEN_KEY);
    return false;
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // خروج محلی
  }

  token = null;
  currentUser = null;
  chats = [];
  selectedChatId = null;
  localStorage.removeItem(TOKEN_KEY);

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  showAuth();
}

function updateConnectionStatus(online) {
  const status = document.querySelector(".connection-status");
  if (!status) return;

  status.className = `connection-status ${online ? "online" : "offline"}`;
  status.innerHTML = `<span class="status-dot"></span>${online ? "متصل" : "قطع اتصال"}`;
}

async function loadConversations() {
  const data = await api("/api/conversations");

  chats = (data.conversations || []).map(item => ({
    id: item.id,
    name: item.title,
    avatar: item.is_group ? "👥" : "👤",
    color: item.is_group ? "blue" : "purple",
    time: item.created_at ? getTime(item.created_at) : "",
    unread: 0,
    group: Boolean(item.is_group),
    messages: []
  }));

  if (selectedChatId && !chats.some(chat => chat.id === selectedChatId)) {
    selectedChatId = null;
  }

  render();
}

async function loadHistory(chat) {
  try {
    const data = await api(
      `/api/messages/${encodeURIComponent(chat.id)}`
    );

    const messages = data.messages || [];

    messages.forEach(item => {
      const id = String(item.id);
      if (seenMessages.has(id)) return;

      seenMessages.add(id);

      chat.messages.push({
        id,
        text: item.message || "",
        username: item.username || "",
        mine: item.username === currentUser?.username,
        time: item.created_at ? getTime(item.created_at) : getTime()
      });
    });

    chat.messages.sort((a, b) => {
      return Number(a.id || 0) - Number(b.id || 0);
    });

    if (selectedChatId === chat.id) render();
  } catch (error) {
    console.error("History error:", error);
  }
}

function joinSelectedRoom() {
  const chat = selectedChat();

  if (!chat || !socket?.connected) return;

  if (lastRoomId && lastRoomId !== chat.id) {
    socket.emit("leave-room", lastRoomId);
  }

  lastRoomId = chat.id;
  socket.emit("join-room", chat.id);
  loadHistory(chat);
}

function connectSocket() {
  if (socket) socket.disconnect();

  lastRoomId = null;

  socket = io(SERVER_URL, {
    auth: { token },
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 10,
    timeout: 20000
  });

  socket.on("connect", () => {
    updateConnectionStatus(true);
    joinSelectedRoom();
  });

  socket.on("disconnect", () => {
    updateConnectionStatus(false);
  });

  socket.on("connect_error", error => {
    updateConnectionStatus(false);

    if (error.message === "UNAUTHORIZED") {
      logout();
    }
  });

  socket.on("message-error", data => {
    alert(data?.error || "ارسال پیام انجام نشد.");
  });

  socket.on("new-message", data => {
    const room = data.room;
    const chat = chats.find(item => item.id === room);

    if (!chat) return;

    const id = String(data.id);
    if (seenMessages.has(id)) return;

    seenMessages.add(id);

    chat.messages.push({
      id,
      text: data.message || "",
      username: data.username || "",
      mine: data.username === currentUser?.username,
      time: data.created_at ? getTime(data.created_at) : getTime()
    });

    chat.time = getTime(data.created_at);
    if (selectedChatId !== chat.id) chat.unread++;

    if (selectedChatId === chat.id) {
      renderConversation();
    } else {
      renderMainPage();
    }
  });
}

function renderChatList() {
  const filtered = chats.filter(chat => {
    const matchesSearch = chat.name.toLowerCase().includes(searchText.toLowerCase());

    const matchesFilter =
      activeFilter === "all" ||
      (activeFilter === "groups" && chat.group) ||
      (activeFilter === "private" && !chat.group);

    return matchesSearch && matchesFilter;
  });

  if (!filtered.length) {
    return `
      <div class="empty-state">
        <div class="empty-icon">💬</div>
        <h3>هنوز گفتگویی نداری</h3>
        <p>با دکمه گفتگوی جدید شروع کن.</p>
      </div>
    `;
  }

  return filtered.map(chat => {
    const last = chat.messages.at(-1);

    return `
      <button class="chat-item" data-chat-id="${escapeHTML(chat.id)}">
        <div class="avatar ${chat.color}">${chat.avatar}</div>
        <div class="chat-info">
          <div class="chat-title-row">
            <strong>${escapeHTML(chat.name)}</strong>
            <span class="chat-time">${escapeHTML(chat.time)}</span>
          </div>
          <div class="chat-bottom-row">
            <span class="last-message">${escapeHTML(last?.text || "هنوز پیامی ارسال نشده")}</span>
            ${chat.unread ? `<span class="unread-count">${chat.unread}</span>` : ""}
          </div>
        </div>
      </button>
    `;
  }).join("");
}

function renderMainPage() {
  let content = "";

  if (activeTab === "chats") {
    content = `
      <div class="section-heading">
        <div>
          <h2>گفتگوها</h2>
          <p>گفتگوهای واقعی حساب تو</p>
        </div>
        <button class="new-chat-button" id="new-chat-button">+ گفتگوی جدید</button>
      </div>

      <div class="search-box">
        <span>⌕</span>
        <input id="chat-search" placeholder="جستجوی گفتگو..." value="${escapeHTML(searchText)}" />
      </div>

      <div class="filters">
        <button class="filter-button ${activeFilter === "all" ? "active" : ""}" data-filter="all">همه</button>
        <button class="filter-button ${activeFilter === "private" ? "active" : ""}" data-filter="private">شخصی</button>
        <button class="filter-button ${activeFilter === "groups" ? "active" : ""}" data-filter="groups">گروه‌ها</button>
      </div>

      <div class="chat-list">${renderChatList()}</div>
    `;
  } else if (activeTab === "contacts") {
    content = `
      <div class="simple-page">
        <div class="simple-icon">👥</div>
        <h2>جستجوی کاربران</h2>
        <p>نام کاربری مخاطب را جستجو کن.</p>

        <form id="user-search-form">
          <input name="username" placeholder="نام کاربری..." minlength="3" required />
          <button class="new-chat-button" type="submit">جستجو</button>
        </form>

        <div id="user-results"></div>
      </div>
    `;
  } else {
    content = `
      <div class="simple-page">
        <div class="simple-icon">👤</div>
        <h2>حساب کاربری</h2>
        <p>نام کاربری: <strong>${escapeHTML(currentUser?.username || "کاربر")}</strong></p>
        <button class="new-chat-button" id="logout-button">خروج از حساب</button>
      </div>
    `;
  }

  app.innerHTML = `
    <div class="app-shell" dir="rtl">
      <header class="top-header">
        <div class="brand">
          <div class="brand-logo">گ</div>
          <div><h1>گپ‌یار</h1><span>پیام‌رسان شما</span></div>
        </div>
        <div class="connection-status offline">
          <span class="status-dot"></span>در حال اتصال
        </div>
      </header>

      <main class="main-content">${content}</main>

      <nav class="bottom-nav">
        <button class="nav-item ${activeTab === "chats" ? "active" : ""}" data-tab="chats"><span>💬</span>گفتگوها</button>
        <button class="nav-item ${activeTab === "contacts" ? "active" : ""}" data-tab="contacts"><span>👥</span>مخاطبین</button>
        <button class="nav-item ${activeTab === "profile" ? "active" : ""}" data-tab="profile"><span>👤</span>حساب من</button>
      </nav>
    </div>
  `;

  updateConnectionStatus(Boolean(socket?.connected));
}

function renderConversation() {
  const chat = selectedChat();

  if (!chat) {
    selectedChatId = null;
    renderMainPage();
    return;
  }

  app.innerHTML = `
    <div class="conversation" dir="rtl">
      <header class="conversation-header">
        <button class="icon-button" id="back-button">›</button>
        <div class="avatar small ${chat.color}">${chat.avatar}</div>
        <div class="conversation-user">
          <strong>${escapeHTML(chat.name)}</strong>
          <span>${chat.group ? "گروه گپ‌یار" : "گفتگوی گپ‌یار"}</span>
        </div>
        <button class="icon-button" id="add-member-button" title="افزودن عضو">+</button>
      </header>

      <main class="messages" id="messages">
        <div class="date-divider"><span>گفتگو</span></div>

        ${chat.messages.map(message => `
          <div class="message-row ${message.mine ? "mine" : "theirs"}">
            <div class="message-bubble">
              ${!message.mine && chat.group ? `<small>${escapeHTML(message.username)}</small>` : ""}
              <div class="message-text">${escapeHTML(message.text)}</div>
              <span class="message-time">${escapeHTML(message.time)}</span>
            </div>
          </div>
        `).join("")}
      </main>

      <form class="message-form" id="message-form">
        <input name="message" placeholder="پیامت را بنویس..." autocomplete="off" maxlength="2000" required />
        <button class="send-button" type="submit">➤</button>
      </form>

      <p class="demo-note">گپ‌یار — پیام‌ها از طریق سرور ارسال می‌شوند.</p>
    </div>
  `;

  const messages = document.querySelector("#messages");
  messages.scrollTop = messages.scrollHeight;
}

function render() {
  if (!token || !currentUser) {
    showAuth();
    return;
  }

  if (selectedChatId) renderConversation();
  else renderMainPage();
}

async function createConversation() {
  const title = prompt("عنوان گفتگو را وارد کن:");
  if (!title?.trim()) return;

  try {
    const data = await api("/api/conversations", {
      method: "POST",
      body: JSON.stringify({
        title: title.trim(),
        isGroup: false
      })
    });

    const item = data.conversation;

    chats.unshift({
      id: item.id,
      name: item.title,
      avatar: "👤",
      color: "purple",
      time: getTime(),
      unread: 0,
      group: false,
      messages: []
    });

    selectedChatId = item.id;
    render();
    joinSelectedRoom();
  } catch (error) {
    alert(error.message);
  }
}

async function searchUsers(username) {
  const data = await api(
    `/api/users/search?q=${encodeURIComponent(username)}`
  );

  const results = document.querySelector("#user-results");
  if (!results) return;

  if (!data.users?.length) {
    results.innerHTML = "<p>کاربری پیدا نشد.</p>";
    return;
  }

  results.innerHTML = data.users.map(user => `
    <div class="contact-result">
      <strong>${escapeHTML(user.username)}</strong>
      <button class="new-chat-button" data-start-chat="${escapeHTML(user.username)}">
        شروع گفتگو
      </button>
    </div>
  `).join("");
}

async function startPrivateChat(username) {
  if (busy) return;

  busy = true;

  try {
    // ابتدا گفتگوی جدید ایجاد می‌شود.
    const data = await api("/api/conversations", {
      method: "POST",
      body: JSON.stringify({
        title: username,
        isGroup: false
      })
    });

    const conversation = data.conversation;

    // کاربر موردنظر به گفتگو اضافه می‌شود.
    await api(`/api/conversations/${encodeURIComponent(conversation.id)}/members`, {
      method: "POST",
      body: JSON.stringify({ username })
    });

    chats.unshift({
      id: conversation.id,
      name: username,
      avatar: "👤",
      color: "purple",
      time: getTime(),
      unread: 0,
      group: false,
      messages: []
    });

    selectedChatId = conversation.id;
    activeTab = "chats";
    render();
    joinSelectedRoom();
  } catch (error) {
    alert(error.message);
  } finally {
    busy = false;
  }
}

async function addMember() {
  const chat = selectedChat();
  if (!chat) return;

  const username = prompt("نام کاربری عضو جدید را وارد کن:");
  if (!username?.trim()) return;

  try {
    await api(`/api/conversations/${encodeURIComponent(chat.id)}/members`, {
      method: "POST",
      body: JSON.stringify({ username: username.trim() })
    });

    alert("عضو با موفقیت اضافه شد.");
  } catch (error) {
    alert(error.message);
  }
}

app.addEventListener("click", async event => {
  const authTab = event.target.closest("[data-auth-mode]");

  if (authTab) {
    authMode = authTab.dataset.authMode;
    authMessage = "";
    showAuth();
    return;
  }

  const chatButton = event.target.closest("[data-chat-id]");

  if (chatButton) {
    const oldRoom = selectedChatId;
    selectedChatId = chatButton.dataset.chatId;

    const chat = selectedChat();
    if (chat) chat.unread = 0;

    if (oldRoom && socket?.connected) socket.emit("leave-room", oldRoom);

    render();
    joinSelectedRoom();
    return;
  }

  const filterButton = event.target.closest("[data-filter]");

  if (filterButton) {
    activeFilter = filterButton.dataset.filter;
    render();
    return;
  }

  const tabButton = event.target.closest("[data-tab]");

  if (tabButton) {
    if (selectedChatId && socket?.connected) {
      socket.emit("leave-room", selectedChatId);
    }

    selectedChatId = null;
    activeTab = tabButton.dataset.tab;
    render();
    return;
  }

  if (event.target.closest("#back-button")) {
    if (selectedChatId && socket?.connected) {
      socket.emit("leave-room", selectedChatId);
    }

    selectedChatId = null;
    render();
    return;
  }

  if (event.target.closest("#new-chat-button")) {
    await createConversation();
    return;
  }

  if (event.target.closest("#add-member-button")) {
    await addMember();
    return;
  }

  const startButton = event.target.closest("[data-start-chat]");

  if (startButton) {
    await startPrivateChat(startButton.dataset.startChat);
    return;
  }

  if (event.target.closest("#logout-button")) {
    await logout();
  }
});

app.addEventListener("input", event => {
  if (event.target.id === "chat-search") {
    const position = event.target.selectionStart;
    searchText = event.target.value;
    render();

    const input = document.querySelector("#chat-search");
    input?.focus();
    input?.setSelectionRange(position, position);
  }
});

app.addEventListener("submit", async event => {
  if (event.target.id === "auth-form") {
    event.preventDefault();
    await handleAuthSubmit(event.target);
    return;
  }

  if (event.target.id === "user-search-form") {
    event.preventDefault();

    const username = event.target.elements.username.value.trim();

    try {
      await searchUsers(username);
    } catch (error) {
      alert(error.message);
    }

    return;
  }

  if (event.target.id === "message-form") {
    event.preventDefault();

    const input = event.target.elements.message;
    const message = input.value.trim();
    const chat = selectedChat();

    if (!message || !chat) return;

    if (!socket?.connected) {
      alert("اتصال به سرور برقرار نیست.");
      return;
    }

    socket.emit("send-message", {
      room: chat.id,
      message
    });

    input.value = "";
  }
});

async function startApp() {
  try {
    await loadConversations();
    connectSocket();
  } catch (error) {
    console.error(error);
    alert("دریافت گفتگوها انجام نشد: " + error.message);
  }
}

async function init() {
  if (await checkSession()) {
    await startApp();
  } else {
    showAuth();
  }
}

init();
