import mongoose from "mongoose";

const Schema = mongoose.Schema;

// const User = new Schema({
//   idUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
// });

const MessageSchema = new Schema(
  {
    idConversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
    },
    sender: { type: mongoose.Schema.Types.Mixed, required: true },
    content: String,
    type: {
      type: String,
      enum: ["text", "image", "file", "video", "audio", "system", "pdf", "doc", "excel", "presentation", "gif"],
      default: "text"
    },
    systemType: {
      type: String,
      enum: ["pin_message", "unpin_message", "add_member", "remove_member", "leave_group", "change_group_name", "change_group_avatar", "set_admin2", "remove_admin2"],
      required: function() {
        return this.type === 'system';
      }
    },
    referencedMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    },
    seen: Boolean,
    fileUrl: {
      type: String,
      default: null
    },
    fileName: {
      type: String,
      default: null
    },
    fileType: {
      type: String,
      default: null
    },
    isRevoked: {
      type: Boolean,
      default: false
    },
    deletedBy: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }],
    reactions: {
      type: Object,
      default: {}
    },
    isForwarded: {
      type: Boolean,
      default: false
    },
    originalMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null
    },
    forwardedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    originalSender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    originalSenderName: {
      type: String,
      default: null
    },
    originalSenderAvatar: {
      type: String,
      default: null
    },
    isPinned: {
      type: Boolean,
      default: false
    },
    pinnedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    pinnedAt: {
      type: Date,
      default: null
    },
    isAIGenerated: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true,
  }
);

export const MessageModel = mongoose.model("Message", MessageSchema);
