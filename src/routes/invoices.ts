import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";
import { requireAdmin } from "../middleware/requireAdmin";

const router = Router();
const prisma = new PrismaClient();

type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | string;

/**
 * Helper: round to 2 decimal places
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Helper: get billing rule values from client/org rules
 */
function getBillingContext(
  clientRules: any,
  orgRules: any
): {
  hourlyRate: number;
  minDuration: number;
  rounding: "none" | "6m" | "15m";
} {
  const hourlyRate =
    Number(clientRules?.hourlyRate) || Number(orgRules?.hourlyRate) || 150;

  const minDuration =
    Number(clientRules?.minDuration) || Number(orgRules?.minDuration) || 0;

  const rounding: "none" | "6m" | "15m" =
    clientRules?.rounding === "6m" || clientRules?.rounding === "15m"
      ? clientRules.rounding
      : orgRules?.rounding === "6m" || orgRules?.rounding === "15m"
      ? orgRules.rounding
      : "none";

  return { hourlyRate, minDuration, rounding };
}

/**
 * Helper: apply minDuration + rounding to minutes
 */
function adjustMinutes(
  minutes: number,
  minDuration: number,
  rounding: "none" | "6m" | "15m"
): number {
  let m = minutes;
  if (minDuration > 0 && m < minDuration) {
    m = minDuration;
  }

  if (rounding === "6m") {
    m = Math.round(m / 6) * 6;
  } else if (rounding === "15m") {
    m = Math.round(m / 15) * 15;
  }

  return m;
}

/**
 * POST /api/invoices/generate
 * Body: { clientId, periodStart, periodEnd }
 * Creates a draft invoice from billable activities for a given client + date range.
 * ADMIN ONLY
 */
router.post("/generate", requireAdmin, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { clientId, periodStart, periodEnd } = req.body;

    if (!clientId || !periodStart || !periodEnd) {
      return res
        .status(400)
        .json({ error: "clientId, periodStart, periodEnd are required" });
    }

    // Load organization & client with rules
    const [org, client] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: req.user.orgId },
        select: { billingRulesJson: true },
      }),
      prisma.client.findFirst({
        where: {
          id: clientId,
          orgId: req.user.orgId,
        },
        select: {
          id: true,
          orgId: true,
          billingRulesJson: true,
        },
      }),
    ]);

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const orgRules = (org?.billingRulesJson as any) || {};
    const clientRules = (client.billingRulesJson as any) || {};

    const { hourlyRate, minDuration, rounding } = getBillingContext(
      clientRules,
      orgRules
    );

    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    // Get billable activities in range, including service type
    const activities = await prisma.activity.findMany({
      where: {
        orgId: req.user.orgId,
        clientId: client.id,
        isBillable: true,
        startTime: {
          gte: start,
        },
        endTime: {
          lte: end,
        },
      },
      include: {
        serviceType: true,
      },
    });

    if (!activities.length) {
      return res
        .status(400)
        .json({ error: "No billable activities found for this period" });
    }

    // Build invoice items
    const items: {
      activityId: string | null;
      description: string;
      quantity: number;
      unitPrice: number;
      amount: number;
    }[] = [];

    for (const activity of activities) {
      const durationMinutes =
        activity.duration ||
        Math.max(
          0,
          Math.round(
            (activity.endTime.getTime() - activity.startTime.getTime()) /
              60000
          )
        );

      const svc = activity.serviceType;

      let description = "Care Management Services";
      let quantity = 0;
      let unitPrice = 0;
      let amount = 0;

      if (svc) {
        description = svc.name;
        unitPrice = svc.rateAmount || 0;

        if (svc.rateType === "flat") {
          // Flat = one unit at the flat rate
          quantity = 1;
          amount = round2(unitPrice);
        } else {
          // Hourly service type
          const adjustedMinutes = adjustMinutes(
            durationMinutes,
            minDuration,
            rounding
          );
          quantity = adjustedMinutes / 60;
          amount = round2(quantity * unitPrice);
        }
      } else {
        // Fallback: no service type, use hourlyRate from rules
        const adjustedMinutes = adjustMinutes(
          durationMinutes,
          minDuration,
          rounding
        );
        quantity = adjustedMinutes / 60;
        unitPrice = hourlyRate;
        amount = round2(quantity * unitPrice);
      }

      if (amount <= 0) continue;

      items.push({
        activityId: activity.id,
        description,
        quantity,
        unitPrice,
        amount,
      });
    }

    if (!items.length) {
      return res.status(400).json({
        error:
          "No billable activities produced any invoiceable amounts with the current rules.",
      });
    }

    const totalAmount = round2(items.reduce((sum, i) => sum + i.amount, 0));

    // Create invoice
    const invoice = await prisma.invoice.create({
      data: {
        orgId: req.user.orgId,
        clientId: client.id,
        periodStart: start,
        periodEnd: end,
        status: "draft",
        totalAmount,
        currency: "USD",
      },
    });

    // Create invoice items
    await Promise.all(
      items.map((item) =>
        prisma.invoiceItem.create({
          data: {
            invoiceId: invoice.id,
            activityId: item.activityId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
          },
        })
      )
    );

    const fullInvoice = await prisma.invoice.findUnique({
      where: { id: invoice.id },
      include: {
        items: true,
        client: true,
      },
    });

    res.status(201).json(fullInvoice);
  } catch (err) {
    console.error("Error generating invoice:", err);
    res.status(500).json({ error: "Failed to generate invoice" });
  }
});

