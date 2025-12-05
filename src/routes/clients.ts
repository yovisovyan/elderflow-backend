import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";
import { requireAdmin } from "../middleware/requireAdmin";
import PDFDocument from "pdfkit";

const router = Router();
const prisma = new PrismaClient();

// Simple reusable audit logger for meds & risks (and more later)
async function logAudit(
  req: AuthRequest,
  params: {
    entityType: string;
    entityId?: string;
    action: string;
    details?: string;
  }
) {
  if (!req.user) return;

  try {
    await prisma.auditLog.create({
      data: {
        orgId: req.user.orgId,
        userId: req.user.userId,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        action: params.action,
        details: params.details ?? null,
      },
    });
  } catch (err) {
    // We NEVER want audit logging to crash the main request
    console.error("Error writing audit log:", err);
  }
}

/**
 * GET /api/clients
 * Returns list of clients for the logged-in organization.
 * Care managers only see clients where they are the primary CM.
 */
router.get("/", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const where: any = {
      orgId: req.user.orgId,
    };

    // 🔹 Care managers only see their own clients
    if (req.user.role === "care_manager") {
      where.primaryCMId = req.user.userId;
    }

    const clients = await prisma.client.findMany({
      where,
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
 * Care managers can only access their own clients.
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
      include: {
        primaryCM: {
          select: {
            id: true,
            name: true,
            profileImageUrl: true,
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // 🔹 Care manager cannot access another CM's client
    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res
        .status(403)
        .json({ error: "You are not allowed to access this client." });
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

    // total billable duration
    const activities = await prisma.activity.findMany({
      where: {
        clientId: client.id,
        orgId: req.user.orgId,
        isBillable: true,
      },
    });

    const totalMinutes = activities.reduce((sum, a) => sum + a.duration, 0);
    const totalHoursBilled = totalMinutes / 60;

    // outstanding balance
    let outstandingBalance = 0;
    let lastInvoiceDate: Date | null = null;

    for (const inv of invoices) {
      const paidAmount = inv.payments
        .filter((p) => p.status === "completed")
        .reduce((sum, p) => sum + p.amount, 0);

      const remaining = inv.totalAmount - paidAmount;
      if (remaining > 0) outstandingBalance += remaining;

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
      preferredName,
      primaryDiagnosis,
      livingSituation,
      riskFlags,
      primaryLanguage,
      insurance,
      physicianName,
      physicianPhone,
      environmentSafetyNotes,
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
        // extra fields can be wired here later:
        // preferredName,
        // primaryDiagnosis,
        // livingSituation,
        // riskFlags,
        // primaryLanguage,
        // insurance,
        // physicianName,
        // physicianPhone,
        // environmentSafetyNotes,
      },
    });

    await logAudit(req, {
      entityType: "client",
      entityId: client.id,
      action: "create",
      details: `Created client "${client.name}" with status ${client.status}`,
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

    await logAudit(req, {
      entityType: "client",
      entityId: updated.id,
      action: "update",
      details: `Updated client "${updated.name}" (status: ${updated.status})`,
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
 * Includes safety rule for "active" status.
 */
router.put("/:id", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Only admin can update clients" });
    }

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

    // Compute what the new values will be
    const nextStatus: string =
      typeof status === "string" ? status : existing.status;

    const nextPhone: string =
      typeof billingContactPhone === "string"
        ? billingContactPhone
        : existing.billingContactPhone;

    // --- Safety: enforce mandatory fields when setting status to "active" ---
    if (nextStatus === "active") {
      if (!nextPhone || !nextPhone.trim()) {
        return res.status(400).json({
          error:
            "To mark a client as Active, a primary contact phone is required.",
        });
      }

      const insuranceRecord = await prisma.clientInsurance.findFirst({
        where: {
          clientId: existing.id,
          orgId: req.user.orgId,
          NOT: {
            policyNumber: null,
          },
        },
      });

      if (!insuranceRecord || !insuranceRecord.policyNumber) {
        return res.status(400).json({
          error:
            "To mark a client as Active, at least one insurance record with a Policy # is required.",
        });
      }
    }

    const updated = await prisma.client.update({
      where: { id: existing.id },
      data: {
        name: name ?? existing.name,
        dob: dob ? new Date(dob) : existing.dob,
        address: address ?? existing.address,
        billingContactName: billingContactName ?? existing.billingContactName,
        billingContactEmail:
          billingContactEmail ?? existing.billingContactEmail,
        billingContactPhone: nextPhone,
        billingRulesJson: billingRulesJson ?? existing.billingRulesJson,
        status: nextStatus,
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

    // 🔹 Care manager cannot access notes for another CM's client
    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res
        .status(403)
        .json({ error: "You are not allowed to access this client's notes." });
    }

    const notes = await prisma.clientNote.findMany({
      where: {
        clientId: id,
        client: {
          orgId: req.user.orgId,
        },
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json(
      notes.map((n) => ({
        id: n.id,
        content: n.content,
        createdAt: n.createdAt,
        authorId: n.authorId,
        authorName: n.author?.name ?? null,
      }))
    );
  } catch (err) {
    console.error("Error fetching client notes:", err);
    return res.status(500).json({ error: "Failed to load notes." });
  }
});

/**
 * POST /api/clients/:id/notes
 */
router.post("/:id/notes", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const { content } = req.body as { content?: string };

    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Note content is required" });
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

    // 🔹 Care manager cannot add notes for another CM's client
    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res
        .status(403)
        .json({ error: "You are not allowed to add notes for this client." });
    }

    const note = await prisma.clientNote.create({
      data: {
        clientId: id,
        authorId: req.user.userId,
        content: content.trim(),
      },
    });

    await logAudit(req, {
      entityType: "client_note",
      entityId: note.id,
      action: "create",
      details: `Added note for client ${id}`,
    });

    return res.status(201).json({
      id: note.id,
      content: note.content,
      createdAt: note.createdAt,
      authorId: note.authorId,
    });
  } catch (err) {
    console.error("Error creating note", err);
    return res.status(500).json({ error: "Failed to create note" });
  }
});

/**
 * DELETE /api/clients/:clientId/notes/:noteId
 */
router.delete("/:clientId/notes/:noteId", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { clientId, noteId } = req.params;

    const note = await prisma.clientNote.findFirst({
      where: {
        id: noteId,
        clientId,
        client: {
          orgId: req.user.orgId,
        },
      },
      include: {
        client: {
          select: {
            primaryCMId: true,
          },
        },
      },
    });

    if (!note) {
      return res.status(404).json({ error: "Note not found" });
    }

    const isAdmin = req.user.role === "admin";
    const isAuthor = note.authorId === req.user.userId;
    const isPrimaryCM = note.client?.primaryCMId === req.user.userId;

    if (!isAdmin && !isAuthor && !isPrimaryCM) {
      return res
        .status(403)
        .json({ error: "You are not allowed to delete this note." });
    }

    await prisma.clientNote.delete({
      where: { id: note.id },
    });

    await logAudit(req, {
      entityType: "client_note",
      entityId: note.id,
      action: "delete",
      details: `Deleted note for client ${note.clientId}`,
    });

    return res.status(204).send();
  } catch (err) {
    console.error("Error deleting note", err);
    return res.status(500).json({ error: "Failed to delete note" });
  }
});

/**
 * GET /api/clients/:id/billing-rules
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
          primaryCMId: true,
        },
      }),
    ]);

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // 🔹 Care manager cannot access billing rules for another CM's client
    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to access this client's billing rules.",
      });
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

/**
 * GET /api/clients/:id/contacts
 */
router.get("/:id/contacts", async (req: AuthRequest, res) => {
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

    // Care manager cannot access another CM's client
    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res
        .status(403)
        .json({ error: "You are not allowed to access this client's contacts." });
    }

    const contacts = await prisma.clientContact.findMany({
      where: {
        clientId: client.id,
        orgId: req.user.orgId,
      },
      orderBy: { createdAt: "asc" },
    });

    return res.json(contacts);
  } catch (err) {
    console.error("Error fetching client contacts:", err);
    return res.status(500).json({ error: "Failed to load contacts." });
  }
});

/**
 * POST /api/clients/:id/contacts
 */
router.post("/:id/contacts", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const {
      name,
      relationship,
      phone,
      email,
      address,
      notes,
      isEmergencyContact,
    } = req.body as {
      name?: string;
      relationship?: string;
      phone?: string;
      email?: string;
      address?: string;
      notes?: string;
      isEmergencyContact?: boolean;
    };

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

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

    // Care manager cannot add contacts for another CM's client
    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to add contacts for this client.",
      });
    }

    const contact = await prisma.clientContact.create({
      data: {
        orgId: req.user.orgId,
        clientId: client.id,
        name,
        relationship,
        phone,
        email,
        address,
        notes,
        isEmergencyContact: Boolean(isEmergencyContact),
      },
    });

    await logAudit(req, {
      entityType: "contact",
      entityId: contact.id,
      action: "create",
      details: `Added contact "${contact.name}" for client ${client.id}`,
    });

    return res.status(201).json(contact);
  } catch (err) {
    console.error("Error creating client contact:", err);
    return res.status(500).json({ error: "Failed to create contact." });
  }
});

