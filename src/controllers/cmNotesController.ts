// src/controllers/cmNotesController.ts
import { Response } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";

const prisma = new PrismaClient();

// GET /api/cm/notes?limit=5
export async function getCmNotes(req: AuthRequest, res: Response) {
  try {
    if (!req.user || req.user.role !== "care_manager") {
      return res.status(403).json({ error: "Access denied" });
    }

    const limit = Number(req.query.limit) || 5;

    const notes = await prisma.clientNote.findMany({
      where: {
        authorId: req.user.userId,
      },
      include: {
        client: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
    });

    const result = notes.map((n) => ({
      id: n.id,
      clientId: n.client.id,
      clientName: n.client.name,
      createdAt: n.createdAt,
      content: n.content,
    }));

    return res.json(result);
  } catch (err) {
    console.error("getCmNotes error:", err);
    return res.status(500).json({ error: "Failed to load notes" });
  }
}

// POST /api/cm/notes
export async function createCmNote(req: AuthRequest, res: Response) {
  try {
    if (!req.user || req.user.role !== "care_manager") {
      return res.status(403).json({ error: "Access denied" });
    }

    const { clientId, content } = (req.body as any) || {};

    if (!clientId || !content || typeof content !== "string") {
      return res
        .status(400)
        .json({ error: "clientId and content are required" });
    }

    // Optional: enforce client exists & is in same org
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const note = await prisma.clientNote.create({
      data: {
        clientId,
        authorId: req.user.userId,
        content: content.trim(),
      },
      include: {
        client: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return res.status(201).json({
      id: note.id,
      clientId: note.client.id,
      clientName: note.client.name,
      createdAt: note.createdAt,
      content: note.content,
    });
  } catch (err) {
    console.error("createCmNote error:", err);
    return res.status(500).json({ error: "Failed to save note" });
  }
}
