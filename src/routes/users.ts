import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { AuthRequest } from "../middleware/auth";

const prisma = new PrismaClient();
const router = Router();

// POST /api/users
// Admin-only: create a new user (defaults to care_manager)
router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    const authUser = req.user;

    if (!authUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (authUser.role !== "admin") {
      return res.status(403).json({ error: "Admin role required" });
    }

    if (!authUser.orgId) {
      console.error("create user: authUser.orgId is missing", authUser);
      return res
        .status(400)
        .json({ error: "Current user is not associated with an organization." });
    }

    const { name, email, password, role } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      role?: string;
    };

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ error: "name, email and password are required." });
    }

    const normalizedRole = (role as string) ?? "care_manager";
    if (!["admin", "care_manager"].includes(normalizedRole)) {
      return res.status(400).json({ error: "Invalid role." });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        orgId: authUser.orgId,
        role: normalizedRole,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password: passwordHash,
      },
    });

    return res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  } catch (err: any) {
    console.error("Error creating user:", err);

    if (err.code === "P2002") {
      // Prisma unique constraint (likely email)
      return res.status(409).json({ error: "Email already in use." });
    }

    return res.status(500).json({ error: "Failed to create user." });
  }
});

export default router;
