
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

let selectedChatId = null;
let activeTab = "chats";
let activeFilter = "all";
let searchText = "";
let socket = null;

const chats = [
  { id: "amir", name: "امیر", avatar: "👨🏻", color: "purple", time: "۱۲:۴۵", unread: 2, group: false, messages: [] },
  { id: "programming", name: "گروه برنامه‌نویسی", avatar: "💻", color: "blue", time: "دیروز", unread: 0, group: true, messages: [] },
  { id: "mohammad", name: "محمد", avatar: "🧑🏻", color: "green", time: "دیروز", unread: 0, group: false, messages: [] },
  { id: "sara", name: "سارا", avatar: "👩🏻", color: "pink", time: "دوشنبه", unread: 0, group: false, messages: [] },
  { id: "friends", name: "گروه دوستان", avatar: "👥", color: "orange", time: "یکشنبه", unread: 0, group: true, messages: [] }
];

const seenMessages = new Set();

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
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
    throw new Error(data.message || data.error || "اطلاعات واردشده درست نیست.");
  }

  return data;
}

async function handleAuthSubmit(form) {
  if (authLoading) return;

  const username = form.username.value.trim().toLowerCase();
  const password = form.password.value;

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
    authMessage = "";
    authLoading = false;
    startApp();
  } catch (error) {
    authLoading = false;
    authMessage = error.message || "ارتباط با سرور برقرار نشد.";
    showAuth();
  }
}

async function checkSession() {
  if (!token) return false;

  try {
    const response = await fetch(`${SERVER_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) throw new Error("نشست نامعتبر است");

    const data = await response.json();
    currentUser = data.user || data;
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
    await fetch(`${SERVER_URL}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {
    // خروج محلی حتی در صورت قطع بودن سرور انجام می‌شود.
  }

  token = null;
  currentUser = null;
  localStorage.removeItem(TOKEN_KEY);
  selectedChatId = null;
  showAuth();
}

function updateConnectionStatus(online) {
  const status = document.querySelector(".connection-status");
  if (!status) return;

  status.className = `connection-status ${online ? "online" : "offline"}`;
  status.innerHTML = `<span class="status-dot"></span>${online ? "متصل" : "قطع اتصال"}`;
}

async function loadHistory(chat) {
  try {
    const response = await fetch(`${SERVER_URL}/api/messages/${encodeURIComponent(chat.id)}`);
    if (!response.ok) return;

    const data = await response.json();
    const messages = Array.isArray(data) ? data : (data.messages || []);

    messages.forEach(item => {
      const id = item.id ?? `${chat.id}-${item.created_at}-${item.message}`;
      if (seenMessages.has(String(id))) return;
      seenMessages.add(String(id));

      chat.messages.push({
        text: item.message || item.text || "",
        mine: item.username === currentUser?.username,
        time: item.created_at ? getTime(item.created_at) : getTime()
      });
    });

    render();
  } catch (error) {
    console.error("History error:", error);
  }
}

function joinSelectedRoom() {
  const chat = selectedChat();
  if (!chat || !socket?.connected) return;

  socket.emit("join-room", chat.id);
  loadHistory(chat);
}

function connectSocket() {
  if (socket) socket.disconnect();

  socket = io(SERVER_URL, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 10,
    timeout: 20000
  });

  socket.on("connect", () => {
    updateConnectionStatus(true);
    joinSelectedRoom();
  });

  socket.on("disconnect", () => updateConnectionStatus(false));
  socket.on("connect_error", () => updateConnectionStatus(false));

  socket.on("new-message", data => {
    const room = data.room || data.chatId;
    const chat = chats.find(item => item.id === room);
    if (!chat) return;

    const messageText = data.message || data.text || "";
    const id = data.id ?? `${room}-${data.created_at}-${messageText}-${data.username}`;
    if (seenMessages.has(String(id))) return;
    seenMessages.add(String(id));

    chat.messages.push({
      text: messageText,
      mine: data.username === currentUser?.username,
      time: data.created_at ? getTime(data.created_at) : getTime()
    });

    chat.time = getTime();
    if (selectedChatId !== chat.id) chat.unread++;
    render();
  });
}

function renderChatList() {
  const filtered = chats.filter(chat => {
    const matchesSearch = chat.name.toLowerCase().includes(searchText.toLowerCase());
    const matchesFilter = activeFilter === "all" ||
      (activeFilter === "groups" && chat.group) ||
      (activeFilter === "private" && !chat.group);
    return matchesSearch && matchesFilter;
  });

  if (!filtered.length) {
    return `<div class="empty-state"><div class="empty-icon">🔎</div><h3>گفتگویی پیدا نشد</h3><p>عبارت دیگری را جستجو کن.</p></div>`;
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
  const title = activeTab === "chats" ? "گفتگوها" : activeTab === "contacts" ? "مخاطبین" : "حساب کاربری";

  let content = "";

  if (activeTab === "chats") {
    content = `
      <div class="section-heading">
        <div><h2>گفتگوها</h2><p>پیام‌هایت را اینجا ببین</p></div>
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
        <h2>مخاطبین</h2>
        <p>بخش مخاطبین در مرحله بعدی تکمیل می‌شود.</p>
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
        <div class="connection-status offline"><span class="status-dot"></span>در حال اتصال</div>
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
      </header>

      <main class="messages" id="messages">
        <div class="date-divider"><span>گفتگو</span></div>
        ${chat.messages.map(message => `
          <div class="message-row ${message.mine ? "mine" : "theirs"}">
            <div class="message-bubble">
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
    selectedChatId = chatButton.dataset.chatId;
    const chat = selectedChat();
    if (chat) chat.unread = 0;
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
    activeTab = tabButton.dataset.tab;
    selectedChatId = null;
    render();
    return;
  }

  if (event.target.closest("#back-button")) {
    selectedChatId = null;
    render();
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

  if (event.target.id === "message-form") {
    event.preventDefault();

    const input = event.target.elements.message;
    const message = input.value.trim();
    const chat = selectedChat();

    if (!message || !chat || !socket?.connected) return;

    socket.emit("send-message", {
      room: chat.id,
      message
    });

    chat.messages.push({
      text: message,
      mine: true,
      time: getTime()
    });
    chat.time = getTime();
    render();
  }
});

async function startApp() {
  render();
  connectSocket();
}

async function init() {
  if (await checkSession()) {
    startApp();
  } else {
    showAuth();
  }
}

init();