/**
 * PUT /api/clients/:clientId/contacts/:contactId
 */
router.put("/:clientId/contacts/:contactId", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { clientId, contactId } = req.params;
    const {
      name,
      relationship,
      phone,
      email,
      address,
      notes,
      isEmergencyContact,
    } = req.body as {
      name?: string;
      relationship?: string;
      phone?: string;
      email?: string;
      address?: string;
      notes?: string;
      isEmergencyContact?: boolean;
    };

    // Ensure contact exists and belongs to same org & client
    const contact = await prisma.clientContact.findFirst({
      where: {
        id: contactId,
        clientId,
        orgId: req.user.orgId,
      },
      include: {
        client: true,
      },
    });

    if (!contact) {
      return res.status(404).json({ error: "Contact not found" });
    }

    // Care manager cannot edit contacts for another CM's client
    if (
      req.user.role === "care_manager" &&
      contact.client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to edit contacts for this client.",
      });
    }

    const updated = await prisma.clientContact.update({
      where: { id: contactId },
      data: {
        name: name ?? contact.name,
        relationship: relationship ?? contact.relationship,
        phone: phone ?? contact.phone,
        email: email ?? contact.email,
        address: address ?? contact.address,
        notes: notes ?? contact.notes,
        ...(typeof isEmergencyContact === "boolean"
          ? { isEmergencyContact }
          : {}),
      },
    });

    await logAudit(req, {
      entityType: "contact",
      entityId: updated.id,
      action: "update",
      details: `Updated contact "${updated.name}" for client ${updated.clientId}`,
    });

    return res.json(updated);
  } catch (err) {
    console.error("Error updating client contact:", err);
    return res.status(500).json({ error: "Failed to update contact." });
  }
});



/**
 * DELETE /api/clients/:clientId/contacts/:contactId
 */
router.delete(
  "/:clientId/contacts/:contactId",
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { clientId, contactId } = req.params;

      const contact = await prisma.clientContact.findFirst({
        where: {
          id: contactId,
          clientId,
          orgId: req.user.orgId,
        },
        include: {
          client: true,
        },
      });

      if (!contact) {
        return res.status(404).json({ error: "Contact not found" });
      }

      // Care manager cannot delete contacts for another CM's client
      if (
        req.user.role === "care_manager" &&
        contact.client.primaryCMId !== req.user.userId
      ) {
        return res.status(403).json({
          error: "You are not allowed to delete contacts for this client.",
        });
      }

      await prisma.clientContact.delete({
        where: {
          id: contactId,
        },
      });

       await logAudit(req, {
        entityType: "contact",
        entityId: contact.id,
        action: "delete",
        details: `Deleted contact "${contact.name}" for client ${contact.clientId}`,
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("Error deleting client contact:", err);
      return res.status(500).json({ error: "Failed to delete contact." });
    }
  }
);

/**
 * GET /api/clients/:id/providers
 */
router.get("/:id/providers", async (req: AuthRequest, res) => {
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

    // Care manager cannot access another CM's client
    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to access this client's providers.",
      });
    }

    const providers = await prisma.clientProvider.findMany({
      where: {
        clientId: client.id,
        orgId: req.user.orgId,
      },
      orderBy: { createdAt: "asc" },
    });

    return res.json(providers);
  } catch (err) {
    console.error("Error fetching client providers:", err);
    return res.status(500).json({ error: "Failed to load providers." });
  }
});

/**
 * POST /api/clients/:id/providers
 */