/**
 * GET /api/invoices
 * Query: clientId? status?
 * Care managers only see invoices for their own clients.
 */
router.get("/", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { clientId, status } = req.query;

    const where: any = {
      orgId: req.user.orgId,
    };

    if (clientId) where.clientId = clientId;
    if (status) where.status = status;

    // Care manager: only invoices for their clients
    if (req.user.role === "care_manager") {
      where.client = { primaryCMId: req.user.userId };
    }

    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: {
        periodEnd: "desc",
      },
      include: {
        client: true,
      },
    });

    res.json(invoices);
  } catch (err) {
    console.error("Error fetching invoices:", err);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

/**
 * GET /api/invoices/export/csv
 * Care managers only export invoices for their clients.
 */
router.get("/export/csv", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { status, clientId } = req.query;

    const where: any = {
      orgId: req.user.orgId,
    };

    if (status) where.status = status;
    if (clientId) where.clientId = clientId;

    // Care manager: only export invoices for their clients
    if (req.user.role === "care_manager") {
      where.client = { primaryCMId: req.user.userId };
    }

    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: { periodEnd: "desc" },
      include: {
        client: true,
      },
    });

    const header = [
      "Invoice ID",
      "Client Name",
      "Status",
      "Total Amount",
      "Currency",
      "Period Start",
      "Period End",
    ];

    const rows = invoices.map((inv) => [
      inv.id,
      inv.client?.name ?? "",
      inv.status,
      inv.totalAmount?.toFixed(2) ?? "0.00",
      inv.currency ?? "USD",
      inv.periodStart ? inv.periodStart.toISOString().slice(0, 10) : "",
      inv.periodEnd ? inv.periodEnd.toISOString().slice(0, 10) : "",
    ]);

    const csvLines = [header, ...rows]
      .map((cols) =>
        cols
          .map((c) => {
            const v = c ?? "";
            if (typeof v === "string" && (v.includes(",") || v.includes('"'))) {
              return `"${v.replace(/"/g, '""')}"`;
            }
            return v;
          })
          .join(",")
      )
      .join("\n");

    const fileName = `elderflow_invoices_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );
    res.status(200).send(csvLines);
  } catch (err) {
    console.error("Error exporting invoices CSV:", err);
    res.status(500).json({ error: "Failed to export invoices CSV" });
  }
});

/**
 * GET /api/invoices/:id/pdf
 */
router.get("/:id/pdf", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;

    const invoice = await prisma.invoice.findFirst({
      where: { id, orgId: req.user.orgId },
      include: {
        client: true,
      },
    });

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const clientName = invoice.client?.name ?? "Unknown client";
    const total = invoice.totalAmount?.toFixed(2) ?? "0.00";

    const text = `Invoice #${invoice.id}  Client: ${clientName}  Total: $${total}`;

    const pdf = Buffer.from(
      `%PDF-1.3
1 0 obj<<>>endobj
2 0 obj<< /Length ${44 + text.length} >>stream
BT /F1 12 Tf 50 750 Td (${text
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)")}) Tj ET
endstream endobj
3 0 obj<< /Type /Catalog /Pages 4 0 R >>endobj
4 0 obj<< /Type /Pages /Kids [5 0 R] /Count 1 >>endobj
5 0 obj<< /Type /Page /Parent 4 0 R /MediaBox [0 0 612 792] /Contents 2 0 R /Resources<< /Font<< /F1 6 0 R>>>> >>endobj
6 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
xref
0 7
0000000000 65535 f 
0000000010 00000 n 
0000000045 00000 n 
0000000128 00000 n 
0000000173 00000 n 
0000000236 00000 n 
trailer<< /Root 3 0 R /Size 7>>
startxref
420
%%EOF`,
      "utf-8"
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="invoice-${invoice.id}.pdf"`
    );

    return res.send(pdf);
  } catch (err) {
    console.error("Error generating invoice PDF:", err);
    res.status(500).json({ error: "Failed to generate invoice PDF" });
  }
});

/**
 * GET /api/invoices/:id
 * Care managers can only view invoices for their own clients.
 * Includes:
 * - items
 * - payments (sorted by paidAt)
 * - totalPaid
 * - balance
 * - paidAmount (alias for totalPaid)
 * - balanceRemaining (alias for balance)
 * - client.primaryCM (care manager)
 */
router.get("/:id", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;

    const invoice = await prisma.invoice.findFirst({
      where: { id, orgId: req.user.orgId },
      include: {
        items: true,
        payments: {
          orderBy: {
            paidAt: "asc",
          },
        },
        client: {
          include: {
            primaryCM: true,
          },
        },
      },
    });

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    // Care manager cannot see invoices for another CM's client
    if (
      req.user.role === "care_manager" &&
      invoice.client &&
      (invoice.client as any).primaryCMId !== req.user.userId
    ) {
      return res
        .status(403)
        .json({ error: "You are not allowed to view this invoice." });
    }

    const completedPayments = (invoice.payments ?? []).filter(
      (p) => p.status === "completed"
    );

    const totalPaid = completedPayments.reduce(
      (sum, p) => sum + (p.amount || 0),
      0
    );

    const balance = (invoice.totalAmount || 0) - totalPaid;

    return res.json({
      id: invoice.id,
      orgId: invoice.orgId,
      clientId: invoice.clientId,
      client: invoice.client,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      status: invoice.status,
      totalAmount: invoice.totalAmount,
      currency: invoice.currency,
      pdfUrl: invoice.pdfUrl,
      sentAt: invoice.sentAt,
      paidAt: invoice.paidAt,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,

      items: invoice.items,
      payments: invoice.payments,

      totalPaid,
      balance,

      paidAmount: totalPaid,
      balanceRemaining: balance,
    });
  } catch (err) {
    console.error("Error fetching invoice:", err);
    return res.status(500).json({ error: "Failed to fetch invoice" });
  }
});

/**
 * POST /api/invoices/:id/approve
 * ADMIN ONLY – mark invoice as "sent"
 */
router.post("/:id/approve", requireAdmin, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;

    const invoice = await prisma.invoice.findFirst({
      where: {
        id,
        orgId: req.user.orgId,
      },
    });

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "sent",
        sentAt: new Date(),
      },
    });

    res.json(updated);
  } catch (err) {
    console.error("Error approving invoice:", err);
    res.status(500).json({ error: "Failed to approve invoice" });
  }
});

/**
 * POST /api/invoices/:id/mark-paid
 * ADMIN ONLY
 */
router.post("/:id/mark-paid", requireAdmin, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const { amount, method, reference } = req.body as {
      amount?: number;
      method?: string;
      reference?: string;
    };

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }
    if (!method || typeof method !== "string") {
      return res.status(400).json({ error: "Payment method required" });
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        id,
        orgId: req.user.orgId,
      },
      include: {
        payments: true,
      },
    });

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const payment = await prisma.payment.create({
      data: {
        orgId: req.user.orgId,
        invoiceId: invoice.id,
        status: "completed",
        amount,
        method,
        reference: reference || null,
        paidAt: new Date(),
      },
    });

    const allPayments = [...(invoice.payments ?? []), payment].filter(
      (p) => p.status === "completed"
    );
    const totalPaid = allPayments.reduce(
      (sum, p) => sum + (p.amount || 0),
      0
    );

    const remaining = (invoice.totalAmount || 0) - totalPaid;

    let updatedStatus: InvoiceStatus = invoice.status;
    let paidAt = invoice.paidAt;

    if (remaining <= 0) {
      updatedStatus = "paid";
      if (!paidAt) {
        paidAt = new Date();
      }
    }

    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: updatedStatus,
        paidAt,
      },
      include: {
        items: true,
        payments: true,
        client: true,
      },
    });

    res.json({
      invoice: updatedInvoice,
      balanceRemaining: remaining > 0 ? remaining : 0,
    });
  } catch (err) {
    console.error("Error marking invoice as paid", err);
    res.status(500).json({ error: "Failed to mark invoice as paid" });
  }
});

/**
 * PATCH /api/invoices/:id
 * Update invoice status (admin only)
 */
router.patch("/:id", requireAdmin, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const { status } = req.body as { status?: string };

    if (!status) {
      return res.status(400).json({ error: "Status is required" });
    }

    if (!["draft", "sent", "paid", "overdue"].includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    const updated = await prisma.invoice.update({
      where: {
        id,
      },
      data: {
        status,
      },
    });

    return res.json(updated);
  } catch (err) {
    console.error("Error updating invoice", err);
    return res.status(500).json({ error: "Failed to update invoice" });
  }
});

export default router;
