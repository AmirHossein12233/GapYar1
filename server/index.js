
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(httpServer, {
  cors: { origin: "*" }
});

app.get("/", (req, res) => {
  res.json({
    app: "GapYar",
    status: "online",
    message: "سرور گپ‌یار فعال است"
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

io.on("connection", (socket) => {
  console.log("کاربر متصل شد:", socket.id);

  socket.on("join-room", (room) => {
    if (typeof room === "string" && room.length > 0 && room.length <= 100) {
      socket.join(room);
    }
  });

  socket.on("send-message", (data) => {
    if (
      !data ||
      typeof data.room !== "string" ||
      typeof data.message !== "string" ||
      !data.message.trim() ||
      data.message.length > 2000
    ) return;

    io.to(data.room).emit("new-message", {
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
