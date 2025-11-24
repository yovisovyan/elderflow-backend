import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/payments
 * Optional query: clientId, invoiceId
 */
router.get("/", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { clientId, invoiceId } = req.query;

    const where: any = {
      orgId: req.user.orgId,
    };

    if (invoiceId) where.invoiceId = invoiceId;

    const payments = await prisma.payment.findMany({
      where,
      orderBy: {
        paidAt: "desc",
      },
      include: {
        invoice: true,
      },
    });

    // Optional: filter by clientId using joined invoice
    const filtered =
      clientId && typeof clientId === "string"
        ? payments.filter((p) => p.invoice.clientId === clientId)
        : payments;

    res.json(filtered);
  } catch (err) {
    console.error("Error fetching payments:", err);
    res.status(500).json({ error: "Failed to fetch payments" });
  }
});

export default router;
