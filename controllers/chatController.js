import mongoose from "mongoose";
import { ConversationModel } from "../models/ConversationModel.js";
import { MessageModel } from "../models/MessageModel.js";
import { UsersModel } from "../models/UserModel.js";
import fs from 'fs';
import { uploadToCloudinary } from '../config/Cloudinary.js';
import { getIO } from '../config/Socket.js';

export const createConversation = async (userFrom, userTo) => {
  console.log(userFrom, userTo);
  const newConversation = new ConversationModel({
    type: "private",
    lastMessage: "",
    members: [],
  });
  newConversation.members.push({ idUser: userFrom });
  newConversation.members.push({ idUser: userTo });
  await newConversation.save();
  return newConversation;
};

export const createGroupConversation = async (req, res) => {
  try {
    const { name, members, avatar } = req.body;
    const creatorId = req.user._id;
    
    // Validate input
    if (!name || !members || !Array.isArray(members) || members.length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: "Group name and at least 2 members are required" 
      });
    }
    
    // Create new group conversation - don't set lastMessage initially
    const newGroupConversation = new ConversationModel({
      type: "group",
      name: name,
      avatar: avatar || "https://res.cloudinary.com/daclejcpu/image/upload/v1744812771/avatar-mac-dinh-12_i7jnd3.jpg",
      // Remove the empty string for lastMessage
      members: [],
      admin: creatorId
    });
    
    // Add creator to members if not already included
    if (!members.includes(creatorId.toString())) {
      members.push(creatorId.toString());
    }
    
    // Add all members to the conversation
    for (const memberId of members) {
      try {
        // Convert string ID to MongoDB ObjectID
        const objectId = new mongoose.Types.ObjectId(memberId);
        newGroupConversation.members.push({ idUser: objectId });
      } catch (error) {
        console.error(`Invalid ObjectID format for member: ${memberId}`, error);
        // Skip invalid IDs instead of failing the whole operation
      }
    }
    
    // Save the conversation without lastMessage first
    await newGroupConversation.save();
    
    // Get member names for the welcome message
    const memberIds = members.filter(id => id !== creatorId.toString());
    let memberNames = [];
    
    try {
      // Find user information for each member
      const { UsersModel } = await import("../models/UserModel.js");
      const users = await UsersModel.find({ _id: { $in: memberIds } }, 'name');
      memberNames = users.map(user => user.name);
    } catch (error) {
      console.error("Error fetching member names:", error);
      // Continue with empty names if there's an error
    }
    
    // Create a welcome message with member information
    const welcomeMessage = new MessageModel({
      idConversation: newGroupConversation._id,
      content: memberNames.length > 0 
        ? `${req.user.name} đã tạo nhóm và mời ${memberNames.join(', ')} vào nhóm`
        : `${req.user.name} đã tạo nhóm ${name}`,
      type: 'system', // Now using system type for centered, subtle messages
      systemType: 'add_member', // Thêm systemType cho tin nhắn hệ thống
      seen: false,
      sender: creatorId,
    });
    
    const savedMessage = await welcomeMessage.save();
    
    // Now update the conversation with the lastMessage ID
    await ConversationModel.findByIdAndUpdate(
      newGroupConversation._id,
      { lastMessage: savedMessage._id }
    );
    
    // Populate member information for response
    const populatedConversation = await ConversationModel.findById(newGroupConversation._id)
      .populate({
        path: "members.idUser",
        select: { name: 1, avatar: 1 }
      })
      .populate("admin", "name avatar");
    
    // Import Socket và gửi thông báo cho tất cả thành viên về nhóm mới
    try {
      const { getIO } = await import("../config/Socket.js");
      const io = getIO();
      
      if (io) {
        // Gửi thông báo đến từng thành viên
        members.forEach(memberId => {
          io.to(memberId).emit("group_created", populatedConversation);
          
          // Đồng thời gửi cập nhật danh sách cuộc trò chuyện cho mỗi thành viên
          io.to(memberId).emit("update_conversation_list", {
            conversation: populatedConversation,
            hasNewMessage: true
          });
        });
        
        console.log(`🔔 Đã gửi thông báo nhóm mới đến ${members.length} thành viên`);
      }
    } catch (error) {
      console.error("Error emitting group_created event:", error);
      // Tiếp tục xử lý ngay cả khi không gửi được thông báo
    }
    
    return res.status(201).json({
      success: true,
      message: "Group conversation created successfully",
      conversation: populatedConversation
    });
  } catch (error) {
    console.error("Error creating group conversation:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to create group conversation", 
      error: error.message 
    });
  }
};

export const joinConversation = async (id) => {
  try {
    const conversation = await ConversationModel.findOne({ _id: id });
    return conversation;
  } catch (error) {
    return undefined;
  }
};

export const getAllConversation = async (req, res) => {
  const allConversation = await ConversationModel.find();
  res.send(allConversation);
};

export const getAllConversationByUser = async (req, res) => {
  try {
    // Kiểm tra xem có yêu cầu populate đầy đủ thông tin người dùng không
    const shouldPopulateUsers = req.query.populate_users === 'true';
    
    // Tìm tất cả cuộc trò chuyện của người dùng với thông tin tối thiểu
    const list = await ConversationModel.find({
      "members.idUser": { $in: req.params.id },
    })
      .select({
        _id: 1,
        name: 1,
        type: 1,
        avatar: 1,
        lastMessage: 1,
        updatedAt: 1,
        admin: 1,    // Đảm bảo chọn trường admin
        admin2: 1,   // Đảm bảo chọn trường admin2
        "members.idUser": 1
      })
      .populate({
        path: "members.idUser",
        select: shouldPopulateUsers ? 
          { name: 1, avatar: 1, email: 1, phone: 1, status: 1 } : 
          { name: 1, avatar: 1 },
      })
      .populate({
        path: "lastMessage",
        select: "content type createdAt sender seen fileUrl isRevoked", 
      })
      .populate({
        path: "admin",
        select: shouldPopulateUsers ? 
          { name: 1, avatar: 1, email: 1, phone: 1 } : 
          { name: 1, avatar: 1 },
      })
      .populate({
        path: "admin2",
        select: shouldPopulateUsers ? 
          { name: 1, avatar: 1, email: 1, phone: 1 } : 
          { name: 1, avatar: 1 },
      })
      .sort({ updatedAt: -1 });
      
    // Đếm số tin nhắn chưa đọc cho mỗi cuộc trò chuyện
    const conversationsWithUnread = await Promise.all(
      list.map(async (conversation) => {
        const unreadCount = await MessageModel.countDocuments({
          idConversation: conversation._id,
          seen: false,
          sender: { $ne: req.params.id } // Không đếm tin nhắn của chính người dùng
        });
        
        // Chuyển đổi Mongoose document sang plain object và thêm unreadCount
        const plainConversation = conversation.toObject();
        plainConversation.unreadCount = unreadCount;
        
        // Log thông tin admin để debug
        console.log(`Conversation ${conversation._id} - Admin: ${JSON.stringify(conversation.admin)}, Admin2: ${JSON.stringify(conversation.admin2)}`);
        
        return plainConversation;
      })
    );
    
    console.log(`Đã tải ${list.length} cuộc trò chuyện cho user ${req.params.id}, populate_users=${shouldPopulateUsers}`);
    res.send(conversationsWithUnread);
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).send({ error: "Không thể tải danh sách cuộc trò chuyện" });
  }
};