router.post("/:id/providers", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const {
      type,
      name,
      specialty,
      phone,
      email,
      address,
      notes,
    } = req.body as {
      type?: string;
      name?: string;
      specialty?: string;
      phone?: string;
      email?: string;
      address?: string;
      notes?: string;
    };

    if (!type || !name) {
      return res
        .status(400)
        .json({ error: "Provider type and name are required" });
    }

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

    // Care manager cannot add providers for another CM's client
    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to add providers for this client.",
      });
    }

    const provider = await prisma.clientProvider.create({
      data: {
        orgId: req.user.orgId,
        clientId: client.id,
        type,
        name,
        specialty,
        phone,
        email,
        address,
        notes,
      },
    });

    await logAudit(req, {
      entityType: "provider",
      entityId: provider.id,
      action: "create",
      details: `Added provider "${provider.name}" (${provider.type}) for client ${client.id}`,
    });

    return res.status(201).json(provider);
  } catch (err) {
    console.error("Error creating client provider:", err);
    return res.status(500).json({ error: "Failed to create provider." });
  }
});

/**
 * PUT /api/clients/:clientId/providers/:providerId
 */
router.put(
  "/:clientId/providers/:providerId",
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { clientId, providerId } = req.params;
      const {
        type,
        name,
        specialty,
        phone,
        email,
        address,
        notes,
      } = req.body as {
        type?: string;
        name?: string;
        specialty?: string;
        phone?: string;
        email?: string;
        address?: string;
        notes?: string;
      };

      // Ensure provider exists and belongs to same org & client
      const provider = await prisma.clientProvider.findFirst({
        where: {
          id: providerId,
          clientId,
          orgId: req.user.orgId,
        },
        include: {
          client: true,
        },
      });

      if (!provider) {
        return res.status(404).json({ error: "Provider not found" });
      }

      // Care manager cannot edit providers for another CM's client
      if (
        req.user.role === "care_manager" &&
        provider.client.primaryCMId !== req.user.userId
      ) {
        return res.status(403).json({
          error: "You are not allowed to edit providers for this client.",
        });
      }

      const updated = await prisma.clientProvider.update({
        where: { id: providerId },
        data: {
          type: type ?? provider.type,
          name: name ?? provider.name,
          specialty: specialty ?? provider.specialty,
          phone: phone ?? provider.phone,
          email: email ?? provider.email,
          address: address ?? provider.address,
          notes: notes ?? provider.notes,
        },
      });

      await logAudit(req, {
        entityType: "provider",
        entityId: updated.id,
        action: "update",
        details: `Updated provider "${updated.name}" for client ${updated.clientId}`,
      });

      return res.json(updated);
    } catch (err) {
      console.error("Error updating client provider:", err);
      return res.status(500).json({ error: "Failed to update provider." });
    }
  }
);

/**
 * DELETE /api/clients/:clientId/providers/:providerId
 */
router.delete(
  "/:clientId/providers/:providerId",
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { clientId, providerId } = req.params;

      const provider = await prisma.clientProvider.findFirst({
        where: {
          id: providerId,
          clientId,
          orgId: req.user.orgId,
        },
        include: {
          client: true,
        },
      });

      if (!provider) {
        return res.status(404).json({ error: "Provider not found" });
      }

      // Care manager cannot delete providers for another CM's client
      if (
        req.user.role === "care_manager" &&
        provider.client.primaryCMId !== req.user.userId
      ) {
        return res.status(403).json({
          error: "You are not allowed to delete providers for this client.",
        });
      }

      await prisma.clientProvider.delete({
        where: { id: providerId },
      });

      await logAudit(req, {
        entityType: "provider",
        entityId: provider.id,
        action: "delete",
        details: `Deleted provider "${provider.name}" for client ${provider.clientId}`,
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("Error deleting client provider:", err);
      return res.status(500).json({ error: "Failed to delete provider." });
    }
  }
);

/**
 * GET /api/clients/:id/medications
 */
router.get("/:id/medications", async (req: AuthRequest, res) => {
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

    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to access this client's medications.",
      });
    }

    const meds = await prisma.clientMedication.findMany({
      where: {
        clientId: client.id,
        orgId: req.user.orgId,
      },
      orderBy: { createdAt: "asc" },
    });

    return res.json(meds);
  } catch (err) {
    console.error("Error fetching client medications:", err);
    return res.status(500).json({ error: "Failed to load medications." });
  }
});

/**
 * POST /api/clients/:id/medications
 * Body: { name, dosage?, frequency?, route?, prescribingProvider?, notes? }
 */
router.post("/:id/medications", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const {
      name,
      dosage,
      frequency,
      route,
      prescribingProvider,
      notes,
    } = req.body as {
      name?: string;
      dosage?: string;
      frequency?: string;
      route?: string;
      prescribingProvider?: string;
      notes?: string;
    };

    if (!name) {
      return res.status(400).json({ error: "Medication name is required" });
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

    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to add medications for this client.",
      });
    }

    const med = await prisma.clientMedication.create({
      data: {
        orgId: req.user.orgId,
        clientId: client.id,
        name,
        dosage,
        frequency,
        route,
        prescribingProvider,
        notes,
      },
    });

    // Audit log: created medication
    const medLabel = [med.name, med.dosage, med.frequency]
      .filter(Boolean)
      .join(" ");
    await logAudit(req, {
      entityType: "medication",
      entityId: med.id,
      action: "create",
      details: `Added medication: ${medLabel || med.name}`,
    });

    return res.status(201).json(med);
  } catch (err) {
    console.error("Error creating client medication:", err);
    return res.status(500).json({ error: "Failed to create medication." });
  }
});

/**
 * PUT /api/clients/:clientId/medications/:medicationId
 * Body: partial medication fields
 */
