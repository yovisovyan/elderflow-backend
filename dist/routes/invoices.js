"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const requireAdmin_1 = require("../middleware/requireAdmin");
const validate_1 = require("../middleware/validate");
const pdfkit_1 = __importDefault(require("pdfkit"));
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
const generateInvoiceSchema = zod_1.z.object({
    clientId: zod_1.z.string().min(1, "clientId is required"),
    periodStart: zod_1.z.string().min(1, "periodStart is required"),
    periodEnd: zod_1.z.string().min(1, "periodEnd is required"),
});
const markPaidParamsSchema = zod_1.z.object({
    id: zod_1.z.string().min(1, "Invoice id is required"),
});
const markPaidBodySchema = zod_1.z.object({
    amount: zod_1.z.number().positive("Payment amount must be > 0"),
    method: zod_1.z
        .string()
        .min(1, "Payment method is required")
        .max(100, "Method too long"),
    reference: zod_1.z.string().max(255).optional(),
});
/**
 * Helper: round to 2 decimal places
 */
function round2(n) {
    return Math.round(n * 100) / 100;
}
/**
 * Helper: get billing rule values from client/org rules
 */
function getBillingContext(clientRules, orgRules) {
    const hourlyRate = Number(clientRules === null || clientRules === void 0 ? void 0 : clientRules.hourlyRate) || Number(orgRules === null || orgRules === void 0 ? void 0 : orgRules.hourlyRate) || 150;
    const minDuration = Number(clientRules === null || clientRules === void 0 ? void 0 : clientRules.minDuration) || Number(orgRules === null || orgRules === void 0 ? void 0 : orgRules.minDuration) || 0;
    const rounding = (clientRules === null || clientRules === void 0 ? void 0 : clientRules.rounding) === "6m" || (clientRules === null || clientRules === void 0 ? void 0 : clientRules.rounding) === "15m"
        ? clientRules.rounding
        : (orgRules === null || orgRules === void 0 ? void 0 : orgRules.rounding) === "6m" || (orgRules === null || orgRules === void 0 ? void 0 : orgRules.rounding) === "15m"
            ? orgRules.rounding
            : "none";
    return { hourlyRate, minDuration, rounding };
}
/**
 * Helper: apply minDuration + rounding to minutes
 */
function adjustMinutes(minutes, minDuration, rounding) {
    let m = minutes;
    if (minDuration > 0 && m < minDuration) {
        m = minDuration;
    }
    if (rounding === "6m") {
        m = Math.round(m / 6) * 6;
    }
    else if (rounding === "15m") {
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
router.post("/generate", requireAdmin_1.requireAdmin, (0, validate_1.validate)(generateInvoiceSchema), async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { clientId, periodStart, periodEnd } = req.body;
        // At this point, Zod has already enforced required fields.
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
        const orgRules = (org === null || org === void 0 ? void 0 : org.billingRulesJson) || {};
        const clientRules = client.billingRulesJson || {};
        const { hourlyRate, minDuration, rounding } = getBillingContext(clientRules, orgRules);
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
        const items = [];
        for (const activity of activities) {
            const durationMinutes = activity.duration ||
                Math.max(0, Math.round((activity.endTime.getTime() - activity.startTime.getTime()) /
                    60000));
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
                }
                else {
                    // Hourly service type
                    const adjustedMinutes = adjustMinutes(durationMinutes, minDuration, rounding);
                    quantity = adjustedMinutes / 60;
                    amount = round2(quantity * unitPrice);
                }
            }
            else {
                // Fallback: no service type, use hourlyRate from rules
                const adjustedMinutes = adjustMinutes(durationMinutes, minDuration, rounding);
                quantity = adjustedMinutes / 60;
                unitPrice = hourlyRate;
                amount = round2(quantity * unitPrice);
            }
            if (amount <= 0)
                continue;
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
                error: "No billable activities produced any invoiceable amounts with the current rules.",
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
        await Promise.all(items.map((item) => prisma.invoiceItem.create({
            data: {
                invoiceId: invoice.id,
                activityId: item.activityId,
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                amount: item.amount,
            },
        })));
        const fullInvoice = await prisma.invoice.findUnique({
            where: { id: invoice.id },
            include: {
                items: true,
                client: true,
            },
        });
        res.status(201).json(fullInvoice);
    }
    catch (err) {
        console.error("Error generating invoice:", err);
        res.status(500).json({ error: "Failed to generate invoice" });
    }
});
/**
 * GET /api/invoices
 * Query: clientId? status?
 * Care managers only see invoices for their own clients.
 */
router.get("/", async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { clientId, status } = req.query;
        const where = {
            orgId: req.user.orgId,
        };
        if (clientId)
            where.clientId = clientId;
        if (status)
            where.status = status;
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
    }
    catch (err) {
        console.error("Error fetching invoices:", err);
        res.status(500).json({ error: "Failed to fetch invoices" });
    }
});
/**
 * GET /api/invoices/export/csv
 * Care managers only export invoices for their clients.
 */
