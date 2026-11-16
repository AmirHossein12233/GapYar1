
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import pg from "pg";

const { Pool } = pg;

const app = express();
const httpServer = createServer(app);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

app.use(cors());
app.use(express.json({ limit: "100kb" }));

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --------------------
// Database
// --------------------

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      room VARCHAR(100) NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// --------------------
// Main API
// --------------------

app.get("/", (req, res) => {
  res.json({
    app: "GapYar",
    status: "online",
    message: "سرور گپ‌یار فعال است",
    version: "1.2.0"
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
// Rubika Webhook
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
          text: "سلام! به ربات گپ‌یار خوش آمدی. 🤖\nربات با موفقیت فعال شد."
        })
      }
    );

    const result = await response.json();

    if (!response.ok || result.status !== "OK") {
      console.error("Rubika API request failed");
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