export const saveMessage = async (dataOrReq, res) => {
  try {
    let data;
    let userId;

    // Check if this is a direct call from socket or an HTTP request
    if (dataOrReq && dataOrReq.body) {
      // HTTP request
      data = dataOrReq.body;
      userId = dataOrReq.user?._id;
      
      if (!userId && dataOrReq.body.sender) {
        userId = dataOrReq.body.sender;
      }
    } else {
      // Direct call from socket or direct object
      data = dataOrReq;
      userId = data.sender;
    }

    if (!data || !userId) {
      console.error("Invalid data or missing user ID");
      if (res) {
        return res.status(400).send({ message: "Dữ liệu không hợp lệ" });
      }
      return null;
    }

    const { idConversation, content, type, fileUrl, fileName, fileType } = data;

    if (!idConversation) {
      console.error("Missing required field: idConversation");
      if (res) {
        return res.status(400).send({ message: "Thiếu ID cuộc trò chuyện" });
      }
      return null;
    }

    // Kiểm tra xem nội dung có phải là tin nhắn file mà không có content không
    const messageContent = content || (fileName ? `File: ${fileName}` : '');

    // Log thông tin file nhận được
    if (fileUrl || fileName || fileType) {
      console.log("📁 Saving file message:", {
        type,
        fileUrl,
        fileName,
        fileType,
        content: messageContent
      });
    }

    const messageData = {
      idConversation,
      content: messageContent,
      type: type || 'text',
      seen: false,
      sender: userId,
    };

    // Add file information if it exists
    if (fileUrl) {
      messageData.fileUrl = fileUrl;
      console.log("📄 Setting fileUrl:", fileUrl);
    }
    if (fileName) {
      messageData.fileName = fileName;
      console.log("📝 Setting fileName:", fileName);
    }
    if (fileType) {
      messageData.fileType = fileType;
      console.log("🏷️ Setting fileType:", fileType);
    }
    
    // Handle GIF type specifically
    if (type === 'gif' && fileUrl) {
      console.log("🎭 Processing GIF message with URL:", fileUrl);
      messageData.type = 'gif';
    }

    // Log để kiểm tra dữ liệu trước khi lưu
    console.log("💾 Saving message with data:", JSON.stringify(messageData, null, 2));

    const message = new MessageModel(messageData);
    const savedMessage = await message.save();

    // Log sau khi lưu để kiểm tra
    console.log("✅ Saved message:", {
      id: savedMessage._id,
      type: savedMessage.type,
      fileUrl: savedMessage.fileUrl,
      fileName: savedMessage.fileName
    });

    // Cập nhật tin nhắn cuối cùng
    await updateLastMesssage({ idConversation, message: savedMessage._id });

    // Return the message object
    if (res) {
      res.send(savedMessage);
    }
    
    return savedMessage;
  } catch (error) {
    console.error("saveMessage error:", error);
    if (res) {
      res.status(500).send({ message: "Lỗi server" });
    }
    return null;
  }
};

export const updateLastMesssage = async ({ idConversation, message }) => {
  try {
    if (!idConversation || !message) {
      console.error("Missing idConversation or message ID in updateLastMesssage");
      return false;
    }
    
    console.log(`Updating last message for conversation ${idConversation} to message ${message}`);
    const conversation = await ConversationModel.findById(idConversation);
    
    if (!conversation) {
      console.error(`Conversation with ID ${idConversation} not found`);
      return false;
    }
    
    conversation.lastMessage = message;
    await conversation.save();
    return true;
  } catch (error) {
    console.error("Error in updateLastMesssage:", error);
    return false;
  }
};

export const getAllMessageByConversation = async (req, res) => {
  try {
    const conversationId = req.params.id;
    const limit = parseInt(req.query.limit) || 20; // Mặc định 20 tin nhắn mỗi lần load
    const beforeTimestamp = req.query.before ? new Date(req.query.before) : new Date(); // Mặc định là thời gian hiện tại nếu không có timestamp
    
    console.log(`Tải tin nhắn cho conversation ${conversationId}, limit: ${limit}, before: ${beforeTimestamp}`);

    // Xây dựng query
    const query = {
      idConversation: conversationId,
      createdAt: { $lt: beforeTimestamp }
    };
    
    // Tìm tin nhắn, sắp xếp theo thời gian mới nhất trước
    const messages = await MessageModel.find(query)
      .sort({ createdAt: -1 }) // Sắp xếp thời gian từ mới đến cũ
      .limit(limit)
      .populate('sender', 'name avatar'); // Chỉ lấy thông tin cần thiết của người gửi
      
    // Đảo ngược kết quả để hiển thị tin nhắn cũ trước, mới sau
    const sortedMessages = messages.reverse();
    
    // Xác định xem có còn tin nhắn cũ hơn không
    const oldestMessage = sortedMessages[0]; 
    let hasMore = false;
    
    if (oldestMessage) {
      const olderMessagesCount = await MessageModel.countDocuments({
        idConversation: conversationId,
        createdAt: { $lt: oldestMessage.createdAt }
      });
      
      hasMore = olderMessagesCount > 0;
    }
    
    console.log(`Đã tải ${sortedMessages.length} tin nhắn. Còn tin nhắn cũ hơn: ${hasMore ? "Có" : "Không"}`);
    
    res.send({
      messages: sortedMessages,
      hasMore: hasMore,
      // Trả về timestamp của tin nhắn cũ nhất để làm điểm bắt đầu cho lần fetch tiếp theo
      nextCursor: oldestMessage ? oldestMessage.createdAt.toISOString() : null
    });
    
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).send({ error: "Không thể tải tin nhắn" });
  }
};

export const chat = async (id) => {
  let allConversation = await ConversationModel.findOne({ _id: id });
  res.send(allConversation);
};

export const getAllFriend = async (req, res) => {
  console.log(req.params.id);
  const data = await ConversationModel.aggregate({
    $match: { _id: req.params.id },
  });

  res.send(data);
};

export const seenMessage = async (idConversationOrReq, res) => {
  let idConversation;
  
  // Xử lý các trường hợp khác nhau của tham số đầu vào
  if (typeof idConversationOrReq === 'string' || idConversationOrReq instanceof String) {
    // Trường hợp là string ID
    idConversation = idConversationOrReq;
  } else if (idConversationOrReq && idConversationOrReq.params && idConversationOrReq.params.id) {
    // Trường hợp là HTTP request
    idConversation = idConversationOrReq.params.id;
  } else {
    console.error("Invalid parameters for seenMessage");
    if (res) {
      return res.status(400).json({ error: "ID cuộc trò chuyện không hợp lệ" });
    }
    return false;
  }

  try {
    await MessageModel.updateMany(
      { idConversation: idConversation },
      { seen: true }
    );
    
    if (res) {
      // Nếu là HTTP request, trả về response
      res.status(200).json({ message: "Messages marked as seen" });
    }
    return true;
  } catch (error) {
    console.error("Error updating messages:", error);
    if (res) {
      res.status(500).json({ error: "Không thể đánh dấu tin nhắn đã đọc" });
    }
    return false;
  }
};

