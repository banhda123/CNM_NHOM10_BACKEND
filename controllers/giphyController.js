import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;
const GIPHY_API_URL = 'https://api.giphy.com/v1/gifs';

// Tìm kiếm GIF từ Giphy API
export const searchGifs = async (req, res) => {
  try {
    const { q, limit = 20, offset = 0 } = req.query;
    
    if (!q) {
      return res.status(400).json({ message: 'Cần có từ khóa tìm kiếm' });
    }
    
    const response = await axios.get(`${GIPHY_API_URL}/search`, {
      params: {
        api_key: GIPHY_API_KEY,
        q,
        limit,
        offset,
        lang: 'vi'
      }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Lỗi khi tìm kiếm GIF:', error);
    res.status(500).json({ message: 'Lỗi khi tìm kiếm GIF', error: error.message });
  }
};

// Lấy GIF trending từ Giphy API
export const getTrendingGifs = async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    
    const response = await axios.get(`${GIPHY_API_URL}/trending`, {
      params: {
        api_key: GIPHY_API_KEY,
        limit,
        offset
      }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Lỗi khi lấy GIF trending:', error);
    res.status(500).json({ message: 'Lỗi khi lấy GIF trending', error: error.message });
  }
};

// Lấy GIF ngẫu nhiên từ Giphy API
export const getRandomGifs = async (req, res) => {
  try {
    const { tag, rating = 'g' } = req.query;
    
    const response = await axios.get(`${GIPHY_API_URL}/random`, {
      params: {
        api_key: GIPHY_API_KEY,
        tag,
        rating
      }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Lỗi khi lấy GIF ngẫu nhiên:', error);
    res.status(500).json({ message: 'Lỗi khi lấy GIF ngẫu nhiên', error: error.message });
  }
};
