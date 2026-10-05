import express from "express";
import {
  sendMessage,
  getChatHistory,
  getUserChatHistory,
} from "../controllers/chatController.js";

const router = express.Router();

router.post("/", sendMessage);              // POST /chat  (keeps old frontend working)
router.post("/message", sendMessage);       // POST /chat/message
router.get("/history/:sessionId", getChatHistory);
router.get("/user-history", getUserChatHistory);
//router.get("/slots", getSlots);


export default router;