export const revokeMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    if (!messageId) {
      return res.status(400).json({ error: "Cần cung cấp ID tin nhắn" });
    }

    // Tìm tin nhắn
    const message = await MessageModel.findById(messageId);
    
    if (!message) {
      return res.status(404).json({ error: "Không tìm thấy tin nhắn" });
    }

    // Kiểm tra người thu hồi tin nhắn có phải là người gửi không
    if (message.sender.toString() !== userId.toString()) {
      return res.status(403).json({ error: "Bạn chỉ có thể thu hồi tin nhắn của chính mình" });
    }

    // Cập nhật tình trạng thu hồi tin nhắn
    message.isRevoked = true;
    await message.save();

    return res.status(200).json({
      success: true,
      message: "Message revoked successfully"
    });
  } catch (error) {
    console.error("Error revoking message:", error);
    return res.status(500).json({ error: "Không thể thu hồi tin nhắn" });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    if (!messageId) {
      return res.status(400).json({ error: "Cần cung cấp ID tin nhắn" });
    }

    // Tìm tin nhắn
    const message = await MessageModel.findById(messageId);
    
    if (!message) {
      return res.status(404).json({ error: "Không tìm thấy tin nhắn" });
    }

    // Không cần kiểm tra người xóa có phải người gửi không
    // Bất kỳ ai cũng có thể xóa tin nhắn ở phía của họ
    
    // Kiểm tra xem người dùng đã xóa tin nhắn này chưa
    if (message.deletedBy && message.deletedBy.some(id => id.toString() === userId.toString())) {
      return res.status(400).json({ error: "Tin nhắn đã được bạn xóa trước đó" });
    }
    
    // Thêm userId vào mảng deletedBy
    if (!message.deletedBy) {
      message.deletedBy = [];
    }
    
    message.deletedBy.push(userId);
    await message.save();

    return res.status(200).json({
      success: true,
      message: "Message deleted for you"
    });
  } catch (error) {
    console.error("Error deleting message:", error);
    return res.status(500).json({ error: "Không thể xóa tin nhắn" });
  }
};

export const forwardMessage = async (req, res) => {
  try {
    const { messageId, conversationId } = req.body;
    const userId = req.user._id;

    if (!messageId || !conversationId) {
      return res.status(400).json({ error: "Cần cung cấp ID tin nhắn và ID cuộc trò chuyện" });
    }

    // Tìm tin nhắn gốc
    const originalMessage = await MessageModel.findById(messageId).populate('sender', 'name avatar');
    
    if (!originalMessage) {
      return res.status(404).json({ error: "Không tìm thấy tin nhắn gốc" });
    }

    // Tạo tin nhắn mới với nội dung được chuyển tiếp
    const forwardedMessage = new MessageModel({
      idConversation: conversationId,
      content: originalMessage.content,
      type: originalMessage.type,
      seen: false,
      sender: userId,
      fileUrl: originalMessage.fileUrl,
      fileName: originalMessage.fileName,
      fileType: originalMessage.fileType,
      isForwarded: true,
      originalMessage: originalMessage._id,
      forwardedBy: userId,
      originalSender: originalMessage.sender._id,
      originalSenderName: originalMessage.sender.name,
      originalSenderAvatar: originalMessage.sender.avatar
    });

    const savedMessage = await forwardedMessage.save();
    
    // Cập nhật tin nhắn cuối cùng cho cuộc trò chuyện
    await updateLastMesssage({ 
      idConversation: conversationId, 
      message: savedMessage._id 
    });

    // Populate thông tin người gửi để trả về đầy đủ thông tin
    const populatedMessage = await MessageModel.findById(savedMessage._id)
      .populate('sender', 'name avatar')
      .populate('originalSender', 'name avatar');

    return res.status(200).json({
      success: true,
      message: "Message forwarded successfully",
      forwardedMessage: populatedMessage
    });
  } catch (error) {
    console.error("Error forwarding message:", error);
    return res.status(500).json({ error: "Không thể chuyển tiếp tin nhắn" });
  }
};

// Group chat management functions

export const addMemberToGroup = async (req, res) => {
  try {
    const { conversationId, memberIds } = req.body;
    const userId = req.user._id;

    if (!conversationId || !memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Conversation ID and at least one member ID are required" 
      });
    }

    // Find the conversation
    const conversation = await ConversationModel.findById(conversationId)
      .populate({
        path: "members.idUser",
        select: "name avatar"
      });

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: "Conversation not found" 
      });
    }

    // Check if it's a group conversation
    if (conversation.type !== "group") {
      return res.status(400).json({ 
        success: false, 
        message: "This operation is only allowed for group conversations" 
      });
    }

    // Check if the user is admin or a member of the group
    const isAdmin = conversation.admin && conversation.admin.toString() === userId.toString();
    const isMember = conversation.members.some(member => 
      member.idUser && member.idUser._id && member.idUser._id.toString() === userId.toString()
    );

    if (!isAdmin && !isMember) {
      return res.status(403).json({ 
        success: false, 
        message: "You don't have permission to add members to this group" 
      });
    }

    // Get current member IDs
    const currentMemberIds = conversation.members.map(member => 
      member.idUser._id.toString()
    );

    // Filter out members that are already in the group
    const newMemberIds = memberIds.filter(id => !currentMemberIds.includes(id));

    if (newMemberIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "All specified members are already in the group" 
      });
    }

    // Add new members
    for (const memberId of newMemberIds) {
      conversation.members.push({ idUser: memberId });
    }

    await conversation.save();

    // Create system message about new members
    const addedUsers = await UsersModel.find({ _id: { $in: newMemberIds } }, "name");
    const addedNames = addedUsers.map(user => user.name).join(", ");
    
    const systemMessage = new MessageModel({
      idConversation: conversationId,
      content: `${req.user.name} đã thêm ${addedNames} vào nhóm`,
      type: 'system',
      systemType: 'add_member',
      seen: false,
      sender: userId,
    });
    
    const savedMessage = await systemMessage.save();
    
    // Update last message
    await updateLastMesssage({ 
      idConversation: conversationId, 
      message: savedMessage._id 
    });

    // Get updated conversation with populated members
    const updatedConversation = await ConversationModel.findById(conversationId)
      .populate({
        path: "members.idUser",
        select: "name avatar"
      })
      .populate("admin", "name avatar")
      .populate("admin2", "name avatar")
      .populate({
        path: "lastMessage",
        populate: {
          path: "sender",
          select: "name avatar"
        }
      });
    
    // Import socket.io instance
    const io = getIO();
    
    if (io) {
      // Notify all users in the conversation about the update
      console.log(`🔔 Thông báo cho tất cả thành viên trong phòng ${conversationId} về việc có thành viên mới`);
      io.to(conversationId).emit('group_updated', updatedConversation);
      
      // Notify each newly added member individually
      for (const memberId of newMemberIds) {
        // For each new member, emit a 'member_added' event to their personal room
        // This will allow their client to add the group to their conversation list
        console.log(`🔔 Thông báo cho thành viên mới ${memberId} về nhóm ${conversationId}`);
        io.to(memberId).emit('member_added', { 
          conversation: updatedConversation, 
          member: { idUser: memberId }
        });
      }
      
      // Cập nhật danh sách cuộc trò chuyện cho tất cả thành viên
      if (updatedConversation.members && Array.isArray(updatedConversation.members)) {
        updatedConversation.members.forEach(member => {
          if (member.idUser && member.idUser._id) {
            console.log(`🔄 Cập nhật danh sách cuộc trò chuyện cho thành viên ${member.idUser._id}`);
            io.to(member.idUser._id.toString()).emit('update_conversation_list', {
              conversation: updatedConversation,
              timestamp: new Date().toISOString()
            });
          }
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Members added to group successfully",
      conversation: updatedConversation
    });
  } catch (error) {
    console.error("Error adding members to group:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to add members to group", 
      error: error.message 
    });
  }
};

