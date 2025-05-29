import { Server } from "socket.io";
import {
  createConversation,
  joinConversation,
  saveMessage,
  seenMessage,
  updateLastMesssage,
} from "../controllers/chatController.js";
import {
  acceptFriend,
  addFriend,
  deleteRequestFriend,
  DontAcceptFriend,
  unFriend,
} from "../controllers/userController.js";
import { MessageModel } from "../models/MessageModel.js";
import { ConversationModel } from "../models/ConversationModel.js";

// Biến để lưu trữ io instance để có thể sử dụng từ các module khác
let ioInstance = null;

export const ConnectSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: ["http://localhost:3000", "http://localhost", "http://localhost:8081", "*"],
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      allowedHeaders: ["my-custom-header", "Content-Type", "Authorization"],
      credentials: true,
    },
  });
  
  // Lưu io instance để có thể sử dụng từ bên ngoài
  ioInstance = io;

  io.on("connection", (socket) => {
    console.log(`${socket.id} connected`);

    // Map để lưu trạng thái online của người dùng
    const userStatusMap = new Map();

    socket.on("join_room", (User) => {
      console.log("join-room");
      socket.join(User._id);
      
      // Cập nhật trạng thái online và thông báo cho danh bạ
      if (User._id) {
        // Kiểm tra nếu người dùng đã online rồi thì không gửi lại sự kiện
        const wasAlreadyOnline = userStatusMap.get(User._id) === true;
        
        // Cập nhật trạng thái, nhưng chỉ gửi thông báo nếu chuyển từ offline sang online
        userStatusMap.set(User._id, true);
        
        if (!wasAlreadyOnline) {
          console.log(`Emitting user_online for ${User._id}`);
          socket.broadcast.emit("user_online", User._id);
        }
      }
    });

    socket.on("leave_room", (User) => {
      console.log("leave-room");
      socket.leave(User._id);
      
      // Cập nhật trạng thái offline và thông báo
      if (User._id) {
        userStatusMap.set(User._id, false);
        socket.broadcast.emit("user_offline", User._id);
      }
    });

    // Xử lý trạng thái người dùng
    socket.on("user_status", (data) => {
      if (data.userId) {
        const isOnline = data.status === "online";
        // Kiểm tra nếu trạng thái không thay đổi thì không gửi thông báo
        const currentStatus = userStatusMap.get(data.userId);
        const statusChanged = currentStatus !== isOnline;
        
        // Cập nhật trạng thái
        userStatusMap.set(data.userId, isOnline);
        
        // Chỉ thông báo khi trạng thái thực sự thay đổi
        if (statusChanged) {
          console.log(`Status changed for ${data.userId}: ${isOnline ? 'online' : 'offline'}`);
          socket.broadcast.emit(isOnline ? "user_online" : "user_offline", data.userId);
        }
      }
    });

    // Xử lý xác nhận tin nhắn đã được gửi đến thiết bị
    socket.on("message_delivered", async (data) => {
      try {
        const { messageId, conversationId } = data;
        if (!messageId || !conversationId) return;
        
        // Cập nhật trạng thái tin nhắn trong DB nếu cần
        // await MessageModel.findByIdAndUpdate(messageId, { delivered: true });
        
        // Gửi xác nhận đến tất cả thành viên trong cuộc trò chuyện
        io.to(conversationId).emit("message_delivered", { 
          messageId, 
          conversationId,
          deliveredAt: new Date()
        });
      } catch (error) {
        console.error("Error in message_delivered event:", error);
      }
    });

    // Xử lý thông báo người dùng đang xem tin nhắn
    socket.on("viewing_messages", (data) => {
      try {
        const { conversationId } = data;
        if (!conversationId) return;
        
        // Lấy ID người dùng từ request hoặc socket
        const userId = socket.userId || data.userId;
        if (!userId) return;
        
        // Thông báo cho tất cả thành viên trong cuộc trò chuyện
        socket.to(conversationId).emit("user_viewing_messages", {
          userId,
          conversationId,
          timestamp: new Date()
        });
      } catch (error) {
        console.error("Error in viewing_messages event:", error);
      }
    });

    socket.on("stop_viewing_messages", (data) => {
      try {
        const { conversationId } = data;
        if (!conversationId) return;
        
        const userId = socket.userId || data.userId;
        if (!userId) return;
        
        socket.to(conversationId).emit("user_stop_viewing_messages", {
          userId,
          conversationId,
          timestamp: new Date()
        });
      } catch (error) {
        console.error("Error in stop_viewing_messages event:", error);
      }
    });

    // Xử lý đồng bộ hóa tin nhắn sau khi mất kết nối
    socket.on("sync_messages", async (data) => {
      try {
        const { conversationId, lastMessageTimestamp } = data;
        if (!conversationId) return;
        
        // Tìm tất cả tin nhắn từ thời điểm lastMessageTimestamp
        const query = { idConversation: conversationId };
        
        if (lastMessageTimestamp) {
          query.createdAt = { $gt: new Date(lastMessageTimestamp) };
        }
        
        // Tìm các tin nhắn mới
        const messages = await MessageModel.find(query)
          .sort({ createdAt: 1 })
          .populate("sender", "name avatar _id")
          .lean();
        
        // Gửi kết quả về cho client yêu cầu
        socket.emit("sync_messages_result", {
          conversationId,
          messages,
          count: messages.length,
          timestamp: new Date()
        });
      } catch (error) {
        console.error("Error in sync_messages event:", error);
        socket.emit("message_error", {
          type: "sync_error",
          message: "Không thể đồng bộ tin nhắn",
          details: error.message
        });
      }
    });

    // Đăng ký thiết bị cho đồng bộ đa thiết bị
    socket.on("register_device", (deviceInfo) => {
      try {
        const { userId, deviceId, deviceType } = deviceInfo;
        if (!userId || !deviceId) return;
        
        // Lưu thông tin thiết bị vào user session hoặc DB
        console.log(`📱 Đăng ký thiết bị: ${deviceId} (${deviceType}) cho user ${userId}`);
        
        // Có thể lưu vào db hoặc memory store ở đây
        
        // Thông báo đăng ký thành công
        socket.emit("device_registered", {
          success: true,
          deviceId,
          timestamp: new Date()
        });
      } catch (error) {
        console.error("Error in register_device event:", error);
      }
    });

    // Đồng bộ trạng thái tin nhắn giữa các thiết bị
    socket.on("sync_message_status", (data) => {
      try {
        const { messageIds, status, userId } = data;
        if (!Array.isArray(messageIds) || !status || !userId) return;
        
        // Thông báo cho tất cả thiết bị của người dùng này
        socket.to(userId).emit("device_sync", {
          type: "message_status",
          messageIds,
          status,
          timestamp: new Date()
        });
      } catch (error) {
        console.error("Error in sync_message_status event:", error);
      }
    });

    socket.on("add_friend", async (data) => {
      const { userFrom, userTo } = data;
      await addFriend(userFrom, userTo);

      io.emit("add_friend_success");
      io.to(userTo).emit("new_request_friend", userTo);
    });

    socket.on("delete_request_friend", async (data) => {
      const { userFrom, userTo } = data;
      await deleteRequestFriend(userFrom, userTo);
      io.emit("delete_request_friend_success");
    });

    // Handle avatar updates
    socket.on("avatar_updated", (data) => {
      try {
        const { userId, avatarUrl } = data;
        if (!userId || !avatarUrl) {
          console.log("Invalid avatar update data:", data);
          return;
        }
        
        console.log(`🖼️ Broadcasting avatar update for user ${userId}`);
        
        // Broadcast to all connected clients except the sender
        socket.broadcast.emit("avatar_updated", {
          userId,
          avatarUrl,
          timestamp: new Date()
        });
      } catch (error) {
        console.error("Error handling avatar update:", error);
      }
    });

    socket.on("accept_request_friend", async (data) => {
      const { userFrom, userTo } = data;
      await acceptFriend(userFrom, userTo);

      io.emit("accept_request_friend_success", userFrom);
      io.to(userTo).emit("accept_request_friend", userTo);
    });

    socket.on("dont_accept_request_friend", async (data) => {
      const { userFrom, userTo } = data;
      await DontAcceptFriend(userFrom, userTo);

      io.emit("dont_accept_request_friend_success", userFrom);
      io.to(userTo).emit("dont_accept_request_friend", userTo);
    });

    socket.on("un_friend", async (data) => {
      const { userFrom, userTo, idConversation } = data;
      await unFriend(userFrom, userTo, idConversation);

      io.emit("un_friend_success", userFrom);
      io.to(userTo).emit("un_friend", userTo);
    });

    socket.on("join_conversation", (idConversation) => {
      socket.join(idConversation);
    });

    socket.on("join_all_conversation", (array) => {
      socket.join(array);
    });

    socket.on("seen_message", async (idConversation) => {
      await seenMessage(idConversation);
      io.to(idConversation).emit("seen_message");
    });

    socket.on("send_message", async (data) => {
      try {
        const newMessage = await saveMessage(data);
        
        // Kiểm tra nếu tin nhắn không được lưu thành công
        if (!newMessage) {
          console.error("Failed to save message");
          socket.emit("message_error", {
            error: "Không thể lưu tin nhắn",
            type: "save_error",
            timestamp: new Date()
          });
          return;
        }
        
        try {
          await updateLastMesssage({
            idConversation: newMessage.idConversation,
            message: newMessage._id,
          });
        } catch (updateError) {
          console.error("Error updating last message:", updateError);
          // Tiếp tục xử lý vì tin nhắn đã được lưu thành công
        }

        // Chỉ gửi dữ liệu cần thiết của tin nhắn để giảm tải mạng
        const messageData = {
          _id: newMessage._id,
          content: newMessage.content,
          type: newMessage.type,
          sender: newMessage.sender,
          idConversation: newMessage.idConversation,
          fileUrl: newMessage.fileUrl,
          fileName: newMessage.fileName, 
          fileType: newMessage.fileType,
          createdAt: newMessage.createdAt,
          seen: newMessage.seen,
          isRevoked: newMessage.isRevoked
        };

        // Emitting to conversation room only
        io.to(newMessage.idConversation.toString()).emit(
          "new_message",
          messageData
        );
        
        console.log(`📨 Tin nhắn mới đã được gửi - ID: ${newMessage._id}`);
        
        // Lấy thông tin tối thiểu cần thiết cho cập nhật danh sách cuộc trò chuyện
        const conversation = await ConversationModel.findById(newMessage.idConversation)
          .select('_id name type avatar members lastMessage updatedAt')
          .populate({
            path: "members.idUser",
            select: "name avatar _id"
          });
          
        if (conversation && conversation.members) {
          // Tạo đối tượng dữ liệu tối giản để cập nhật danh sách cuộc trò chuyện
          const conversationUpdate = {
            _id: conversation._id,
            name: conversation.name,
            type: conversation.type,
            avatar: conversation.avatar,
            lastMessage: messageData,
            updatedAt: new Date()
          };
          
          // Emit cập nhật riêng cho từng thành viên
          conversation.members.forEach(member => {
            if (member.idUser && member.idUser._id) {
              // Đếm nhanh tin nhắn chưa đọc nếu không phải người gửi
              let unreadCount = 0;
              if (member.idUser._id.toString() !== newMessage.sender.toString()) {
                unreadCount = 1; // Tạm thời chỉ cần biết có tin nhắn chưa đọc, client sẽ cập nhật số chính xác sau
              }
              
              // Thêm unreadCount vào dữ liệu cập nhật
              const memberUpdate = {
                ...conversationUpdate,
                unreadCount
              };
              
              io.to(member.idUser._id.toString()).emit("update_conversation_list", {
                conversation: memberUpdate
              });
            }
          });
        }
      } catch (error) {
        console.error("Error handling send_message:", error);
      }
    });

    socket.on("revoke_message", async (data) => {
      try {
        const { messageId, conversationId, userId } = data;
        
        // Kiểm tra dữ liệu đầu vào
        if (!messageId || !conversationId || !userId) {
          socket.emit("revoke_message_error", {
            error: "Thiếu thông tin cần thiết",
            code: "MISSING_DATA"
          });
          return;
        }
        
        // Tìm tin nhắn
        const message = await MessageModel.findById(messageId);
        
        if (!message) {
          socket.emit("revoke_message_error", {
            error: "Không tìm thấy tin nhắn",
            code: "MESSAGE_NOT_FOUND"
          });
          return;
        }
        
        // Kiểm tra người thu hồi tin nhắn có phải là người gửi không
        if (message.sender.toString() !== userId) {
          socket.emit("revoke_message_error", {
            error: "Bạn chỉ có thể thu hồi tin nhắn của chính mình",
            code: "UNAUTHORIZED"
          });
          return;
        }
        
        // Kiểm tra thời gian - chỉ cho phép thu hồi tin nhắn trong vòng 24 giờ
        const messageTime = new Date(message.createdAt).getTime();
        const currentTime = new Date().getTime();
        const timeDiff = currentTime - messageTime;
        const hoursDiff = timeDiff / (1000 * 60 * 60);
        
        if (hoursDiff > 24) {
          socket.emit("revoke_message_error", {
            error: "Chỉ có thể thu hồi tin nhắn trong vòng 24 giờ",
            code: "TIME_LIMIT_EXCEEDED"
          });
          return;
        }
        
        // Lưu thông tin loại tin nhắn trước khi cập nhật
        const messageType = message.type || 'text';
        const hasFile = !!message.fileUrl;
        console.log(`📝 Thu hồi tin nhắn ID ${messageId}, loại: ${messageType}, có file: ${hasFile}`);
        
        // Cập nhật tình trạng thu hồi tin nhắn
        message.isRevoked = true;
        message.revokedAt = new Date();
        await message.save();
        
        // Thông báo cho tất cả người dùng trong cuộc trò chuyện
        io.to(conversationId).emit("message_revoked", {
          messageId,
          conversationId,
          type: messageType, // Gửi đúng loại tin nhắn cho client
          hasFile: hasFile, // Thêm thông tin có phải là file hay không
          revokedAt: message.revokedAt,
          revokedBy: userId
        });
        
        // Gửi xác nhận thành công cho người thu hồi
        socket.emit("revoke_message_success", {
          messageId,
          conversationId
        });
        
      } catch (error) {
        console.error("Error revoking message via socket:", error);
        socket.emit("revoke_message_error", {
          error: "Không thể thu hồi tin nhắn",
          details: error.message,
          code: "SERVER_ERROR"
        });
      }
    });
    
    socket.on("delete_message", async (data) => {
      try {
        const { messageId, conversationId, userId } = data;
        
        // Tìm tin nhắn
        const message = await MessageModel.findById(messageId);
        
        if (!message) {
          socket.emit("delete_message_error", { error: "Không tìm thấy tin nhắn" });
          return;
        }
        
        // Không cần kiểm tra người xóa có phải người gửi không
        // Kiểm tra xem người dùng đã xóa tin nhắn này chưa
        if (message.deletedBy && message.deletedBy.some(id => id.toString() === userId)) {
          socket.emit("delete_message_error", { error: "Tin nhắn đã được bạn xóa trước đó" });
          return;
        }
        
        // Thêm userId vào mảng deletedBy
        if (!message.deletedBy) {
          message.deletedBy = [];
        }
        
        message.deletedBy.push(userId);
        await message.save();
        
        // Chỉ gửi thông báo cho người dùng đang thực hiện thao tác
        // không phát sóng cho tất cả mọi người trong cuộc trò chuyện
        socket.emit("message_deleted", { messageId, conversationId, forUser: userId });
      } catch (error) {
        console.error("Error deleting message via socket:", error);
        socket.emit("delete_message_error", { error: "Không thể xóa tin nhắn" });
      }
    });

    socket.on("create_conversation", async (data) => {
      try {
        const { userFrom, userTo } = data;
        
        if (!userFrom || !userTo) {
          socket.emit("conversation_error", {
            message: "Thiếu thông tin người dùng",
            code: "MISSING_USER_INFO"
          });
          return;
        }
        
        const newConversation = await createConversation(userFrom, userTo);
        
        if (!newConversation) {
          socket.emit("conversation_error", {
            message: "Không thể tạo cuộc trò chuyện",
            code: "CREATION_FAILED"
          });
          return;
        }
        
        io.to(userFrom).to(userTo).emit("new_conversation", newConversation);
        
        // Thông báo cập nhật danh sách cuộc trò chuyện
        io.to(userFrom).emit("update_conversation_list", {
          conversation: newConversation,
          isNew: true
        });
        
        io.to(userTo).emit("update_conversation_list", {
          conversation: newConversation,
          isNew: true
        });
        
      } catch (error) {
        console.error("Error creating conversation:", error);
        socket.emit("conversation_error", {
          message: "Không thể tạo cuộc trò chuyện",
          error: error.message,
          code: "SERVER_ERROR"
        });
      }
    });

    socket.on("leave_conversation", (idConversation) => {
      socket.leave(idConversation);
      io.to(idConversation).emit("user_left", socket.id);
    });

    socket.on("typing", (data) => {
      const { idConversation, userId } = data;
      socket.to(idConversation).emit("user_typing", userId);
    });

    socket.on("stop_typing", (data) => {
      const { idConversation, userId } = data;
      socket.to(idConversation).emit("user_stop_typing", userId);
    });

    // Xử lý thêm cảm xúc vào tin nhắn
    socket.on("add_reaction", async (data) => {
      try {
        const { messageId, conversationId, userId, emoji } = data;
        
        // Tìm tin nhắn
        const message = await MessageModel.findById(messageId);
        
        if (!message) {
          socket.emit("reaction_error", { error: "Không tìm thấy tin nhắn" });
          return;
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
        
        // Gửi thông báo cho tất cả người dùng trong cuộc trò chuyện
        io.to(conversationId).emit("message_reaction", { 
          messageId, 
          emoji,
          userId,
          action: 'add'
        });
      } catch (error) {
        console.error("Error adding reaction:", error);
        socket.emit("reaction_error", { error: "Không thể thêm cảm xúc" });
      }
    });
    
    // Xử lý xóa cảm xúc khỏi tin nhắn
    socket.on("remove_reaction", async (data) => {
      try {
        const { messageId, conversationId, userId, emoji } = data;
        
        // Tìm tin nhắn
        const message = await MessageModel.findById(messageId);
        
        if (!message) {
          socket.emit("reaction_error", { error: "Không tìm thấy tin nhắn" });
          return;
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
        
        // Gửi thông báo cho tất cả người dùng trong cuộc trò chuyện
        io.to(conversationId).emit("message_reaction", { 
          messageId, 
          emoji,
          userId,
          action: 'remove'
        });
      } catch (error) {
        console.error("Error removing reaction:", error);
        socket.emit("reaction_error", { error: "Không thể xóa cảm xúc" });
      }
    });

    // Xử lý chuyển tiếp tin nhắn
    socket.on("forward_message", async (data) => {
      try {
        const { messageId, conversationId, userId } = data;
        
        if (!messageId || !conversationId || !userId) {
          socket.emit("forward_message_error", { error: "Thiếu thông tin cần thiết" });
          return;
        }
        
        // Tìm tin nhắn gốc
        const originalMessage = await MessageModel.findById(messageId)
          .populate('sender', 'name avatar');
        
        if (!originalMessage) {
          socket.emit("forward_message_error", { error: "Không tìm thấy tin nhắn gốc" });
          return;
        }
        
        // Tạo tin nhắn mới từ tin nhắn gốc
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

        // CHỈ gửi tin nhắn tới phòng cuộc trò chuyện đích
        io.to(conversationId).emit("new_message", populatedMessage);
        
        // Thông báo thành công cho người gửi - chỉ gửi cho client gọi socket
        socket.emit("forward_message_success", populatedMessage);
        
      } catch (error) {
        console.error("Error forwarding message:", error);
        socket.emit("forward_message_error", { error: "Không thể chuyển tiếp tin nhắn" });
      }
    });
    
    // Handle pin message event
    socket.on("pin_message", async (data) => {
      try {
        const { messageId } = data;
        
        if (!messageId) {
          socket.emit("pin_message_error", { error: "Thiếu ID tin nhắn" });
          return;
        }
        
        // Find the message to be pinned
        const message = await MessageModel.findById(messageId)
          .populate('sender', 'name avatar')
          .populate('pinnedBy', 'name avatar');
        
        if (!message) {
          socket.emit("pin_message_error", { error: "Không tìm thấy tin nhắn" });
          return;
        }
        
        // Find the conversation to check permissions
        const conversation = await ConversationModel.findById(message.idConversation);
        if (!conversation) {
          socket.emit("pin_message_error", { error: "Không tìm thấy cuộc trò chuyện" });
          return;
        }
        
        // Tạo tin nhắn hệ thống
        const systemMessage = new MessageModel({
          idConversation: message.idConversation,
          content: `${message.pinnedBy?.name || 'Ai đó'} đã ghim một tin nhắn`,
          type: 'system',
          sender: message.pinnedBy?._id || message.sender._id,
          createdAt: new Date(),
          systemType: 'pin_message',
          referencedMessage: message._id
        });
        
        // Lưu tin nhắn hệ thống
        await systemMessage.save();
        
        // Populate sender cho tin nhắn hệ thống
        await systemMessage.populate('sender', 'name avatar');
        
        // Emit the event to all users in the conversation
        io.to(message.idConversation.toString()).emit("message_pinned", {
          message: message,
          conversation: conversation._id,
          systemMessage: systemMessage
        });
        
      } catch (error) {
        console.error("Error pinning message via socket:", error);
        socket.emit("pin_message_error", { error: "Không thể ghim tin nhắn" });
      }
    });
    
    // Handle unpin message event
    socket.on("unpin_message", async (data) => {
      try {
        const { messageId } = data;
        
        if (!messageId) {
          socket.emit("unpin_message_error", { error: "Thiếu ID tin nhắn" });
          return;
        }
        
        // Find the message to be unpinned
        const message = await MessageModel.findById(messageId)
          .populate('sender', 'name avatar');
        
        if (!message) {
          socket.emit("unpin_message_error", { error: "Không tìm thấy tin nhắn" });
          return;
        }
        
        // Get the user who is unpinning the message (from socket)
        const user = socket.user;
        
        // Tạo tin nhắn hệ thống
        const systemMessage = new MessageModel({
          idConversation: message.idConversation,
          content: `${user?.name || 'Ai đó'} đã bỏ ghim một tin nhắn`,
          type: 'system',
          sender: user?._id || message.sender._id,
          createdAt: new Date(),
          systemType: 'unpin_message',
          referencedMessage: message._id
        });
        
        // Lưu tin nhắn hệ thống
        await systemMessage.save();
        
        // Populate sender cho tin nhắn hệ thống
        await systemMessage.populate('sender', 'name avatar');
        
        // Emit the event to all users in the conversation
        io.to(message.idConversation.toString()).emit("message_unpinned", {
          messageId: message._id,
          conversation: message.idConversation,
          systemMessage: systemMessage
        });
        
      } catch (error) {
        console.error("Error unpinning message via socket:", error);
        socket.emit("unpin_message_error", { error: "Không thể bỏ ghim tin nhắn" });
      }
    });
    
    socket.on("remove_member_from_group", async (data) => {
      try {
        const { groupId, memberId } = data;
        io.to(groupId).emit("member_removed", { groupId, memberId });
      } catch (error) {
        console.error("Error removing member from group:", error);
      }
    });

    // Add new handler for member_removed_from_group
    socket.on("member_removed_from_group", async (data) => {
      try {
        const { conversationId, memberId, removedBy, groupName, timestamp, memberName, removedByName } = data;
        
        console.log(`🔄 Member removal socket event - Conversation: ${conversationId}, Member: ${memberId} (${memberName || 'Unknown'}), RemovedBy: ${removedBy} (${removedByName || 'Unknown'}), Time: ${timestamp || 'N/A'}`);
        
        // Trực tiếp thông báo cho người dùng bị xóa
        if (memberId) {
          // Thông báo người dùng đã bị xóa
          io.to(memberId).emit("removed_from_group", {
            ...data,
            message: `Bạn đã bị xóa khỏi nhóm "${groupName || 'Group Chat'}" bởi người quản trị`
          });
          
          // Xóa cuộc trò chuyện khỏi danh sách cuộc trò chuyện của người dùng
          io.to(memberId).emit("conversation_deleted", {
            conversationId,
            timestamp: new Date().toISOString()
          });
          
          console.log(`✉️ Sent removal notification to user ${memberId}`);
        }
        
        // Get the updated conversation data
        const conversation = await ConversationModel.findById(conversationId)
          .populate({
            path: "members.idUser",
            select: { name: 1, avatar: 1 }
          })
          .populate("admin", "name avatar")
          .populate("admin2", "name avatar")
          .populate("lastMessage");

        if (conversation) {
          console.log(`📢 Broadcasting member removal to all members in conversation ${conversationId}`);
          
          // Emit to all members in the conversation about the update
          io.to(conversationId).emit("group_updated", {
            _id: conversation._id,
            name: conversation.name, 
            type: conversation.type,
            avatar: conversation.avatar,
            members: conversation.members,
            admin: conversation.admin,
            admin2: conversation.admin2,
            lastMessage: conversation.lastMessage
          });
          
          // Broadcast the member_removed_from_group event to all members EXCEPT the removed member
          // This ensures all members get real-time updates
          io.to(conversationId).emit("member_removed_from_group", {
            ...data,
            conversation: {
              _id: conversation._id,
              name: conversation.name,
              members: conversation.members,
              admin: conversation.admin,
              admin2: conversation.admin2
            }
          });
          
          // Update conversation list for all members
          if (conversation.members && Array.isArray(conversation.members)) {
            conversation.members.forEach(member => {
              if (member.idUser && member.idUser._id) {
                const memberId = member.idUser._id.toString();
                console.log(`📝 Updating conversation list for member: ${memberId}`);
                
                io.to(memberId).emit("update_conversation_list", {
                  conversation: conversation,
                  action: "member_removed",
                  timestamp: new Date().toISOString()
                });
              }
            });
          }
        } else {
          console.log(`⚠️ Conversation ${conversationId} not found when handling member removal`);
        }
        
      } catch (error) {
        console.error("Error handling member_removed_from_group event:", error);
      }
    });

    socket.on("leave_group", async (data) => {
      try {
        const { groupId, userId } = data;
        console.log(`👋 User ${userId} is leaving group ${groupId}`);

        // Emit to the specific user who left
        io.to(userId).emit("group_left", {
          conversationId: groupId,
          userId: userId
        });

        // Emit to all members in the conversation
        io.to(groupId).emit("member_left_group", {
          conversationId: groupId,
          memberId: userId,
          type: 'leave'
        });

        // Get the conversation to update all members' conversation list
        const conversation = await ConversationModel.findById(groupId)
          .populate({
            path: "members.idUser",
            select: { name: 1, avatar: 1 }
          })
          .populate("lastMessage");

        if (conversation) {
          // Emit update_conversation_list to all members
          conversation.members.forEach(member => {
            if (member.idUser && member.idUser._id) {
              io.to(member.idUser._id.toString()).emit("update_conversation_list", {
                conversation: conversation
              });
            }
          });
        }

      } catch (error) {
        console.error("Error handling group leave:", error);
      }
    });

    socket.on("disconnect", () => {
      console.log(`${socket.id} disconnected`);
    });

    // Xử lý tạo nhóm mới
    socket.on("create_group", async (groupData) => {
      try {
        const { name, avatar, description, admin, members } = groupData;
        console.log("🔸 Creating group:", name);
        
        // Tạo nhóm mới
        const conversation = new ConversationModel({
          name,
          avatar,
          description,
          admin,
          type: "group",
          members: [
            { idUser: admin, role: "admin" },
            ...members.map(m => ({ idUser: m, role: "member" }))
          ],
          createdAt: new Date(),
          updatedAt: new Date()
        });
        
        // Lưu vào database
        const savedConversation = await conversation.save();
        
        // Populate thông tin thành viên
        const populatedConversation = await ConversationModel.findById(savedConversation._id)
          .populate({
            path: "members.idUser",
            select: { name: 1, avatar: 1 }
          })
          .populate("admin", "name avatar")
          .lean();
        
        // Thêm thông tin mở rộng trước khi gửi về client
        const enhancedConversation = {
          ...populatedConversation,
          isGroup: true,
          typing: false,
          unreadCount: 0,
          lastMessage: null,
          createdAt: new Date()
        };
        
        console.log("🔸 Group created:", savedConversation._id);
        
        // Thông báo cho admin (người tạo nhóm) - Chỉ gửi một lần
        io.to(admin).emit("group_created", enhancedConversation);
        
        // Thông báo cho tất cả thành viên (trừ admin) sử dụng update_conversation_list thay vì group_created
        // để tránh lặp vô hạn với group_created
        members.forEach(memberId => {
          if (memberId !== admin) {
            // Sử dụng update_conversation_list thay vì group_created để đồng bộ
            io.to(memberId).emit("update_conversation_list", {
              conversation: enhancedConversation,
              action: "add_group"
            });
          }
        });
      } catch (error) {
        console.error("Error creating group:", error);
        socket.emit("message_error", {
          type: "group_creation_error",
          message: "Cannot create group",
          error: error.message
        });
      }
    });
    
    // Thêm xử lý sự kiện chi tiết cho hoạt động nhóm
    socket.on("group_activity", (data) => {
      try {
        const { conversationId, activityType, actorId, targetId, details } = data;
        
        if (!conversationId || !activityType) return;
        
        // Gửi thông báo hoạt động đến tất cả thành viên nhóm
        io.to(conversationId).emit("group_activity", {
          conversationId,
          activityType,
          actorId,
          targetId,
          details,
          timestamp: new Date()
        });
      } catch (error) {
        console.error("Error in group_activity event:", error);
      }
    });

    socket.on("add_member_to_group", async (data) => {
      try {
        const { groupId, memberId } = data;
        console.log(`Socket: Adding member ${memberId} to group ${groupId}`);
        
        if (!groupId || !memberId) {
          console.error("Invalid data for add_member_to_group:", data);
          return;
        }
        
        // Tìm cuộc trò chuyện và cập nhật với thông tin đầy đủ
        const conversation = await ConversationModel.findById(groupId)
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
        
        if (!conversation) {
          console.error(`Group ${groupId} not found`);
          return;
        }
        
        // Kiểm tra xem thành viên đã tồn tại trong nhóm chưa
        const memberExists = conversation.members.some(member => 
          member.idUser && 
          ((member.idUser._id && member.idUser._id.toString() === memberId.toString()) ||
           (typeof member.idUser === 'string' && member.idUser.toString() === memberId.toString()))
        );
        
        if (!memberExists) {
          console.log(`Member ${memberId} is not in group ${groupId}, cannot emit event`);
          return;
        }
        
        // Thông báo cho tất cả thành viên trong nhóm
        console.log(`Emitting member_added event to room ${groupId}`);
        io.to(groupId).emit("member_added", {
          conversation: conversation,
          member: { idUser: memberId }
        });
        
        // Thông báo riêng cho thành viên mới
        console.log(`Emitting member_added event to user ${memberId}`);
        io.to(memberId).emit("member_added", {
          conversation: conversation,
          member: { idUser: memberId }
        });
        
        // Cập nhật danh sách cuộc trò chuyện cho tất cả thành viên
        if (conversation.members && Array.isArray(conversation.members)) {
          conversation.members.forEach(member => {
            if (member.idUser && member.idUser._id) {
              console.log(`Updating conversation list for user ${member.idUser._id}`);
              io.to(member.idUser._id.toString()).emit("update_conversation_list", {
                conversation: conversation,
                timestamp: new Date().toISOString()
              });
            }
          });
        }
      } catch (error) {
        console.error("Error handling add_member_to_group event:", error);
      }
    });

    socket.on("member_added", async (data) => {
      try {
        const { conversation, member } = data;
        
        if (!conversation || !conversation._id || !member) {
          console.error("Invalid data for member_added event:", data);
          return;
        }
        
        console.log(`Socket: Member added to group ${conversation._id}`, {
          conversationName: conversation.name,
          memberInfo: member.idUser?.name || member.idUser
        });
        
        // Thông báo cho tất cả thành viên trong phòng
        io.to(conversation._id.toString()).emit("member_added", {
          conversation: conversation,
          member: member
        });
        
        // Thông báo riêng cho thành viên mới
        const memberId = member.idUser?._id || member.idUser;
        if (memberId) {
          io.to(memberId.toString()).emit("member_added", {
            conversation: conversation,
            member: member
          });
          
          // Thông báo cập nhật danh sách cuộc trò chuyện cho thành viên mới
          io.to(memberId.toString()).emit("update_conversation_list", {
            conversation: conversation,
            timestamp: new Date().toISOString()
          });
        }
        
        // Cập nhật danh sách cuộc trò chuyện cho tất cả thành viên
        if (conversation.members && Array.isArray(conversation.members)) {
          conversation.members.forEach(m => {
            if (m.idUser && (m.idUser._id || typeof m.idUser === 'string')) {
              const userId = m.idUser._id?.toString() || m.idUser.toString();
              io.to(userId).emit("update_conversation_list", {
                conversation: conversation,
                timestamp: new Date().toISOString()
              });
            }
          });
        }
      } catch (error) {
        console.error("Error handling member_added event:", error);
      }
    });
  });
};

// Hàm tiện ích để gửi tin nhắn mới đến các client trong cuộc trò chuyện
export const emitNewMessage = async (message, socketId = null) => {
  if (ioInstance && message && message.idConversation) {
    console.log(`🔔 Emitting new message to conversation ${message.idConversation}`);
    
    // Ensure message is in the right format
    let formattedMessage = message;
    
    // If message is a Mongoose document, convert to plain object
    if (message.toObject && typeof message.toObject === 'function') {
      formattedMessage = message.toObject();
    }
    
    // Log detailed info for file messages
    if (formattedMessage.type !== 'text') {
      console.log(`📨 Emitting ${formattedMessage.type} message:`, {
        id: formattedMessage._id,
        type: formattedMessage.type,
        fileUrl: formattedMessage.fileUrl,
        fileName: formattedMessage.fileName,
        fileType: formattedMessage.fileType,
        content: formattedMessage.content
      });
      
      // Đảm bảo các thuộc tính file được giữ lại
      if (!formattedMessage.fileUrl) {
        console.warn('⚠️ Message is missing fileUrl! This will cause rendering issues.');
      }
      if (!formattedMessage.fileName && (formattedMessage.type !== 'text' && formattedMessage.type !== 'image')) {
        console.warn('⚠️ Non-text/image message is missing fileName! This will cause rendering issues.');
      }
    }
    
    // If a specific socketId is provided, emit to all clients in the conversation except the sender
    if (socketId) {
      console.log(`📲 Detected socketId: ${socketId}, direct emit`);
      ioInstance.to(formattedMessage.idConversation.toString()).except(socketId).emit('new_message', formattedMessage);
    } else {
      // Otherwise, emit to all clients in the conversation
      ioInstance.to(formattedMessage.idConversation.toString()).emit('new_message', formattedMessage);
    }
    return true;
  }
  return false;
};

// Xuất ioInstance để các module khác có thể sử dụng
export const getIO = () => ioInstance;

export const emitDeviceSync = async (userId, syncData) => {
  if (!ioInstance || !userId) {
    return false;
  }
  
  try {
    console.log(`📱 Gửi đồng bộ đến thiết bị của user ${userId}`);
    
    // Emit tới userId - sẽ gửi đến tất cả thiết bị đã join room của user này
    ioInstance.to(userId).emit('device_sync', {
      ...syncData,
      timestamp: new Date()
    });
    
    return true;
  } catch (error) {
    console.error(`Lỗi khi gửi đồng bộ đến thiết bị của user ${userId}:`, error);
    return false;
  }
};

export const emitSpecificUserTyping = async (userId, userName, conversationId) => {
  if (!ioInstance || !userId || !conversationId) {
    return false;
  }
  
  try {
    console.log(`⌨️ Gửi thông báo người dùng ${userName} đang nhập trong cuộc trò chuyện ${conversationId}`);
    
    // Emit đến tất cả thành viên trong cuộc trò chuyện
    ioInstance.to(conversationId).emit('specific_user_typing', {
      userId,
      userName,
      conversationId,
      timestamp: new Date()
    });
    
    return true;
  } catch (error) {
    console.error(`Lỗi khi gửi thông báo đang nhập:`, error);
    return false;
  }
};

export const emitUserActivity = async (userId, activityType, extraData = {}) => {
  if (!ioInstance || !userId) {
    return false;
  }
  
  try {
    console.log(`👤 Gửi thông báo hoạt động ${activityType} của user ${userId}`);
    
    // Tìm danh sách bạn bè hoặc liên hệ của người dùng
    // Đây chỉ là ví dụ, thực tế cần thay thế bằng truy vấn thực tế
    const { UsersModel } = await import("../models/UserModel.js");
    const user = await UsersModel.findById(userId);
    
    if (!user || !user.friends || !Array.isArray(user.friends)) {
      return false;
    }
    
    // Emit hoạt động đến tất cả bạn bè/liên hệ
    user.friends.forEach(friendId => {
      if (friendId) {
        ioInstance.to(friendId.toString()).emit('user_activity', {
          userId,
          activityType,
          ...extraData,
          timestamp: new Date()
        });
      }
    });
    
    return true;
  } catch (error) {
    console.error(`Lỗi khi gửi thông báo hoạt động:`, error);
    return false;
  }
};
