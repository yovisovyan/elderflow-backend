"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
/**
 * GET /api/cm/summary
 * Summary for the currently logged-in care manager:
 *  - todayHours
 *  - weekHours (last 7 days)
 *  - assignedClients
 *  - recentActivities
 *  - upcomingVisits (future activities with source="visit")
 */
router.get("/summary", async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const cmId = req.user.userId;
        const orgId = req.user.orgId;
        const now = new Date();
        // Today range
        const startToday = new Date(now);
        startToday.setHours(0, 0, 0, 0);
        const endToday = new Date(now);
        endToday.setHours(23, 59, 59, 999);
        // Last 7 days
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const [todayActivities, weekActivities, assignedClientsCount, recentActivities, upcomingVisitsRaw,] = await Promise.all([
            prisma.activity.findMany({
                where: {
                    orgId,
                    cmId,
                    startTime: {
                        gte: startToday,
                        lte: endToday,
                    },
                },
                select: {
                    duration: true,
                },
            }),
            prisma.activity.findMany({
                where: {
                    orgId,
                    cmId,
                    startTime: {
                        gte: sevenDaysAgo,
                    },
                },
                select: {
                    duration: true,
                },
            }),
            prisma.client.count({
                where: {
                    orgId,
                    primaryCMId: cmId,
                },
            }),
            prisma.activity.findMany({
                where: {
                    orgId,
                    cmId,
                },
                include: {
                    client: { select: { name: true } },
                    serviceType: { select: { name: true } },
                },
                orderBy: {
                    startTime: "desc",
                },
                take: 10,
            }),
            prisma.activity.findMany({
                where: {
                    orgId,
                    cmId,
                    startTime: {
                        gt: now,
                    },
                    OR: [
                        { source: "visit" },
                        { source: "Visit" },
                        { source: "VISIT" },
                    ],
                },
                include: {
                    client: { select: { name: true } },
                    serviceType: { select: { name: true } },
                },
                orderBy: {
                    startTime: "asc",
                },
                take: 5,
            }),
        ]);
        const sumMinutes = (rows) => rows.reduce((sum, a) => sum + (a.duration || 0), 0);
        const todayHours = sumMinutes(todayActivities) / 60;
        const weekHours = sumMinutes(weekActivities) / 60;
        const recentActivitiesMapped = recentActivities.map((a) => {
            var _a, _b, _c, _d;
            return ({
                id: a.id,
                startTime: a.startTime,
                duration: a.duration,
                isBillable: a.isBillable,
                client: { name: (_b = (_a = a.client) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null },
                serviceType: { name: (_d = (_c = a.serviceType) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : null },
            });
        });
        const upcomingVisits = upcomingVisitsRaw.map((a) => {
            var _a, _b, _c, _d;
            return ({
                id: a.id,
                startTime: a.startTime,
                duration: a.duration,
                clientName: (_b = (_a = a.client) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "Unknown client",
                serviceName: (_d = (_c = a.serviceType) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "Visit",
            });
        });
        return res.json({
            todayHours: Number(todayHours.toFixed(2)),
            weekHours: Number(weekHours.toFixed(2)),
            assignedClients: assignedClientsCount,
            recentActivities: recentActivitiesMapped,
            upcomingVisits,
        });
    }
    catch (err) {
        console.error("Error fetching CM summary:", err);
        return res.status(500).json({ error: "Failed to fetch CM summary." });
    }
});
exports.default = router;
