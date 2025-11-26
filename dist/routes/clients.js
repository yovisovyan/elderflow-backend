"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const requireAdmin_1 = require("../middleware/requireAdmin");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
/**
 * GET /api/clients
 * Returns list of clients for the logged-in organization.
 * Care managers only see clients where they are the primary CM.
 */
router.get("/", async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const where = {
            orgId: req.user.orgId,
        };
        // 🔹 Care managers only see their own clients
        if (req.user.role === "care_manager") {
            where.primaryCMId = req.user.userId;
        }
        const clients = await prisma.client.findMany({
            where,
            orderBy: { name: "asc" },
        });
        res.json(clients);
    }
    catch (err) {
        console.error("Error fetching clients:", err);
        res.status(500).json({ error: "Failed to fetch clients" });
    }
});
/**
 * GET /api/clients/:id
 * Returns one client plus a simple billing summary:
 * - totalHoursBilled
 * - outstandingBalance
 * - lastInvoiceDate
 * Care managers can only access their own clients.
 */
router.get("/:id", async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { id } = req.params;
        const client = await prisma.client.findFirst({
            where: {
                id,
                orgId: req.user.orgId,
            },
        });
        if (!client) {
            return res.status(404).json({ error: "Client not found" });
        }
        // 🔹 Care manager cannot access another CM's client
        if (req.user.role === "care_manager" &&
            client.primaryCMId !== req.user.userId) {
            return res
                .status(403)
                .json({ error: "You are not allowed to access this client." });
        }
        // Fetch invoices + payments to build a simple summary
        const invoices = await prisma.invoice.findMany({
            where: {
                clientId: client.id,
                orgId: req.user.orgId,
            },
            include: {
                payments: true,
            },
            orderBy: {
                periodEnd: "desc",
            },
        });
        // total hours: sum of activity.duration / 60
        const activities = await prisma.activity.findMany({
            where: {
                clientId: client.id,
                orgId: req.user.orgId,
                isBillable: true,
            },
        });
        const totalMinutes = activities.reduce((sum, a) => sum + a.duration, 0);
        const totalHoursBilled = totalMinutes / 60;
        // outstanding balance = sum(invoice.totalAmount) - sum(payments.amount for completed)
        let outstandingBalance = 0;
        let lastInvoiceDate = null;
        for (const inv of invoices) {
            const paidAmount = inv.payments
                .filter((p) => p.status === "completed")
                .reduce((sum, p) => sum + p.amount, 0);
            const remaining = inv.totalAmount - paidAmount;
            if (remaining > 0) {
                outstandingBalance += remaining;
            }
            if (!lastInvoiceDate || (inv.periodEnd && inv.periodEnd > lastInvoiceDate)) {
                lastInvoiceDate = inv.periodEnd;
            }
        }
        res.json({
            client,
            summary: {
                totalHoursBilled,
                outstandingBalance,
                lastInvoiceDate,
            },
        });
    }
    catch (err) {
        console.error("Error fetching client:", err);
        res.status(500).json({ error: "Failed to fetch client" });
    }
});
/**
 * POST /api/clients
 * Creates a new client (admin only for now).
 */
router.post("/", async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        if (req.user.role !== "admin")
            return res.status(403).json({ error: "Only admin can create clients" });
        const { name, dob, address, billingContactName, billingContactEmail, billingContactPhone, primaryCMId, billingRulesJson, status, } = req.body;
        if (!name || !dob || !address || !billingContactName) {
            return res.status(400).json({ error: "Missing required fields" });
        }
        const client = await prisma.client.create({
            data: {
                orgId: req.user.orgId,
                primaryCMId,
                name,
                dob: new Date(dob),
                address,
                billingContactName,
                billingContactEmail,
                billingContactPhone,
                billingRulesJson: billingRulesJson || {},
                status: status || "active",
            },
        });
        res.status(201).json(client);
    }
    catch (err) {
        console.error("Error creating client:", err);
        res.status(500).json({ error: "Failed to create client" });
    }
});
router.patch("/:id", async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    if (req.user.role !== "admin") {
        return res.status(403).json({ error: "Only admin can update clients" });
    }
    const { name, status, billingContactName, billingContactEmail, billingContactPhone, billingRulesJson, } = req.body;
    try {
        const updated = await prisma.client.update({
            where: {
                id: req.params.id,
                // optionally enforce org: orgId: req.user.orgId,
            },
            data: {
                ...(name !== undefined ? { name } : {}),
                ...(status !== undefined ? { status } : {}),
                ...(billingContactName !== undefined ? { billingContactName } : {}),
                ...(billingContactEmail !== undefined ? { billingContactEmail } : {}),
                ...(billingContactPhone !== undefined ? { billingContactPhone } : {}),
                ...(billingRulesJson !== undefined ? { billingRulesJson } : {}),
            },
        });
        return res.json(updated);
    }
    catch (err) {
        console.error("Error updating client", err);
        return res.status(500).json({ error: "Failed to update client" });
    }
});
/**
 * PUT /api/clients/:id
 * Updates client info + billing rules.
 */