export const removeMemberFromGroup = async (req, res) => {
  try {
    const { conversationId, memberId } = req.params;
    const userId = req.user._id;

    if (!conversationId || !memberId) {
      return res.status(400).json({ 
        success: false, 
        message: "Conversation ID and member ID are required" 
      });
    }

    console.log('Removing member request:', { conversationId, memberId, userId: userId.toString() });

    // Find the conversation and populate necessary fields
    const conversation = await ConversationModel.findById(conversationId)
      .populate({
        path: "members.idUser",
        select: "name avatar"
      })
      .populate("admin", "name")
      .populate("admin2", "name");

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: "Conversation not found" 
      });
    }

    // Check if it's a group conversation
    if (conversation.type !== "group") {
      return res.status(400).json({ 
        success: false, 
        message: "This operation is only allowed for group conversations" 
      });
    }

    // Check permissions with safe null checks
    const isAdmin = conversation.admin && 
                  conversation.admin._id && 
                  conversation.admin._id.toString() === userId.toString();
    
    const isAdmin2 = conversation.admin2 && 
                    conversation.admin2._id && 
                    conversation.admin2._id.toString() === userId.toString();
    
    console.log('Permission check:', { 
      isAdmin, 
      isAdmin2, 
      conversationAdmin: conversation.admin ? conversation.admin._id : null,
      conversationAdmin2: conversation.admin2 ? conversation.admin2._id : null
    });
    
    // Check if the member being removed is admin or admin2
    const isRemovingAdmin = conversation.admin && 
                          conversation.admin._id && 
                          conversation.admin._id.toString() === memberId;
    
    const isRemovingAdmin2 = conversation.admin2 && 
                           conversation.admin2._id && 
                           conversation.admin2._id.toString() === memberId;

    // Validate permissions
    if (!isAdmin && !isAdmin2) {
      return res.status(403).json({ 
        success: false, 
        message: "Only admin or admin2 can remove members" 
      });
    }

    // Admin2 cannot remove admin or other admin2
    if (isAdmin2 && !isAdmin && (isRemovingAdmin || isRemovingAdmin2)) {
      return res.status(403).json({ 
        success: false, 
        message: "Admin2 cannot remove admin or other admin2" 
      });
    }

    // Find the member to be removed with null checks
    const memberToRemove = conversation.members.find(member => 
      member.idUser && 
      member.idUser._id && 
      member.idUser._id.toString() === memberId
    );

    if (!memberToRemove) {
      return res.status(404).json({ 
        success: false, 
        message: "Member not found in the group" 
      });
    }

    // Store member info before removing
    const removedMemberName = memberToRemove.idUser.name;

    // Remove the member with null checks
    conversation.members = conversation.members.filter(member => 
      !member.idUser || 
      !member.idUser._id || 
      member.idUser._id.toString() !== memberId
    );

    // If removing admin2, clear the admin2 field
    if (isRemovingAdmin2) {
      conversation.admin2 = null;
    }

    await conversation.save();

    // Create system message about member removal
    const systemMessage = new MessageModel({
      idConversation: conversationId,
      content: `${req.user.name} đã xóa ${removedMemberName} khỏi nhóm`,
      type: 'system',
      systemType: 'remove_member',
      seen: false,
      sender: userId,
    });
    
    const savedMessage = await systemMessage.save();
    
    // Update last message
    await updateLastMesssage({ 
      idConversation: conversationId, 
      message: savedMessage._id 
    });

    // Get updated conversation with populated fields
    const updatedConversation = await ConversationModel.findById(conversationId)
      .populate({
        path: "members.idUser",
        select: "name avatar"
      })
      .populate("admin", "name avatar")
      .populate("admin2", "name avatar");

    // Get socket.io instance
    const io = getIO();
    
    if (io) {
      console.log(`Emitting group_updated to conversation ${conversationId}`);
      
      // Emit to all remaining members about the update with fully populated data
      io.to(conversationId).emit('group_updated', {
        _id: updatedConversation._id,
        name: updatedConversation.name, 
        type: updatedConversation.type,
        avatar: updatedConversation.avatar,
        members: updatedConversation.members,
        admin: updatedConversation.admin,
        admin2: updatedConversation.admin2,
        lastMessage: updatedConversation.lastMessage
      });

      console.log(`Notifying removed member ${memberId} about removal`);
      
      // Emit to the removed member
      io.to(memberId).emit('removed_from_group', {
        conversationId: conversationId,
        groupName: conversation.name,
        removedBy: req.user.name,
        message: `Bạn đã bị ${req.user.name} xóa khỏi nhóm "${conversation.name}"`
      });

      // Remove the conversation from removed member's list
      io.to(memberId).emit('conversation_deleted', {
        conversationId: conversationId
      });
    }

    return res.status(200).json({
      success: true,
      message: "Member removed from group successfully",
      conversation: updatedConversation
    });
  } catch (error) {
    console.error("Error removing member from group:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to remove member from group", 
      error: error.message 
    });
  }
};

export const leaveGroup = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;

    if (!conversationId) {
      return res.status(400).json({ 
        success: false, 
        message: "Conversation ID is required" 
      });
    }

    // Find the conversation
    const conversation = await ConversationModel.findById(conversationId)
      .populate({
        path: "members.idUser",
        select: "name avatar"
      });

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: "Conversation not found" 
      });
    }

    // Check if it's a group conversation
    if (conversation.type !== "group") {
      return res.status(400).json({ 
        success: false, 
        message: "This operation is only allowed for group conversations" 
      });
    }

    // Check if the user is a member of the group
    const memberIndex = conversation.members.findIndex(member => 
      member.idUser._id.toString() === userId.toString()
    );

    if (memberIndex === -1) {
      return res.status(404).json({ 
        success: false, 
        message: "You are not a member of this group" 
      });
    }

    // Get user name before removing
    const userName = req.user.name;

    // Remove the user from members
    conversation.members.splice(memberIndex, 1);

    // If the user is admin and there are members left, assign a new admin
    if (conversation.admin.toString() === userId.toString() && conversation.members.length > 0) {
      conversation.admin = conversation.members[0].idUser._id;
    }

    // If no members left, delete the conversation
    if (conversation.members.length === 0) {
      await ConversationModel.findByIdAndDelete(conversationId);
      await MessageModel.deleteMany({ idConversation: conversationId });

      return res.status(200).json({
        success: true,
        message: "You left the group and it was deleted as no members remain"
      });
    }

    await conversation.save();

    // Create system message about leaving
    const systemMessage = new MessageModel({
      idConversation: conversationId,
      content: `${userName} đã rời khỏi nhóm`,
      type: 'system',
      systemType: 'leave_group',
      seen: false,
      sender: userId,
    });
    
    const savedMessage = await systemMessage.save();
    
    // Update last message
    await updateLastMesssage({ 
      idConversation: conversationId, 
      message: savedMessage._id 
    });

    // Get updated conversation with populated members
    const updatedConversation = await ConversationModel.findById(conversationId)
      .populate({
        path: "members.idUser",
        select: "name avatar"
      })
      .populate("admin", "name avatar");
    
    // Get socket.io instance
    const io = getIO();
    
    // Emit group_updated event to all members in the conversation
    if (io) {
      // Gửi dữ liệu đầy đủ thay vì đối tượng updatedConversation
      io.to(conversationId).emit('group_updated', {
        _id: updatedConversation._id,
        name: updatedConversation.name, 
        type: updatedConversation.type,
        avatar: updatedConversation.avatar,
        members: updatedConversation.members,
        admin: updatedConversation.admin,
        admin2: updatedConversation.admin2,
        lastMessage: updatedConversation.lastMessage
      });
      
      // Emit member_removed event to all members in the conversation
      io.to(conversationId).emit('member_removed', { 
        conversation: updatedConversation, 
        memberId: userId,
        memberName: userName
      });
      
      console.log(`🔔 Notifying members that user ${userName} (${userId}) left group ${conversationId}`);
    }

    return res.status(200).json({
      success: true,
      message: "You left the group successfully"
    });
  } catch (error) {
    console.error("Error leaving group:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to leave group", 
      error: error.message 
    });
  }
};

