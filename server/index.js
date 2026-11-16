
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.get("/", (req, res) => {
  res.json({
    app: "GapYar",
    status: "online",
    message: "سرور گپ‌یار فعال است",
    version: "1.0.0"
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

io.on("connection", socket => {
  console.log("کاربر متصل شد:", socket.id);

  socket.on("join-room", room => {
    if (
      typeof room === "string" &&
      /^[a-z0-9_-]{1,100}$/i.test(room)
    ) {
      socket.join(room);
      console.log("ورود به اتاق:", room);
    }
  });

  socket.on("send-message", data => {
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

    io.to(data.room).emit("new-message", {
      room: data.room,
      message: data.message.trim(),
      time: new Date().toISOString()
    });
  });

  socket.on("disconnect", () => {
    console.log("کاربر قطع شد:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`GapYar Server running on port ${PORT}`);
});