router.put("/:id", async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        if (req.user.role !== "admin") {
            return res.status(403).json({ error: "Only admin can update clients" });
        }
        const { id } = req.params;
        const { name, dob, address, billingContactName, billingContactEmail, billingContactPhone, billingRulesJson, status, } = req.body;
        // ensure client belongs to this org
        const existing = await prisma.client.findFirst({
            where: { id, orgId: req.user.orgId },
        });
        if (!existing) {
            return res.status(404).json({ error: "Client not found" });
        }
        const updated = await prisma.client.update({
            where: { id: existing.id },
            data: {
                name: name !== null && name !== void 0 ? name : existing.name,
                dob: dob ? new Date(dob) : existing.dob,
                address: address !== null && address !== void 0 ? address : existing.address,
                billingContactName: billingContactName !== null && billingContactName !== void 0 ? billingContactName : existing.billingContactName,
                billingContactEmail: billingContactEmail !== null && billingContactEmail !== void 0 ? billingContactEmail : existing.billingContactEmail,
                billingContactPhone: billingContactPhone !== null && billingContactPhone !== void 0 ? billingContactPhone : existing.billingContactPhone,
                billingRulesJson: billingRulesJson !== null && billingRulesJson !== void 0 ? billingRulesJson : existing.billingRulesJson,
                status: status !== null && status !== void 0 ? status : existing.status,
            },
        });
        res.json(updated);
    }
    catch (err) {
        console.error("Error updating client:", err);
        res.status(500).json({ error: "Failed to update client" });
    }
});
/**
 * GET /api/clients/:id/notes
 * Returns notes for a client (most recent first)
 * Care managers can only access notes for their own clients.
 */
router.get("/:id/notes", async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { id } = req.params;
        // Ensure client belongs to same org
        const client = await prisma.client.findFirst({
            where: {
                id,
                orgId: req.user.orgId,
            },
        });
        if (!client) {
            return res.status(404).json({ error: "Client not found" });
        }
        // 🔹 Care manager cannot access notes for another CM's client
        if (req.user.role === "care_manager" &&
            client.primaryCMId !== req.user.userId) {
            return res
                .status(403)
                .json({ error: "You are not allowed to access this client's notes." });
        }
        const notes = await prisma.note.findMany({
            where: {
                clientId: id,
                orgId: req.user.orgId,
            },
            orderBy: {
                createdAt: "desc",
            },
        });
        return res.json(notes.map((n) => ({
            id: n.id,
            content: n.content,
            createdAt: n.createdAt,
            authorId: n.authorId,
        })));
    }
    catch (err) {
        console.error("Error fetching notes", err);
        return res.status(500).json({ error: "Failed to fetch notes" });
    }
});
/**
 * POST /api/clients/:id/notes
 * Body: { content: string }
 * Care managers can only add notes for their own clients.
 */
router.post("/:id/notes", async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { id } = req.params;
        const { content } = req.body;
        if (!content || !content.trim()) {
            return res.status(400).json({ error: "Note content is required" });
        }
        const client = await prisma.client.findFirst({
            where: {
                id,
                orgId: req.user.orgId,
            },
        });
        if (!client) {
            return res.status(404).json({ error: "Client not found" });
        }
        // 🔹 Care manager cannot add notes for another CM's client
        if (req.user.role === "care_manager" &&
            client.primaryCMId !== req.user.userId) {
            return res
                .status(403)
                .json({ error: "You are not allowed to add notes for this client." });
        }
        const note = await prisma.note.create({
            data: {
                orgId: req.user.orgId,
                clientId: id,
                authorId: req.user.userId,
                content: content.trim(),
            },
        });
        return res.status(201).json(note);
    }
    catch (err) {
        console.error("Error creating note", err);
        return res.status(500).json({ error: "Failed to create note" });
    }
});
/**
 * GET /api/clients/:id/billing-rules
 * Returns org-level and client-specific billing rules.
 * Care managers can only access billing rules for their own clients.
 */
router.get("/:id/billing-rules", async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { id } = req.params;
        const [org, client] = await Promise.all([
            prisma.organization.findUnique({
                where: { id: req.user.orgId },
                select: { billingRulesJson: true },
            }),
            prisma.client.findFirst({
                where: {
                    id,
                    orgId: req.user.orgId,
                },
                select: {
                    id: true,
                    billingRulesJson: true,
                    primaryCMId: true,
                },
            }),
        ]);
        if (!client) {
            return res.status(404).json({ error: "Client not found" });
        }
        // 🔹 Care manager cannot access billing rules for another CM's client
        if (req.user.role === "care_manager" &&
            client.primaryCMId !== req.user.userId) {
            return res.status(403).json({
                error: "You are not allowed to access this client's billing rules.",
            });
        }
        const orgRules = (org === null || org === void 0 ? void 0 : org.billingRulesJson) || {};
        const clientRules = client.billingRulesJson || {};
        return res.json({
            ok: true,
            orgRules,
            clientRules,
        });
    }
    catch (err) {
        console.error("Error fetching client billing rules:", err);
        return res
            .status(500)
            .json({ error: "Failed to fetch client billing rules." });
    }
});
/**
 * POST /api/clients/:id/billing-rules
 * ADMIN ONLY – Save client-specific billing rules overrides.
 */
router.post("/:id/billing-rules", requireAdmin_1.requireAdmin, async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { id } = req.params;
        const { rules } = req.body;
        if (!rules || typeof rules !== "object") {
            return res.status(400).json({ error: "Invalid rules JSON." });
        }
        const client = await prisma.client.findFirst({
            where: {
                id,
                orgId: req.user.orgId,
            },
        });
        if (!client) {
            return res.status(404).json({ error: "Client not found" });
        }
        const updated = await prisma.client.update({
            where: { id: client.id },
            data: { billingRulesJson: rules },
        });
        return res.json({
            ok: true,
            clientRules: updated.billingRulesJson,
        });
    }
    catch (err) {
        console.error("Error saving client billing rules:", err);
        return res
            .status(500)
            .json({ error: "Failed to save client billing rules." });
    }
});
exports.default = router;
