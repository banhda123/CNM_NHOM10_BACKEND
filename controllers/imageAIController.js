import Replicate from 'replicate';
import { MessageModel } from '../models/MessageModel.js';
import { ConversationModel } from '../models/ConversationModel.js';
import { UsersModel } from '../models/UserModel.js';
import cloudinary from '../config/Cloudinary.js';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Replicate API token
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
console.log('Replicate API Token:', REPLICATE_API_TOKEN ? 'Token exists' : 'Token missing');

// Function to call Replicate API directly using axios
async function callReplicateAPI(modelVersion, input) {
  console.log(`Calling Replicate API for model: ${modelVersion}`);
  
  try {
    // Create prediction
    const createResponse = await axios.post(
      'https://api.replicate.com/v1/predictions',
      {
        version: modelVersion,
        input: input
      },
      {
        headers: {
          'Authorization': `Token ${REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const predictionId = createResponse.data.id;
    console.log(`Prediction created with ID: ${predictionId}`);
    
    // Poll for prediction result
    let prediction = null;
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes with 5-second intervals
    
    while (!prediction?.output && attempts < maxAttempts) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      
      const getResponse = await axios.get(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: {
            'Authorization': `Token ${REPLICATE_API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      prediction = getResponse.data;
      console.log(`Prediction status: ${prediction.status}`);
      
      if (prediction.error) {
        throw new Error(`Replicate API error: ${prediction.error}`);
      }
    }
    
    if (!prediction?.output) {
      throw new Error('Failed to generate output within the time limit');
    }
    
    return prediction.output;
  } catch (error) {
    console.error('Error calling Replicate API:', error.response?.data || error.message);
    throw error;
  }
}

// Function to generate image from text prompt
export const generateImageFromText = async (req, res) => {
  try {
    const { prompt, conversationId, sender, socketId } = req.body;

    if (!prompt || !conversationId || !sender) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    console.log(`Generating image for prompt: "${prompt}"`);

    // Call Replicate API to generate image
    // Using Stable Diffusion model
    console.log('Calling Replicate API for image generation...');
    const modelVersion = "27b93a2413e7f36cd83da926f3656280b2931564ff050bf9575f1fdf9bcd7478";
    const input = {
      prompt: prompt,
      width: 768,
      height: 768,
      num_outputs: 1,
      guidance_scale: 7.5,
      num_inference_steps: 50,
    };
    
    const output = await callReplicateAPI(modelVersion, input);
    
    if (!output || !output[0]) {
      return res.status(500).json({ error: 'Failed to generate image' });
    }

    const imageUrl = output[0];
    console.log(`Image generated: ${imageUrl}`);

    // Download the image from the URL
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const tempFilePath = path.join(__dirname, `../temp/ai_image_${uuidv4()}.png`);
    
    // Ensure temp directory exists
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Save the image temporarily
    fs.writeFileSync(tempFilePath, response.data);

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(tempFilePath, {
      folder: 'ai_generated',
      resource_type: 'image'
    });

    // Delete the temporary file
    fs.unlinkSync(tempFilePath);

    // Get conversation to update
    const conversation = await ConversationModel.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Create a new message with the generated image
    const newMessage = new MessageModel({
      idConversation: conversationId,
      sender: sender,
      content: prompt,
      type: 'image',
      fileUrl: result.secure_url,
      fileName: 'AI Generated Image',
      fileType: 'image/png',
      fileSize: result.bytes,
      isAIGenerated: true
    });

    // Save the message
    const savedMessage = await newMessage.save();

    // Update conversation's last message
    conversation.lastMessage = savedMessage._id;
    await conversation.save();

    // Emit socket event for new message if socket service is available
    const { emitNewMessage, getIO } = await import('../config/Socket.js');
    
    if (emitNewMessage) {
      await emitNewMessage(savedMessage, socketId);
    }
    
    // Update conversation list for all members
    try {
      const io = getIO();
      if (io) {
        const updatedConversation = await ConversationModel.findById(conversationId)
          .populate({
            path: "members.idUser",
            select: { name: 1, avatar: 1 }
          })
          .populate("lastMessage");
          
        if (updatedConversation && updatedConversation.members) {
          updatedConversation.members.forEach(member => {
            if (member.idUser && member.idUser._id) {
              io.to(member.idUser._id.toString()).emit("update_conversation_list", {
                conversation: updatedConversation,
                newMessage: savedMessage
              });
            }
          });
        }
      }
    } catch (socketError) {
      console.error("Error sending socket updates:", socketError);
    }

    return res.status(200).json({
      success: true,
      message: 'Image generated successfully',
      data: savedMessage
    });

  } catch (error) {
    console.error('Error generating image:', error);
    return res.status(500).json({ error: 'Failed to generate image' });
  }
};

// Function to transform an existing image
export const transformImage = async (req, res) => {
  try {
    const { imageUrl, conversationId, sender, socketId, prompt } = req.body;
  
    if (!imageUrl) {
      return res.status(400).json({ error: 'Image URL is required' });
    }
  
    if (!conversationId) {
      return res.status(400).json({ error: 'Conversation ID is required' });
    }
  
    if (!sender) {
      return res.status(400).json({ error: 'Sender ID is required' });
    }
  
    if (prompt) {
      console.log(`Transformation prompt provided: ${prompt}`);
    }

    console.log(`Transforming image: ${imageUrl}`);

    // Call Replicate API to transform image
    // Using a style transfer model
    console.log('Calling Replicate API for image transformation...');
    // Choose appropriate model based on whether a prompt is provided
    let modelVersion;
    let input;
    
    if (prompt) {
      // If prompt is provided, use Stable Diffusion for image-to-image transformation
      modelVersion = "27b93a2413e7f36cd83da926f3656280b2931564ff050bf9575f1fdf9bcd7478";
      input = {
        image: imageUrl,
        prompt: prompt,
        strength: 0.6, // Controls how much to transform (0.0 = no change, 1.0 = complete change)
        guidance_scale: 7.5,
        num_inference_steps: 50
      };
    } else {
      // If no prompt, use Real-ESRGAN for upscaling/enhancement
      modelVersion = "42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b";
      input = {
        image: imageUrl,
        scale: 2,
        face_enhance: true
      };
    }
    
    const output = await callReplicateAPI(modelVersion, input);
    
    if (!output) {
      return res.status(500).json({ error: 'Failed to transform image' });
    }

    const transformedImageUrl = output;
    console.log(`Image transformed: ${transformedImageUrl}`);

    // Download the image from the URL
    const response = await axios.get(transformedImageUrl, { responseType: 'arraybuffer' });
    const tempFilePath = path.join(__dirname, `../temp/transformed_image_${uuidv4()}.png`);
    
    // Ensure temp directory exists
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Save the image temporarily
    fs.writeFileSync(tempFilePath, response.data);

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(tempFilePath, {
      folder: 'ai_transformed',
      resource_type: 'image'
    });

    // Delete the temporary file
    fs.unlinkSync(tempFilePath);

    // Get conversation to update
    const conversation = await ConversationModel.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Create a new message with the transformed image
    const newMessage = new MessageModel({
      idConversation: conversationId,
      sender: sender,
      content: 'AI enhanced image',
      type: 'image',
      fileUrl: result.secure_url,
      fileName: 'AI Enhanced Image',
      fileType: 'image/png',
      fileSize: result.bytes,
      isAIGenerated: true
    });

    // Save the message
    const savedMessage = await newMessage.save();

    // Update conversation's last message
    conversation.lastMessage = savedMessage._id;
    await conversation.save();

    // Emit socket event for new message if socket service is available
    const { emitNewMessage, getIO } = await import('../config/Socket.js');
    
    if (emitNewMessage) {
      await emitNewMessage(savedMessage, socketId);
    }
    
    // Update conversation list for all members
    try {
      const io = getIO();
      if (io) {
        const updatedConversation = await ConversationModel.findById(conversationId)
          .populate({
            path: "members.idUser",
            select: { name: 1, avatar: 1 }
          })
          .populate("lastMessage");
          
        if (updatedConversation && updatedConversation.members) {
          updatedConversation.members.forEach(member => {
            if (member.idUser && member.idUser._id) {
              io.to(member.idUser._id.toString()).emit("update_conversation_list", {
                conversation: updatedConversation,
                newMessage: savedMessage
              });
            }
          });
        }
      }
    } catch (socketError) {
      console.error("Error sending socket updates:", socketError);
    }

    return res.status(200).json({
      success: true,
      message: 'Image transformed successfully',
      data: savedMessage
    });

  } catch (error) {
    console.error('Error transforming image:', error);
    return res.status(500).json({ error: 'Failed to transform image' });
  }
};
