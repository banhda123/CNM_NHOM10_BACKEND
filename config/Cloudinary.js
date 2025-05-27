// cloudinary.js
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

export const uploadToCloudinary = async (filePath, folder = 'uploads') => {
    // Determine file extension
    const fileExtension = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    
    // Determine resource_type based on file extension
    let resourceType = 'auto'; // auto will try to detect the file type
    let uploadOptions = {
        folder,
        resource_type: resourceType,
    };
    
    // Explicitly set resource_type for known file types
    if (['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv'].includes(fileExtension)) {
        resourceType = 'video';
        uploadOptions.resource_type = resourceType;
    } else if (['.mp3', '.wav', '.ogg', '.m4a'].includes(fileExtension)) {
        resourceType = 'audio';
        uploadOptions.resource_type = resourceType;
    } else if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(fileExtension)) {
        resourceType = 'image';
        uploadOptions.resource_type = resourceType;
    } else if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'].includes(fileExtension)) {
        resourceType = 'raw';
        uploadOptions.resource_type = resourceType;
        
        // Add options for document files
        uploadOptions.use_filename = true;
        uploadOptions.unique_filename = true;
        uploadOptions.overwrite = false;
        
        // Remove attachment flag to allow viewing in browser
        // Cloudinary sẽ trả về URL có thể mở trực tiếp
        
        // Thêm public_id có ý nghĩa
        uploadOptions.public_id = `file_${Date.now()}_${path.basename(fileName, fileExtension)}`;
    }
    
    console.log(`Uploading file: ${fileName} with options:`, uploadOptions);
    
    try {
        const result = await cloudinary.uploader.upload(filePath, uploadOptions);
        console.log(`Upload successful. URL: ${result.secure_url}`);
        return result;
    } catch (error) {
        console.error(`Upload error: ${error.message}`);
        throw error;
    }
};

export default cloudinary;
