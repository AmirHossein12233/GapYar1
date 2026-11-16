
import "./style.css";
import { io } from "socket.io-client";

const SERVER_URL = "https://gapyar-server.onrender.com";
const app = document.querySelector("#app");

const socket = io(SERVER_URL, {
  autoConnect: true,
  reconnection: true,
  timeout: 20000
});

const chats = [
  { id: "amir", name: "امیر", avatar: "👨🏻", color: "purple", group: false, messages: [], unread: 0, time: "" },
  { id: "programming", name: "گروه برنامه‌نویسی", avatar: "💻", color: "blue", group: true, messages: [], unread: 0, time: "" },
  { id: "mohammad", name: "محمد", avatar: "🧑🏻", color: "green", group: false, messages: [], unread: 0, time: "" },
  { id: "sara", name: "سارا", avatar: "👩🏻", color: "pink", group: false, messages: [], unread: 0, time: "" },
  { id: "friends", name: "گروه دوستان", avatar: "👥", color: "orange", group: true, messages: [], unread: 0, time: "" }
];

let selectedChatId = null;
let activeTab = "chats";
let activeFilter = "all";
let searchText = "";

const loadedRooms = new Set();
const loadingRooms = new Set();
const receivedMessageIds = new Set();

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#039;"
  })[char]);
}

function selectedChat() {
  return chats.find(chat => chat.id === selectedChatId);
}

