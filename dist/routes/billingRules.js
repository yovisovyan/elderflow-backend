"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const requireAdmin_1 = require("../middleware/requireAdmin");
const prisma = new client_1.PrismaClient();
const router = (0, express_1.Router)();
/**
 * GET /api/billing/rules
 */
router.get("/", async (req, res) => {
    var _a;
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const org = await prisma.organization.findUnique({
            where: { id: req.user.orgId },
            select: { billingRulesJson: true },
        });
        return res.json({
            ok: true,
            rules: (_a = org === null || org === void 0 ? void 0 : org.billingRulesJson) !== null && _a !== void 0 ? _a : {},
        });
    }
    catch (err) {
        console.error("Error fetching billing rules:", err);
        return res.status(500).json({ error: "Failed to fetch billing rules." });
    }
});
/**
 * POST /api/billing/rules
 * ADMIN ONLY
 */
router.post("/", requireAdmin_1.requireAdmin, async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { rules } = req.body;
        if (!rules || typeof rules !== "object") {
            return res.status(400).json({ error: "Invalid rules JSON." });
        }
        const updated = await prisma.organization.update({
            where: { id: req.user.orgId },
            data: { billingRulesJson: rules },
        });
        return res.json({ ok: true, rules: updated.billingRulesJson });
    }
    catch (err) {
        console.error("Error saving billing rules:", err);
        return res.status(500).json({ error: "Failed to save billing rules." });
    }
});
exports.default = router;
