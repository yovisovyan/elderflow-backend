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


dotenv.config();

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

// PUBLIC ROUTES
app.use("/api/auth", authRoutes);
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// PROTECTED ROUTES
app.use("/api/clients", authMiddleware, clientsRoutes);
app.use("/api/activities", authMiddleware, activitiesRoutes);
app.use("/api/ai", authMiddleware, aiRoutes);
app.use("/api/invoices", authMiddleware, invoicesRoutes);
app.use("/api/payments", authMiddleware, paymentsRoutes);
app.use("/api/dashboard", authMiddleware, dashboardRoutes);
app.use("/api/reports", authMiddleware, reportsRoutes);
app.use("/api/invoices", invoicesRoutes);
app.use(express.json());


const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Backend API running on port ${PORT}`);
});
