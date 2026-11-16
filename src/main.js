
import "./style.css";

const SERVER_URL = "http://127.0.0.1:3001";

const app = document.querySelector("#app");

const chats = [
  {
    id: "amir",
    name: "امیر",
    avatar: "👨🏻",
    color: "purple",
    time: "۱۲:۴۵",
    unread: 2,
    group: false,
    messages: [
      { text: "سلام، خوبی؟", mine: false, time: "۱۲:۳۰" },
      { text: "سلام، ممنونم. تو خوبی؟", mine: true, time: "۱۲:۳۲" },
      { text: "گپ‌یار آماده شد؟", mine: false, time: "۱۲:۴۵" }
    ]
  },
  {
    id: "programming",
    name: "گروه برنامه‌نویسی",
    avatar: "💻",
    color: "blue",
    time: "۱۱:۲۰",
    unread: 4,
    group: true,
    messages: [
      { text: "سلام به همه اعضا", mine: false, time: "۱۱:۱۰" },
      { text: "به گروه خوش آمدید!", mine: true, time: "۱۱:۲۰" }
    ]
  },
  {
    id: "mohammad",
    name: "محمد",
    avatar: "🧑🏻",
    color: "green",
    time: "دیروز",
    unread: 0,
    group: false,
    messages: [
      { text: "فردا صحبت می‌کنیم.", mine: false, time: "۱۹:۳۰" }
    ]
  },
  {
    id: "sara",
    name: "سارا",
    avatar: "👩🏻",
    color: "pink",
    time: "دیروز",
    unread: 0,
    group: false,
    messages: [
      { text: "عکس‌ها را دیدی؟", mine: false, time: "۱۸:۱۰" }
    ]
  },
  {
    id: "friends",
    name: "گروه دوستان",
    avatar: "👥",
    color: "orange",
    time: "شنبه",
    unread: 0,
    group: true,
    messages: [
      { text: "کی وقت داره؟", mine: false, time: "۱۶:۰۰" }
    ]
  }
];

let selectedChatId = null;
let activeTab = "chats";
let activeFilter = "all";
let searchText = "";

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function selectedChat() {
  return chats.find((chat) => chat.id === selectedChatId);
}

function getFilteredChats() {
  return chats.filter((chat) => {
    const matchesSearch = chat.name
      .toLowerCase()
      .includes(searchText.toLowerCase());

    const matchesFilter =
      activeFilter === "all" ||
      (activeFilter === "unread" && chat.unread > 0) ||
      (activeFilter === "groups" && chat.group);

    return matchesSearch && matchesFilter;
  });
}

function renderChatList() {
  const list = document.querySelector("#chat-list");
  if (!list) return;

  const filtered = getFilteredChats();

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔎</div>
        <h3>گفتگویی پیدا نشد</h3>
        <p>نام دیگری جستجو کن.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = filtered.map((chat) => {
    const lastMessage = chat.messages.at(-1);

    return `
      <button class="chat-item" type="button" data-chat-id="${chat.id}">
        <div class="avatar ${chat.color}">${chat.avatar}</div>

        <div class="chat-info">
          <div class="chat-title-row">
            <strong>${escapeHTML(chat.name)}</strong>
            <span class="chat-time">${escapeHTML(chat.time)}</span>
          </div>

          <div class="chat-bottom-row">
            <span class="last-message">
              ${lastMessage ? escapeHTML(lastMessage.text) : "هنوز پیامی وجود ندارد"}
            </span>
            ${chat.unread > 0
              ? `<span class="unread-count">${chat.unread}</span>`
              : ""}
          </div>
        </div>
      </button>
    `;
  }).join("");
}

