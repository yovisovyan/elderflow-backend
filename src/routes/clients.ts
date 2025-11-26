import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";
import { requireAdmin } from "../middleware/requireAdmin";


const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/clients
 * Returns list of clients for the logged-in organization.
 */
router.get("/", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const clients = await prisma.client.findMany({
      where: { orgId: req.user.orgId },
      orderBy: { name: "asc" },
    });

    res.json(clients);
  } catch (err) {
    console.error("Error fetching clients:", err);
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

/**
 * GET /api/clients/:id
 * Returns one client plus a simple billing summary:
 * - totalHoursBilled
 * - outstandingBalance
 * - lastInvoiceDate
 */
router.get("/:id", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;

    const client = await prisma.client.findFirst({
      where: {
        id,
        orgId: req.user.orgId,
      },
    });

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // Fetch invoices + payments to build a simple summary
    const invoices = await prisma.invoice.findMany({
      where: {
        clientId: client.id,
        orgId: req.user.orgId,
      },
      include: {
        payments: true,
      },
      orderBy: {
        periodEnd: "desc",
      },
    });

    // total hours: sum of activity.duration / 60
    const activities = await prisma.activity.findMany({
      where: {
        clientId: client.id,
        orgId: req.user.orgId,
        isBillable: true,
      },
    });

    const totalMinutes = activities.reduce((sum, a) => sum + a.duration, 0);
    const totalHoursBilled = totalMinutes / 60;

    // outstanding balance = sum(invoice.totalAmount) - sum(payments.amount for completed)
    let outstandingBalance = 0;
    let lastInvoiceDate: Date | null = null;

    for (const inv of invoices) {
      const paidAmount = inv.payments
        .filter((p) => p.status === "completed")
        .reduce((sum, p) => sum + p.amount, 0);

      const remaining = inv.totalAmount - paidAmount;
      if (remaining > 0) {
        outstandingBalance += remaining;
      }

      if (!lastInvoiceDate || (inv.periodEnd && inv.periodEnd > lastInvoiceDate)) {
        lastInvoiceDate = inv.periodEnd;
      }
    }

    res.json({
      client,
      summary: {
        totalHoursBilled,
        outstandingBalance,
        lastInvoiceDate,
      },
    });
  } catch (err) {
    console.error("Error fetching client:", err);
    res.status(500).json({ error: "Failed to fetch client" });
  }
});

/**
 * POST /api/clients
 * Creates a new client (admin only for now).
 */
router.post("/", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Only admin can create clients" });

    const {
      name,
      dob,
      address,
      billingContactName,
      billingContactEmail,
      billingContactPhone,
      primaryCMId,
      billingRulesJson,
      status,
    } = req.body;

    if (!name || !dob || !address || !billingContactName) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const client = await prisma.client.create({
      data: {
        orgId: req.user.orgId,
        primaryCMId,
        name,
        dob: new Date(dob),
        address,
        billingContactName,
        billingContactEmail,
        billingContactPhone,
        billingRulesJson: billingRulesJson || {},
        status: status || "active",
      },
    });

    res.status(201).json(client);
  } catch (err) {
    console.error("Error creating client:", err);
    res.status(500).json({ error: "Failed to create client" });
  }
});

router.patch("/:id", async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only admin can update clients" });
  }

  const {
    name,
    status,
    billingContactName,
    billingContactEmail,
    billingContactPhone,
    billingRulesJson,
  } = req.body;

  try {
    const updated = await prisma.client.update({
      where: {
        id: req.params.id,
        // optionally enforce org: orgId: req.user.orgId,
      },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(billingContactName !== undefined ? { billingContactName } : {}),
        ...(billingContactEmail !== undefined ? { billingContactEmail } : {}),
        ...(billingContactPhone !== undefined ? { billingContactPhone } : {}),
        ...(billingRulesJson !== undefined ? { billingRulesJson } : {}),
      },
    });

    return res.json(updated);
  } catch (err) {
    console.error("Error updating client", err);
    return res.status(500).json({ error: "Failed to update client" });
  }
});


/**
 * PUT /api/clients/:id
 * Updates client info + billing rules.
 */