router.get("/export/csv", async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { status, clientId } = req.query;
        const where = {
            orgId: req.user.orgId,
        };
        if (status)
            where.status = status;
        if (clientId)
            where.clientId = clientId;
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
        const rows = invoices.map((inv) => {
            var _a, _b, _c, _d, _e;
            return [
                inv.id,
                (_b = (_a = inv.client) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "",
                inv.status,
                (_d = (_c = inv.totalAmount) === null || _c === void 0 ? void 0 : _c.toFixed(2)) !== null && _d !== void 0 ? _d : "0.00",
                (_e = inv.currency) !== null && _e !== void 0 ? _e : "USD",
                inv.periodStart ? inv.periodStart.toISOString().slice(0, 10) : "",
                inv.periodEnd ? inv.periodEnd.toISOString().slice(0, 10) : "",
            ];
        });
        const csvLines = [header, ...rows]
            .map((cols) => cols
            .map((c) => {
            const v = c !== null && c !== void 0 ? c : "";
            if (typeof v === "string" && (v.includes(",") || v.includes('"'))) {
                return `"${v.replace(/"/g, '""')}"`;
            }
            return v;
        })
            .join(","))
            .join("\n");
        const fileName = `elderflow_invoices_${new Date()
            .toISOString()
            .slice(0, 10)}.csv`;
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.status(200).send(csvLines);
    }
    catch (err) {
        console.error("Error exporting invoices CSV:", err);
        res.status(500).json({ error: "Failed to export invoices CSV" });
    }
});
/**
 * GET /api/invoices/:id/pdf
 * Generates a more polished PDF using PDFKit.
 */