router.put(
  "/:clientId/medications/:medicationId",
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { clientId, medicationId } = req.params;
      const {
        name,
        dosage,
        frequency,
        route,
        prescribingProvider,
        notes,
      } = req.body as {
        name?: string;
        dosage?: string;
        frequency?: string;
        route?: string;
        prescribingProvider?: string;
        notes?: string;
      };

      const med = await prisma.clientMedication.findFirst({
        where: {
          id: medicationId,
          clientId,
          orgId: req.user.orgId,
        },
        include: {
          client: true,
        },
      });

      if (!med) {
        return res.status(404).json({ error: "Medication not found" });
      }

      if (
        req.user.role === "care_manager" &&
        med.client.primaryCMId !== req.user.userId
      ) {
        return res.status(403).json({
          error: "You are not allowed to edit medications for this client.",
        });
      }

      const updated = await prisma.clientMedication.update({
        where: { id: medicationId },
        data: {
          name: name ?? med.name,
          dosage: dosage ?? med.dosage,
          frequency: frequency ?? med.frequency,
          route: route ?? med.route,
          prescribingProvider:
            prescribingProvider ?? med.prescribingProvider,
          notes: notes ?? med.notes,
        },
      });

      // Audit log: updated medication
      const changes: string[] = [];

      if (name && name !== med.name) {
        changes.push(`name: "${med.name}" -> "${name}"`);
      }
      if (dosage && dosage !== med.dosage) {
        changes.push(`dosage: "${med.dosage ?? ""}" -> "${dosage}"`);
      }
      if (frequency && frequency !== med.frequency) {
        changes.push(
          `frequency: "${med.frequency ?? ""}" -> "${frequency}"`
        );
      }
      if (route && route !== med.route) {
        changes.push(`route: "${med.route ?? ""}" -> "${route}"`);
      }
      if (
        prescribingProvider &&
        prescribingProvider !== med.prescribingProvider
      ) {
        changes.push(
          `prescribingProvider: "${med.prescribingProvider ?? ""}" -> "${prescribingProvider}"`
        );
      }

      const medLabel = [med.name, med.dosage, med.frequency]
        .filter(Boolean)
        .join(" ");

      await logAudit(req, {
        entityType: "medication",
        entityId: med.id,
        action: "update",
        details:
          changes.length > 0
            ? `Updated medication ${medLabel || med.name}: ${changes.join(
                "; "
              )}`
            : `Updated medication ${medLabel || med.name}`,
      });

      return res.json(updated);
    } catch (err) {
      console.error("Error updating client medication:", err);
      return res.status(500).json({ error: "Failed to update medication" });
    }
  }
);

/**
 * DELETE /api/clients/:clientId/medications/:medicationId
 */
router.delete(
  "/:clientId/medications/:medicationId",
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { clientId, medicationId } = req.params;

      const med = await prisma.clientMedication.findFirst({
        where: {
          id: medicationId,
          clientId,
          orgId: req.user.orgId,
        },
        include: {
          client: true,
        },
      });

      if (!med) {
        return res.status(404).json({ error: "Medication not found" });
      }

      if (
        req.user.role === "care_manager" &&
        med.client.primaryCMId !== req.user.userId
      ) {
        return res.status(403).json({
          error: "You are not allowed to delete medications for this client.",
        });
      }

      await prisma.clientMedication.delete({
        where: { id: medicationId },
      });

      const medLabel = [med.name, med.dosage, med.frequency]
        .filter(Boolean)
        .join(" ");

      await logAudit(req, {
        entityType: "medication",
        entityId: med.id,
        action: "delete",
        details: `Deleted medication: ${medLabel || med.name}`,
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("Error deleting client medication:", err);
      return res.status(500).json({ error: "Failed to delete medication." });
    }
  }
);

/**
 * GET /api/clients/:id/allergies
 */
router.get("/:id/allergies", async (req: AuthRequest, res) => {
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

    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to access this client's allergies.",
      });
    }

    const allergies = await prisma.clientAllergy.findMany({
      where: {
        clientId: client.id,
        orgId: req.user.orgId,
      },
      orderBy: { createdAt: "asc" },
    });

    return res.json(allergies);
  } catch (err) {
    console.error("Error fetching client allergies:", err);
    return res.status(500).json({ error: "Failed to load allergies." });
  }
});

/**
 * POST /api/clients/:id/allergies
 */
router.post("/:id/allergies", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const { allergen, reaction, severity, notes } = req.body as {
      allergen?: string;
      reaction?: string;
      severity?: string;
      notes?: string;
    };

    if (!allergen) {
      return res.status(400).json({ error: "Allergen is required" });
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

    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to add allergies for this client.",
      });
    }

    const allergy = await prisma.clientAllergy.create({
      data: {
        orgId: req.user.orgId,
        clientId: client.id,
        allergen,
        reaction,
        severity,
        notes,
      },
    });

    await logAudit(req, {
      entityType: "allergy",
      entityId: allergy.id,
      action: "create",
      details: `Added allergy "${allergy.allergen}" for client ${allergy.clientId}`,
    });

    return res.status(201).json(allergy);
  } catch (err) {
    console.error("Error creating client allergy:", err);
    return res.status(500).json({ error: "Failed to create allergy." });
  }
});

/**
 * PUT /api/clients/:clientId/allergies/:allergyId
 */
router.put(
  "/:clientId/allergies/:allergyId",
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { clientId, allergyId } = req.params;
      const { allergen, reaction, severity, notes } = req.body as {
        allergen?: string;
        reaction?: string;
        severity?: string;
        notes?: string;
      };

      const allergy = await prisma.clientAllergy.findFirst({
        where: {
          id: allergyId,
          clientId,
          orgId: req.user.orgId,
        },
        include: {
          client: true,
        },
      });

      if (!allergy) {
        return res.status(404).json({ error: "Allergy not found" });
      }

      if (
        req.user.role === "care_manager" &&
        allergy.client.primaryCMId !== req.user.userId
      ) {
        return res.status(403).json({
          error: "You are not allowed to edit allergies for this client.",
        });
      }

      const updated = await prisma.clientAllergy.update({
        where: { id: allergyId },
        data: {
          allergen: allergen ?? allergy.allergen,
          reaction: reaction ?? allergy.reaction,
          severity: severity ?? allergy.severity,
          notes: notes ?? allergy.notes,
        },
      });

      await logAudit(req, {
        entityType: "allergy",
        entityId: updated.id,
        action: "update",
        details: `Updated allergy "${updated.allergen}" for client ${updated.clientId}`,
      });

      return res.json(updated);
    } catch (err) {
      console.error("Error updating client allergy:", err);
      return res.status(500).json({ error: "Failed to update allergy." });
    }
  }
);

/**
 * DELETE /api/clients/:clientId/allergies/:allergyId
 */