router.put("/:id", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const {
      name,
      dob,
      address,
      billingContactName,
      billingContactEmail,
      billingContactPhone,
      billingRulesJson,
      status,
    } = req.body;

    // ensure client belongs to this org
    const existing = await prisma.client.findFirst({
      where: { id, orgId: req.user.orgId },
    });

    if (!existing) {
      return res.status(404).json({ error: "Client not found" });
    }

    const updated = await prisma.client.update({
      where: { id: existing.id },
      data: {
        name: name ?? existing.name,
        dob: dob ? new Date(dob) : existing.dob,
        address: address ?? existing.address,
        billingContactName: billingContactName ?? existing.billingContactName,
        billingContactEmail: billingContactEmail ?? existing.billingContactEmail,
        billingContactPhone: billingContactPhone ?? existing.billingContactPhone,
        billingRulesJson: billingRulesJson ?? existing.billingRulesJson,
        status: status ?? existing.status,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error("Error updating client:", err);
    res.status(500).json({ error: "Failed to update client" });
  }
});

/**
 * GET /api/clients/:id/notes
 * Returns notes for a client (most recent first)
 */
router.get("/:id/notes", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;

    // Ensure client belongs to same org
    const client = await prisma.client.findFirst({
      where: {
        id,
        orgId: req.user.orgId,
      },
    });

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const notes = await prisma.note.findMany({
      where: {
        clientId: id,
        orgId: req.user.orgId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // We no longer have an author relation; frontend can use authorId or show "You"
    return res.json(
      notes.map((n: any) => ({
        id: n.id,
        content: n.content,
        createdAt: n.createdAt,
        authorId: n.authorId,
      }))
    );
  } catch (err) {
    console.error("Error fetching notes", err);
    return res.status(500).json({ error: "Failed to fetch notes" });
  }
});


/**
 * POST /api/clients/:id/notes
 * Body: { content: string }
 */
router.post("/:id/notes", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const { content } = req.body as { content?: string };

    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Note content is required" });
    }

    // Ensure client exists & belongs to same org
    const client = await prisma.client.findFirst({
      where: {
        id,
        orgId: req.user.orgId,
      },
    });

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const note = await prisma.note.create({
      data: {
        orgId: req.user.orgId,
        clientId: id,
        authorId: req.user.userId, // same pattern as activities
        content: content.trim(),
      },
    });

    return res.status(201).json(note);
  } catch (err) {
    console.error("Error creating note", err);
    return res.status(500).json({ error: "Failed to create note" });
  }
});

/**
 * GET /api/clients/:id/billing-rules
 * Returns org-level and client-specific billing rules.
 */
router.get("/:id/billing-rules", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;

    const [org, client] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: req.user.orgId },
        select: { billingRulesJson: true },
      }),
      prisma.client.findFirst({
        where: {
          id,
          orgId: req.user.orgId,
        },
        select: {
          id: true,
          billingRulesJson: true,
        },
      }),
    ]);

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const orgRules = (org?.billingRulesJson as any) || {};
    const clientRules = (client.billingRulesJson as any) || {};

    return res.json({
      ok: true,
      orgRules,
      clientRules,
    });
  } catch (err) {
    console.error("Error fetching client billing rules:", err);
    return res
      .status(500)
      .json({ error: "Failed to fetch client billing rules." });
  }
});

/**
 * POST /api/clients/:id/billing-rules
 * ADMIN ONLY – Save client-specific billing rules overrides.
 * Body: { rules: { hourlyRate?, minDuration?, rounding? } }
 */
router.post(
  "/:id/billing-rules",
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      const { rules } = req.body as { rules?: any };

      if (!rules || typeof rules !== "object") {
        return res.status(400).json({ error: "Invalid rules JSON." });
      }

      const client = await prisma.client.findFirst({
        where: {
          id,
          orgId: req.user.orgId,
        },
      });

      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      const updated = await prisma.client.update({
        where: { id: client.id },
        data: { billingRulesJson: rules },
      });

      return res.json({
        ok: true,
        clientRules: updated.billingRulesJson,
      });
    } catch (err) {
      console.error("Error saving client billing rules:", err);
      return res
        .status(500)
        .json({ error: "Failed to save client billing rules." });
    }
  }
);



export default router;
