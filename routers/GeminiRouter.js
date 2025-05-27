import express from 'express';
import { processGeminiMessage } from '../controllers/geminiController.js';
import { verifyToken } from '../middlewares/auth.js';

const router = express.Router();

// Middleware tùy chọn để xác thực token
const optionalAuth = (req, res, next) => {
  try {
    // Lấy token từ header nếu có
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      // Xử lý xác thực token ở đây nếu cần
      // Nếu không có token, vẫn cho phép tiếp tục
    }
    next();
  } catch (error) {
    console.error('Lỗi xác thực token tùy chọn:', error);
    next(); // Vẫn tiếp tục ngay cả khi có lỗi
  }
};

// Endpoint để xử lý tin nhắn Gemini - sử dụng xác thực tùy chọn
router.post('/message', optionalAuth, processGeminiMessage);

export default router;