router.delete(
  "/:clientId/allergies/:allergyId",
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { clientId, allergyId } = req.params;

      const allergy = await prisma.clientAllergy.findFirst({
        where: {
          id: allergyId,
          clientId,
          orgId: req.user.orgId,
        },
        include: {
          client: true,
        },
      });

      if (!allergy) {
        return res.status(404).json({ error: "Allergy not found" });
      }

      if (
        req.user.role === "care_manager" &&
        allergy.client.primaryCMId !== req.user.userId
      ) {
        return res.status(403).json({
          error: "You are not allowed to delete allergies for this client.",
        });
      }

      await prisma.clientAllergy.delete({
        where: { id: allergyId },
      });

      await logAudit(req, {
        entityType: "allergy",
        entityId: allergy.id,
        action: "delete",
        details: `Deleted allergy "${allergy.allergen}" for client ${allergy.clientId}`,
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("Error deleting client allergy:", err);
      return res.status(500).json({ error: "Failed to delete allergy." });
    }
  }
);

/**
 * GET /api/clients/:id/insurance
 */
router.get("/:id/insurance", async (req: AuthRequest, res) => {
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

    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to access this client's insurance.",
      });
    }

    const insurance = await prisma.clientInsurance.findMany({
      where: {
        clientId: client.id,
        orgId: req.user.orgId,
      },
      orderBy: { createdAt: "asc" },
    });

    return res.json(insurance);
  } catch (err) {
    console.error("Error fetching client insurance:", err);
    return res.status(500).json({ error: "Failed to load insurance." });
  }
});

/**
 * POST /api/clients/:id/insurance
 */
router.post("/:id/insurance", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const {
      insuranceType,
      carrier,
      policyNumber,
      groupNumber,
      memberId,
      phone,
      notes,
      primary,
    } = req.body as {
      insuranceType?: string;
      carrier?: string;
      policyNumber?: string;
      groupNumber?: string;
      memberId?: string;
      phone?: string;
      notes?: string;
      primary?: boolean;
    };

    if (!carrier && !insuranceType) {
      return res.status(400).json({
        error: "At least carrier or insuranceType is required",
      });
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

    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to add insurance for this client.",
      });
    }

    const record = await prisma.clientInsurance.create({
      data: {
        orgId: req.user.orgId,
        clientId: client.id,
        insuranceType,
        carrier,
        policyNumber,
        groupNumber,
        memberId,
        phone,
        notes,
        primary: Boolean(primary),
      },
    });

    await logAudit(req, {
      entityType: "insurance",
      entityId: record.id,
      action: "create",
      details: `Added insurance "${record.carrier ?? ""}" for client ${record.clientId}`,
    });

    return res.status(201).json(record);
  } catch (err) {
    console.error("Error creating client insurance:", err);
    return res.status(500).json({ error: "Failed to create insurance." });
  }
});

/**
 * PUT /api/clients/:clientId/insurance/:insuranceId
 */
router.put(
  "/:clientId/insurance/:insuranceId",
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { clientId, insuranceId } = req.params;
      const {
        insuranceType,
        carrier,
        policyNumber,
        groupNumber,
        memberId,
        phone,
        notes,
        primary,
      } = req.body as {
        insuranceType?: string;
        carrier?: string;
        policyNumber?: string;
        groupNumber?: string;
        memberId?: string;
        phone?: string;
        notes?: string;
        primary?: boolean;
      };

      const record = await prisma.clientInsurance.findFirst({
        where: {
          id: insuranceId,
          clientId,
          orgId: req.user.orgId,
        },
        include: {
          client: true,
        },
      });

      if (!record) {
        return res.status(404).json({ error: "Insurance record not found" });
      }

      if (
        req.user.role === "care_manager" &&
        record.client.primaryCMId !== req.user.userId
      ) {
        return res.status(403).json({
          error: "You are not allowed to edit insurance for this client.",
        });
      }

      const updated = await prisma.clientInsurance.update({
        where: { id: insuranceId },
        data: {
          insuranceType: insuranceType ?? record.insuranceType,
          carrier: carrier ?? record.carrier,
          policyNumber: policyNumber ?? record.policyNumber,
          groupNumber: groupNumber ?? record.groupNumber,
          memberId: memberId ?? record.memberId,
          phone: phone ?? record.phone,
          notes: notes ?? record.notes,
          ...(typeof primary === "boolean" ? { primary } : {}),
        },
      });

      await logAudit(req, {
        entityType: "insurance",
        entityId: updated.id,
        action: "update",
        details: `Updated insurance "${updated.carrier ?? ""}" for client ${updated.clientId}`,
      });

      return res.json(updated);
    } catch (err) {
      console.error("Error updating client insurance:", err);
      return res.status(500).json({ error: "Failed to update insurance." });
    }
  }
);

/**
 * DELETE /api/clients/:clientId/insurance/:insuranceId
 */
router.delete(
  "/:clientId/insurance/:insuranceId",
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { clientId, insuranceId } = req.params;

      const record = await prisma.clientInsurance.findFirst({
        where: {
          id: insuranceId,
          clientId,
          orgId: req.user.orgId,
        },
        include: {
          client: true,
        },
      });

      if (!record) {
        return res.status(404).json({ error: "Insurance record not found" });
      }

      if (
        req.user.role === "care_manager" &&
        record.client.primaryCMId !== req.user.userId
      ) {
        return res.status(403).json({
          error: "You are not allowed to delete insurance for this client.",
        });
      }

      await prisma.clientInsurance.delete({
        where: { id: insuranceId },
      });

      await logAudit(req, {
        entityType: "insurance",
        entityId: record.id,
        action: "delete",
        details: `Deleted insurance "${record.carrier ?? ""}" for client ${record.clientId}`,
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("Error deleting client insurance:", err);
      return res.status(500).json({ error: "Failed to delete insurance." });
    }
  }
);

/**
 * GET /api/clients/:id/risks
 */
router.get("/:id/risks", async (req: AuthRequest, res) => {
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

    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to access this client's risks.",
      });
    }

    const risks = await prisma.clientRisk.findMany({
      where: {
        clientId: client.id,
        orgId: req.user.orgId,
      },
      orderBy: { createdAt: "asc" },
    });

    return res.json(risks);
  } catch (err) {
    console.error("Error fetching client risks:", err);
    return res.status(500).json({ error: "Failed to load risks." });
  }
});

/**
 * POST /api/clients/:id/risks
 * Body: { category, severity?, notes? }
 */
