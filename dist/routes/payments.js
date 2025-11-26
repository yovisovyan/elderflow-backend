"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
/**
 * GET /api/payments
 * Optional query: clientId, invoiceId
 */
router.get("/", async (req, res) => {
    try {
        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });
        const { clientId, invoiceId } = req.query;
        const where = {
            orgId: req.user.orgId,
        };
        if (invoiceId)
            where.invoiceId = invoiceId;
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
        const filtered = clientId && typeof clientId === "string"
            ? payments.filter((p) => p.invoice.clientId === clientId)
            : payments;
        res.json(filtered);
    }
    catch (err) {
        console.error("Error fetching payments:", err);
        res.status(500).json({ error: "Failed to fetch payments" });
    }
});
exports.default = router;
