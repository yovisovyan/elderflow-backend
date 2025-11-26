"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
router.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ error: "Email and password required" });
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user)
        return res.status(401).json({ error: "Invalid credentials" });
    const passOK = await bcryptjs_1.default.compare(password, user.password);
    if (!passOK)
        return res.status(401).json({ error: "Invalid credentials" });
    // Create JWT
    const token = jsonwebtoken_1.default.sign({
        userId: user.id,
        orgId: user.orgId,
        role: user.role,
    }, process.env.JWT_SECRET || "secret", { expiresIn: "2h" });
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
exports.default = router;
