import mongoose from "mongoose";

const Schema = mongoose.Schema;

const User = new Schema({
  idUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
});

const ConversationSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["private", "group"],
      required: true,
    },
    name: {
      type: String,
      required: function() {
        return this.type === "group";
      },
    },
    avatar: {
      type: String,
      default: "https://res.cloudinary.com/daclejcpu/image/upload/v1744812771/avatar-mac-dinh-12_i7jnd3.jpg",
    },
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    members: [
      {
        idUser: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        role: {
          type: String,
          enum: ["member", "admin2"],
          default: "member"
        }
      }
    ],
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function() {
        return this.type === "group";
      },
    },
    admin2: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    permissions: {
      changeName: {
        type: Boolean,
        default: true
      },
      changeAvatar: {
        type: Boolean,
        default: true
      },
      addMembers: {
        type: Boolean,
        default: true
      },
      removeMembers: {
        type: Boolean,
        default: true
      },
      deleteGroup: {
        type: Boolean,
        default: true
      },
      pinMessages: {
        type: Boolean,
        default: true
      }
    }
  },
  {
    timestamps: true,
  }
);

export const ConversationModel = mongoose.model(
  "Conversation",
  ConversationSchema
);