router.post("/:id/risks", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const { category, severity, notes } = req.body as {
      category?: string;
      severity?: string;
      notes?: string;
    };

    if (!category) {
      return res.status(400).json({ error: "Risk category is required" });
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

    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to add risks for this client.",
      });
    }

    const risk = await prisma.clientRisk.create({
      data: {
        orgId: req.user.orgId,
        clientId: client.id,
        category,
        severity,
        notes,
      },
    });

    const riskLabel = `${risk.category}${
      risk.severity ? ` (${risk.severity})` : ""
    }`;

    await logAudit(req, {
      entityType: "risk",
      entityId: risk.id,
      action: "create",
      details: `Added risk: ${riskLabel}`,
    });

    return res.status(201).json(risk);
  } catch (err) {
    console.error("Error creating client risk:", err);
    return res.status(500).json({ error: "Failed to create risk." });
  }
});

/**
 * PUT /api/clients/:clientId/risks/:riskId
 * Body: partial risk fields
 */
router.put(
  "/:clientId/risks/:riskId",
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { clientId, riskId } = req.params;
      const { category, severity, notes } = req.body as {
        category?: string;
        severity?: string;
        notes?: string;
      };

      const risk = await prisma.clientRisk.findFirst({
        where: {
          id: riskId,
          clientId,
          orgId: req.user.orgId,
        },
        include: {
          client: true,
        },
      });

      if (!risk) {
        return res.status(404).json({ error: "Risk not found" });
      }

      if (
        req.user.role === "care_manager" &&
        risk.client.primaryCMId !== req.user.userId
      ) {
        return res.status(403).json({
          error: "You are not allowed to edit risks for this client.",
        });
      }

      const updated = await prisma.clientRisk.update({
        where: { id: riskId },
        data: {
          category: category ?? risk.category,
          severity: severity ?? risk.severity,
          notes: notes ?? risk.notes,
        },
      });

      const changes: string[] = [];

      if (category && category !== risk.category) {
        changes.push(`category: "${risk.category}" -> "${category}"`);
      }
      if (severity && severity !== risk.severity) {
        changes.push(
          `severity: "${risk.severity ?? ""}" -> "${severity}"`
        );
      }
      if (notes && notes !== risk.notes) {
        changes.push(
          `notes changed (length ${risk.notes?.length ?? 0} -> ${notes.length})`
        );
      }

      const riskLabel = `${risk.category}${
        risk.severity ? ` (${risk.severity})` : ""
      }`;

      await logAudit(req, {
        entityType: "risk",
        entityId: risk.id,
        action: "update",
        details:
          changes.length > 0
            ? `Updated risk ${riskLabel}: ${changes.join("; ")}`
            : `Updated risk ${riskLabel}`,
      });

      return res.json(updated);
    } catch (err) {
      console.error("Error updating client risk:", err);
      return res.status(500).json({ error: "Failed to update risk." });
    }
  }
);

/**
 * DELETE /api/clients/:clientId/risks/:riskId
 */
router.delete(
  "/:clientId/risks/:riskId",
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { clientId, riskId } = req.params;

      const risk = await prisma.clientRisk.findFirst({
        where: {
          id: riskId,
          clientId,
          orgId: req.user.orgId,
        },
        include: {
          client: true,
        },
      });

      if (!risk) {
        return res.status(404).json({ error: "Risk not found" });
      }

      if (
        req.user.role === "care_manager" &&
        risk.client.primaryCMId !== req.user.userId
      ) {
        return res.status(403).json({
          error: "You are not allowed to delete risks for this client.",
        });
      }

      await prisma.clientRisk.delete({
        where: { id: riskId },
      });

      const riskLabel = `${risk.category}${
        risk.severity ? ` (${risk.severity})` : ""
      }`;

      await logAudit(req, {
        entityType: "risk",
        entityId: risk.id,
        action: "delete",
        details: `Deleted risk: ${riskLabel}`,
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("Error deleting client risk:", err);
      return res.status(500).json({ error: "Failed to delete risk." });
    }
  }
);

/**
 * GET /api/clients/:id/documents
 */
router.get("/:id/documents", async (req: AuthRequest, res) => {
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

    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to access this client's documents.",
      });
    }

    const docs = await prisma.clientDocument.findMany({
      where: {
        clientId: client.id,
        orgId: req.user.orgId,
      },
      orderBy: { uploadedAt: "asc" },
    });

    return res.json(docs);
  } catch (err) {
    console.error("Error fetching client documents:", err);
    return res.status(500).json({ error: "Failed to load documents." });
  }
});

/**
 * POST /api/clients/:id/documents
 * Body: { title, fileUrl, category?, fileType? }
 */
router.post("/:id/documents", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const { title, fileUrl, category, fileType } = req.body as {
      title?: string;
      fileUrl?: string;
      category?: string;
      fileType?: string;
    };

    if (!title || !fileUrl) {
      return res
        .status(400)
        .json({ error: "Title and fileUrl are required" });
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

    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to add documents for this client.",
      });
    }

    const doc = await prisma.clientDocument.create({
      data: {
        orgId: req.user.orgId,
        clientId: client.id,
        title,
        fileUrl,
        category,
        fileType,
      },
    });

    await logAudit(req, {
      entityType: "document",
      entityId: doc.id,
      action: "create",
      details: `Added document "${doc.title}" for client ${doc.clientId}`,
    });

    return res.status(201).json(doc);
  } catch (err) {
    console.error("Error creating client document:", err);
    return res.status(500).json({ error: "Failed to create document." });
  }
});

/**
 * DELETE /api/clients/:clientId/documents/:documentId
 */
router.delete(
  "/:clientId/documents/:documentId",
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { clientId, documentId } = req.params;

      const doc = await prisma.clientDocument.findFirst({
        where: {
          id: documentId,
          clientId,
          orgId: req.user.orgId,
        },
        include: {
          client: true,
        },
      });

      if (!doc) {
        return res.status(404).json({ error: "Document not found" });
      }

      if (
        req.user.role === "care_manager" &&
        doc.client.primaryCMId !== req.user.userId
      ) {
        return res.status(403).json({
          error: "You are not allowed to delete documents for this client.",
        });
      }

      await prisma.clientDocument.delete({
        where: { id: documentId },
      });

      await logAudit(req, {
        entityType: "document",
        entityId: doc.id,
        action: "delete",
        details: `Deleted document "${doc.title}" for client ${doc.clientId}`,
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("Error deleting client document:", err);
      return res.status(500).json({ error: "Failed to delete document." });
    }
  }
);

