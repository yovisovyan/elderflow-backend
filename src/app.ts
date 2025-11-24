import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

import authRoutes from "./routes/auth";
import clientsRoutes from "./routes/clients";
import activitiesRoutes from "./routes/activities";
import aiRoutes from "./routes/ai";
import invoicesRoutes from "./routes/invoices";
import paymentsRoutes from "./routes/payments";
import dashboardRoutes from "./routes/dashboard";
import reportsRoutes from "./routes/reports";
import { authMiddleware } from "./middleware/auth";
import stripeRouter, { stripeWebhookHandler } from "./routes/stripe";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

// 🔹 CORS – allow all origins for now (including Vercel)
app.use(
  cors({
    origin: true,        // reflect request origin
    credentials: true,
  })
);

// 🔹 Stripe webhook (raw body)
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler
);

// 🔹 JSON body parser for the rest of your API
app.use(express.json());

// 🔹 Public routes
app.use("/api/auth", authRoutes);
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// 🔹 Protected routes
app.use("/api/clients", authMiddleware, clientsRoutes);
app.use("/api/activities", authMiddleware, activitiesRoutes);
app.use("/api/ai", authMiddleware, aiRoutes);
app.use("/api/invoices", authMiddleware, invoicesRoutes);
app.use("/api/payments", authMiddleware, paymentsRoutes);
app.use("/api/dashboard", authMiddleware, dashboardRoutes);
app.use("/api/reports", authMiddleware, reportsRoutes);

// 🔹 Non-webhook Stripe routes (currently stubbed)
app.use("/api/stripe", stripeRouter);

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Backend API running on port ${PORT}`);
});