export const updateGroupInfo = async (req, res) => {
  try {
    const { conversationId, name, avatar } = req.body;
    const userId = req.user._id;

    if (!conversationId || (!name && !avatar)) {
      return res.status(400).json({ 
        success: false, 
        message: "Conversation ID and at least one field to update are required" 
      });
    }

    // Find the conversation
    const conversation = await ConversationModel.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: "Conversation not found" 
      });
    }

    // Check if it's a group conversation
    if (conversation.type !== "group") {
      return res.status(400).json({ 
        success: false, 
        message: "This operation is only allowed for group conversations" 
      });
    }

    // Check if the user is admin or a member
    const isAdmin = conversation.admin && conversation.admin.toString() === userId.toString();
    const isMember = conversation.members.some(member => 
      member.idUser && member.idUser.toString() === userId.toString()
    );

    if (!isAdmin && !isMember) {
      return res.status(403).json({ 
        success: false, 
        message: "You don't have permission to update this group" 
      });
    }

    // Update fields
    let updateMessage = "";
    if (name) {
      conversation.name = name;
      updateMessage = `${req.user.name} đã đổi tên nhóm thành ${name}`;
    }

    if (avatar) {
      conversation.avatar = avatar;
      updateMessage = updateMessage || `${req.user.name} đã đổi ảnh đại diện nhóm`;
    }

    await conversation.save();

    // Create system message about the update
    const systemMessage = new MessageModel({
      idConversation: conversationId,
      content: updateMessage,
      type: 'system',
      systemType: name ? 'change_group_name' : 'change_group_avatar',
      seen: false,
      sender: userId,
    });
    
    const savedMessage = await systemMessage.save();
    
    // Get IO instance
    const io = getIO();
    
    // Emit group_updated event to all members
    if (io) {
      // Emit to all members of the conversation
      conversation.members.forEach(member => {
        if (member.idUser) {
          io.to(member.idUser.toString()).emit('group_updated', {
            conversationId,
            name: conversation.name,
            avatar: conversation.avatar,
            updatedBy: req.user.name,
            systemMessage: {
              _id: savedMessage._id,
              content: updateMessage,
              createdAt: savedMessage.createdAt
            }
          });
        }
      });
    }
    
    // Update last message
    await updateLastMesssage({ 
      idConversation: conversationId, 
      message: savedMessage._id 
    });

    // Get updated conversation with populated members
    const updatedConversation = await ConversationModel.findById(conversationId)
      .populate({
        path: "members.idUser",
        select: "name avatar"
      })
      .populate("admin", "name avatar");

    return res.status(200).json({
      success: true,
      message: "Group information updated successfully",
      conversation: updatedConversation
    });
  } catch (error) {
    console.error("Error updating group info:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to update group information", 
      error: error.message 
    });
  }
};

export const deleteGroup = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;

    if (!conversationId) {
      return res.status(400).json({ 
        success: false, 
        message: "Conversation ID is required" 
      });
    }

    // Find the conversation
    const conversation = await ConversationModel.findById(conversationId)
      .populate("admin", "name avatar")
      .populate({
        path: "members.idUser",
        select: "_id name avatar"
      });

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: "Conversation not found" 
      });
    }

    // Check if it's a group conversation
    if (conversation.type !== "group") {
      return res.status(400).json({ 
        success: false, 
        message: "This operation is only allowed for group conversations" 
      });
    }

    // Check if the user is admin
    const isAdmin = conversation.admin && conversation.admin._id.toString() === userId.toString();

    if (!isAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: "Only the group admin can delete the group" 
      });
    }

    // Store group information for notifications before deletion
    const groupInfo = {
      id: conversation._id,
      name: conversation.name,
      members: conversation.members.map(member => member.idUser._id.toString())
    };

    // Delete all messages in the conversation
    await MessageModel.deleteMany({ idConversation: conversationId });
    
    // Delete the conversation
    await ConversationModel.findByIdAndDelete(conversationId);

    // Get socket.io instance
    const io = getIO();
    
    // Emit group_deleted event to all members in the conversation
    io.to(conversationId).emit('group_deleted', {
      conversationId: conversationId,
      groupName: groupInfo.name,
      deletedBy: req.user.name,
      message: `Nhóm "${groupInfo.name}" đã bị xóa bởi admin`
    });
    
    // Also emit individually to each member to ensure they receive the notification
    // even if they're not currently in the group's socket room
    groupInfo.members.forEach(memberId => {
      io.to(memberId).emit('group_deleted', {
        conversationId: conversationId,
        groupName: groupInfo.name,
        deletedBy: req.user.name,
        message: `Nhóm "${groupInfo.name}" đã bị xóa bởi admin`
      });
    });
    
    console.log(`🗑️ Nhóm ${groupInfo.name} (${conversationId}) đã bị xóa bởi ${req.user.name}`);

    return res.status(200).json({
      success: true,
      message: "Group deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting group:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to delete group", 
      error: error.message 
    });
  }
};

export const setAdmin2 = async (req, res) => {
  try {
    const { conversationId, memberId } = req.body;
    const userId = req.user._id;

    // Validate input
    if (!conversationId || !memberId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }

    // Find the conversation
    const conversation = await ConversationModel.findById(conversationId)
      .populate("admin", "name avatar")
      .populate("admin2", "name avatar")
      .populate({
        path: "members.idUser",
        select: "name avatar"
      });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found"
      });
    }

    // Check if the requester is the admin
    if (!conversation.admin || conversation.admin._id.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Only admin can set admin2"
      });
    }

    // Check if the member exists in the conversation
    const memberToPromote = conversation.members.find(
      member => member.idUser._id.toString() === memberId
    );

    if (!memberToPromote) {
      return res.status(404).json({
        success: false,
        message: "Member not found in conversation"
      });
    }

    // Set the admin2 role
    conversation.admin2 = memberId;
    memberToPromote.role = "admin2";

    // Save the conversation
    await conversation.save();

    // Create system message about the change
    const systemMessage = new MessageModel({
      idConversation: conversationId,
      content: `${req.user.name} đã giao quyền phó nhóm cho ${memberToPromote.idUser.name}`,
      type: 'system',
      systemType: 'set_admin2',
      seen: false,
      sender: userId,
    });
    
    const savedMessage = await systemMessage.save();
    
    // Update last message
    await updateLastMesssage({ 
      idConversation: conversationId, 
      message: savedMessage._id 
    });

    // Get updated conversation with populated fields
    const updatedConversation = await ConversationModel.findById(conversationId)
      .populate("admin", "name avatar")
      .populate("admin2", "name avatar")
      .populate({
        path: "members.idUser",
        select: "name avatar"
      });
    
    // Get socket.io instance
    const io = getIO();
    
    // Emit group_updated event to all members in the conversation
    io.to(conversationId).emit('group_updated', updatedConversation);
    
    // Emit a specific event for the user who was promoted to admin2
    io.to(memberId).emit('admin2_assigned', { 
      conversation: updatedConversation,
      memberId: memberId,
      assignedBy: req.user.name
    });
    
    console.log(`🔔 Thông báo đến người dùng ${memberId}, họ đã được giao quyền phó nhóm trong group ${conversationId}`);

    return res.status(200).json({
      success: true,
      message: "Admin2 set successfully",
      conversation: updatedConversation
    });
  } catch (error) {
    console.error("Error setting admin2:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to set admin2",
      error: error.message
    });
  }
};

