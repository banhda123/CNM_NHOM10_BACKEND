import express from "express";
import {
  changeAvatar,
  checkCodeOtp,
  Demo,
  getAllFriendByUser,
  getAllPeopleRequestByUser,
  getNewToken,
  getUser,
  getUserById,
  Login,
  Register,
  searchUser,
  sendMail,
  UpdatePassword,
  addFriend,
  acceptFriend,
  DontAcceptFriend,
  unFriend,
  deleteRequestFriend,
  updateUserInfo,
  changeUserPassword,
  checkFriendshipStatus,
  getAllSentRequestsByUser,
  deferFriendRequest,
  getDeferredRequests,
  cancelFriendRequest,
  removeFriend
} from "../controllers/userController.js";
import { isAuth } from "../utils/index.js";
import { upload } from "../utils/uploadImage.js";

const UserRouter = express.Router();

UserRouter.get("/", getUser);
UserRouter.post("/search", searchUser);
UserRouter.get("/:id", isAuth, getUserById);
UserRouter.post("/login", Login);
UserRouter.post("/register", Register);

UserRouter.post("/sendmail", sendMail);
UserRouter.post("/checkotp", checkCodeOtp);
UserRouter.post("/updatepassword", UpdatePassword);
UserRouter.post("/getnewtoken", getNewToken);

UserRouter.post("/avatar", isAuth, upload.single("image"), changeAvatar);

// API bạn bè
UserRouter.post("/addFriend", isAuth, addFriend);
UserRouter.post("/acceptFriend", isAuth, acceptFriend);
UserRouter.post("/dontAcceptFriend", isAuth, DontAcceptFriend);
UserRouter.post("/unFriend", isAuth, removeFriend);
UserRouter.post("/deleteRequestFriend", isAuth, deleteRequestFriend);

UserRouter.get("/getAllFriendByUser/:id", getAllFriendByUser);
UserRouter.get("/getAllPeopleRequestByUser/:id", getAllPeopleRequestByUser);

// API mới cho tính năng kết bạn nâng cao
UserRouter.get("/getAllSentRequestsByUser/:id", getAllSentRequestsByUser);
UserRouter.get("/checkFriendshipStatus/:userFromId/:userToId", isAuth, checkFriendshipStatus);
UserRouter.post("/deferFriendRequest", isAuth, deferFriendRequest);
UserRouter.get("/getDeferredRequests/:id", isAuth, getDeferredRequests);
UserRouter.post("/cancelFriendRequest", isAuth, cancelFriendRequest);

UserRouter.get("/demo", Demo);

// New routes
UserRouter.post("/update-profile", isAuth, updateUserInfo);
UserRouter.post("/change-password", isAuth, changeUserPassword);

export default UserRouter;
