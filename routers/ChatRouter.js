import express from "express";
import {
  getAllConversation,
  getAllConversationByUser,
  getAllFriend,
  getAllMessageByConversation,
  saveMessage,
  seenMessage,
  revokeMessage,
  deleteMessage,
  forwardMessage,
  createGroupConversation,
  addMemberToGroup,
  removeMemberFromGroup,
  leaveGroup,
  updateGroupInfo,
  deleteGroup,
  setAdmin2,
  removeAdmin2,
  updateGroupPermissions,
  uploadFile,
  pinMessage,
  unpinMessage,
  getPinnedMessages,
  getConversationMedia,
  getConversationFiles,
  getConversationLinks
} from "../controllers/chatController.js";
import { isAuth } from "../utils/index.js";
import multer from "multer";
import { uploadToCloudinary } from "../config/Cloudinary.js";
import { emitNewMessage } from "../config/Socket.js";
import fs from "fs";
import path from "path";
import { MessageModel } from "../models/MessageModel.js";
import { processGeminiMessage } from "../controllers/geminiController.js";

const ChatRouter = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Tăng kích thước tối đa cho file tải lên, đặc biệt là video
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // Tăng giới hạn kích thước file lên 100MB
  }
});

ChatRouter.get("/", getAllConversation);
ChatRouter.get("/allmessage/:id", getAllMessageByConversation);
ChatRouter.get("/conversations/:id", getAllConversationByUser);
ChatRouter.get("/:id", getAllConversationByUser);
ChatRouter.get("/friend/:id", getAllFriend);

ChatRouter.post("/message", isAuth, saveMessage);
ChatRouter.post("/seen/:id", isAuth, seenMessage);
ChatRouter.post("/message/revoke/:messageId", isAuth, revokeMessage);
ChatRouter.post("/message/delete/:messageId", isAuth, deleteMessage);
ChatRouter.post("/message/forward", isAuth, forwardMessage);

// Group chat routes
ChatRouter.post("/group", isAuth, createGroupConversation);
ChatRouter.put("/group", isAuth, updateGroupInfo);
ChatRouter.delete("/group/:conversationId", isAuth, deleteGroup);
ChatRouter.post("/group/members", isAuth, addMemberToGroup);
ChatRouter.delete("/group/:conversationId/members/:memberId", isAuth, removeMemberFromGroup);
ChatRouter.post("/group/leave/:conversationId", isAuth, leaveGroup);

// Message pinning routes
ChatRouter.post("/message/:messageId/pin", isAuth, pinMessage);
ChatRouter.delete("/message/:messageId/pin", isAuth, unpinMessage);
ChatRouter.get("/conversation/:conversationId/pinned-messages", isAuth, getPinnedMessages);

// Admin2 and permissions routes
ChatRouter.post("/group/admin2", isAuth, setAdmin2);
ChatRouter.delete("/group/admin2/:conversationId", isAuth, removeAdmin2);
ChatRouter.post("/group/:conversationId/admin2/remove/:memberId", isAuth, removeMemberFromGroup);  // New route for admin2 to remove members
ChatRouter.put("/group/permissions", isAuth, updateGroupPermissions);

ChatRouter.post("/upload", isAuth, upload.single('file'), uploadFile);

// Gemini AI route - handle messages sent to Gemini AI
// Không yêu cầu xác thực để cho phép sử dụng trong GeminiChatBox
ChatRouter.post("/gemini/message", processGeminiMessage);

// API thêm cảm xúc vào tin nhắn
ChatRouter.post("/message/reaction", isAuth, async (req, res) => {
  try {
    const { messageId, userId, emoji } = req.body;
    
    if (!messageId || !userId || !emoji) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    
    // Tìm tin nhắn
    const message = await MessageModel.findById(messageId);
    
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }
    
    // Khởi tạo reactions object nếu chưa có
    if (!message.reactions) {
      message.reactions = {};
    }
    
    // Khởi tạo mảng người dùng cho emoji này nếu chưa có
    if (!message.reactions[emoji]) {
      message.reactions[emoji] = [];
    }
    
    // Thêm userId vào danh sách nếu chưa có
    if (!message.reactions[emoji].includes(userId)) {
      message.reactions[emoji].push(userId);
      await message.save();
      
      console.log(`👍 Người dùng ${userId} đã thêm cảm xúc ${emoji} vào tin nhắn ${messageId}`);
    }
    
    res.status(200).json({ message: "Reaction added successfully" });
  } catch (error) {
    console.error("Error adding reaction:", error);
    res.status(500).json({ error: "Failed to add reaction" });
  }
});

// API xóa cảm xúc khỏi tin nhắn
ChatRouter.post("/message/reaction/remove", isAuth, async (req, res) => {
  try {
    const { messageId, userId, emoji } = req.body;
    
    if (!messageId || !userId || !emoji) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    
    // Tìm tin nhắn
    const message = await MessageModel.findById(messageId);
    
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }
    
    // Kiểm tra xem có reactions không
    if (message.reactions && message.reactions[emoji]) {
      // Xóa userId khỏi danh sách
      message.reactions[emoji] = message.reactions[emoji].filter(id => id.toString() !== userId);
      
      // Nếu không còn ai thả emoji này, xóa khỏi danh sách
      if (message.reactions[emoji].length === 0) {
        delete message.reactions[emoji];
      }
      
      await message.save();
      console.log(`👎 Người dùng ${userId} đã xóa cảm xúc ${emoji} khỏi tin nhắn ${messageId}`);
    }
    
    res.status(200).json({ message: "Reaction removed successfully" });
  } catch (error) {
    console.error("Error removing reaction:", error);
    res.status(500).json({ error: "Failed to remove reaction" });
  }
});

// Routes for fetching media, files, and links
ChatRouter.get("/conversation/:conversationId/media", isAuth, getConversationMedia);
ChatRouter.get("/conversation/:conversationId/files", isAuth, getConversationFiles);
ChatRouter.get("/conversation/:conversationId/links", isAuth, getConversationLinks);

export default ChatRouter;
