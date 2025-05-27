import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Check if MongoDB URI is available
if (!process.env.URL_DB) {
  console.error('URL_DB is not defined in environment variables');
  process.exit(1);
}

// Define a simple User schema for this script
const UserSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  password: String,
  avatar: String,
  status: String,
  about: String,
  isAI: Boolean,
  friends: Array,
  myRequest: Array,
  peopleRequest: Array
});

// Create the User model
const User = mongoose.model('User', UserSchema);

// Connect to MongoDB
mongoose.connect(process.env.URL_DB)
  .then(() => {
    console.log('Connected to MongoDB');
    createGeminiUser();
  })
  .catch(err => {
    console.error('Could not connect to MongoDB', err);
    process.exit(1);
  });

// Function to create Gemini user
async function createGeminiUser() {
  try {
    // Check if Gemini user already exists
    const existingUser = await User.findOne({ email: 'gemini@ai.assistant' });
    
    if (existingUser) {
      console.log('Gemini user already exists with ID:', existingUser._id);
      // Update the isAI flag if needed
      if (!existingUser.isAI) {
        await User.updateOne(
          { _id: existingUser._id },
          { $set: { isAI: true } }
        );
        console.log('Updated Gemini user with isAI flag');
      }
    } else {
      // Create new Gemini user
      const geminiUser = new User({
        name: 'Gemini AI',
        email: 'gemini@ai.assistant',
        phone: 'gemini-ai',
        password: 'gemini_secure_password_' + Date.now(), // Random secure password
        avatar: 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/gemini_1.width-1000.format-webp.webp',
        status: 'online',
        about: 'Tu00f4i lu00e0 tru1ee3 lu00fd AI Gemini, luu00f4n su1eb5n su00e0ng giu00fap u0111u1ee1 bu1ea1n!',
        isAI: true,
        friends: [],
        myRequest: [],
        peopleRequest: []
      });
      
      const savedUser = await geminiUser.save();
      console.log('Created new Gemini user with ID:', savedUser._id);
    }
    
    console.log('Gemini user setup completed successfully');
  } catch (error) {
    console.error('Error creating Gemini user:', error);
  } finally {
    // Close the connection
    mongoose.connection.close();
    process.exit(0);
  }
}
