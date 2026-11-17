
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";
import pg from "pg";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import crypto from "crypto";

dotenv.config();

const { Pool } = pg;
const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const CLIENT_URL = process.env.CLIENT_URL || "*";

app.use(cors({
  origin: CLIENT_URL === "*" ? true : CLIENT_URL,
  credentials: true
}));

app.use(express.json({ limit: "2mb" }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL === "*" ? true : CLIENT_URL,
    methods: ["GET", "POST"]
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(20) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id VARCHAR(100) PRIMARY KEY,
      title VARCHAR(100) NOT NULL,
      is_group BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id VARCHAR(100)
        REFERENCES conversations(id) ON DELETE CASCADE,
      user_id BIGINT
        REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (conversation_id, user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      room VARCHAR(100) NOT NULL,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      username VARCHAR(20),
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // سازگاری با جدول پیام‌های نسخه قدیمی
  await pool.query(`
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS user_id BIGINT
        REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS username VARCHAR(20)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS messages_room_id_idx
    ON messages(room, id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS conversation_members_user_idx
    ON conversation_members(user_id)
  `);

  console.log("Database initialized");
}

async function createSession(userId) {
  const token = createToken();

  await pool.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [userId, hashToken(token)]
  );

  return token;
}

async function findUserByToken(token) {
  if (!token || typeof token !== "string") return null;

  const result = await pool.query(
    `SELECT users.id, users.username
     FROM user_sessions
     JOIN users ON users.id = user_sessions.user_id
     WHERE user_sessions.token_hash = $1
       AND user_sessions.expires_at > NOW()`,
    [hashToken(token)]
  );

  return result.rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ")
      ? header.slice(7)
      : "";

    const user = await findUserByToken(token);

    if (!user) {
      return res.status(401).json({
        error: "لطفاً دوباره وارد حساب شوید"
      });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    console.error("Auth error:", error);
    res.status(500).json({ error: "خطای سرور" });
  }
}

async function isMember(conversationId, userId) {
  const result = await pool.query(
    `SELECT 1 FROM conversation_members
     WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId]
  );

  return result.rowCount > 0;
}

// صفحه اصلی
app.get("/", (req, res) => {
  res.json({
    app: "GapYar",
    status: "online",
    message: "سرور گپ‌یار فعال است",
    version: "2.0.0"
  });
});

// ثبت نام
app.post("/api/auth/register", authLimiter, async (req, res) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({
        error: "نام کاربری باید ۳ تا ۲۰ حرف انگلیسی، عدد یا زیرخط باشد"
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "رمز عبور باید حداقل ۸ کاراکتر باشد"
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username`,
      [username, passwordHash]
    );

    const user = result.rows[0];
    const token = await createSession(user.id);

    res.status(201).json({ user, token });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "این نام کاربری قبلاً ثبت شده است"
      });
    }

    console.error("Register error:", error);
    res.status(500).json({ error: "ثبت نام انجام نشد" });
  }
});

// ورود
app.post("/api/auth/login", authLimiter, async (req, res) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const result = await pool.query(
      `SELECT id, username, password_hash
       FROM users WHERE username = $1`,
      [username]
    );

    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({
        error: "نام کاربری یا رمز عبور اشتباه است"
      });
    }

    const token = await createSession(user.id);

    res.json({
      user: { id: user.id, username: user.username },
      token
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "ورود انجام نشد" });
  }
});

// بررسی نشست
app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// خروج
app.post("/api/auth/logout", requireAuth, async (req, res) => {
  await pool.query(
    "DELETE FROM user_sessions WHERE token_hash = $1",
    [hashToken(req.token)]
  );

  res.json({ success: true });
});

// جستجوی کاربران
app.get("/api/users/search", requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();

    if (q.length < 3) {
      return res.json({ users: [] });
    }

    const result = await pool.query(
      `SELECT id, username FROM users
       WHERE username ILIKE $1 AND id <> $2
       ORDER BY username
       LIMIT 20`,
      [`%${q}%`, req.user.id]
    );

    res.json({ users: result.rows });
  } catch (error) {
    console.error("User search error:", error);
    res.status(500).json({ error: "جستجو انجام نشد" });
  }
});

