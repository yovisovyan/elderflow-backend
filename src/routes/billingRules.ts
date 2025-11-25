import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";
import { requireAdmin } from "../middleware/requireAdmin";

const prisma = new PrismaClient();
const router = Router();

/**
 * GET /api/billing/rules
 * Returns the organization-wide billing rules.
 */
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user)
      return res.status(401).json({ error: "Unauthorized" });

    const org = await prisma.organization.findUnique({
      where: { id: req.user.orgId },
      select: { billingRulesJson: true },
    });

    return res.json({
      ok: true,
      rules: org?.billingRulesJson ?? {},
    });
  } catch (err) {
    console.error("Error fetching billing rules:", err);
    return res.status(500).json({ error: "Failed to fetch billing rules." });
  }
});

/**
 * POST /api/billing/rules
 * ADMIN ONLY - Save organization-wide rules.
 */
router.post("/", requireAdmin, async (req: AuthRequest, res: Response) => {
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
  } catch (err) {
    console.error("Error saving billing rules:", err);
    return res.status(500).json({ error: "Failed to save billing rules." });
  }
});

export default router;
