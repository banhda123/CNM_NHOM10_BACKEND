import axios from 'axios';
import { MessageModel } from '../models/MessageModel.js';
import { ConversationModel } from '../models/ConversationModel.js';
import { UsersModel } from '../models/UserModel.js';
import mongoose from 'mongoose';
import UserAIModel from '../models/UserAIModel.js';
import { emitNewMessage } from '../config/Socket.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

const buildRequestBody = (message) => ({
  contents: [
    {
      parts: [
        {
          text: message,
        },
      ],
    },
  ],
});

const extractResponseContent = (data) => {
  const candidates = data?.candidates || [];
  if (candidates.length > 0) {
    const content = candidates[0]?.content;
    if (content?.parts?.length > 0) {
      return content.parts[0].text.trim();
    }
  }
  return "Không tìm thấy phản hồi.";
};

const handleError = (error) => {
  console.error("Error fetching Gemini response:", error?.response?.data || error);
  return "Có lỗi xảy ra, vui lòng thử lại.";
};

const fetchGeminiResponse = async (message) => {
  try {
    const response = await axios.post(GEMINI_ENDPOINT, buildRequestBody(message), {
      headers: { "Content-Type": "application/json" },
    });

    return extractResponseContent(response.data);
  } catch (error) {
    return handleError(error);
  }
};

// Process a message sent to Gemini AI and generate a response
export const processGeminiMessage = async (req, res) => {
  try {
    // Support both formats: messageId/conversationId or direct content/conversationId
    const { messageId, conversationId, content, sender } = req.body;
    
    // Validate input
    if (!content && !messageId) {
      return res.status(400).json({ error: 'Either messageId or content must be provided' });
    }
    
    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId is required' });
    }
    
    let messageContent;
    let conversation = null;
    let geminiUser = null;
    let userSender = null;
    
    // Get message content
    if (messageId) {
      // Original flow - find message by ID
      const userMessage = await MessageModel.findById(messageId);
      if (!userMessage) {
        return res.status(404).json({ error: 'Message not found' });
      }
      messageContent = userMessage.content;
    } else if (content) {
      // New flow - direct content provided
      messageContent = content;
    }
    
    // Extract query from message if it starts with @AIGemini or @AiGemini
    let query = messageContent;
    const aiPrefixes = ['@AIGemini', '@AiGemini'];
    for (const prefix of aiPrefixes) {
      if (messageContent.trim().startsWith(prefix)) {
        query = messageContent.substring(prefix.length).trim();
        break;
      }
    }
    
    // Nếu conversationId không hợp lệ (ví dụ: temp-conversation), chỉ trả về Gemini response, không lưu DB
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      const geminiResponse = await fetchGeminiResponse(query);
      return res.status(200).json({
        success: true,
        message: 'Gemini response (no DB)',
        data: {
          content: geminiResponse
        }
      });
    }
    
    // Try to find conversation and Gemini user
    try {
      conversation = await ConversationModel.findById(conversationId)
        .populate('members.idUser');
      
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      
      // Lấy Gemini AI từ UserAIModel (không phải là thành viên nhóm)
      let geminiUser = await UserAIModel.findOne({ email: 'gemini@ai.assistant' });
      if (!geminiUser) {
        geminiUser = new UserAIModel({
          name: 'Gemini AI',
          email: 'gemini@ai.assistant',
          avatar: 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/gemini_1.width-1000.format-webp.webp',
          status: 'online',
          about: 'Tôi là trợ lý AI Gemini, luôn sẵn sàng giúp đỡ bạn!'
        });
        await geminiUser.save();
      }
      
      // Lấy thông tin người gửi
      if (sender) {
        userSender = await UsersModel.findById(sender);
      }
      
    } catch (error) {
      console.error('Error finding conversation or Gemini user:', error);
      return res.status(500).json({ error: 'Failed to process conversation data' });
    }
    
    // Generate Gemini response
    const geminiResponse = await fetchGeminiResponse(query);
    
    // Create a new message from Gemini
    const newMessage = new MessageModel({
      idConversation: conversationId,
      sender: 'ai-gemini',
      content: geminiResponse,
      type: 'text',
      status: 'sent',
      isAIGenerated: true
    });
    
    // Save the message
    await newMessage.save();
    
    // Update conversation's last message with the ID of the new message
    try {
      conversation.lastMessage = newMessage._id;
      await conversation.save();
    } catch (error) {
      console.error('Error saving conversation:', error);
    }
    
    // Emit socket event for new message (dùng emitNewMessage)
    try {
      await emitNewMessage(newMessage);
    } catch (e) {
      console.error('Error emitting Gemini message via socket:', e);
    }
    
    return res.status(200).json({
      success: true,
      message: 'Gemini response processed successfully',
      data: newMessage
    });
    
  } catch (error) {
    console.error('Error processing Gemini message:', error);
    return res.status(500).json({ error: 'Failed to process Gemini message' });
  }
};
