import { UsersModel } from "../models/UserModel.js";
import { generateToken } from "../utils/index.js";
import cloudinary from "cloudinary";
import { ConversationModel } from "../models/ConversationModel.js";
import { MessageModel } from "../models/MessageModel.js";
import { sendSMS } from "../utils/sms.js";

export const getUser = async (req, res) => {
  const users = await UsersModel.find();
  res.send(users);
};

export const getUserByPhoneNumber = async (req, res) => {
  const user = await UsersModel.findOne({ phone: req.params.phone });
  if (user) {
    res.send(user);
  } else {
    res.status(403).send({ message: "user not found" });
  }
};

export const getUserById = async (req, res) => {
  let userId = req.params.id;
  if (userId === 'me') {
    // Lấy userId từ token đã xác thực (giả sử middleware đã gán req.user)
    if (!req.user || !req.user._id) {
      return res.status(401).send({ message: 'Unauthorized' });
    }
    userId = req.user._id;
  }
  // Kiểm tra userId có hợp lệ không (24 ký tự hex)
  if (!userId || typeof userId !== 'string' || !userId.match(/^[a-fA-F0-9]{24}$/)) {
    return res.status(400).send({ message: 'Invalid user id' });
  }
  try {
    const user = await UsersModel.findById(userId);
    if (user) {
      res.send(user);
    } else {
      res.status(404).send({ message: "user not found" });
    }
  } catch (err) {
    res.status(500).send({ message: "Server error", error: err.message });
  }
};

export const updateRefeshToken = (user, refeshToken) => {
  user.refeshToken = refeshToken;
  user.save();
};

export const Login = async (req, res) => {
  // Kiểm tra thông tin đầy đủ
  if (!req.body.phone || !req.body.password) {
    return res.status(400).send({ message: "Vui lòng điền đầy đủ thông tin" });
  }
  // Kiểm tra số điện thoại
  const phoneRegex = /^\d{10}$/;
  if (!phoneRegex.test(req.body.phone)) {
    return res.status(400).send({ message: "Số điện thoại phải gồm đúng 10 chữ số." });
  }
  // Kiểm tra mật khẩu
  const password = req.body.password;
  const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@#$!%*?&^_-]{8,32}$/;
  if (!passwordRegex.test(password) || /\s/.test(password)) {
    return res.status(400).send({ 
      message: "Mật khẩu phải từ 8-32 ký tự, gồm chữ cái, số, ký tự đặc biệt và không chứa khoảng trắng." 
    });
  }

  const user = await UsersModel.findOne({
    phone: req.body.phone,
    password: req.body.password,
  });

  if (user) {
    const tokens = generateToken(user);
    updateRefeshToken(user, tokens.refeshToken);

    res.send({
      _id: user._id,
      name: user.name,
      phone: user.phone,
      password: user.password,
      otp: user.otp || null,
      token: tokens.accessToken,
      refeshToken: tokens.refeshToken,
    });
  } else {
    res.status(403).send({ message: "Số điện thoại hoặc mật khẩu không đúng" });
  }
};

export const Register = async (req, res) => {
  // Kiểm tra số điện thoại
  const phoneRegex = /^\d{10}$/;
  if (!phoneRegex.test(req.body.phone)) {
    return res.status(400).send({ message: "Số điện thoại phải gồm đúng 10 chữ số." });
  }
  // Kiểm tra mật khẩu
  const password = req.body.password;
  const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@#$!%*?&^_-]{8,32}$/;
  if (!passwordRegex.test(password) || /\s/.test(password)) {
    return res.status(400).send({ 
      message: "Mật khẩu phải từ 8-32 ký tự, gồm chữ cái, số, ký tự đặc biệt và không chứa khoảng trắng." 
    });
  }

  console.log(req.body);
  const userExists = await UsersModel.findOne({ phone: req.body.phone });
  console.log(userExists);
  if (userExists) {
    res.status(400).send({ message: "Số điện thoại này đã đăng kí tài khoản" });
  } else {
    const user = new UsersModel({
      name: req.body.name,
      phone: req.body.phone,
      password: req.body.password,
      avatar:
        "https://res.cloudinary.com/daclejcpu/image/upload/v1744812771/avatar-mac-dinh-12_i7jnd3.jpg",
    });
    await user.save();

    res.status(200).send({
      _id: user._id,
      name: user.name,
      password: user.password,
      phone: user.phone,
      otp: "",
    });
  }
};

