import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const router = Router();
const prisma = new PrismaClient();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user)
    return res.status(401).json({ error: "Invalid credentials" });

  const passOK = await bcrypt.compare(password, user.password);
  if (!passOK)
    return res.status(401).json({ error: "Invalid credentials" });

  // Create JWT
  const token = jwt.sign(
    {
      userId: user.id,
      orgId: user.orgId,
      role: user.role,
    },
    process.env.JWT_SECRET || "secret",
    { expiresIn: "2h" }
  );

  // Update last login time
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  });

  res.json({
    message: "Login successful",
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
    },
  });
});

export default router;
