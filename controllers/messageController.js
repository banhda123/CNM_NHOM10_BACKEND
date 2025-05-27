export const handleVideoMessage = async (req, res) => {
  try {
    console.log('🎬 Xử lý tin nhắn video từ người dùng');
    // Xác thực quyền truy cập cuộc trò chuyện
    const { idConversation, userId } = req.body;
    if (!idConversation || !userId) {
      console.log('❌ Thiếu idConversation hoặc userId');
      return res.status(400).json({ error: "Thiếu thông tin cần thiết" });
    }

    // Kiểm tra xem người dùng có trong cuộc trò chuyện không
    const conversation = await ConversationModel.findById(idConversation);
    if (!conversation) {
      console.log(`❌ Không tìm thấy cuộc trò chuyện với id ${idConversation}`);
      return res.status(404).json({ error: "Không tìm thấy cuộc trò chuyện" });
    }

    const memberExists = conversation.members.some(member => 
      member.idUser && member.idUser.toString() === userId.toString()
    );

    if (!memberExists) {
      console.log(`🚫 Người dùng ${userId} không thuộc cuộc trò chuyện ${idConversation}`);
      return res.status(403).json({ error: "Bạn không phải là thành viên của cuộc trò chuyện này" });
    }

    // Xử lý video
    if (!req.file) {
      console.log('❌ Không tìm thấy file video');
      return res.status(400).json({ error: "Không có video nào được tải lên" });
    }

    // Kiểm tra dung lượng video
    const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB
    if (req.file.size > MAX_VIDEO_SIZE) {
      console.log(`❌ Video quá lớn: ${req.file.size} bytes`);
      return res.status(400).json({ error: "Video quá lớn, kích thước tối đa là 100MB" });
    }

    // Kiểm tra định dạng video
    if (!req.file.mimetype.startsWith('video/')) {
      console.log(`❌ Định dạng không hỗ trợ: ${req.file.mimetype}`);
      return res.status(400).json({ error: "Định dạng file không được hỗ trợ" });
    }

    console.log(`✅ Video hợp lệ: ${req.file.originalname}, ${req.file.size} bytes, ${req.file.mimetype}`);

    // Tạo URL cho video
    const videoUrl = `/uploads/videos/${req.file.filename}`;
    const { sender, content, socketId } = req.body;

    // Tạo và lưu tin nhắn video mới
    const newMessage = new MessageModel({
      idConversation,
      content: content || `Video: ${req.file.originalname}`,
      type: 'video',
      seen: false,
      sender,
      fileUrl: videoUrl,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size
    });

    console.log('📝 Lưu tin nhắn video với dữ liệu:', {
      idConversation,
      sender,
      type: 'video',
      fileUrl: videoUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size
    });

    const savedMessage = await newMessage.save();
    console.log(`✅ Đã lưu tin nhắn video với ID: ${savedMessage._id}`);

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
      console.log(`📣 Tin nhắn video đã được phát sóng: ${messageEmitted ? 'thành công' : 'thất bại'}`);
    }
    
    // Cập nhật danh sách cuộc trò chuyện cho tất cả thành viên
    try {
      const io = getIO();
      if (io) {
        // Lấy thông tin cuộc trò chuyện đã cập nhật
        const updatedConversation = await ConversationModel.findById(idConversation)
          .populate({
            path: "members.idUser",
            select: { name: 1, avatar: 1 }
          })
          .populate("lastMessage");
          
        if (updatedConversation && updatedConversation.members) {
          console.log(`📣 Cập nhật danh sách cuộc trò chuyện sau khi gửi video cho ${updatedConversation.members.length} thành viên`);
          
          // Emit update_conversation_list cho từng thành viên
          updatedConversation.members.forEach(member => {
            if (member.idUser && member.idUser._id) {
              console.log(`👤 Gửi cập nhật danh sách cuộc trò chuyện cho user: ${member.idUser._id.toString()}`);
              io.to(member.idUser._id.toString()).emit("update_conversation_list", {
                conversation: updatedConversation,
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

    // Trả về phản hồi thành công
    console.log('📤 Gửi phản hồi về client với thông tin tin nhắn video');
    return res.status(200).json({
      ...savedMessage.toObject(),
      _id: savedMessage._id.toString(),
      fileUrl: videoUrl,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      type: 'video'
    });

  } catch (error) {
    console.error("Error handling video message:", error);
    return res.status(500).json({ error: "Lỗi khi xử lý tin nhắn video" });
  }
}; 