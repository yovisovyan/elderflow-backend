"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
/**
 * Simple reusable audit logger for activities (and other entities if needed)
 */
async function logAudit(req, params) {
    var _a, _b;
    if (!req.user)
        return;
    try {
        await prisma.auditLog.create({
            data: {
                orgId: req.user.orgId,
                userId: req.user.userId,
                entityType: params.entityType,
                entityId: (_a = params.entityId) !== null && _a !== void 0 ? _a : null,
                action: params.action,
                details: (_b = params.details) !== null && _b !== void 0 ? _b : null,
            },
        });
    }
    catch (err) {
        // Never let audit logging crash the main request
        console.error("Error writing activity audit log:", err);
    }
}
/**
 * PATCH /api/activities/:id
 * Update activity fields (source, isBillable, isFlagged, notes).
 * Admins can edit any activity in their org.
 * Care managers can only edit their own activities (cmId = req.user.userId).
 */
router.patch("/:id", async (req, res) => {
    var _a, _b, _c, _d, _e;
    try {
        if (!req.user) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const { id } = req.params;
        const { source, isBillable, isFlagged, notes } = req.body;
        // Make sure there's at least something to update
        if (typeof source === "undefined" &&
            typeof isBillable === "undefined" &&
            typeof isFlagged === "undefined" &&
            typeof notes === "undefined") {
            return res.status(400).json({
                error: "No fields to update. Allowed fields: source, isBillable, isFlagged, notes.",
            });
        }
        // Find activity in org
        const activity = await prisma.activity.findFirst({
            where: {
                id,
                orgId: req.user.orgId,
            },
        });
        if (!activity) {
            return res.status(404).json({ error: "Activity not found" });
        }
        // Role-based authorization: care managers can only touch their own activities
        if (req.user.role === "care_manager" && activity.cmId !== req.user.userId) {
            return res
                .status(403)
                .json({ error: "You are not allowed to edit this activity." });
        }
        // Build update payload only with provided fields
        const data = {};
        if (typeof source !== "undefined") {
            data.source = source || "manual";
        }
        if (typeof isBillable !== "undefined") {
            data.isBillable = !!isBillable;
        }
        if (typeof isFlagged !== "undefined") {
            data.isFlagged = !!isFlagged;
        }
        if (typeof notes !== "undefined") {
            data.notes = notes && notes.trim().length > 0 ? notes.trim() : null;
        }
        // Always track who made this change
        data.updatedById = req.user.userId;
        const currentUser = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { name: true },
        });
        data.updatedByName = (_a = currentUser === null || currentUser === void 0 ? void 0 : currentUser.name) !== null && _a !== void 0 ? _a : null;
        const updated = await prisma.activity.update({
            where: { id: activity.id },
            data,
        });
        // Audit log: updated activity
        const changes = [];
        if (typeof source !== "undefined" && source !== activity.source) {
            changes.push(`source: "${activity.source}" -> "${updated.source}"`);
        }
        if (typeof isBillable !== "undefined" && !!isBillable !== activity.isBillable) {
            changes.push(`isBillable: "${activity.isBillable}" -> "${updated.isBillable}"`);
        }
        if (typeof isFlagged !== "undefined" && !!isFlagged !== activity.isFlagged) {
            changes.push(`isFlagged: "${activity.isFlagged}" -> "${updated.isFlagged}"`);
        }
        if (typeof notes !== "undefined" && notes !== activity.notes) {
            const oldLen = (_c = (_b = activity.notes) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0;
            const newLen = (_e = (_d = updated.notes) === null || _d === void 0 ? void 0 : _d.length) !== null && _e !== void 0 ? _e : 0;
            changes.push(`notes changed (length ${oldLen} -> ${newLen})`);
        }
        await logAudit(req, {
            entityType: "activity",
            entityId: updated.id,
            action: "update",
            details: changes.length > 0
                ? `Updated activity ${updated.id} for client ${updated.clientId}: ${changes.join("; ")}`
                : `Updated activity ${updated.id} for client ${updated.clientId}`,
        });
        return res.json(updated);
    }
    catch (err) {
        console.error("Error updating activity:", err);
        return res.status(500).json({ error: "Failed to update activity" });
    }
});
/**
 * DELETE /api/activities/:id
 * Delete an activity.
 * Admins can delete any activity in their org.
 * Care managers can only delete their own activities.
 * If the activity has already been invoiced, we block delete to avoid breaking invoices.
 */
router.delete("/:id", async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const { id } = req.params;
        // Find activity in org
        const activity = await prisma.activity.findFirst({
            where: {
                id,
                orgId: req.user.orgId,
            },
            include: {
                client: true,
                cm: true,
                serviceType: true,
                updatedBy: {
                    select: { name: true },
                },
            },
        });
        if (!activity) {
            return res.status(404).json({ error: "Activity not found" });
        }
        // Role-based authorization
        if (req.user.role === "care_manager" && activity.cmId !== req.user.userId) {
            return res
                .status(403)
                .json({ error: "You are not allowed to delete this activity." });
        }
        // Block delete if the activity is already linked to an invoice
        const invoicedItem = await prisma.invoiceItem.findFirst({
            where: {
                activityId: activity.id,
            },
        });
        if (invoicedItem) {
            return res.status(400).json({
                error: "This activity has already been invoiced. Adjust the invoice instead of deleting the activity.",
            });
        }
        await prisma.activity.delete({
            where: { id: activity.id },
        });
        await logAudit(req, {
            entityType: "activity",
            entityId: activity.id,
            action: "delete",
            details: `Deleted activity ${activity.id} for client ${activity.clientId}`,
        });
        return res.json({ ok: true });
    }
    catch (err) {
        console.error("Error deleting activity:", err);
        return res.status(500).json({ error: "Failed to delete activity" });
    }
});
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
        // Care managers only see activities they logged themselves
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
                updatedBy: {
                    select: { name: true },
                },
            },
        });
        if (!activity) {
            return res.status(404).json({ error: "Activity not found" });
        }
        // Care manager cannot view other users' activities
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
        // Validate serviceTypeId if provided
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
        await logAudit(req, {
            entityType: "activity",
            entityId: activity.id,
            action: "create",
            details: `Created activity ${activity.id} for client ${activity.clientId} (${activity.source})`,
        });
        res.status(201).json(activity);
    }
    catch (err) {
        console.error("Error creating activity:", err);
        res.status(500).json({ error: "Failed to create activity" });
    }
});
exports.default = router;
