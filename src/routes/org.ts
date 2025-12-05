// src/routes/org.ts
import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth";
import { requireAdmin } from "../middleware/requireAdmin";
import { validate } from "../middleware/validate";

const router = Router();
const prisma = new PrismaClient();

const updateOrgSettingsSchema = z.object({
  name: z.string().min(1, "Organization name is required"),
  contactEmail: z.string().email("Contact email must be a valid email"),
  hourlyRate: z.number().nonnegative().optional(),
  minDuration: z.number().nonnegative().optional(),
  rounding: z.enum(["none", "6m", "15m"]).optional(),

  // NEW – invoice + branding fields
  currency: z.string().min(1).max(10).optional(),
  invoicePrefix: z.string().max(20).optional(),
  paymentTermsDays: z.number().int().nonnegative().optional(),
  lateFeePercent: z.number().nonnegative().optional(),
  invoiceFooterText: z.string().max(1000).optional(),
  brandColor: z.string().max(32).optional(),
  logoUrl: z.string().url().optional(),
});


/**
 * GET /api/org/settings
 * Returns org-level settings for the current user's organization.
 * Admin or CM can read, but only admin can update.
 */
router.get("/settings", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

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

    const rules = (org.billingRulesJson as any) || {};

    return res.json({
      name: org.name,
      contactEmail: org.contactEmail,
      hourlyRate: typeof rules.hourlyRate === "number" ? rules.hourlyRate : null,
      minDuration:
        typeof rules.minDuration === "number" ? rules.minDuration : null,
      rounding:
        rules.rounding === "6m" || rules.rounding === "15m"
          ? rules.rounding
          : "none",

          // NEW fields
      currency: typeof rules.currency === "string" ? rules.currency : "USD",
      invoicePrefix:
        typeof rules.invoicePrefix === "string" ? rules.invoicePrefix : "",
      paymentTermsDays:
        typeof rules.paymentTermsDays === "number"
          ? rules.paymentTermsDays
          : null,
      lateFeePercent:
        typeof rules.lateFeePercent === "number"
          ? rules.lateFeePercent
          : null,
      invoiceFooterText:
        typeof rules.invoiceFooterText === "string"
          ? rules.invoiceFooterText
          : "",
      brandColor:
        typeof rules.brandColor === "string" ? rules.brandColor : "",
      logoUrl: typeof rules.logoUrl === "string" ? rules.logoUrl : "",
    
    });
  } catch (err) {
    console.error("Error fetching org settings:", err);
    return res.status(500).json({ error: "Failed to fetch org settings" });
  }
});

/**
 * PUT /api/org/settings
 * ADMIN ONLY – update name, contact email, and billing rules (hourlyRate, minDuration, rounding).
 */
router.put(
  "/settings",
  requireAdmin,
  validate(updateOrgSettingsSchema),
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const {
  name,
  contactEmail,
  hourlyRate,
  minDuration,
  rounding,
  currency,
  invoicePrefix,
  paymentTermsDays,
  lateFeePercent,
  invoiceFooterText,
  brandColor,
  logoUrl,
} = req.body as {
  name: string;
  contactEmail: string;
  hourlyRate?: number;
  minDuration?: number;
  rounding?: "none" | "6m" | "15m";
  currency?: string;
  invoicePrefix?: string;
  paymentTermsDays?: number;
  lateFeePercent?: number;
  invoiceFooterText?: string;
  brandColor?: string;
  logoUrl?: string;
};


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

      const currentRules = (org.billingRulesJson as any) || {};

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
    } catch (err) {
      console.error("Error updating org settings:", err);
      return res.status(500).json({ error: "Failed to update org settings" });
    }
  }
);

/**
 * GET /api/org/audit-logs
 * Returns recent audit logs for this organization (meds, risks, etc.).
 * Admins + CMs can view.
 * Query:
 *  - limit?: number (default 200)
 *  - entityType?: string (e.g. "medication", "risk")
 */
router.get("/audit-logs", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { limit, entityType } = req.query;

    let take = 200;
    if (limit) {
      const parsed = parseInt(limit as string, 10);
      if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 1000) {
        take = parsed;
      }
    }

    const where: any = {
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

    const payload = logs.map((log) => ({
      id: log.id,
      entityType: log.entityType,
      entityId: log.entityId,
      action: log.action,
      details: log.details,
      createdAt: log.createdAt,
      userId: log.userId,
      userName: log.user?.name ?? log.user?.email ?? null,
    }));

    return res.json(payload);
  } catch (err) {
    console.error("Error fetching org audit logs:", err);
    return res.status(500).json({ error: "Failed to load audit logs." });
  }
});


export default router;