export const removeAdmin2 = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;

    if (!conversationId) {
      return res.status(400).json({ 
        success: false, 
        message: "Conversation ID is required" 
      });
    }

    // Find the conversation
    const conversation = await ConversationModel.findById(conversationId)
      .populate("admin", "name avatar")
      .populate("admin2", "name avatar")
      .populate({
        path: "members.idUser",
        select: "name avatar"
      });

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: "Conversation not found" 
      });
    }

    // Check if it's a group conversation
    if (conversation.type !== "group") {
      return res.status(400).json({ 
        success: false, 
        message: "This operation is only allowed for group conversations" 
      });
    }

    // Check if the user is admin
    if (!conversation.admin || conversation.admin._id.toString() !== userId.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: "Only the group admin can remove admin2" 
      });
    }

    // Check if there's an admin2
    if (!conversation.admin2) {
      return res.status(404).json({ 
        success: false, 
        message: "No admin2 found in the group" 
      });
    }

    // Get admin2 ID in string format for comparison
    const admin2Id = conversation.admin2._id ? conversation.admin2._id.toString() : conversation.admin2.toString();

    // Find the admin2 member
    const admin2Member = conversation.members.find(member => 
      member.idUser._id.toString() === admin2Id
    );

    if (!admin2Member) {
      return res.status(404).json({ 
        success: false, 
        message: "No admin2 found in the group" 
      });
    }

    // Store admin2 name before removing role
    const admin2Name = admin2Member.idUser.name;

    // Remove admin2 role
    admin2Member.role = "member";
    conversation.admin2 = null;

    // Save the conversation
    await conversation.save();

    // Create system message about the change
    const systemMessage = new MessageModel({
      idConversation: conversationId,
      content: `${req.user.name} đã gỡ ${admin2Name} khỏi vị trí phó nhóm`,
      type: 'system',
      systemType: 'remove_admin2',
      seen: false,
      sender: userId,
    });
    
    const savedMessage = await systemMessage.save();
    
    // Update last message
    await updateLastMesssage({ 
      idConversation: conversationId, 
      message: savedMessage._id 
    });

    // Get updated conversation with populated fields
    const updatedConversation = await ConversationModel.findById(conversationId)
      .populate("admin", "name avatar")
      .populate("admin2", "name avatar")
      .populate({
        path: "members.idUser",
        select: "name avatar"
      });
    
    // Get socket.io instance
    const io = getIO();
    
    // Emit group_updated event to all members in the conversation
    io.to(conversationId).emit('group_updated', updatedConversation);
    
    // Emit a specific event for the user who was demoted from admin2
    io.to(admin2Id).emit('admin2_removed', { 
      conversation: updatedConversation,
      memberId: admin2Id,
      removedBy: req.user.name
    });
    
    console.log(`🔔 Notifying user ${admin2Id} that their admin2 role was removed in group ${conversationId}`);

    return res.status(200).json({
      success: true,
      message: "Admin2 removed successfully",
      conversation: updatedConversation
    });
  } catch (error) {
    console.error("Error removing admin2:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to remove admin2", 
      error: error.message 
    });
  }
};

export const updateGroupPermissions = async (req, res) => {
  try {
    const { conversationId, permissions } = req.body;
    const userId = req.user._id;

    if (!conversationId || !permissions) {
      return res.status(400).json({ 
        success: false, 
        message: "Conversation ID and permissions are required" 
      });
    }

    // Find the conversation
    const conversation = await ConversationModel.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: "Conversation not found" 
      });
    }

    // Check if it's a group conversation
    if (conversation.type !== "group") {
      return res.status(400).json({ 
        success: false, 
        message: "This operation is only allowed for group conversations" 
      });
    }

    // Check if the user is admin
    const isAdmin = conversation.admin && conversation.admin.toString() === userId.toString();

    if (!isAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: "Only the group admin can update permissions" 
      });
    }

    // Update permissions
    conversation.permissions = {
      ...conversation.permissions,
      ...permissions
    };

    await conversation.save();

    // Create system message about the change
    const systemMessage = new MessageModel({
      idConversation: conversationId,
      content: `${req.user.name} đã cập nhật quyền hạn của nhóm`,
      type: 'system',
      seen: false,
      sender: userId,
    });
    
    const savedMessage = await systemMessage.save();
    
    // Update last message
    await updateLastMesssage({ 
      idConversation: conversationId, 
      message: savedMessage._id 
    });

    // Get updated conversation with populated members
    const updatedConversation = await ConversationModel.findById(conversationId)
      .populate({
        path: "members.idUser",
        select: "name avatar"
      })
      .populate("admin", "name avatar")
      .populate("admin2", "name avatar");

    return res.status(200).json({
      success: true,
      message: "Group permissions updated successfully",
      conversation: updatedConversation
    });
  } catch (error) {
    console.error("Error updating group permissions:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to update group permissions", 
      error: error.message 
    });
  }
};

export const uploadFile = async (req, res) => {
  try {
    // Xử lý tệp tải lên
    if (!req.file) {
      return res.status(400).json({ error: "Không có file nào được tải lên" });
    }

    // Lấy thông tin từ form data
    const { idConversation, sender, content, type } = req.body;
    const socketId = req.body.socketId; // Lấy socketId nếu có
    
    console.log('📁 File đã được tải lên:', {
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size,
      mimetype: req.file.mimetype,
      idConversation,
      sender,
      type
    });

    // Phát hiện loại file
    let detectedType = type || 'file';
    if (!type) {
      if (req.file.mimetype.startsWith('image/')) {
        detectedType = 'image';
      } else if (req.file.mimetype.startsWith('video/')) {
        detectedType = 'video';
        console.log('🎬 Phát hiện file là video, xử lý đặc biệt');
      } else if (req.file.mimetype.startsWith('audio/')) {
        detectedType = 'audio';
      } else if (req.file.mimetype.includes('pdf')) {
        detectedType = 'pdf';
      } else if (req.file.mimetype.includes('word') || 
                req.file.mimetype.includes('document') || 
                req.file.originalname.endsWith('.doc') || 
                req.file.originalname.endsWith('.docx')) {
        detectedType = 'doc';
      } else if (req.file.mimetype.includes('excel') || 
                req.file.mimetype.includes('sheet') || 
                req.file.originalname.endsWith('.xls') || 
                req.file.originalname.endsWith('.xlsx')) {
        detectedType = 'excel';
      } else if (req.file.mimetype.includes('presentation') || 
                req.file.originalname.endsWith('.ppt') || 
                req.file.originalname.endsWith('.pptx')) {
        detectedType = 'presentation';
      }
    }

    // Upload file lên Cloudinary thay vì dùng local storage
    console.log('☁️ Đang tải lên Cloudinary...');
    const folderName = detectedType === 'image' ? 'zalo_images' : 
                      detectedType === 'video' ? 'zalo_videos' : 
                      detectedType === 'audio' ? 'zalo_audio' : 'zalo_files';
    
    const cloudinaryResult = await uploadToCloudinary(req.file.path, folderName);
    console.log('✅ Tải lên Cloudinary thành công:', cloudinaryResult);
    
    // Lấy URL từ Cloudinary thay vì tạo local URL
    const fileUrl = cloudinaryResult.secure_url;
    console.log(`📋 URL file từ Cloudinary: ${fileUrl}, loại file: ${detectedType}`);
    
    // Xóa file tạm sau khi đã upload lên Cloudinary
    fs.unlinkSync(req.file.path);
    console.log('🗑️ Đã xóa file tạm thời:', req.file.path);
    
    // Tạo và lưu tin nhắn mới với file
    const newMessage = new MessageModel({
      idConversation,
      content: content || `Tệp: ${req.file.originalname}`,
      type: detectedType,
      seen: false,
      sender,
      fileUrl: fileUrl,
      fileName: req.file.originalname,
      fileType: req.file.mimetype
    });

    console.log('📝 Lưu tin nhắn mới với dữ liệu:', {
      idConversation,
      content: content || `Tệp: ${req.file.originalname}`,
      type: detectedType,
      fileUrl,
      fileName: req.file.originalname
    });

    const savedMessage = await newMessage.save();
    console.log(`✅ Đã lưu tin nhắn với ID: ${savedMessage._id}`);
    
    // Cập nhật tin nhắn cuối cùng cho cuộc trò chuyện
    await updateLastMesssage({
      idConversation,
      message: savedMessage._id
    });
    console.log(`✅ Đã cập nhật tin nhắn cuối cùng cho cuộc trò chuyện ${idConversation}`);

    // Sử dụng Socket.io để thông báo tin nhắn mới
    const { emitNewMessage, getIO } = await import('../config/Socket.js');
    
    // Sử dụng emitNewMessage để gửi tin nhắn mới
    if (emitNewMessage) {
      const messageEmitted = await emitNewMessage(savedMessage, socketId);
      console.log(`📣 Tin nhắn file đã được phát sóng: ${messageEmitted ? 'thành công' : 'thất bại'}`);
    }
    
    // Cập nhật danh sách cuộc trò chuyện cho tất cả thành viên
    try {
      const io = getIO();
      if (io) {
        // Lấy thông tin cuộc trò chuyện đã cập nhật
        const conversation = await ConversationModel.findById(idConversation)
          .populate({
            path: "members.idUser",
            select: { name: 1, avatar: 1 }
          })
          .populate("lastMessage");
          
        if (conversation && conversation.members) {
          console.log(`📣 Cập nhật danh sách cuộc trò chuyện sau khi tải lên file cho ${conversation.members.length} thành viên`);
          
          // Emit update_conversation_list cho từng thành viên
          conversation.members.forEach(member => {
            if (member.idUser && member.idUser._id) {
              console.log(`👤 Gửi cập nhật danh sách cuộc trò chuyện cho user: ${member.idUser._id.toString()}`);
              io.to(member.idUser._id.toString()).emit("update_conversation_list", {
                conversation: conversation,
                newMessage: savedMessage
              });
            }
          });
        }
      }
    } catch (socketError) {
      console.error("Lỗi khi gửi cập nhật qua socket:", socketError);
      // Vẫn tiếp tục xử lý phản hồi HTTP dù có lỗi socket
    }

    // Trả về phản hồi thành công với đầy đủ thông tin
    console.log('📤 Gửi phản hồi về client với đầy đủ thông tin của tin nhắn');
    return res.status(200).json({
      ...savedMessage.toObject(),
      _id: savedMessage._id.toString(),
      fileUrl: fileUrl,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      type: detectedType
    });
  } catch (error) {
    console.error("Error uploading file:", error);
    return res.status(500).json({ error: "Lỗi khi tải file lên server" });
  }
};

