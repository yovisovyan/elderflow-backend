"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const requireAdmin_1 = require("../middleware/requireAdmin");
const prisma = new client_1.PrismaClient();
const router = (0, express_1.Router)();
/**
 * GET /api/users
 * Admin-only list of users. Optional query: ?role=care_manager
 */
router.get("/", requireAdmin_1.requireAdmin, async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { role } = req.query;
        const where = {
            orgId: req.user.orgId,
        };
        if (role && typeof role === "string") {
            where.role = role;
        }
        const users = await prisma.user.findMany({
            where,
            include: {
                _count: {
                    select: {
                        clients: true, // relation "PrimaryCM" on User
                    },
                },
            },
            orderBy: { name: "asc" },
        });
        return res.json({
            users: users.map((u) => ({
                id: u.id,
                name: u.name,
                email: u.email,
                role: u.role,
                clientsCount: u._count.clients,
                createdAt: u.createdAt,
            })),
        });
    }
    catch (err) {
        console.error("Error fetching users:", err);
        return res.status(500).json({ error: "Failed to fetch users." });
    }
});
/**
 * GET /api/users/:id/summary
 * Admin-only – details for a specific user with assigned clients.
 */
router.get("/:id/summary", requireAdmin_1.requireAdmin, async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { id } = req.params;
        const user = await prisma.user.findFirst({
            where: {
                id,
                orgId: req.user.orgId,
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                createdAt: true,
            },
        });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        const clients = await prisma.client.findMany({
            where: {
                orgId: req.user.orgId,
                primaryCMId: id,
            },
            select: {
                id: true,
                name: true,
                status: true,
            },
            orderBy: { name: "asc" },
        });
        return res.json({
            user,
            clients,
        });
    }
    catch (err) {
        console.error("Error fetching user summary:", err);
        return res
            .status(500)
            .json({ error: "Failed to fetch user summary." });
    }
});
/**
 * POST /api/users
 * Admin-only – create a new user (role: care_manager or admin).
 * (Your original logic, preserved and extended slightly)
 */
router.post("/", async (req, res) => {
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
            return res.status(400).json({
                error: "Current user is not associated with an organization.",
            });
        }
        const { name, email, password, role } = req.body;
        if (!name || !email || !password) {
            return res
                .status(400)
                .json({ error: "name, email and password are required." });
        }
        const normalizedRole = role === "admin" || role === "care_manager" ? role : "care_manager";
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
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
    }
    catch (err) {
        console.error("Error creating user:", err);
        if (err.code === "P2002") {
            return res.status(409).json({ error: "Email already in use." });
        }
        return res.status(500).json({ error: "Failed to create user." });
    }
});
/**
 * POST /api/users/:id/assign-clients
 * Admin-only – assign clients to a care manager.
 * Body: { clientIds: string[] }
 *
 * NOTE: We only assign, we don't force-unassign others to avoid null issues
 * with primaryCMId being non-nullable in the schema.
 */
router.post("/:id/assign-clients", requireAdmin_1.requireAdmin, async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { id } = req.params;
        const { clientIds } = req.body;
        if (!Array.isArray(clientIds)) {
            return res
                .status(400)
                .json({ error: "clientIds must be an array of client IDs." });
        }
        const user = await prisma.user.findFirst({
            where: {
                id,
                orgId: req.user.orgId,
            },
        });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        if (user.role !== "care_manager") {
            return res.status(400).json({
                error: "Only care managers can have client assignments.",
            });
        }
        const orgId = req.user.orgId;
        // Assign this CM to all specified clients (overwrites any previous CM)
        if (clientIds.length > 0) {
            await prisma.client.updateMany({
                where: {
                    orgId,
                    id: {
                        in: clientIds,
                    },
                },
                data: {
                    primaryCMId: id,
                },
            });
        }
        const clients = await prisma.client.findMany({
            where: {
                orgId,
                primaryCMId: id,
            },
            select: {
                id: true,
                name: true,
                status: true,
            },
            orderBy: { name: "asc" },
        });
        return res.json({
            ok: true,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
            },
            clients,
        });
    }
    catch (err) {
        console.error("Error assigning clients to user:", err);
        return res
            .status(500)
            .json({ error: "Failed to assign clients to user." });
    }
});
exports.default = router;
