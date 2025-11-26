"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const router = (0, express_1.Router)();
/**
 * GET /api/cm/summary
 * Summary for the currently logged-in care manager
 */
router.get("/summary", async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const cmId = req.user.userId;
        const orgId = req.user.orgId;
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const [last7, last30, recentActivities] = await Promise.all([
            prisma.activity.findMany({
                where: {
                    orgId,
                    cmId,
                    startTime: { gte: sevenDaysAgo },
                },
                include: {
                    client: true,
                    serviceType: true,
                },
                orderBy: { startTime: "desc" },
            }),
            prisma.activity.findMany({
                where: {
                    orgId,
                    cmId,
                    startTime: { gte: thirtyDaysAgo },
                },
                // no include needed here for summary, only duration/isBillable
                orderBy: { startTime: "desc" },
            }),
            prisma.activity.findMany({
                where: {
                    orgId,
                    cmId,
                },
                include: {
                    client: true,
                    serviceType: true,
                },
                orderBy: { startTime: "desc" },
                take: 8,
            }),
        ]);
        // just care about duration + isBillable
        const sumMinutes = (rows, billableOnly = false) => rows.reduce((sum, a) => {
            if (billableOnly && !a.isBillable)
                return sum;
            return sum + (a.duration || 0);
        }, 0);
        const last7Minutes = sumMinutes(last7);
        const last7BillableMinutes = sumMinutes(last7, true);
        const last7Hours = last7Minutes / 60;
        const last7BillableHours = last7BillableMinutes / 60;
        const last30Minutes = sumMinutes(last30);
        const last30Hours = last30Minutes / 60;
        return res.json({
            metrics: {
                last7Days: {
                    activitiesCount: last7.length,
                    hours: Number(last7Hours.toFixed(2)),
                    billableHours: Number(last7BillableHours.toFixed(2)),
                },
                last30Days: {
                    activitiesCount: last30.length,
                    hours: Number(last30Hours.toFixed(2)),
                },
            },
            recentActivities,
        });
    }
    catch (err) {
        console.error("Error fetching CM summary:", err);
        return res.status(500).json({ error: "Failed to fetch CM summary." });
    }
});
exports.default = router;
