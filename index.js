import express from "express";
import cors from "cors";
import UserRouter from "./routers/UserRouter.js";
import ConnectToDB from "./config/db.js";
import dotenv from "dotenv";
import { createServer } from "http";
import { ConnectSocket } from "./config/Socket.js";
import cloudinary from "./config/Cloudinary.js";
import ChatRouter from "./routers/ChatRouter.js";
import uploadRouter from "./routers/uploadrouter.js";
import GiphyRouter from "./routers/GiphyRouter.js";
import GeminiRouter from "./routers/GeminiRouter.js";
import ImageAIRouter from "./routers/ImageAIRouter.js";
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 4000;

ConnectSocket(server);
ConnectToDB();

app.use(
  cors({
    origin: function(origin, callback) {
      // Cho phép kết nối từ bất kỳ nguồn nào
      callback(null, true);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Serve static files from uploads directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use("/user", UserRouter);
app.use("/chat", ChatRouter);
app.use("/", uploadRouter);
app.use("/giphy", GiphyRouter);
app.use("/chat/gemini", GeminiRouter);
app.use("/image-ai", ImageAIRouter);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on all network interfaces at port ${PORT}`);
  console.log(`Access locally via: http://localhost:${PORT}`);
  console.log(`For other devices on the network, use your machine's IP address`);
});
