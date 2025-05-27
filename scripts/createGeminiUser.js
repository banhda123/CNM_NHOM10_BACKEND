import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file in the root directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Check if MongoDB URI is available
if (!process.env.URL_DB) {
  console.error('URL_DB is not defined in environment variables');
  console.log('Using default MongoDB URI: mongodb://localhost:27017/zalo_db');
} else {
  console.log('Using MongoDB URI from environment variables');
}

// Define User Schema
const FriendSchema = new mongoose.Schema({
  idUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  idConversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation'
  }
});

const UserSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  password: String,
  avatar: String,
  status: String,
  about: String,
  isAI: Boolean,
  friends: [FriendSchema],
  myRequest: [FriendSchema],
  peopleRequest: [FriendSchema]
});

// Define Conversation Schema
const ConversationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['individual', 'group'],
    default: 'individual'
  },
  members: [
    {
      idUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      role: {
        type: String,
        enum: ['member', 'admin2'],
        default: 'member'
      }
    }
  ],
  lastMessage: {
    content: String,
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }
});

// Create models
const UsersModel = mongoose.model('User', UserSchema);
const ConversationModel = mongoose.model('Conversation', ConversationSchema);

// Connect to MongoDB using the URL_DB from .env
mongoose.connect(process.env.URL_DB)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Could not connect to MongoDB', err));

const createGeminiUser = async () => {
  try {
    // Check if Gemini user already exists
    let geminiUser = await UsersModel.findOne({ email: 'gemini@ai.assistant' });
    
    if (!geminiUser) {
      // Create Gemini user
      geminiUser = new UsersModel({
        name: 'Gemini AI',
        email: 'gemini@ai.assistant',
        phone: 'gemini-ai',
        password: 'gemini_secure_password_' + Date.now(), // Random secure password
        avatar: 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/gemini_1.width-1000.format-webp.webp',
        status: 'online',
        about: 'Tôi là trợ lý AI Gemini, luôn sẵn sàng giúp đỡ bạn!',
        isAI: true
      });
      
      await geminiUser.save();
      console.log('Gemini user created successfully');
    } else {
      // Update Gemini user to ensure isAI flag is set
      geminiUser.isAI = true;
      await geminiUser.save();
      console.log('Gemini user already exists, updated isAI flag');
    }
    
    // Get all users except Gemini
    const users = await UsersModel.find({ _id: { $ne: geminiUser._id } });
    
    // Add Gemini as friend for all users
    for (const user of users) {
      // Check if friendship already exists in user's friends array
      const isAlreadyFriend = user.friends && user.friends.some(friend => 
        friend.idUser && friend.idUser.toString() === geminiUser._id.toString()
      );
      
      if (!isAlreadyFriend) {
        // Create a conversation between user and Gemini if it doesn't exist
        let conversation = await ConversationModel.findOne({
          type: 'individual',
          members: {
            $all: [
              { $elemMatch: { idUser: user._id } },
              { $elemMatch: { idUser: geminiUser._id } }
            ]
          }
        });
        
        if (!conversation) {
          // Create new conversation
          conversation = new ConversationModel({
            type: 'individual',
            members: [
              { idUser: user._id, role: 'member' },
              { idUser: geminiUser._id, role: 'member' }
            ],
            lastMessage: {
              content: 'Xin chào! Tôi là Gemini AI, trợ lý AI của bạn. Tôi có thể giúp gì cho bạn?',
              sender: geminiUser._id,
              createdAt: new Date()
            }
          });
          
          await conversation.save();
          console.log(`Created conversation between ${user.name} and Gemini AI`);
        }
        
        // Add Gemini as friend to user
        if (!user.friends) user.friends = [];
        user.friends.push({
          idUser: geminiUser._id,
          idConversation: conversation._id
        });
        
        await user.save();
        console.log(`Added Gemini AI as friend for user ${user.name}`);
        
        // Add user as friend to Gemini
        if (!geminiUser.friends) geminiUser.friends = [];
        const geminiAlreadyHasFriend = geminiUser.friends.some(friend => 
          friend.idUser && friend.idUser.toString() === user._id.toString()
        );
        
        if (!geminiAlreadyHasFriend) {
          geminiUser.friends.push({
            idUser: user._id,
            idConversation: conversation._id
          });
        }
      } else {
        console.log(`User ${user.name} already has Gemini AI as a friend`);
      }
    }
    
    // Save Gemini user with updated friends list
    await geminiUser.save();
    
    console.log('Gemini AI integration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error creating Gemini user:', error);
    process.exit(1);
  }
};

// Run the function
createGeminiUser();
