import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/dashboard/summary
 * Returns high-level KPIs for the current month.
 */
router.get("/summary", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const orgId = req.user.orgId;

    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // We’ll use Promise.all to query in parallel
    const [
      activeClientCount,
      activitiesThisMonth,
      draftInvoiceCount,
      paymentsThisMonth
    ] = await Promise.all([
      prisma.client.count({
        where: {
          orgId,
          status: "active",
        },
      }),

      prisma.activity.findMany({
        where: {
          orgId,
          isBillable: true,
          startTime: {
            gte: firstOfMonth,
            lt: startOfNextMonth,
          },
        },
      }),

      prisma.invoice.count({
        where: {
          orgId,
          status: "draft", // treat draft as "pending approval"
        },
      }),

      prisma.payment.findMany({
        where: {
          orgId,
          status: "completed",
          paidAt: {
            gte: firstOfMonth,
            lt: startOfNextMonth,
          },
        },
      }),
    ]);

    const totalMinutes = activitiesThisMonth.reduce(
      (sum, a) => sum + a.duration,
      0
    );
    const hoursLoggedThisMonth = +(totalMinutes / 60).toFixed(2);

    const revenueThisMonth = paymentsThisMonth.reduce(
      (sum, p) => sum + p.amount,
      0
    );

    // Overdue invoices: status = "sent" and periodEnd is more than 14 days ago
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    const cutoff = new Date(now.getTime() - fourteenDaysMs);

    const overdueInvoiceCount = await prisma.invoice.count({
      where: {
        orgId,
        status: "sent",
        periodEnd: {
          lt: cutoff,
        },
      },
    });

    res.json({
      activeClientCount,
      hoursLoggedThisMonth,
      invoicesPendingApproval: draftInvoiceCount,
      revenueThisMonth,
      overdueInvoiceCount,
    });
  } catch (err) {
    console.error("Error fetching dashboard summary:", err);
    res.status(500).json({ error: "Failed to fetch dashboard summary" });
  }
});

export default router;