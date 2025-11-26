import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { AuthRequest } from "../middleware/auth";
import { requireAdmin } from "../middleware/requireAdmin";

const prisma = new PrismaClient();
const router = Router();

/**
 * GET /api/users
 * Admin-only list of users. Optional query: ?role=care_manager
 */
router.get("/", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { role } = req.query;

    const where: any = {
      orgId: req.user.orgId,
    };

    if (role && typeof role === "string") {
      where.role = role;
    }

    const users = await prisma.user.findMany({
      where,
      include: {
        _count: {
          select: {
            clients: true, // relation "PrimaryCM" on User
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return res.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        clientsCount: u._count.clients,
        profileImageUrl: u.profileImageUrl,
        title: u.title,
        createdAt: u.createdAt,
      })),
    });
  } catch (err) {
    console.error("Error fetching users:", err);
    return res.status(500).json({ error: "Failed to fetch users." });
  }
});

/**
 * GET /api/users/:id/summary
 * Admin-only – details for a specific user with assigned clients.
 */
router.get(
  "/:id/summary",
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;

      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          orgId: true,
          profileImageUrl: true,
          title: true,
          phone: true,
        },
      });

      if (!user || user.orgId !== req.user.orgId) {
        return res.status(404).json({ error: "User not found" });
      }

      const clients = await prisma.client.findMany({
        where: {
          orgId: req.user.orgId,
          primaryCMId: id,
        },
        select: {
          id: true,
          name: true,
          status: true,
        },
        orderBy: { name: "asc" },
      });

      return res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          createdAt: user.createdAt,
          profileImageUrl: user.profileImageUrl,
          title: user.title,
          phone: user.phone,
        },
        clients,
      });
    } catch (err) {
      console.error("Error fetching user summary:", err);
      return res
        .status(500)
        .json({ error: "Failed to fetch user summary." });
    }
  }
);

/**
 * POST /api/users
 * Admin-only – create a new user (role: care_manager or admin).
 * Body: { name, email, password, role?, profileImageUrl?, title?, phone?, clientIds?[] }
 */
router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    const authUser = req.user;

    if (!authUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (authUser.role !== "admin") {
      return res.status(403).json({ error: "Admin role required" });
    }

    if (!authUser.orgId) {
      console.error("create user: authUser.orgId is missing", authUser);
      return res.status(400).json({
        error: "Current user is not associated with an organization.",
      });
    }

    const {
      name,
      email,
      password,
      role,
      profileImageUrl,
      title,
      phone,
      clientIds,
    } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      role?: string;
      profileImageUrl?: string;
      title?: string;
      phone?: string;
      clientIds?: string[];
    };

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ error: "name, email and password are required." });
    }

    const normalizedRole =
      role === "admin" || role === "care_manager" ? role : "care_manager";

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        orgId: authUser.orgId,
        role: normalizedRole,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password: passwordHash,
        profileImageUrl: profileImageUrl?.trim() || null,
        title: title?.trim() || null,
        phone: phone?.trim() || null,
      },
    });

    // Assign clients at creation if care_manager and clientIds provided
    if (
      normalizedRole === "care_manager" &&
      Array.isArray(clientIds) &&
      clientIds.length > 0
    ) {
      await prisma.client.updateMany({
        where: {
          orgId: authUser.orgId,
          id: {
            in: clientIds,
          },
        },
        data: {
          primaryCMId: user.id,
        },
      });
    }

    return res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      profileImageUrl: user.profileImageUrl,
      title: user.title,
      phone: user.phone,
    });
  } catch (err: any) {
    console.error("Error creating user:", err);

    if (err.code === "P2002") {
      return res.status(409).json({ error: "Email already in use." });
    }

    return res.status(500).json({ error: "Failed to create user." });
  }
});

/**
 * POST /api/users/:id/assign-clients
 * Admin-only – assign clients to a care manager.
 * Body: { clientIds: string[] }
 */
router.post(
  "/:id/assign-clients",
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      const { clientIds } = req.body as { clientIds?: string[] };

      if (!Array.isArray(clientIds)) {
        return res
          .status(400)
          .json({ error: "clientIds must be an array of client IDs." });
      }

      const user = await prisma.user.findUnique({
        where: { id },
      });

      if (!user || user.orgId !== req.user.orgId) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.role !== "care_manager") {
        return res.status(400).json({
          error: "Only care managers can have client assignments.",
        });
      }

      const orgId = req.user.orgId;

      // Assign this CM to all specified clients (overwrites any previous CM)
      if (clientIds.length > 0) {
        await prisma.client.updateMany({
          where: {
            orgId,
            id: {
              in: clientIds,
            },
          },
          data: {
            primaryCMId: id,
          },
        });
      }

      const clients = await prisma.client.findMany({
        where: {
          orgId,
          primaryCMId: id,
        },
        select: {
          id: true,
          name: true,
          status: true,
        },
        orderBy: { name: "asc" },
      });

      return res.json({
        ok: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          profileImageUrl: user.profileImageUrl,
          title: user.title,
          phone: user.phone,
        },
        clients,
      });
    } catch (err) {
      console.error("Error assigning clients to user:", err);
      return res
        .status(500)
        .json({ error: "Failed to assign clients to user." });
    }
  }
);

/**
 * DELETE /api/users/:id
 * Admin-only – delete a care manager.
 * Safety: prevent delete if they still own any clients.
 */
router.delete(
  "/:id",
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;

      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          _count: {
            select: { clients: true },
          },
        },
      });

      if (!user || user.orgId !== req.user.orgId) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user._count.clients > 0) {
        return res.status(400).json({
          error:
            "This care manager still has assigned clients. Reassign or remove clients before deleting.",
        });
      }

      await prisma.user.delete({
        where: { id: user.id },
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("Error deleting user:", err);
      return res.status(500).json({ error: "Failed to delete user." });
    }
  }
);

export default router;
