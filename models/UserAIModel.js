import mongoose from 'mongoose';

const UserAISchema = new mongoose.Schema({
  name: String,
  email: String,
  avatar: String,
  about: String,
  status: String,
  // Có thể thêm các trường khác nếu cần
});

const UserAIModel = mongoose.model('UserAI', UserAISchema);
export default UserAIModel; 