/**
 * Care Plans & Goals & Progress Notes (already good; no audit for now)
 * ... (these routes are unchanged except for previous additions) ...
 * (kept from your code, so I won't repeat the entire block here to avoid confusion)
 * You can keep your existing care-plans/goals/progress-notes routes as-is.
 */

/**
 * GET /api/clients/:id/face-sheet
 * Generate a 1-page Emergency Face Sheet PDF for the client.
 */
router.get("/:id/face-sheet", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;

    // Load client + related safety/billing data (similar to clientSnapshot)
    const client = await prisma.client.findFirst({
      where: {
        id,
        orgId: req.user.orgId,
      },
      include: {
        contacts: true,
        medications: true,
        allergies: true,
        risks: true,
        insurances: true,
      },
    });

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // Primary contact: emergency contact -> first contact -> billing contact
    const emergency = client.contacts.find((c) => c.isEmergencyContact);
    const firstContact = client.contacts[0];

    const primaryContactName =
      emergency?.name ||
      firstContact?.name ||
      client.billingContactName ||
      null;
    const primaryContactPhone =
      emergency?.phone ||
      firstContact?.phone ||
      client.billingContactPhone ||
      null;
    const primaryContactEmail =
      emergency?.email ||
      firstContact?.email ||
      client.billingContactEmail ||
      null;

    // Medications
    const medCount = client.medications.length;

    // Allergies: choose severe first, else first
    const allergyCount = client.allergies.length;
    const severeAllergy =
      client.allergies.find(
        (a) => (a.severity ?? "").toLowerCase() === "severe"
      ) || client.allergies[0] || null;

    const topAllergyLabel = severeAllergy
      ? `${severeAllergy.allergen}${
          severeAllergy.severity ? ` (${severeAllergy.severity})` : ""
        }`
      : null;

    // Risks: choose high first, else first
    const riskCount = client.risks.length;
    const highRisk =
      client.risks.find(
        (r) => (r.severity ?? "").toLowerCase() === "high"
      ) || client.risks[0] || null;

    const topRisks = client.risks
      .slice(0, 3)
      .map((r) => `${r.category}${r.severity ? ` (${r.severity})` : ""}`);

    // Insurance: primary or first
    const primaryInsurance =
      client.insurances.find((i) => i.primary) || client.insurances[0] || null;

    const primaryInsuranceLabel = primaryInsurance
      ? [primaryInsurance.carrier, primaryInsurance.insuranceType]
          .filter(Boolean)
          .join(" · ")
      : null;

    // --- PDF generation ---
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
    });

    const safeName = client.name.replace(/[^a-z0-9_\- ]/gi, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeName}_face_sheet.pdf"`
    );

    doc.pipe(res);

    // Title
    doc.fontSize(18).text("Emergency Face Sheet", { align: "center" }).moveDown(0.5);

    doc
      .fontSize(10)
      .text(`Generated: ${new Date().toLocaleString()}`, {
        align: "center",
      })
      .moveDown(1.5);

    // Client identity
    doc.fontSize(14).text(client.name, { align: "left" }).moveDown(0.3);

    doc
      .fontSize(10)
      .text(
        client.preferredName ? `Preferred name: ${client.preferredName}` : "",
        { continued: false }
      );
    doc.text(
      client.primaryDiagnosis ? `Primary dx: ${client.primaryDiagnosis}` : ""
    );
    doc.moveDown(0.5);

    // Contact + address row
    if (client.address) {
      doc.text(`Address: ${client.address}`);
    }
    if (primaryContactName || primaryContactPhone || primaryContactEmail) {
      doc.moveDown(0.3).fontSize(11).text("Primary Contact:", {
        underline: true,
      });
      doc.fontSize(10);
      if (primaryContactName) {
        doc.text(`Name: ${primaryContactName}`);
      }
      if (primaryContactPhone) {
        doc.text(`Phone: ${primaryContactPhone}`);
      }
      if (primaryContactEmail) {
        doc.text(`Email: ${primaryContactEmail}`);
      }
    }

    doc.moveDown(0.8);

    // Insurance block
    doc.fontSize(11).text("Insurance & Billing", { underline: true }).moveDown(0.3);
    doc.fontSize(10);
    if (primaryInsurance) {
      if (primaryInsuranceLabel) {
        doc.text(primaryInsuranceLabel);
      }
      if (primaryInsurance.policyNumber) {
        doc.text(`Policy #: ${primaryInsurance.policyNumber}`);
      }
      if (primaryInsurance.groupNumber) {
        doc.text(`Group #: ${primaryInsurance.groupNumber}`);
      }
      if (primaryInsurance.memberId) {
        doc.text(`Member ID: ${primaryInsurance.memberId}`);
      }
      if (primaryInsurance.phone) {
        doc.text(`Phone: ${primaryInsurance.phone}`);
      }
    } else {
      doc.text("No insurance on file.");
    }

    doc.moveDown(0.8);

    // Allergies block
    doc.fontSize(11).text("Allergies", { underline: true }).moveDown(0.3);
    doc.fontSize(10);

    if (allergyCount === 0) {
      doc.text("No allergies recorded.");
    } else {
      doc.text(`Total: ${allergyCount}`, { continued: !!topAllergyLabel });
      if (topAllergyLabel) {
        doc.text(`   Top: ${topAllergyLabel}`);
      }
      client.allergies.slice(0, 5).forEach((a) => {
        doc.text(
          `• ${a.allergen}${
            a.reaction ? ` – ${a.reaction}` : ""
          }${a.severity ? ` (${a.severity})` : ""}`
        );
      });
    }

    doc.moveDown(0.8);

    // Medications block
    doc.fontSize(11).text("Medications", { underline: true }).moveDown(0.3);
    doc.fontSize(10);

    if (medCount === 0) {
      doc.text("No medications recorded.");
    } else {
      doc.text(`Total: ${medCount}`);
      client.medications.slice(0, 10).forEach((m) => {
        const line = [m.name, m.dosage, m.frequency, m.route]
          .filter(Boolean)
          .join(" – ");
        doc.text(`• ${line}`);
      });
    }

    doc.moveDown(0.8);

    // Risks block
    doc.fontSize(11).text("Risks & Safety Flags", { underline: true }).moveDown(0.3);
    doc.fontSize(10);

    if (riskCount === 0) {
      doc.text("No risks recorded.");
    } else {
      doc.text(`Total: ${riskCount}`);
      if (topRisks.length > 0) {
        doc.text("Top risks:");
        topRisks.forEach((r) => {
          doc.text(`• ${r}`);
        });
      }
    }

    // Footer
    doc.moveDown(1);
    doc
      .fontSize(8)
      .fillColor("gray")
      .text(
        "This face sheet is for emergency reference only. Refer to ElderFlow for the latest information.",
        { align: "center" }
      );

    doc.end();
  } catch (err) {
    console.error("Error generating face sheet:", err);
    return res.status(500).json({ error: "Failed to generate face sheet." });
  }
});

