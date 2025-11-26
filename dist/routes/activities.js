"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
/**
 * GET /api/activities
 * Query params:
 *  - clientId (optional)
 *  - flagged (optional: "true" or "false")
 *
 * Admin: all activities in org (optionally filtered)
 * Care manager: ONLY activities they logged (cmId = current user)
 */
router.get("/", async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { clientId, flagged } = req.query;
        const where = {
            orgId: req.user.orgId,
        };
        if (clientId)
            where.clientId = clientId;
        if (flagged === "true")
            where.isFlagged = true;
        if (flagged === "false")
            where.isFlagged = false;
        // 🔹 Care managers only see activities they logged themselves
        if (req.user.role === "care_manager") {
            where.cmId = req.user.userId;
        }
        const activities = await prisma.activity.findMany({
            where,
            orderBy: { startTime: "desc" },
            include: {
                client: true,
                cm: true,
                serviceType: true,
            },
        });
        res.json(activities);
    }
    catch (err) {
        console.error("Error fetching activities:", err);
        res.status(500).json({ error: "Failed to fetch activities" });
    }
});
/**
 * GET /api/activities/:id
 * Returns a single activity with related client & care manager.
 *
 * Care managers can only see their own activities.
 */
router.get("/:id", async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { id } = req.params;
        const activity = await prisma.activity.findFirst({
            where: {
                id,
                orgId: req.user.orgId,
            },
            include: {
                client: true,
                cm: true,
                serviceType: true,
            },
        });
        if (!activity) {
            return res.status(404).json({ error: "Activity not found" });
        }
        // 🔹 Care manager cannot view other users' activities
        if (req.user.role === "care_manager" &&
            activity.cmId !== req.user.userId) {
            return res
                .status(403)
                .json({ error: "You are not allowed to view this activity." });
        }
        res.json(activity);
    }
    catch (err) {
        console.error("Error fetching activity:", err);
        res.status(500).json({ error: "Failed to fetch activity" });
    }
});
/**
 * POST /api/activities
 * Creates a manual activity entry (not AI-generated).
 * Body:
 *  - clientId
 *  - source ("phone" | "email" | "visit" | "manual")
 *  - startTime (ISO string)
 *  - endTime (ISO string)
 *  - isBillable (boolean)
 *  - notes (string)
 *  - serviceTypeId (optional)
 */
router.post("/", async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { clientId, startTime, endTime, duration, notes, source, isBillable, serviceTypeId, } = req.body;
        if (!clientId || !source || !startTime || !endTime) {
            return res.status(400).json({
                error: "clientId, source, startTime, endTime are required",
            });
        }
        const start = new Date(startTime);
        const end = new Date(endTime);
        const computedDuration = duration !== null && duration !== void 0 ? duration : Math.round((end.getTime() - start.getTime()) / 60000);
        // --- Validate serviceTypeId if provided ---
        let finalServiceTypeId = null;
        if (serviceTypeId) {
            const svc = await prisma.serviceType.findFirst({
                where: {
                    id: serviceTypeId,
                    orgId: req.user.orgId,
                    isActive: true,
                },
            });
            if (!svc) {
                return res.status(400).json({ error: "Invalid serviceTypeId" });
            }
            finalServiceTypeId = svc.id;
        }
        const activity = await prisma.activity.create({
            data: {
                orgId: req.user.orgId,
                clientId,
                cmId: req.user.userId,
                source,
                startTime: start,
                endTime: end,
                duration: computedDuration,
                billingCode: null,
                isBillable: isBillable !== null && isBillable !== void 0 ? isBillable : true,
                aiConfidence: 0.95,
                notes: notes !== null && notes !== void 0 ? notes : "",
                isFlagged: false,
                capturedByAi: false,
                serviceTypeId: finalServiceTypeId,
            },
            include: {
                client: true,
                cm: true,
                serviceType: true,
            },
        });
        res.status(201).json(activity);
    }
    catch (err) {
        console.error("Error creating activity:", err);
        res.status(500).json({ error: "Failed to create activity" });
    }
});
exports.default = router;
