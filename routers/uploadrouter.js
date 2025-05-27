// routes/uploadRoute.js
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { uploadToCloudinary } from '../config/Cloudinary.js';
import { isAuth } from '../utils/index.js';

const router = express.Router();

// Configure multer for all file types
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Updated upload middleware for all file types
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB limit
    }
});

router.post('/upload', isAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        const filePath = req.file.path;
        let folder = 'zalo_files';

        // Determine folder based on file type
        if (req.file.mimetype.startsWith('image/')) {
            folder = 'zalo_images';
        } else if (req.file.mimetype.startsWith('video/')) {
            folder = 'zalo_videos';
        } else if (req.file.mimetype.startsWith('audio/')) {
            folder = 'zalo_audio';
        }

        // Upload to Cloudinary
        const result = await uploadToCloudinary(filePath, folder);

        // Remove temporary file
        fs.unlinkSync(filePath);

        // Return response
        res.json({
            message: 'Upload successful',
            url: result.secure_url,
            public_id: result.public_id,
            fileUrl: result.secure_url,
            fileName: req.file.originalname,
            fileType: req.file.mimetype
        });
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