/**
 * GET /api/clients/:id/care-plans
 * List care plans for a client.
 */
router.get("/:id/care-plans", async (req: AuthRequest, res) => {
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

    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to access care plans for this client.",
      });
    }

    const plans = await prisma.carePlan.findMany({
      where: {
        clientId: client.id,
        orgId: req.user.orgId,
      },
      orderBy: { createdAt: "asc" },
    });

    return res.json(plans);
  } catch (err) {
    console.error("Error fetching care plans:", err);
    return res.status(500).json({ error: "Failed to load care plans." });
  }
});

/**
 * POST /api/clients/:id/care-plans
 * Body: { title, status?, startDate?, targetDate?, summary? }
 */
router.post("/:id/care-plans", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const {
      title,
      status,
      startDate,
      targetDate,
      summary,
    } = req.body as {
      title?: string;
      status?: string;
      startDate?: string;
      targetDate?: string;
      summary?: string;
    };

    if (!title) {
      return res.status(400).json({ error: "Care plan title is required" });
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

    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to create care plans for this client.",
      });
    }

    const plan = await prisma.carePlan.create({
      data: {
        orgId: req.user.orgId,
        clientId: client.id,
        title,
        status: status || "active",
        summary,
        startDate: startDate ? new Date(startDate) : null,
        targetDate: targetDate ? new Date(targetDate) : null,
        createdById: req.user.userId,
      },
    });

    return res.status(201).json(plan);
  } catch (err) {
    console.error("Error creating care plan:", err);
    return res.status(500).json({ error: "Failed to create care plan." });
  }
});

/**
 * GET /api/clients/:id/progress-notes
 * List structured progress notes for a client.
 */
router.get("/:id/progress-notes", async (req: AuthRequest, res) => {
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

    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to access progress notes for this client.",
      });
    }

    const notes = await prisma.progressNote.findMany({
      where: {
        clientId: client.id,
        orgId: req.user.orgId,
      },
      orderBy: { date: "desc" },
      include: {
        author: true,
        carePlan: true,
      },
    });

    return res.json(notes);
  } catch (err) {
    console.error("Error fetching progress notes:", err);
    return res
      .status(500)
      .json({ error: "Failed to load progress notes." });
  }
});

/**
 * POST /api/clients/:id/progress-notes
 * Body: { date?, noteType?, content, carePlanId? }
 */
router.post("/:id/progress-notes", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const {
      date,
      noteType,
      content,
      carePlanId,
    } = req.body as {
      date?: string;
      noteType?: string;
      content?: string;
      carePlanId?: string;
    };

    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Note content is required" });
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

    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to add progress notes for this client.",
      });
    }

    let planId: string | null = null;
    if (carePlanId) {
      const plan = await prisma.carePlan.findFirst({
        where: {
          id: carePlanId,
          clientId: client.id,
          orgId: req.user.orgId,
        },
      });
      if (plan) {
        planId = plan.id;
      }
    }

    const note = await prisma.progressNote.create({
      data: {
        orgId: req.user.orgId,
        clientId: client.id,
        authorId: req.user.userId,
        date: date ? new Date(date) : new Date(),
        noteType,
        content: content.trim(),
        carePlanId: planId,
      },
      include: {
        author: true,
        carePlan: true,
      },
    });

    return res.status(201).json(note);
  } catch (err) {
    console.error("Error creating progress note:", err);
    return res.status(500).json({ error: "Failed to create progress note." });
  }
});

/**
 * GET /api/clients/:id/audit-logs
 * Returns audit logs for this client, currently medications & risks.
 */
router.get("/:id/audit-logs", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;

    // Make sure client exists and belongs to org
    const client = await prisma.client.findFirst({
      where: {
        id,
        orgId: req.user.orgId,
      },
    });

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // Care managers can only access their own clients
    if (
      req.user.role === "care_manager" &&
      client.primaryCMId !== req.user.userId
    ) {
      return res.status(403).json({
        error: "You are not allowed to access this client's audit logs.",
      });
    }

    // Get IDs of this client's meds and risks
    const [meds, risks] = await Promise.all([
      prisma.clientMedication.findMany({
        where: { clientId: client.id, orgId: req.user.orgId },
        select: { id: true },
      }),
      prisma.clientRisk.findMany({
        where: { clientId: client.id, orgId: req.user.orgId },
        select: { id: true },
      }),
    ]);

    const medIds = meds.map((m) => m.id);
    const riskIds = risks.map((r) => r.id);

    if (medIds.length === 0 && riskIds.length === 0) {
      return res.json([]); // nothing to show yet
    }

    const orFilters: any[] = [];
    if (medIds.length > 0) {
      orFilters.push({
        entityType: "medication",
        entityId: { in: medIds },
      });
    }
    if (riskIds.length > 0) {
      orFilters.push({
        entityType: "risk",
        entityId: { in: riskIds },
      });
    }

    const logs = await prisma.auditLog.findMany({
      where: {
        orgId: req.user.orgId,
        OR: orFilters,
      },
      include: {
        user: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Return a cleaner payload
    return res.json(
      logs.map((log) => ({
        id: log.id,
        entityType: log.entityType,
        entityId: log.entityId,
        action: log.action,
        details: log.details,
        createdAt: log.createdAt,
        userName: log.user?.name ?? log.user?.email ?? null,
      }))
    );
  } catch (err) {
    console.error("Error fetching audit logs:", err);
    return res.status(500).json({ error: "Failed to load audit logs." });
  }
});


export default router;