router.get("/:id/pdf", async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { id } = req.params;
        const invoice = await prisma.invoice.findFirst({
            where: { id, orgId: req.user.orgId },
            include: {
                client: true,
                items: true,
                payments: {
                    orderBy: {
                        paidAt: "asc",
                    },
                },
            },
        });
        if (!invoice) {
            return res.status(404).json({ error: "Invoice not found" });
        }
        // Optional: load org name for header
        const org = await prisma.organization.findUnique({
            where: { id: req.user.orgId },
            select: { name: true },
        });
        const orgName = (_a = org === null || org === void 0 ? void 0 : org.name) !== null && _a !== void 0 ? _a : "ElderFlow";
        const clientName = (_c = (_b = invoice.client) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : "Unknown client";
        const totalAmount = (_d = invoice.totalAmount) !== null && _d !== void 0 ? _d : 0;
        const completedPayments = ((_e = invoice.payments) !== null && _e !== void 0 ? _e : []).filter((p) => p.status === "completed");
        const totalPaid = completedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const balance = totalAmount - totalPaid;
        // --- Set up PDFKit document ---
        const doc = new pdfkit_1.default({ size: "A4", margin: 50 });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.id}.pdf"`);
        doc.pipe(res);
        // HEADER
        doc
            .fontSize(18)
            .text(orgName, { align: "left" })
            .moveDown(0.2);
        doc
            .fontSize(10)
            .fillColor("gray")
            .text("Invoice generated by ElderFlow", { align: "left" })
            .moveDown(1);
        doc
            .fontSize(20)
            .fillColor("black")
            .text("INVOICE", { align: "right" })
            .moveDown(0.5);
        // Invoice identity + meta
        doc.fontSize(10);
        doc.text(`Invoice ID: ${invoice.id}`);
        doc.text(`Period: ${invoice.periodStart
            ? invoice.periodStart.toISOString().slice(0, 10)
            : "—"} to ${invoice.periodEnd
            ? invoice.periodEnd.toISOString().slice(0, 10)
            : "—"}`);
        doc.text(`Status: ${(invoice.status || "").toString().toUpperCase() || "UNKNOWN"}`);
        doc.moveDown(0.5);
        // Client / billing info
        doc.text(`Client: ${clientName}`);
        if ((_f = invoice.client) === null || _f === void 0 ? void 0 : _f.billingContactName) {
            doc.text(`Billing contact: ${invoice.client.billingContactName}`);
        }
        if ((_g = invoice.client) === null || _g === void 0 ? void 0 : _g.billingContactEmail) {
            doc.text(`Billing email: ${invoice.client.billingContactEmail}`);
        }
        if ((_h = invoice.client) === null || _h === void 0 ? void 0 : _h.billingContactPhone) {
            doc.text(`Billing phone: ${invoice.client.billingContactPhone}`);
        }
        doc.moveDown(1);
        // LINE ITEMS TABLE
        doc
            .fontSize(12)
            .text("Line items", { underline: true })
            .moveDown(0.3);
        doc.fontSize(10);
        if (!invoice.items.length) {
            doc.text("No line items on this invoice.");
        }
        else {
            const tableTop = doc.y;
            const colDescription = 50;
            const colHours = 320;
            const colRate = 380;
            const colAmount = 450;
            // Header row
            doc
                .font("Helvetica-Bold")
                .text("Description", colDescription, tableTop)
                .text("Hours", colHours, tableTop)
                .text("Rate", colRate, tableTop)
                .text("Amount", colAmount, tableTop);
            doc
                .moveTo(colDescription, tableTop + 12)
                .lineTo(550, tableTop + 12)
                .strokeColor("#CCCCCC")
                .stroke();
            doc.font("Helvetica");
            let y = tableTop + 18;
            invoice.items.forEach((item) => {
                if (y > 720) {
                    doc.addPage();
                    y = 50;
                }
                doc.text(item.description, colDescription, y, {
                    width: colHours - colDescription - 10,
                });
                doc.text(item.quantity.toFixed(2), colHours, y, { width: 50 });
                doc.text(`$${item.unitPrice.toFixed(2)}`, colRate, y, { width: 60 });
                doc.text(`$${item.amount.toFixed(2)}`, colAmount, y, { width: 80 });
                y += 18;
            });
            doc.moveDown(2);
        }
        // TOTALS SECTION
        doc.moveDown(1);
        doc
            .font("Helvetica-Bold")
            .text("Totals", { underline: true })
            .moveDown(0.3);
        doc.font("Helvetica");
        doc.text(`Total amount: $${totalAmount.toFixed(2)}`);
        doc.text(`Total paid:   $${totalPaid.toFixed(2)}`);
        doc.text(`Balance due:  $${balance.toFixed(2)}`);
        doc.moveDown(1);
        // PAYMENTS SECTION
        doc.font("Helvetica-Bold").text("Payments", { underline: true });
        doc.moveDown(0.3);
        doc.font("Helvetica");
        if (!invoice.payments.length) {
            doc.text("No payments recorded for this invoice.");
        }
        else {
            invoice.payments.forEach((p) => {
                const paidDate = p.paidAt
                    ? new Date(p.paidAt).toLocaleString()
                    : "N/A";
                const refText = p.reference && p.reference.trim().length > 0
                    ? ` – Ref: ${p.reference}`
                    : "";
                doc.text(`${paidDate} – ${p.method} – $${p.amount.toFixed(2)} – ${p.status}${refText}`);
            });
        }
        doc.moveDown(2);
        // FOOTER
        doc
            .fontSize(8)
            .fillColor("gray")
            .text("This invoice is for informational purposes only. Refer to ElderFlow for the latest status and details.", {
            align: "center",
        });
        doc.end();
    }
    catch (err) {
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
router.get("/:id", async (req, res) => {
    var _a;
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
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
        if (req.user.role === "care_manager" &&
            invoice.client &&
            invoice.client.primaryCMId !== req.user.userId) {
            return res
                .status(403)
                .json({ error: "You are not allowed to view this invoice." });
        }
        const completedPayments = ((_a = invoice.payments) !== null && _a !== void 0 ? _a : []).filter((p) => p.status === "completed");
        const totalPaid = completedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
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
    }
    catch (err) {
        console.error("Error fetching invoice:", err);
        return res.status(500).json({ error: "Failed to fetch invoice" });
    }
});
/**
 * POST /api/invoices/:id/approve
 * ADMIN ONLY – mark invoice as "sent"
 */
router.post("/:id/approve", requireAdmin_1.requireAdmin, async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
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
    }
    catch (err) {
        console.error("Error approving invoice:", err);
        res.status(500).json({ error: "Failed to approve invoice" });
    }
});
/**
 * POST /api/invoices/:id/mark-paid
 * ADMIN ONLY
 */
router.post("/:id/mark-paid", requireAdmin_1.requireAdmin, (0, validate_1.validate)(markPaidParamsSchema, "params"), (0, validate_1.validate)(markPaidBodySchema), async (req, res) => {
    var _a;
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { id } = req.params;
        const { amount, method, reference } = req.body;
        // Zod has already validated amount, method, reference.
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
        const allPayments = [...((_a = invoice.payments) !== null && _a !== void 0 ? _a : []), payment].filter((p) => p.status === "completed");
        const totalPaid = allPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
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
    }
    catch (err) {
        console.error("Error marking invoice as paid", err);
        res.status(500).json({ error: "Failed to mark invoice as paid" });
    }
});
/**
 * PATCH /api/invoices/:id
 * Update invoice status (admin only)
 */
router.patch("/:id", requireAdmin_1.requireAdmin, async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const { id } = req.params;
        const { status } = req.body;
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
    }
    catch (err) {
        console.error("Error updating invoice", err);
        return res.status(500).json({ error: "Failed to update invoice" });
    }
});
exports.default = router;
