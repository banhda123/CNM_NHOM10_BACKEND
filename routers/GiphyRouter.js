import express from "express";
import { searchGifs, getTrendingGifs, getRandomGifs } from "../controllers/giphyController.js";
import { isAuth } from "../utils/index.js";

const GiphyRouter = express.Router();

// Các route cho Giphy API
GiphyRouter.get("/search", searchGifs);
GiphyRouter.get("/trending", getTrendingGifs);
GiphyRouter.get("/random", getRandomGifs);

export default GiphyRouter;
