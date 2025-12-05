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
import usersRoutes from "./routes/users";
import billingRulesRoutes from "./routes/billingRules";
import stripeRouter, { stripeWebhookHandler } from "./routes/stripe";
import serviceTypesRoutes from "./routes/serviceTypes";
import cmDashboardRoutes from "./routes/cmDashboard";
import { errorHandler } from "./middleware/errorHandler";
import orgRouter from "./routes/org";




dotenv.config();

const app = express();
const prisma = new PrismaClient();

// 🔹 CORS – allow all origins for now (Vercel + local)
app.use(
  cors({
    origin: true, // reflect request origin
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
app.use("/api/service-types", authMiddleware, serviceTypesRoutes);
app.use("/api/cm", authMiddleware, cmDashboardRoutes);
app.use(errorHandler);




// 🔹 Admin-only user management
app.use("/api/users", authMiddleware, usersRoutes);

// 🔹 Org billing rules (GET for any authed user, POST is admin-only inside the route)
app.use("/api/billing/rules", authMiddleware, billingRulesRoutes);

// 🔹 Non-webhook Stripe routes (currently stubbed)
app.use("/api/stripe", stripeRouter);

app.use("/api/org", authMiddleware, orgRouter);


const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Backend API running on port ${PORT}`);
});
