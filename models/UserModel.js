import mongoose from 'mongoose'

const Schema = mongoose.Schema

const FriendSchema = new Schema({
  idUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  idConversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation" },
});

const UserSchema = new Schema(
  {
    name: String,
    phone: String,
    avatar: String,
    password: String,
    otp: String,
    refeshToken: String,
    cloudinary_id: String,
    
    // Thêm các trường mới
    email: String,
    birthday: String,
    status: {
      type: String,
      default: "Hey there! I'm using this app"
    },
    about: {
      type: String,
      default: "No bio yet"
    },

    friends: [FriendSchema],
    myRequest: [FriendSchema], 
    peopleRequest: [FriendSchema],
    deferredRequest: [
      {
        idUser: {
          type: Schema.Types.ObjectId, 
          ref: "User"
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }
    ],
  },
  {
    timestamps: true,
  }
);

export const UsersModel = mongoose.model("User", UserSchema);
export const FriendsModel = mongoose.model("Friend", FriendSchema);