// ساخت گفتگو
app.post("/api/conversations", requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    const title = String(req.body.title || "گفتگوی جدید").trim();
    const isGroup = Boolean(req.body.isGroup);

    if (!title || title.length > 100) {
      return res.status(400).json({ error: "عنوان گفتگو نامعتبر است" });
    }

    const id = crypto.randomBytes(16).toString("hex");

    await client.query("BEGIN");

    await client.query(
      `INSERT INTO conversations (id, title, is_group)
       VALUES ($1, $2, $3)`,
      [id, title, isGroup]
    );

    await client.query(
      `INSERT INTO conversation_members (conversation_id, user_id)
       VALUES ($1, $2)`,
      [id, req.user.id]
    );

    await client.query("COMMIT");

    res.status(201).json({
      conversation: {
        id,
        title,
        is_group: isGroup
      }
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Create conversation error:", error);
    res.status(500).json({ error: "ساخت گفتگو انجام نشد" });
  } finally {
    client.release();
  }
});

// دریافت گفتگوها
app.get("/api/conversations", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.title, c.is_group, c.created_at
       FROM conversations c
       JOIN conversation_members m ON m.conversation_id = c.id
       WHERE m.user_id = $1
       ORDER BY c.created_at DESC`,
      [req.user.id]
    );

    res.json({ conversations: result.rows });
  } catch (error) {
    console.error("Conversations error:", error);
    res.status(500).json({ error: "دریافت گفتگوها انجام نشد" });
  }
});

// افزودن عضو به گفتگو
app.post("/api/conversations/:id/members", requireAuth, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const username = String(req.body.username || "").trim().toLowerCase();

    if (!(await isMember(conversationId, req.user.id))) {
      return res.status(403).json({ error: "شما عضو این گفتگو نیستید" });
    }

    const userResult = await pool.query(
      "SELECT id, username FROM users WHERE username = $1",
      [username]
    );

    const target = userResult.rows[0];

    if (!target) {
      return res.status(404).json({ error: "کاربر پیدا نشد" });
    }

    await pool.query(
      `INSERT INTO conversation_members (conversation_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [conversationId, target.id]
    );

    res.json({ success: true, user: target });
  } catch (error) {
    console.error("Add member error:", error);
    res.status(500).json({ error: "افزودن عضو انجام نشد" });
  }
});

// تاریخچه پیام‌ها
app.get("/api/messages/:room", requireAuth, async (req, res) => {
  try {
    const room = req.params.room;

    if (!(await isMember(room, req.user.id))) {
      return res.status(403).json({
        error: "شما عضو این گفتگو نیستید"
      });
    }

    const result = await pool.query(
      `SELECT id, room, user_id, username, message, created_at
       FROM messages
       WHERE room = $1
       ORDER BY id ASC
       LIMIT 200`,
      [room]
    );

    res.json({ messages: result.rows });
  } catch (error) {
    console.error("History error:", error);
    res.status(500).json({ error: "دریافت پیام‌ها انجام نشد" });
  }
});

// احراز هویت سوکت
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const user = await findUserByToken(token);

    if (!user) {
      return next(new Error("UNAUTHORIZED"));
    }

    socket.user = user;
    next();
  } catch (error) {
    next(new Error("AUTH_ERROR"));
  }
});

// اتصال کاربران
io.on("connection", (socket) => {
  console.log("User connected:", socket.user.username);

  socket.on("join-room", async (room) => {
    try {
      if (typeof room !== "string") return;

      if (!(await isMember(room, socket.user.id))) {
        socket.emit("message-error", {
          error: "شما عضو این گفتگو نیستید"
        });
        return;
      }

      socket.join(room);
      socket.emit("joined-room", { room });
    } catch (error) {
      console.error("Join room error:", error);
    }
  });

  socket.on("leave-room", (room) => {
    if (typeof room === "string") {
      socket.leave(room);
    }
  });

  socket.on("send-message", async (data) => {
    try {
      const room = String(data?.room || "");
      const message = String(data?.message || "").trim();

      if (!room || !message || message.length > 5000) {
        return socket.emit("message-error", {
          error: "متن پیام نامعتبر است"
        });
      }

      if (!(await isMember(room, socket.user.id))) {
        return socket.emit("message-error", {
          error: "شما عضو این گفتگو نیستید"
        });
      }

      const result = await pool.query(
        `INSERT INTO messages (room, user_id, username, message)
         VALUES ($1, $2, $3, $4)
         RETURNING id, room, user_id, username, message, created_at`,
        [room, socket.user.id, socket.user.username, message]
      );

      io.to(room).emit("new-message", result.rows[0]);
    } catch (error) {
      console.error("Send message error:", error);
      socket.emit("message-error", {
        error: "ارسال پیام انجام نشد"
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.user.username);
  });
});

// خطاهای عمومی
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "خطای داخلی سرور" });
});

async function start() {
  try {
    await initializeDatabase();

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`GapYar Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
}

start();
