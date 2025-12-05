"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/org.ts
const express_1 = require("express");
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const requireAdmin_1 = require("../middleware/requireAdmin");
const validate_1 = require("../middleware/validate");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
const updateOrgSettingsSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "Organization name is required"),
    contactEmail: zod_1.z.string().email("Contact email must be a valid email"),
    hourlyRate: zod_1.z.number().nonnegative().optional(),
    minDuration: zod_1.z.number().nonnegative().optional(),
    rounding: zod_1.z.enum(["none", "6m", "15m"]).optional(),
    // NEW – invoice + branding fields
    currency: zod_1.z.string().min(1).max(10).optional(),
    invoicePrefix: zod_1.z.string().max(20).optional(),
    paymentTermsDays: zod_1.z.number().int().nonnegative().optional(),
    lateFeePercent: zod_1.z.number().nonnegative().optional(),
    invoiceFooterText: zod_1.z.string().max(1000).optional(),
    brandColor: zod_1.z.string().max(32).optional(),
    logoUrl: zod_1.z.string().url().optional(),
});
/**
 * GET /api/org/settings
 * Returns org-level settings for the current user's organization.
 * Admin or CM can read, but only admin can update.
 */
router.get("/settings", async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const org = await prisma.organization.findUnique({
            where: { id: req.user.orgId },
            select: {
                name: true,
                contactEmail: true,
                billingRulesJson: true,
            },
        });
        if (!org) {
            return res.status(404).json({ error: "Organization not found" });
        }
        const rules = org.billingRulesJson || {};
        return res.json({
            name: org.name,
            contactEmail: org.contactEmail,
            hourlyRate: typeof rules.hourlyRate === "number" ? rules.hourlyRate : null,
            minDuration: typeof rules.minDuration === "number" ? rules.minDuration : null,
            rounding: rules.rounding === "6m" || rules.rounding === "15m"
                ? rules.rounding
                : "none",
            // NEW fields
            currency: typeof rules.currency === "string" ? rules.currency : "USD",
            invoicePrefix: typeof rules.invoicePrefix === "string" ? rules.invoicePrefix : "",
            paymentTermsDays: typeof rules.paymentTermsDays === "number"
                ? rules.paymentTermsDays
                : null,
            lateFeePercent: typeof rules.lateFeePercent === "number"
                ? rules.lateFeePercent
                : null,
            invoiceFooterText: typeof rules.invoiceFooterText === "string"
                ? rules.invoiceFooterText
                : "",
            brandColor: typeof rules.brandColor === "string" ? rules.brandColor : "",
            logoUrl: typeof rules.logoUrl === "string" ? rules.logoUrl : "",
        });
    }
    catch (err) {
        console.error("Error fetching org settings:", err);
        return res.status(500).json({ error: "Failed to fetch org settings" });
    }
});
/**
 * PUT /api/org/settings
 * ADMIN ONLY – update name, contact email, and billing rules (hourlyRate, minDuration, rounding).
 */
router.put("/settings", requireAdmin_1.requireAdmin, (0, validate_1.validate)(updateOrgSettingsSchema), async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { name, contactEmail, hourlyRate, minDuration, rounding, currency, invoicePrefix, paymentTermsDays, lateFeePercent, invoiceFooterText, brandColor, logoUrl, } = req.body;
        const org = await prisma.organization.findUnique({
            where: { id: req.user.orgId },
            select: {
                id: true,
                billingRulesJson: true,
            },
        });
        if (!org) {
            return res.status(404).json({ error: "Organization not found" });
        }
        const currentRules = org.billingRulesJson || {};
        const updatedRules = {
            ...currentRules,
            ...(typeof hourlyRate === "number" ? { hourlyRate } : {}),
            ...(typeof minDuration === "number" ? { minDuration } : {}),
            ...(rounding ? { rounding } : {}),
            // NEW fields – only overwrite when defined
            ...(currency ? { currency } : {}),
            ...(typeof invoicePrefix === "string"
                ? { invoicePrefix }
                : {}),
            ...(typeof paymentTermsDays === "number"
                ? { paymentTermsDays }
                : {}),
            ...(typeof lateFeePercent === "number"
                ? { lateFeePercent }
                : {}),
            ...(typeof invoiceFooterText === "string"
                ? { invoiceFooterText }
                : {}),
            ...(typeof brandColor === "string" ? { brandColor } : {}),
            ...(typeof logoUrl === "string" ? { logoUrl } : {}),
        };
        const updated = await prisma.organization.update({
            where: { id: org.id },
            data: {
                name,
                contactEmail,
                billingRulesJson: updatedRules,
            },
            select: {
                name: true,
                contactEmail: true,
                billingRulesJson: true,
            },
        });
        return res.json({
            ok: true,
            name: updated.name,
            contactEmail: updated.contactEmail,
            billingRulesJson: updated.billingRulesJson,
        });
    }
    catch (err) {
        console.error("Error updating org settings:", err);
        return res.status(500).json({ error: "Failed to update org settings" });
    }
});
/**
 * GET /api/org/audit-logs
 * Returns recent audit logs for this organization (meds, risks, etc.).
 * Admins + CMs can view.
 * Query:
 *  - limit?: number (default 200)
 *  - entityType?: string (e.g. "medication", "risk")
 */
router.get("/audit-logs", async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { limit, entityType } = req.query;
        let take = 200;
        if (limit) {
            const parsed = parseInt(limit, 10);
            if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 1000) {
                take = parsed;
            }
        }
        const where = {
            orgId: req.user.orgId,
        };
        if (entityType && typeof entityType === "string") {
            where.entityType = entityType;
        }
        const logs = await prisma.auditLog.findMany({
            where,
            include: {
                user: true,
            },
            orderBy: {
                createdAt: "desc",
            },
            take,
        });
        const payload = logs.map((log) => {
            var _a, _b, _c, _d;
            return ({
                id: log.id,
                entityType: log.entityType,
                entityId: log.entityId,
                action: log.action,
                details: log.details,
                createdAt: log.createdAt,
                userId: log.userId,
                userName: (_d = (_b = (_a = log.user) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : (_c = log.user) === null || _c === void 0 ? void 0 : _c.email) !== null && _d !== void 0 ? _d : null,
            });
        });
        return res.json(payload);
    }
    catch (err) {
        console.error("Error fetching org audit logs:", err);
        return res.status(500).json({ error: "Failed to load audit logs." });
    }
});
exports.default = router;
