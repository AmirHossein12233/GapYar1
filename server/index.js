
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import pg from "pg";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { randomBytes, createHash } from "node:crypto";

const { Pool } = pg;

const app = express();
const httpServer = createServer(app);

app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "100kb" }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "تعداد تلاش‌ها زیاد است. کمی بعد دوباره امتحان کن."
  }
});

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeUsername(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      room VARCHAR(100) NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(20) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// ساخت نشست ورود
async function createSession(userId) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);

  await pool.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [userId, tokenHash]
  );

  return token;
}

// بررسی اعتبار نشست
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7).trim()
    : "";

  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return res.status(401).json({
      error: "ابتدا وارد حساب خود شو"
    });
  }

  try {
    const result = await pool.query(
      `SELECT u.id, u.username
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1
       AND s.expires_at > NOW()
       LIMIT 1`,
      [hashToken(token)]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error: "نشست منقضی شده است. دوباره وارد شو."
      });
    }

    req.user = result.rows[0];
    req.token = token;
    next();
  } catch (error) {
    console.error("Authentication error:", error.message);
    res.status(500).json({
      error: "خطای سرور در بررسی ورود"
    });
  }
}

// --------------------
// Main API
// --------------------

app.get("/", (req, res) => {
  res.json({
    app: "GapYar",
    status: "online",
    message: "سرور گپ‌یار فعال است",
    version: "1.3.0"
  });
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      database: "connected"
    });
  } catch {
    res.status(503).json({
      status: "error",
      database: "disconnected"
    });
  }
});

// --------------------
// Register
// --------------------

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = req.body?.password;

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({
      error: "نام کاربری باید ۳ تا ۲۰ حرف انگلیسی، عدد یا زیرخط باشد."
    });
  }

  if (
    typeof password !== "string" ||
    password.length < 8 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return res.status(400).json({
      error: "رمز عبور باید حداقل ۸ کاراکتر و حداکثر ۷۲ بایت باشد."
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username`,
      [username, passwordHash]
    );

    const user = result.rows[0];
    const token = await createSession(user.id);

    res.status(201).json({
      message: "ثبت‌نام موفق بود",
      token,
      user
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "این نام کاربری قبلاً ثبت شده است."
      });
    }

    console.error("Register error:", error.message);
    res.status(500).json({
      error: "ثبت‌نام انجام نشد"
    });
  }
});

// --------------------
// Login
// --------------------

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = req.body?.password;

  if (
    !/^[a-z0-9_]{3,20}$/.test(username) ||
    typeof password !== "string" ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return res.status(400).json({
      error: "نام کاربری یا رمز عبور نامعتبر است."
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, username, password_hash
       FROM users
       WHERE username = $1
       LIMIT 1`,
      [username]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error: "نام کاربری یا رمز عبور اشتباه است."
      });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        error: "نام کاربری یا رمز عبور اشتباه است."
      });
    }

    const token = await createSession(user.id);

    res.json({
      message: "ورود موفق بود",
      token,
      user: {
        id: user.id,
        username: user.username
      }
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({
      error: "ورود انجام نشد"
    });
  }
});

// --------------------
// Current user
// --------------------

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({
    user: req.user
  });
});

// --------------------
// Logout
// --------------------

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM user_sessions WHERE token_hash = $1",
      [hashToken(req.token)]
    );

    res.json({
      message: "با موفقیت خارج شدی"
    });
  } catch (error) {
    console.error("Logout error:", error.message);
    res.status(500).json({
      error: "خروج انجام نشد"
    });
  }
});

// --------------------
// Chat history
// --------------------

app.get("/api/messages/:room", async (req, res) => {
  const room = req.params.room;

  if (!/^[a-z0-9_-]{1,100}$/i.test(room)) {
    return res.status(400).json({
      error: "اتاق نامعتبر است"
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, room, message, created_at
       FROM messages
       WHERE room = $1
       ORDER BY id ASC
       LIMIT 100`,
      [room]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("History error:", error.message);
    res.status(500).json({
      error: "خطا در دریافت پیام‌ها"
    });
  }
});

// --------------------
// Socket.IO
// --------------------

io.on("connection", socket => {
  console.log("کاربر متصل شد:", socket.id);

  socket.on("join-room", room => {
    if (
      typeof room === "string" &&
      /^[a-z0-9_-]{1,100}$/i.test(room)
    ) {
      socket.join(room);
    }
  });

  socket.on("send-message", async data => {
    if (
      !data ||
      typeof data.room !== "string" ||
      !/^[a-z0-9_-]{1,100}$/i.test(data.room) ||
      typeof data.message !== "string" ||
      !data.message.trim() ||
      data.message.length > 2000
    ) {
      return;
    }

    try {
      const result = await pool.query(
        `INSERT INTO messages (room, message)
         VALUES ($1, $2)
         RETURNING id, room, message, created_at`,
        [data.room, data.message.trim()]
      );

      io.to(data.room).emit("new-message", result.rows[0]);
    } catch (error) {
      console.error("Message save error:", error.message);
      socket.emit("message-error", {
        message: "ذخیره پیام انجام نشد"
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("کاربر قطع شد:", socket.id);
  });
});

// --------------------
// Old Rubika Webhook
// --------------------

app.post("/rubika/webhook/:secret", async (req, res) => {
  const secret = process.env.RUBIKA_WEBHOOK_SECRET;
  const token = process.env.RUBIKA_BOT_TOKEN;

  if (!secret || !token || req.params.secret !== secret) {
    return res.sendStatus(404);
  }

  const update = req.body?.update;
  const message = update?.new_message;

  if (
    update?.type !== "NewMessage" ||
    message?.sender_type !== "User" ||
    typeof update.chat_id !== "string"
  ) {
    return res.sendStatus(200);
  }

  const text = typeof message.text === "string"
    ? message.text.trim()
    : "";

  if (text !== "/start") {
    return res.sendStatus(200);
  }

  try {
    const response = await fetch(
      `https://botapi.rubika.ir/v3/${token}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: update.chat_id,
          text: "سلام! به ربات گپ‌یار خوش آمدی. 🤖"
        })
      }
    );

    const result = await response.json();

    if (!response.ok || result.status !== "OK") {
      return res.sendStatus(502);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("Rubika webhook error:", error.message);
    return res.sendStatus(500);
  }
});

// --------------------
// Start server
// --------------------

const PORT = process.env.PORT || 3000;

initializeDatabase()
  .then(() => {
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`GapYar Server running on port ${PORT}`);
    });
  })
  .catch(error => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