export const getNewToken = async (req, res) => {
  const refeshToken = req.body;
  const userExists = await UsersModel.findOne(refeshToken);
  if (userExists) {
    const tokens = generateToken(userExists);
    updateRefeshToken(userExists, tokens.refeshToken);
    res.send(tokens);
  } else {
    res.status(403).send({ message: "no refesh token" });
  }
};

export const UpdatePassword = async (req, res) => {
  const userExist = await UsersModel.findOne({ phone: req.body.email });
  if (userExist) {
    userExist.password = req.body.password;
    await userExist.save();
    res.send({ message: "Cập nhật mật khẩu thành công" });
  } else {
    res.status(403).send({ message: "Email này chưa đăng kí tài khoản" });
  }
};

function countDownOtp(time, user) {
  setTimeout(() => {
    user.otp = "";
    user.save();
  }, time);
}

export const sendMail = async (req, res) => {
  try {
    const phone = req.body.phone || req.body.email;
    if (!phone) {
      return res.status(400).send({ message: "Thiếu số điện thoại" });
    }
    const otp = Math.floor(100000 + Math.random() * 900000);

    console.log("Gửi OTP tới:", phone, "OTP:", otp);

    const smsSent = await sendSMS(phone, otp);

    if (smsSent) {
      res.send({
        message: "Mã OTP đã được gửi đến số điện thoại của bạn",
        otp: otp,
      });
    } else {
      console.error("Lỗi gửi SMS:", smsSent);
      res.status(500).send({ message: "Không thể gửi SMS" });
    }
  } catch (error) {
    console.log("Lỗi khi gửi OTP:", error);
    res.status(403).send({ message: "Không gửi được mã OTP" });
  }
};

export const checkCodeOtp = async (req, res) => {
  console.log("Request body:", req.body);
  const userExist = await UsersModel.findOne({ phone: req.body.email });
  console.log("User found:", userExist);

  if (userExist) {
    console.log("User OTP:", userExist.otp);
    console.log("Request OTP:", req.body.otp);

    if (req.body.otp === userExist.otp) {
      res.send({ message: "OTP đã đúng" });
    } else {
      res.status(403).send({ message: "OTP không đúng" });
    }
  } else {
    res
      .status(403)
      .send({ message: "Số điện thoại này chưa đăng kí tài khoản" });
  }
};

export const changeAvatar = async (req, res) => {
  const userExist = await UsersModel.findById(req.body._id);
  const result = await cloudinary.uploader.upload(req.file.path, {
    folder: "zalo",
  });

  if (userExist) {
    if (
      userExist.avatar ===
      "https://res.cloudinary.com/daclejcpu/image/upload/v1744812771/avatar-mac-dinh-12_i7jnd3.jpg"
    ) {
      console.log("image default");
    } else {
      cloudinary.uploader.destroy(userExist.cloudinary_id);
    }

    userExist.avatar = result.secure_url;
    userExist.cloulinary_id = result.public_id;

    await userExist.save();
    res.send(userExist);
  } else {
    res.status(403).send({ mesage: "user not found" });
  }
};

export const searchUser = async (req, res) => {
  let user;
  if (req.body.id) {
    user = await UsersModel.findById(req.body.id);
  } else if (req.body.phone) {
    user = await UsersModel.findOne({ phone: req.body.phone });
  } else {
    return res
      .status(400)
      .send({ message: "Vui lòng cung cấp ID hoặc số điện thoại" });
  }

  if (user) {
    res.send(user);
  } else {
    res.status(404).send({ message: "Không tìm thấy người dùng" });
  }
};