function renderConversation(chat) {
  const messages = chat.messages.map((message) => `
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
        <button class="icon-button" type="button" data-action="back">➜</button>
        <div class="avatar small ${chat.color}">${chat.avatar}</div>
        <div class="conversation-user">
          <strong>${escapeHTML(chat.name)}</strong>
          <span>گفتگوی آزمایشی</span>
        </div>
        <button class="icon-button" type="button" aria-label="گزینه‌ها">⋮</button>
      </header>

      <div class="messages" id="messages">
        <div class="date-divider"><span>امروز</span></div>
        ${messages}
      </div>

      <form class="message-form" id="message-form">
        <input
          id="message-input"
          type="text"
          maxlength="2000"
          placeholder="پیامت را بنویس..."
          autocomplete="off"
          required
        />
        <button class="send-button" type="submit" aria-label="ارسال">➤</button>
      </form>
      <p class="demo-note">پیام‌های این صفحه فعلاً فقط در همین نسخه آزمایشی هستند.</p>
    </section>
  `;
}

function renderMainPage() {
  return `
    <div class="app-shell">
      <header class="top-header">
        <div class="brand">
          <div class="brand-logo">گ</div>
          <div>
            <h1>گپ‌یار</h1>
            <span>با هم در ارتباط باشیم</span>
          </div>
        </div>
        <div class="connection-status" id="connection-status">
          <span class="status-dot"></span>
          در حال بررسی سرور...
        </div>
      </header>

      <main class="main-content">
        <div class="section-heading">
          <div>
            <h2>گفتگوها</h2>
            <p>پیام‌های دوستانت اینجا هستند</p>
          </div>
          <button class="new-chat-button" type="button" data-action="new-chat">
            ＋ گفتگوی جدید
          </button>
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
        <button class="nav-item ${activeTab === "chats" ? "active" : ""}" data-tab="chats">
          <span>▤</span>
          گفتگوها
        </button>
        <button class="nav-item ${activeTab === "contacts" ? "active" : ""}" data-tab="contacts">
          <span>♙</span>
          مخاطبین
        </button>
        <button class="nav-item ${activeTab === "profile" ? "active" : ""}" data-tab="profile">
          <span>⚙</span>
          پروفایل
        </button>
      </nav>
    </div>
  `;
}

function renderSimplePage(title, description, icon) {
  return `
    <div class="app-shell">
      <header class="top-header">
        <div class="brand">
          <div class="brand-logo">گ</div>
          <div>
            <h1>گپ‌یار</h1>
            <span>با هم در ارتباط باشیم</span>
          </div>
        </div>
        <div class="connection-status" id="connection-status">
          <span class="status-dot"></span>
          در حال بررسی سرور...
        </div>
      </header>

      <main class="simple-page">
        <div class="simple-icon">${icon}</div>
        <h2>${title}</h2>
        <p>${description}</p>
        <button class="new-chat-button" type="button" data-tab="chats">
          بازگشت به گفتگوها
        </button>
      </main>

      <nav class="bottom-nav">
        <button class="nav-item ${activeTab === "chats" ? "active" : ""}" data-tab="chats">
          <span>▤</span> گفتگوها
        </button>
        <button class="nav-item ${activeTab === "contacts" ? "active" : ""}" data-tab="contacts">
          <span>♙</span> مخاطبین
        </button>
        <button class="nav-item ${activeTab === "profile" ? "active" : ""}" data-tab="profile">
          <span>⚙</span> پروفایل
        </button>
      </nav>
    </div>
  `;
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
    app.innerHTML = renderSimplePage(
      "مخاطبین",
      "بخش مخاطبین در مراحل بعدی تکمیل می‌شود.",
      "♙"
    );
    return;
  }

  if (activeTab === "profile") {
    app.innerHTML = renderSimplePage(
      "پروفایل",
      "تنظیمات حساب کاربری در مراحل بعدی اضافه می‌شود.",
      "⚙"
    );
    return;
  }

  app.innerHTML = renderMainPage();
  renderChatList();

  const searchInput = document.querySelector("#search-input");
  searchInput.value = searchText;
}

function updateConnectionStatus(online, message) {
  const element = document.querySelector("#connection-status");
  if (!element) return;

  element.classList.toggle("online", online);
  element.classList.toggle("offline", !online);

  element.innerHTML = `
    <span class="status-dot"></span>
    ${escapeHTML(message)}
  `;
}

async function checkGapYarServer() {
  try {
    const response = await fetch(`${SERVER_URL}/api/health`, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Server response error");
    }

    const data = await response.json();

    if (data.status !== "ok") {
      throw new Error("Server is not ready");
    }

    updateConnectionStatus(true, "سرور متصل است");
  } catch (error) {
    updateConnectionStatus(false, "سرور قطع است");
    console.error("GapYar server:", error);
  }
}

app.addEventListener("click", (event) => {
  const chatButton = event.target.closest("[data-chat-id]");

  if (chatButton) {
    selectedChatId = chatButton.dataset.chatId;
    render();
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
    alert("امکان ساخت گفتگوی جدید در مراحل بعدی اضافه می‌شود.");
  }
});

app.addEventListener("input", (event) => {
  if (event.target.id === "search-input") {
    searchText = event.target.value;
    renderChatList();
  }
});

app.addEventListener("submit", (event) => {
  if (event.target.id !== "message-form") return;

  event.preventDefault();

  const input = document.querySelector("#message-input");
  const message = input.value.trim();
  const chat = selectedChat();

  if (!chat || !message) return;

  const now = new Date();
  const time = now.toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit"
  });

  chat.messages.push({
    text: message,
    mine: true,
    time
  });

  chat.time = time;
  render();
});

render();
checkGapYarServer();

setInterval(checkGapYarServer, 5000);