// Pin a message in a group chat
export const pinMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    
    // Find the message
    const message = await MessageModel.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found"
      });
    }
    
    // Find the conversation to check permissions
    const conversation = await ConversationModel.findById(message.idConversation);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found"
      });
    }
    
    // Check if it's a group conversation
    if (conversation.type !== "group") {
      return res.status(400).json({
        success: false,
        message: "Pinning messages is only available in group chats"
      });
    }
    
    // Check if user is a member of the group
    const isMember = conversation.members.some(
      member => member.idUser.toString() === req.user._id.toString()
    );
    
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this group"
      });
    }
    
    // Check permissions (only admin, admin2, or based on group permissions)
    const isAdmin = conversation.admin.toString() === req.user._id.toString();
    const isAdmin2 = conversation.admin2 && conversation.admin2.toString() === req.user._id.toString();
    const canPinMessages = conversation.permissions?.pinMessages || false;
    
    if (!isAdmin && !isAdmin2 && !canPinMessages) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to pin messages in this group"
      });
    }
    
    // Update the message
    message.isPinned = true;
    message.pinnedBy = req.user._id;
    message.pinnedAt = new Date();
    await message.save();
    
    // Create a system message about the pinned message
    const systemMessage = new MessageModel({
      idConversation: message.idConversation,
      sender: req.user._id,
      content: `${req.user.name} đã ghim một tin nhắn`,
      type: "system",
      systemType: "pin_message",
      referencedMessage: message._id,
      seen: false
    });
    
    await systemMessage.save();
    
    // Update last message
    await updateLastMesssage({
      idConversation: message.idConversation,
      message: systemMessage._id
    });
    
    // Get the populated message to return
    const populatedMessage = await MessageModel.findById(message._id)
      .populate("sender", "name avatar")
      .populate("pinnedBy", "name avatar");
    
    // Emit socket event for real-time updates
    const io = getIO();
    if (io) {
      io.to(message.idConversation.toString()).emit("message_pinned", {
        message: populatedMessage,
        systemMessage,
        conversation: conversation._id
      });
    }
    
    return res.status(200).json({
      success: true,
      message: "Message pinned successfully",
      pinnedMessage: populatedMessage,
      systemMessage
    });
    
  } catch (error) {
    console.error("Error pinning message:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

// Unpin a message in a group chat
export const unpinMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    
    // Find the message
    const message = await MessageModel.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found"
      });
    }
    
    // Check if the message is pinned
    if (!message.isPinned) {
      return res.status(400).json({
        success: false,
        message: "This message is not pinned"
      });
    }
    
    // Find the conversation to check permissions
    const conversation = await ConversationModel.findById(message.idConversation);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found"
      });
    }
    
    // Check if user is a member of the group
    const isMember = conversation.members.some(
      member => member.idUser.toString() === req.user._id.toString()
    );
    
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this group"
      });
    }
    
    // Check permissions (admin, admin2, the user who pinned it, or based on group permissions)
    const isAdmin = conversation.admin.toString() === req.user._id.toString();
    const isAdmin2 = conversation.admin2 && conversation.admin2.toString() === req.user._id.toString();
    const isPinner = message.pinnedBy && message.pinnedBy.toString() === req.user._id.toString();
    const canPinMessages = conversation.permissions?.pinMessages || false;
    
    if (!isAdmin && !isAdmin2 && !isPinner && !canPinMessages) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to unpin this message"
      });
    }
    
    // Update the message
    message.isPinned = false;
    message.pinnedBy = null;
    message.pinnedAt = null;
    await message.save();
    
    // Create a system message about the unpinned message
    const systemMessage = new MessageModel({
      idConversation: message.idConversation,
      sender: req.user._id,
      content: `${req.user.name} đã bỏ ghim một tin nhắn`,
      type: "system",
      systemType: "unpin_message",
      referencedMessage: message._id,
      seen: false
    });
    
    await systemMessage.save();
    
    // Update last message
    await updateLastMesssage({
      idConversation: message.idConversation,
      message: systemMessage._id
    });
    
    // Emit socket event for real-time updates
    const io = getIO();
    if (io) {
      io.to(message.idConversation.toString()).emit("message_unpinned", {
        messageId: message._id,
        systemMessage,
        conversation: conversation._id
      });
    }
    
    return res.status(200).json({
      success: true,
      message: "Message unpinned successfully",
      messageId: message._id,
      systemMessage
    });
    
  } catch (error) {
    console.error("Error unpinning message:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

// Get all pinned messages in a conversation
export const getPinnedMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    // Find the conversation
    const conversation = await ConversationModel.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found"
      });
    }
    
    // Check if user is a member of the conversation
    const isMember = conversation.members.some(
      member => member.idUser.toString() === req.user._id.toString()
    );
    
    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this conversation"
      });
    }
    
    // Get all pinned messages in the conversation
    const pinnedMessages = await MessageModel.find({
      idConversation: conversationId,
      isPinned: true
    }).populate("sender", "name avatar")
      .populate("pinnedBy", "name avatar")
      .sort({ pinnedAt: -1 });
    
    return res.status(200).json({
      success: true,
      pinnedMessages
    });
    
  } catch (error) {
    console.error("Error getting pinned messages:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

// Function for admin2 to remove member (with specific restrictions)
export const removeMemberByAdmin2 = async (req, res) => {
  try {
    const { conversationId, memberId } = req.params;
    const userId = req.user._id;

    if (!conversationId || !memberId) {
      return res.status(400).json({ 
        success: false, 
        message: "Conversation ID and member ID are required" 
      });
    }

    // Find the conversation and populate necessary fields
    const conversation = await ConversationModel.findById(conversationId)
      .populate({
        path: "members.idUser",
        select: "name avatar"
      })
      .populate("admin", "name")
      .populate("admin2", "name");

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: "Conversation not found" 
      });
    }

    // Check if it's a group conversation
    if (conversation.type !== "group") {
      return res.status(400).json({ 
        success: false, 
        message: "This operation is only allowed for group conversations" 
      });
    }

    // Make sure the user is admin2
    const isAdmin2 = conversation.admin2 && 
                    conversation.admin2._id && 
                    conversation.admin2._id.toString() === userId.toString();
    
    if (!isAdmin2) {
      return res.status(403).json({ 
        success: false, 
        message: "Only admin2 can use this endpoint" 
      });
    }
    
    // Check if the member being removed is admin or admin2
    const isRemovingAdmin = conversation.admin && 
                          conversation.admin._id && 
                          conversation.admin._id.toString() === memberId;
    
    const isRemovingAdmin2 = conversation.admin2 && 
                           conversation.admin2._id && 
                           conversation.admin2._id.toString() === memberId;

    // Admin2 cannot remove admin or other admin2
    if (isRemovingAdmin || isRemovingAdmin2) {
      return res.status(403).json({ 
        success: false, 
        message: "Admin2 cannot remove admin or other admin2" 
      });
    }

    // Find the member to be removed
    const memberToRemove = conversation.members.find(member => 
      member.idUser && 
      member.idUser._id && 
      member.idUser._id.toString() === memberId
    );

    if (!memberToRemove) {
      return res.status(404).json({ 
        success: false, 
        message: "Member not found in the group" 
      });
    }

    // Store member info before removing
    const removedMemberName = memberToRemove.idUser.name;

    // Remove the member
    conversation.members = conversation.members.filter(member => 
      member.idUser &&
      member.idUser._id &&
      member.idUser._id.toString() !== memberId
    );

    await conversation.save();

    // Create system message about member removal
    const systemMessage = new MessageModel({
      idConversation: conversationId,
      content: `${req.user.name} đã xóa ${removedMemberName} khỏi nhóm`,
      type: 'system',
      systemType: 'remove_member',
      seen: false,
      sender: userId,
    });
    
    const savedMessage = await systemMessage.save();
    
    // Update last message
    await updateLastMesssage({ 
      idConversation: conversationId, 
      message: savedMessage._id 
    });

    // Get updated conversation with populated fields
    const updatedConversation = await ConversationModel.findById(conversationId)
      .populate({
        path: "members.idUser",
        select: "name avatar"
      })
      .populate("admin", "name avatar")
      .populate("admin2", "name avatar");

    // Get socket.io instance
    const io = getIO();
    
    if (io) {
      // Emit to all remaining members about the update with fully populated data
      io.to(conversationId).emit('group_updated', {
        _id: updatedConversation._id,
        name: updatedConversation.name, 
        type: updatedConversation.type,
        avatar: updatedConversation.avatar,
        members: updatedConversation.members,
        admin: updatedConversation.admin,
        admin2: updatedConversation.admin2,
        lastMessage: updatedConversation.lastMessage
      });

      // Emit to the removed member
      io.to(memberId).emit('removed_from_group', {
        conversationId: conversationId,
        groupName: conversation.name,
        removedBy: req.user.name,
        message: `Bạn đã bị ${req.user.name} xóa khỏi nhóm "${conversation.name}"`
      });

      // Remove the conversation from removed member's list
      io.to(memberId).emit('conversation_deleted', {
        conversationId: conversationId
      });
    }

    return res.status(200).json({
      success: true,
      message: "Member removed from group successfully",
      conversation: updatedConversation
    });
  } catch (error) {
    console.error("Error removing member from group by admin2:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to remove member from group", 
      error: error.message 
    });
  }
};

