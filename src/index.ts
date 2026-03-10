import dotenv from "dotenv";
dotenv.config();

import express from "express";
import authRoutes from "./routes/auth";
import launchRoutes from "./routes/launches";
import whitelistRoutes from "./routes/whitelist";
import referralRoutes from "./routes/referrals";
import purchaseRoutes from "./routes/purchases";
import vestingRoutes from "./routes/vesting";
import { errorHandler } from "./error";

const app = express();
app.use(express.json());

// Health check
app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Auth
app.use("/api/auth", authRoutes);

// Launch CRUD
app.use("/api/launches", launchRoutes);

// Sub-resources — order matters: more specific paths first
app.use("/api/launches/:id/whitelist", whitelistRoutes);
app.use("/api/launches/:id/referrals", referralRoutes);
app.use("/api/launches/:id/vesting", vestingRoutes);
// Purchases: handles both /purchase (POST) and /purchases (GET)
app.use("/api/launches/:id", purchaseRoutes);

// Global error handler
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
