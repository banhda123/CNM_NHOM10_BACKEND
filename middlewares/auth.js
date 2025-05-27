import jwt from 'jsonwebtoken';
import { UsersModel } from '../models/UserModel.js';

// Middleware để xác thực token
export const verifyToken = async (req, res, next) => {
  try {
    // Lấy token từ header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Không tìm thấy token xác thực' });
    }

    const token = authHeader.split(' ')[1];
    
    // Xác thực token
    const decoded = jwt.verify(token, process.env.TOKEN_SECRET);
    
    // Tìm người dùng từ ID trong token
    const user = await UsersModel.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'Người dùng không tồn tại' });
    }
    
    // Thêm thông tin người dùng vào request
    req.user = {
      id: user._id,
      name: user.name,
      email: user.email
    };
    
    next();
  } catch (error) {
    console.error('Lỗi xác thực token:', error);
    return res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
  }
};

// Middleware để kiểm tra quyền admin
export const verifyAdmin = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    next();
  } else {
    return res.status(403).json({ error: 'Không có quyền truy cập' });
  }
};
