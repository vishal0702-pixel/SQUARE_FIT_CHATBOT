import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import chatRoutes from "./routes/chatRoutes.js";

const app = express();

app.set("trust proxy", 1); // needed on EC2 behind nginx, so the real user IP is used

app.use(cors());
app.use(express.json());

const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,             // 20 requests per IP per minute
  message: { error: "Too many requests. Please wait a minute." },
});

app.use("/chat", chatLimiter, chatRoutes);

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Booking Chat API is running 🚀" });
});

app.listen(process.env.PORT || 5000, () => {
  console.log(`Server running on port ${process.env.PORT || 5000}`);
});