"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCmNotes = getCmNotes;
exports.createCmNote = createCmNote;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
// GET /api/cm/notes?limit=5
async function getCmNotes(req, res) {
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
    }
    catch (err) {
        console.error("getCmNotes error:", err);
        return res.status(500).json({ error: "Failed to load notes" });
    }
}
// POST /api/cm/notes
async function createCmNote(req, res) {
    try {
        if (!req.user || req.user.role !== "care_manager") {
            return res.status(403).json({ error: "Access denied" });
        }
        const { clientId, content } = req.body || {};
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
    }
    catch (err) {
        console.error("createCmNote error:", err);
        return res.status(500).json({ error: "Failed to save note" });
    }
}
