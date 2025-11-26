"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
/**
 * POST /api/reports/generate
 * Body: { type, periodStart, periodEnd }
 * Types can be: "monthly_summary", "client_summary", "audit_log" (for now we just store metadata).
 */
router.post("/generate", async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { type, periodStart, periodEnd } = req.body;
        if (!type || !periodStart || !periodEnd) {
            return res
                .status(400)
                .json({ error: "type, periodStart, periodEnd are required" });
        }
        const start = new Date(periodStart);
        const end = new Date(periodEnd);
        // Simple placeholder "file URL"
        const report = await prisma.report.create({
            data: {
                orgId: req.user.orgId,
                type,
                periodStart: start,
                periodEnd: end,
                fileUrl: `demo://report-${type}-${Date.now()}.pdf`,
            },
        });
        res.status(201).json(report);
    }
    catch (err) {
        console.error("Error generating report:", err);
        res.status(500).json({ error: "Failed to generate report" });
    }
});
/**
 * GET /api/reports
 * Returns list of generated reports for this org.
 */
router.get("/", async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const reports = await prisma.report.findMany({
            where: {
                orgId: req.user.orgId,
            },
            orderBy: {
                createdAt: "desc",
            },
        });
        res.json(reports);
    }
    catch (err) {
        console.error("Error fetching reports:", err);
        res.status(500).json({ error: "Failed to fetch reports" });
    }
});
exports.default = router;
