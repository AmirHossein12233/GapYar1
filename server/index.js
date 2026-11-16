
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
app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

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

app.get("/", (req, res) => {
  res.json({
    app: "GapYar",
    status: "online",
    message: "سرور گپ‌یار فعال است",
    version: "1.1.0"
  });
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({
      status: "error",
      database: "disconnected"
    });
  }
});

app.get("/api/messages/:room", async (req, res) => {
  const room = req.params.room;

  if (!/^[a-z0-9_-]{1,100}$/i.test(room)) {
    return res.status(400).json({ error: "اتاق نامعتبر است" });
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
  } catch {
    res.status(500).json({ error: "خطا در دریافت پیام‌ها" });
  }
});

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
    ) return;

    try {
      const result = await pool.query(
        `INSERT INTO messages (room, message)
         VALUES ($1, $2)
         RETURNING id, room, message, created_at`,
        [data.room, data.message.trim()]
      );

      io.to(data.room).emit("new-message", result.rows[0]);
    } catch (error) {
      console.error("خطای ذخیره پیام:", error.message);
      socket.emit("message-error", {
        message: "ذخیره پیام انجام نشد"
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("کاربر قطع شد:", socket.id);
  });
});

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
