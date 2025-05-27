import express from 'express';
import { generateImageFromText, transformImage } from '../controllers/imageAIController.js';

const router = express.Router();

// Route to generate image from text prompt
router.post('/generate', generateImageFromText);

// Route to transform an existing image
router.post('/transform', transformImage);

export default router;
