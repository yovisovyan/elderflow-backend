"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdmin = requireAdmin;
function requireAdmin(req, res, next) {
    // authMiddleware should already be attaching the user to req
    const user = req.user;
    if (!user || user.role !== "admin") {
        return res.status(403).json({ error: "Admin role required" });
    }
    next();
}
