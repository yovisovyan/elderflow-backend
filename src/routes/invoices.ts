import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";

const router = Router();
const prisma = new PrismaClient();

/**
 * Helper: compute invoice items from activities and client billing rules.
 */
function buildInvoiceItemsFromActivities(
  activities: { id: string; duration: number }[],
  hourlyRate: number
) {
  const items = activities.map((a) => {
    const quantity = +(a.duration / 60).toFixed(2); // hours
    const unitPrice = hourlyRate;
    const amount = +(quantity * unitPrice).toFixed(2);
    return { activityId: a.id, quantity, unitPrice, amount };
  });

  const totalAmount = items.reduce((sum, i) => sum + i.amount, 0);
  return { items, totalAmount };
}

/**
 * POST /api/invoices/generate
 * Body: { clientId, periodStart, periodEnd }
 * Creates a draft invoice from billable activities for a given client + date range.
 */
router.post("/generate", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { clientId, periodStart, periodEnd } = req.body;

    if (!clientId || !periodStart || !periodEnd) {
      return res
        .status(400)
        .json({ error: "clientId, periodStart, periodEnd are required" });
    }

    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        orgId: req.user.orgId,
      },
    });

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    // Get billable activities in range
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
    });

    if (!activities.length) {
      return res
        .status(400)
        .json({ error: "No billable activities found for this period" });
    }

    const rules = (client.billingRulesJson as any) || {};
    const hourlyRate = rules.hourly_rate || rules.hourlyRate || 150;

    const { items, totalAmount } = buildInvoiceItemsFromActivities(
      activities.map((a) => ({ id: a.id, duration: a.duration })),
      hourlyRate
    );

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
    for (const item of items) {
      await prisma.invoiceItem.create({
        data: {
          invoiceId: invoice.id,
          activityId: item.activityId,
          description: "Care Management Services",
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.amount,
        },
      });
    }

    const fullInvoice = await prisma.invoice.findUnique({
      where: { id: invoice.id },
      include: {
        items: true,
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
 * Optional query: status, clientId
 * Returns CSV of invoices for download.
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

    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: { periodEnd: "desc" },
      include: {
        client: true,
      },
    });

    // Build CSV header + rows
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
 * Returns a very simple PDF for the invoice (stub – replace with real PDF later).
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

    // Minimal PDF content (valid but simple). You can later replace this with PDFKit.
    const text = `Invoice #${invoice.id}  Client: ${clientName}  Total: $${total}`;

    const pdf = Buffer.from(
      `%PDF-1.3
1 0 obj<<>>endobj
2 0 obj<< /Length ${44 + text.length} >>stream
BT /F1 12 Tf 50 750 Td (${text.replace(/\(/g, "\\(").replace(/\)/g, "\\)")}) Tj ET
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
0000000343 00000 n 
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
 * Returns invoice with items and payments and computed totals.
 */
router.get("/:id", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;

    const invoice = await prisma.invoice.findFirst({
      where: { id, orgId: req.user.orgId },
      include: {
        items: true,
        payments: true,
        client: true,
      },
    });

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const paidAmount =
      invoice.payments?.reduce((sum, p) => sum + (p.amount || 0), 0) ?? 0;

    const balanceRemaining = (invoice.totalAmount || 0) - paidAmount;

    return res.json({
      ...invoice,
      payments: invoice.payments,
      paidAmount,
      balanceRemaining,
    });
  } catch (err) {
    console.error("Error fetching invoice:", err);
    return res.status(500).json({ error: "Failed to fetch invoice" });
  }
});

router.post("/:id/approve", async (req: AuthRequest, res) => {
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
 * Body: { amount, method, reference? }
 * - Creates a Payment record
 * - Updates invoice status to "paid" if fully covered
 */
router.post("/:id/mark-paid", async (req: AuthRequest, res) => {
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

    // Create payment
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

    // Recalculate total paid
    const allPayments = [...(invoice.payments ?? []), payment].filter(
      (p) => p.status === "completed"
    );
    const totalPaid = allPayments.reduce(
      (sum, p) => sum + (p.amount || 0),
      0
    );

    const remaining = (invoice.totalAmount || 0) - totalPaid;

    let updatedStatus = invoice.status;
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
    console.error("Error marking invoice as paid:", err);
    res.status(500).json({ error: "Failed to mark invoice as paid" });
  }
});

/**
 * PATCH /api/invoices/:id
 * Update invoice status (admin only)
 * Body: { status: "draft" | "sent" | "paid" | "overdue" }
 */
router.patch("/:id", async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Only admin can update invoices" });
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