export default {
  getConversations: getAllConversationByUser,
  createConversation,
  getMessages: getAllMessageByConversation,
  sendMessage: saveMessage,
  markAsSeen: seenMessage,
  createGroupConversation,
  addMemberToGroup,
  removeMemberFromGroup,
  removeMemberByAdmin2,
  leaveGroup,
  deleteGroup,
  updateGroupInfo,
  revokeMessage,
  deleteMessage,
  forwardMessage,
  pinMessage,
  unpinMessage,
  getPinnedMessages
};

// Get images and videos shared in a conversation
export const getConversationMedia = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;

    // Check if the user is a member of the conversation
    const conversation = await ConversationModel.findOne({
      _id: conversationId,
      "members.idUser": userId
    });

    if (!conversation) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this conversation"
      });
    }

    // Get all image and video messages from the conversation
    const mediaMessages = await MessageModel.find({
      idConversation: conversationId,
      type: { $in: ['image', 'video'] },
      deletedBy: { $ne: userId }, // Do not include messages deleted by the current user
      isRevoked: { $ne: true }    // Do not include revoked messages
    })
    .populate("sender", "name avatar")
    .sort({ createdAt: -1 }) // Most recent first
    .lean();

    return res.status(200).json({
      success: true,
      media: mediaMessages
    });
  } catch (error) {
    console.error("Error fetching conversation media:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch media",
      error: error.message
    });
  }
};

// Get files (documents, etc.) shared in a conversation
export const getConversationFiles = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;

    // Check if the user is a member of the conversation
    const conversation = await ConversationModel.findOne({
      _id: conversationId,
      "members.idUser": userId
    });

    if (!conversation) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this conversation"
      });
    }

    // Get all file messages from the conversation (excluding images and videos)
    const fileMessages = await MessageModel.find({
      idConversation: conversationId,
      type: { $in: ['file', 'doc', 'pdf', 'excel', 'presentation', 'audio'] },
      deletedBy: { $ne: userId }, // Do not include messages deleted by the current user
      isRevoked: { $ne: true }    // Do not include revoked messages
    })
    .populate("sender", "name avatar")
    .sort({ createdAt: -1 }) // Most recent first
    .lean();

    return res.status(200).json({
      success: true,
      files: fileMessages
    });
  } catch (error) {
    console.error("Error fetching conversation files:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch files",
      error: error.message
    });
  }
};

// Get links shared in a conversation
export const getConversationLinks = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;

    // Check if the user is a member of the conversation
    const conversation = await ConversationModel.findOne({
      _id: conversationId,
      "members.idUser": userId
    });

    if (!conversation) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this conversation"
      });
    }

    // Find messages that contain links
    // This can be done in two ways:
    // 1. Look for 'link' type messages
    // 2. Use a regex to find URLs in regular text messages
    
    const linkTypeMessages = await MessageModel.find({
      idConversation: conversationId,
      type: 'link',
      deletedBy: { $ne: userId }, // Do not include messages deleted by the current user
      isRevoked: { $ne: true }    // Do not include revoked messages
    }).populate("sender", "name avatar").lean();
    
    // Find text messages that contain URLs using regex
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const textMessages = await MessageModel.find({
      idConversation: conversationId,
      type: 'text',
      content: { $regex: urlRegex },
      deletedBy: { $ne: userId },
      isRevoked: { $ne: true }
    }).populate("sender", "name avatar").lean();
    
    // Process text messages to extract links and add linkUrl property
    const textMessagesWithLinks = textMessages.map(message => {
      const matches = message.content.match(urlRegex);
      if (matches && matches.length > 0) {
        // Use the first URL found as the linkUrl
        return {
          ...message,
          linkUrl: matches[0],
          linkTitle: message.content
        };
      }
      return message;
    });
    
    // Combine both types of messages and sort by createdAt
    const allLinks = [...linkTypeMessages, ...textMessagesWithLinks]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json({
      success: true,
      links: allLinks
    });
  } catch (error) {
    console.error("Error fetching conversation links:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch links",
      error: error.message
    });
  }
};