export const addFriend = async (req, res) => {
  try {
    const userFrom = req.user._id; // Lấy ID từ token
    const userTo = req.body.id;

    if (!userTo) {
      return res
        .status(400)
        .send({ message: "Vui lòng cung cấp ID người dùng" });
    }

    const userToAccount = await UsersModel.findById(userTo);
    const userFromAccount = await UsersModel.findById(userFrom);

    if (!userToAccount || !userFromAccount) {
      return res.status(404).send({ message: "Không tìm thấy người dùng" });
    }

    // Kiểm tra đã là bạn bè chưa
    const isAlreadyFriend = userFromAccount.friends.some(
      (friend) => friend.idUser.toString() === userTo
    );
    if (isAlreadyFriend) {
      return res.status(400).send({ message: "Đã là bạn bè" });
    }

    // Kiểm tra đã gửi lời mời chưa
    const hasSentRequest = userFromAccount.myRequest.some(
      (request) => request.idUser.toString() === userTo
    );
    if (hasSentRequest) {
      return res.status(400).send({ message: "Đã gửi lời mời kết bạn" });
    }

    userToAccount.peopleRequest.push({ idUser: userFrom });
    userFromAccount.myRequest.push({ idUser: userTo });

    await userToAccount.save();
    await userFromAccount.save();

    res.send({ message: "Đã gửi lời mời kết bạn" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Lỗi server" });
  }
};

export const deleteRequestFriend = async (userFrom, userTo) => {
  const userToAccount = await UsersModel.findOne({ _id: userTo });
  const userFromAccount = await UsersModel.findOne({ _id: userFrom });

  if (userToAccount && userFromAccount) {
    userFromAccount.myRequest = userFromAccount.myRequest.filter(
      (x) => x.idUser != userTo
    );
    userToAccount.peopleRequest = userToAccount.peopleRequest.filter(
      (x) => x.idUser != userFrom
    );

    await userFromAccount.save();
    await userToAccount.save();
  }
};

export const acceptFriend = async (req, res) => {
  try {
    const { userFrom, userTo } = req.body;

    if (!userFrom || !userTo) {
      return res
        .status(400)
        .send({ message: "Vui lòng cung cấp đầy đủ thông tin" });
    }

    const userFromAccount = await UsersModel.findById(userFrom);
    const userToAccount = await UsersModel.findById(userTo._id);

    if (!userFromAccount || !userToAccount) {
      return res.status(404).send({ message: "Không tìm thấy người dùng" });
    }

    console.log(userFromAccount);
    console.log(userTo._id);
    // Kiểm tra xem có lời mời kết bạn không
    const hasRequest = userFromAccount.peopleRequest.some(
      (request) => request.idUser.toString() === userTo._id.toString()
    );
    if (!hasRequest) {
      return res
        .status(400)
        .send({ message: "Không tìm thấy lời mời kết bạn" });
    }

    // Tạo cuộc trò chuyện mới
    const newConversation = new ConversationModel({
      type: "private",
      members: [{ idUser: userFrom }, { idUser: userTo }],
    });
    await newConversation.save();

    // Cập nhật danh sách bạn bè
    userFromAccount.peopleRequest = userFromAccount.peopleRequest.filter(
      (x) => x.idUser.toString() !== userTo._id
    );
    userFromAccount.friends.push({
      idUser: userTo,
      idConversation: newConversation._id,
    });

    userToAccount.myRequest = userToAccount.myRequest.filter(
      (x) => x.idUser.toString() !== userFrom
    );
    userToAccount.friends.push({
      idUser: userFrom,
      idConversation: newConversation._id,
    });

    await userFromAccount.save();
    await userToAccount.save();

    res.send({ message: "Đã chấp nhận lời mời kết bạn" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Lỗi server" });
  }
};

export const DontAcceptFriend = async (userFrom, userTo) => {
  const userFromAccount = await UsersModel.findOne({ _id: userFrom });
  const userToAccount = await UsersModel.findOne({ _id: userTo });

  if (userFromAccount && userToAccount) {
    userFromAccount.peopleRequest = userFromAccount.peopleRequest.filter(
      (x) => x.idUser != userTo
    );

    userToAccount.myRequest = userToAccount.myRequest.filter(
      (x) => x.idUser != userFrom
    );

    await userFromAccount.save();
    await userToAccount.save();
  }
};

export const unFriend = async (userFrom, userTo, idConversation) => {
  await ConversationModel.findByIdAndDelete(idConversation);
  await MessageModel.deleteMany({ idConversation: idConversation });

  const userFromAccount = await UsersModel.findOne({ _id: userFrom });
  const userToAccount = await UsersModel.findOne({ _id: userTo });

  if (userFromAccount && userToAccount) {
    userFromAccount.friends = userFromAccount.friends.filter(
      (x) => x.idUser != userTo
    );

    userToAccount.friends = userToAccount.friends.filter(
      (x) => x.idUser != userFrom
    );

    await userFromAccount.save();
    await userToAccount.save();
  }
};

export const getAllPeopleRequestByUser = async (req, res) => {
  try {
    // Basic validation
    if (!req.params?.id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Get user with populated friend requests
    const user = await UsersModel.findById(req.params.id)
      .populate({
        path: "peopleRequest.idUser", // Changed from "friends.idUser"
        select: "_id name avatar",
      })
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return peopleRequest array instead of friends
    res.json(user.peopleRequest || []); // Changed from user.friends
  } catch (error) {
    console.error("Error fetching friend requests:", error); // Updated error message
    res.status(500).json({ message: "Server error" });
  }
};

export const getAllFriendByUser = async (req, res) => {
  const list = await UsersModel.findById(req.params.id).populate({
    path: "friends.idUser",
    select: { name: 1, avatar: 1 },
  });

  res.send(list.friends);
};

export const Demo = (req, res) => {
  res.send("dnsahbc");
};

export const updateUserInfo = async (req, res) => {
  try {
    const { userId, name, status, about, email, birthday } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const user = await UsersModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update only provided fields
    if (name) user.name = name;
    if (status) user.status = status;
    if (about) user.about = about;
    if (email) user.email = email;
    if (birthday) user.birthday = birthday;

    await user.save();
    
    res.status(200).json({
      success: true,
      message: "User information updated successfully",
      user: {
        _id: user._id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        avatar: user.avatar,
        status: user.status,
        about: user.about,
        birthday: user.birthday
      }
    });
  } catch (error) {
    console.error("Error updating user info:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const changeUserPassword = async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;

    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const user = await UsersModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Verify current password
    if (user.password !== currentPassword) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    // Update password
    user.password = newPassword;
    await user.save();
    
    res.status(200).json({
      success: true,
      message: "Password updated successfully"
    });
  } catch (error) {
    console.error("Error changing password:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const checkFriendshipStatus = async (req, res) => {
  try {
    const { userFromId, userToId } = req.params;
    
    if (!userFromId || !userToId) {
      return res.status(400).json({ message: "Thiếu thông tin người dùng" });
    }
    
    if (userFromId === userToId) {
      return res.status(400).json({ message: "Không thể kiểm tra trạng thái kết bạn với chính mình" });
    }
    
    // Lấy thông tin người dùng
    const userFrom = await UsersModel.findById(userFromId);
    const userTo = await UsersModel.findById(userToId);
    
    if (!userFrom || !userTo) {
      return res.status(404).json({ message: "Không tìm thấy người dùng" });
    }
    
    // Kiểm tra đã là bạn bè chưa
    const areFriends = userFrom.friends.some(friend => friend.idUser.toString() === userToId);
    if (areFriends) {
      return res.status(200).json({ status: "friend" });
    }
    
    // Kiểm tra đã gửi lời mời chưa
    const hasSentRequest = userFrom.myRequest.some(request => request.idUser.toString() === userToId);
    if (hasSentRequest) {
      return res.status(200).json({ status: "pending_sent" });
    }
    
    // Kiểm tra đã nhận lời mời chưa
    const hasReceivedRequest = userFrom.peopleRequest.some(request => request.idUser.toString() === userToId);
    if (hasReceivedRequest) {
      return res.status(200).json({ status: "pending_received" });
    }
    
    // Kiểm tra lời mời đã tạm hoãn
    const hasDeferredRequest = userFrom.deferredRequest && userFrom.deferredRequest.some(
      request => request.idUser.toString() === userToId
    );
    if (hasDeferredRequest) {
      return res.status(200).json({ status: "deferred" });
    }
    
    // Không có mối quan hệ bạn bè
    return res.status(200).json({ status: "none" });
  } catch (error) {
    console.error("Error checking friendship status:", error);
    res.status(500).json({ message: "Lỗi server" });
  }
};

export const getAllSentRequestsByUser = async (req, res) => {
  try {
    // Basic validation
    if (!req.params?.id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Get user with populated friend requests
    const user = await UsersModel.findById(req.params.id)
      .populate({
        path: "myRequest.idUser",
        select: "_id name avatar",
      })
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return myRequest array
    res.json(user.myRequest || []);
  } catch (error) {
    console.error("Error fetching sent friend requests:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const deferFriendRequest = async (req, res) => {
  try {
    const { userFrom, userTo } = req.body;

    if (!userFrom || !userTo) {
      return res.status(400).json({ message: "Vui lòng cung cấp đầy đủ thông tin" });
    }

    const userFromAccount = await UsersModel.findById(userFrom);
    const userToAccount = await UsersModel.findById(userTo);

    if (!userFromAccount || !userToAccount) {
      return res.status(404).json({ message: "Không tìm thấy người dùng" });
    }

    // Kiểm tra lời mời có tồn tại không
    const requestIndex = userFromAccount.peopleRequest.findIndex(
      req => req.idUser.toString() === userTo
    );
    
    if (requestIndex === -1) {
      return res.status(400).json({ message: "Không tìm thấy lời mời kết bạn" });
    }

    // Lấy thông tin lời mời
    const requestInfo = userFromAccount.peopleRequest[requestIndex];

    // Tạo mảng deferredRequest nếu chưa có
    if (!userFromAccount.deferredRequest) {
      userFromAccount.deferredRequest = [];
    }

    // Thêm vào danh sách tạm hoãn
    userFromAccount.deferredRequest.push(requestInfo);

    // Xóa khỏi danh sách lời mời
    userFromAccount.peopleRequest.splice(requestIndex, 1);
    
    // Lưu thay đổi
    await userFromAccount.save();

    return res.status(200).json({ 
      success: true, 
      message: "Đã tạm hoãn lời mời kết bạn" 
    });
  } catch (error) {
    console.error("Error deferring friend request:", error);
    res.status(500).json({ message: "Lỗi server" });
  }
};

export const getDeferredRequests = async (req, res) => {
  try {
    // Basic validation
    if (!req.params?.id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Get user with populated deferred requests
    const user = await UsersModel.findById(req.params.id)
      .populate({
        path: "deferredRequest.idUser",
        select: "_id name avatar",
      })
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return deferredRequest array
    res.json(user.deferredRequest || []);
  } catch (error) {
    console.error("Error fetching deferred friend requests:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const cancelFriendRequest = async (req, res) => {
  try {
    const { userFrom, userTo } = req.body;

    if (!userFrom || !userTo) {
      return res.status(400).json({ message: "Vui lòng cung cấp đầy đủ thông tin" });
    }

    const userFromAccount = await UsersModel.findById(userFrom);
    const userToAccount = await UsersModel.findById(userTo);

    if (!userFromAccount || !userToAccount) {
      return res.status(404).json({ message: "Không tìm thấy người dùng" });
    }

    // Xóa lời mời từ người dùng hiện tại
    userFromAccount.myRequest = userFromAccount.myRequest.filter(
      req => req.idUser.toString() !== userTo
    );

    // Xóa lời mời từ người nhận
    userToAccount.peopleRequest = userToAccount.peopleRequest.filter(
      req => req.idUser.toString() !== userFrom
    );

    await userFromAccount.save();
    await userToAccount.save();

    return res.status(200).json({ 
      success: true, 
      message: "Đã hủy lời mời kết bạn" 
    });
  } catch (error) {
    console.error("Error canceling friend request:", error);
    res.status(500).json({ message: "Lỗi server" });
  }
};

// Xử lý API từ client để huỷ kết bạn
export const removeFriend = async (req, res) => {
  try {
    const { userFrom, userTo } = req.body;
    
    if (!userFrom || !userTo) {
      return res.status(400).json({ 
        success: false,
        message: "Thiếu thông tin người dùng" 
      });
    }
    
    // Tìm người dùng
    const userFromData = await UsersModel.findById(userFrom);
    const userToData = await UsersModel.findById(userTo);
    
    if (!userFromData || !userToData) {
      return res.status(404).json({ 
        success: false,
        message: "Không tìm thấy người dùng" 
      });
    }
    
    // Tìm conversation
    const friendInfo = userFromData.friends.find(
      (friend) => friend.idUser.toString() === userTo
    );
    
    if (!friendInfo) {
      return res.status(404).json({ 
        success: false,
        message: "Không tìm thấy mối quan hệ bạn bè" 
      });
    }
    
    const idConversation = friendInfo.idConversation;
    
    // Gọi hàm unFriend để thực hiện
    await unFriend(userFrom, userTo, idConversation);
    
    return res.status(200).json({
      success: true,
      message: "Đã huỷ kết bạn thành công",
      user: {
        _id: userFromData._id,
        name: userFromData.name,
        phone: userFromData.phone,
        avatar: userFromData.avatar
      }
    });
  } catch (error) {
    console.error("Error in removeFriend:", error);
    res.status(500).json({ 
      success: false,
      message: "Lỗi server khi huỷ kết bạn",
      error: error.message 
    });
  }
};