function currentTime() {
  return new Date().toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatTime(value) {
  if (!value) return currentTime();

  return new Date(value).toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function updateConnectionStatus(online) {
  const element = document.querySelector("#connection-status");
  if (!element) return;

  element.classList.toggle("online", online);
  element.classList.toggle("offline", !online);
  element.innerHTML = `
    <span class="status-dot"></span>
    ${online ? "سرور متصل است" : "سرور قطع است"}
  `;
}

async function loadHistory(chat) {
  if (!chat || loadedRooms.has(chat.id) || loadingRooms.has(chat.id)) return;

  loadingRooms.add(chat.id);

  try {
    const response = await fetch(
      `${SERVER_URL}/api/messages/${encodeURIComponent(chat.id)}`
    );

    if (!response.ok) {
      throw new Error("دریافت تاریخچه ناموفق بود");
    }

    const history = await response.json();

    if (!Array.isArray(history)) {
      throw new Error("پاسخ سرور نامعتبر است");
    }

    chat.messages = history.map(item => {
      if (item.id) receivedMessageIds.add(String(item.id));

      return {
        id: item.id,
        text: item.message,
        mine: false,
        time: formatTime(item.created_at)
      };
    });

    const last = chat.messages.at(-1);
    if (last) chat.time = last.time;

    loadedRooms.add(chat.id);

    if (selectedChatId === chat.id) render();
    else renderChatList();

  } catch (error) {
    console.error("History error:", error);
    alert("دریافت پیام‌های قبلی انجام نشد. دوباره تلاش کن.");
  } finally {
    loadingRooms.delete(chat.id);
  }
}

function joinSelectedRoom() {
  const chat = selectedChat();

  if (chat && socket.connected) {
    socket.emit("join-room", chat.id);
    loadHistory(chat);
  }
}

function renderChatList() {
  const list = document.querySelector("#chat-list");
  if (!list) return;

  const filtered = chats.filter(chat => {
    const search = chat.name.toLowerCase().includes(searchText.toLowerCase());

    const filter =
      activeFilter === "all" ||
      (activeFilter === "unread" && chat.unread > 0) ||
      (activeFilter === "groups" && chat.group);

    return search && filter;
  });

  if (!filtered.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔎</div>
        <h3>گفتگویی پیدا نشد</h3>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(chat => {
    const last = chat.messages.at(-1);

    return `
      <button class="chat-item" type="button" data-chat-id="${escapeHTML(chat.id)}">
        <div class="avatar ${chat.color}">${chat.avatar}</div>
        <div class="chat-info">
          <div class="chat-title-row">
            <strong>${escapeHTML(chat.name)}</strong>
            <span class="chat-time">${escapeHTML(chat.time)}</span>
          </div>
          <div class="chat-bottom-row">
            <span class="last-message">
              ${last ? escapeHTML(last.text) : "هنوز پیامی وجود ندارد"}
            </span>
            ${chat.unread ? `<span class="unread-count">${chat.unread}</span>` : ""}
          </div>
        </div>
      </button>`;
  }).join("");
}

function renderConversation(chat) {
  const messages = chat.messages.map(message => `
    <div class="message-row ${message.mine ? "mine" : "theirs"}">
      <div class="message-bubble">
        <div class="message-text">${escapeHTML(message.text)}</div>
        <span class="message-time">${escapeHTML(message.time)}</span>
      </div>
    </div>
  `).join("");

  return `
    <section class="conversation">
      <header class="conversation-header">
        <button class="icon-button" data-action="back">➜</button>
        <div class="avatar small ${chat.color}">${chat.avatar}</div>
        <div class="conversation-user">
          <strong>${escapeHTML(chat.name)}</strong>
          <span>${socket.connected ? "آنلاین" : "در حال اتصال..."}</span>
        </div>
      </header>

      <div class="messages" id="messages">
        <div class="date-divider"><span>تاریخچه پیام‌ها</span></div>
        ${messages}
      </div>

      <form class="message-form" id="message-form">
        <input id="message-input" type="text"
          maxlength="2000" placeholder="پیامت را بنویس..."
          autocomplete="off" required />
        <button class="send-button" type="submit">➤</button>
      </form>
    </section>`;
}

function renderMainPage() {
  return `
    <div class="app-shell">
      <header class="top-header">
        <div class="brand">
          <div class="brand-logo">گ</div>
          <div><h1>گپ‌یار</h1><span>با هم در ارتباط باشیم</span></div>
        </div>
        <div class="connection-status" id="connection-status">
          <span class="status-dot"></span> در حال اتصال...
        </div>
      </header>

      <main class="main-content">
        <div class="section-heading">
          <div><h2>گفتگوها</h2><p>پیام‌های دوستانت اینجا هستند</p></div>
          <button class="new-chat-button" data-action="new-chat">＋ گفتگوی جدید</button>
        </div>

        <div class="search-box">
          <span>⌕</span>
          <input id="search-input" type="search" placeholder="جستجوی گفتگو..." />
        </div>

        <div class="filters">
          <button class="filter-button ${activeFilter === "all" ? "active" : ""}" data-filter="all">همه</button>
          <button class="filter-button ${activeFilter === "unread" ? "active" : ""}" data-filter="unread">خوانده‌نشده</button>
          <button class="filter-button ${activeFilter === "groups" ? "active" : ""}" data-filter="groups">گروه‌ها</button>
        </div>

        <div class="chat-list" id="chat-list"></div>
      </main>

      <nav class="bottom-nav">
        <button class="nav-item ${activeTab === "chats" ? "active" : ""}" data-tab="chats"><span>▤</span> گفتگوها</button>
        <button class="nav-item ${activeTab === "contacts" ? "active" : ""}" data-tab="contacts"><span>♙</span> مخاطبین</button>
        <button class="nav-item ${activeTab === "profile" ? "active" : ""}" data-tab="profile"><span>⚙</span> پروفایل</button>
      </nav>
    </div>`;
}

function renderSimplePage(title, description, icon) {
  return `
    <div class="app-shell">
      <header class="top-header">
        <div class="brand">
          <div class="brand-logo">گ</div>
          <div><h1>گپ‌یار</h1><span>با هم در ارتباط باشیم</span></div>
        </div>
        <div class="connection-status" id="connection-status">
          <span class="status-dot"></span> در حال اتصال...
        </div>
      </header>
      <main class="simple-page">
        <div class="simple-icon">${icon}</div>
        <h2>${title}</h2>
        <p>${description}</p>
        <button class="new-chat-button" data-tab="chats">بازگشت به گفتگوها</button>
      </main>
      <nav class="bottom-nav">
        <button class="nav-item ${activeTab === "chats" ? "active" : ""}" data-tab="chats">▤ گفتگوها</button>
        <button class="nav-item ${activeTab === "contacts" ? "active" : ""}" data-tab="contacts">♙ مخاطبین</button>
        <button class="nav-item ${activeTab === "profile" ? "active" : ""}" data-tab="profile">⚙ پروفایل</button>
      </nav>
    </div>`;
}

function render() {
  if (selectedChatId) {
    const chat = selectedChat();

    if (chat) {
      chat.unread = 0;
      app.innerHTML = renderConversation(chat);

      const messages = document.querySelector("#messages");
      if (messages) messages.scrollTop = messages.scrollHeight;

      return;
    }

    selectedChatId = null;
  }

  if (activeTab === "contacts") {
    app.innerHTML = renderSimplePage("مخاطبین", "بخش مخاطبین بعداً تکمیل می‌شود.", "♙");
    updateConnectionStatus(socket.connected);
    return;
  }

  if (activeTab === "profile") {
    app.innerHTML = renderSimplePage("پروفایل", "تنظیمات حساب کاربری بعداً اضافه می‌شود.", "⚙");
    updateConnectionStatus(socket.connected);
    return;
  }

  app.innerHTML = renderMainPage();
  renderChatList();

  const input = document.querySelector("#search-input");
  if (input) input.value = searchText;

  updateConnectionStatus(socket.connected);
}

socket.on("connect", () => {
  updateConnectionStatus(true);
  joinSelectedRoom();
});

socket.on("disconnect", () => {
  updateConnectionStatus(false);
});

socket.on("connect_error", error => {
  console.error("Socket error:", error.message);
  updateConnectionStatus(false);
});

socket.on("new-message", data => {
  if (
    !data ||
    typeof data.room !== "string" ||
    typeof data.message !== "string"
  ) return;

  const chat = chats.find(item => item.id === data.room);
  if (!chat) return;

  if (data.id && receivedMessageIds.has(String(data.id))) return;
  if (data.id) receivedMessageIds.add(String(data.id));

  chat.messages.push({
    id: data.id,
    text: data.message,
    mine: false,
    time: formatTime(data.created_at || data.time)
  });

  chat.time = currentTime();

  if (selectedChatId === chat.id) {
    render();
  } else {
    chat.unread++;
    renderChatList();
  }
});

app.addEventListener("click", event => {
  const chatButton = event.target.closest("[data-chat-id]");

  if (chatButton) {
    selectedChatId = chatButton.dataset.chatId;
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
    searchText = "";
    render();
    return;
  }

  const actionButton = event.target.closest("[data-action]");

  if (!actionButton) return;

  if (actionButton.dataset.action === "back") {
    selectedChatId = null;
    render();
  }

  if (actionButton.dataset.action === "new-chat") {
    alert("ساخت گفتگوی جدید در مراحل بعدی اضافه می‌شود.");
  }
});

app.addEventListener("input", event => {
  if (event.target.id === "search-input") {
    searchText = event.target.value;
    renderChatList();
  }
});

app.addEventListener("submit", event => {
  if (event.target.id !== "message-form") return;

  event.preventDefault();

  const input = document.querySelector("#message-input");
  const message = input.value.trim();
  const chat = selectedChat();

  if (!chat || !message) return;

  if (!socket.connected) {
    alert("اتصال به سرور برقرار نیست.");
    return;
  }

  socket.emit("send-message", {
    room: chat.id,
    message
  });

  input.value = "";
});

render();
