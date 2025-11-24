import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";

const router = Router();
const prisma = new PrismaClient();

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * POST /api/ai/simulate-activities
 * Body:
 *  - clientId? (optional)
 *  - count? (optional, default 5)
 *
 * Generates N AI-captured activities for demo purposes.
 */
router.post("/simulate-activities", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { clientId, count = 5 } = req.body;

    // Get some clients for this org
    const clients = clientId
      ? await prisma.client.findMany({
          where: { id: clientId, orgId: req.user.orgId },
        })
      : await prisma.client.findMany({
          where: { orgId: req.user.orgId },
          take: 3,
        });

    if (!clients.length) {
      return res
        .status(400)
        .json({ error: "No clients found to attach activities to" });
    }

    // Use any care manager from org (for now)
    const cm = await prisma.user.findFirst({
      where: { orgId: req.user.orgId, role: "care_manager" },
    });

    if (!cm) {
      return res
        .status(400)
        .json({ error: "No care manager found in this organization" });
    }

    const sources = ["phone", "email", "visit"];
    const created: any[] = [];

    for (let i = 0; i < count; i++) {
      const client = randomFrom(clients);
      const source = randomFrom(sources);

      const duration = Math.floor(Math.random() * 85) + 5; // 5–90 minutes
      const end = new Date();
      const start = new Date(end.getTime() - duration * 60000);

      let billingCode: string | null = null;
      if (source === "phone") billingCode = "Phone Support";
      if (source === "email") billingCode = "Care Coordination";
      if (source === "visit") billingCode = "Home Visit";

      const aiConfidence = Math.random() * 0.24 + 0.75; // 0.75–0.99
      const isFlagged = aiConfidence < 0.85 || !billingCode;

            const activity = await prisma.activity.create({
        data: {
          orgId: req.user.orgId,
          clientId: client.id,
          cmId: cm.id,
          source,
          startTime: start,
          endTime: end,
          duration,
          billingCode: billingCode ?? undefined,
          isBillable: true,
          aiConfidence,
          notes: "AI-captured demo activity.",
          isFlagged,
          capturedByAi: true,
        },
      });

      created.push(activity);

      // Audit logging disabled for now until AuditLog schema matches
      // await prisma.auditLog.create({
      //   data: {
      //     orgId: req.user.orgId,
      //     userId: cm.id,
      //     action: "AI_ACTIVITY_GENERATE",
      //     entityType: "activity",
      //     entityId: activity.id,
      //     metadata: {},
      //   },
      // });

    }

    res.json({
      message: "AI activities generated",
      createdCount: created.length,
      activities: created,
    });
  } catch (err) {
    console.error("Error simulating AI activities:", err);
    res.status(500).json({ error: "Failed to simulate activities" });
  }
});

/**
 * GET /api/ai/alerts
 * Returns:
 *  - flaggedActivities: up to 10 flagged activities
 *  - overdueInvoices: (placeholder for now, empty if no invoices)
 */

router.get("/alerts", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const flaggedActivities = await prisma.activity.findMany({
      where: {
        orgId: req.user.orgId,
        isFlagged: true,
      },
      include: {
        client: true,
        cm: true,
      },
      orderBy: {
        startTime: "desc",
      },
      take: 10,
    });

    // Simple overdue definition:
    // - status = "sent"
    // - periodEnd is more than 14 days ago
    const now = new Date();
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    const cutoff = new Date(now.getTime() - fourteenDaysMs);

    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        orgId: req.user.orgId,
        status: "sent",
        periodEnd: {
          lt: cutoff,
        },
      },
      include: {
        client: true,
      },
      orderBy: {
        periodEnd: "asc",
      },
    });

    res.json({
      flaggedActivities,
      overdueInvoices,
    });
  } catch (err) {
    console.error("Error fetching AI alerts:", err);
    res.status(500).json({ error: "Failed to fetch AI alerts" });
  }
});


export default router;
