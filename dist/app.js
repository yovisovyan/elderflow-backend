"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const client_1 = require("@prisma/client");
const auth_1 = __importDefault(require("./routes/auth"));
const clients_1 = __importDefault(require("./routes/clients"));
const activities_1 = __importDefault(require("./routes/activities"));
const ai_1 = __importDefault(require("./routes/ai"));
const invoices_1 = __importDefault(require("./routes/invoices"));
const payments_1 = __importDefault(require("./routes/payments"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const reports_1 = __importDefault(require("./routes/reports"));
const auth_2 = require("./middleware/auth");
const users_1 = __importDefault(require("./routes/users"));
const billingRules_1 = __importDefault(require("./routes/billingRules"));
const stripe_1 = __importStar(require("./routes/stripe"));
const serviceTypes_1 = __importDefault(require("./routes/serviceTypes"));
const cmDashboard_1 = __importDefault(require("./routes/cmDashboard"));
const errorHandler_1 = require("./middleware/errorHandler");
const org_1 = __importDefault(require("./routes/org"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
// 🔹 CORS – allow all origins for now (Vercel + local)
app.use((0, cors_1.default)({
    origin: true, // reflect request origin
    credentials: true,
}));
// 🔹 Stripe webhook (raw body)
app.post("/api/stripe/webhook", express_1.default.raw({ type: "application/json" }), stripe_1.stripeWebhookHandler);
// 🔹 JSON body parser for the rest of your API
app.use(express_1.default.json());
// 🔹 Public routes
app.use("/api/auth", auth_1.default);
app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
});
// 🔹 Protected routes
app.use("/api/clients", auth_2.authMiddleware, clients_1.default);
app.use("/api/activities", auth_2.authMiddleware, activities_1.default);
app.use("/api/ai", auth_2.authMiddleware, ai_1.default);
app.use("/api/invoices", auth_2.authMiddleware, invoices_1.default);
app.use("/api/payments", auth_2.authMiddleware, payments_1.default);
app.use("/api/dashboard", auth_2.authMiddleware, dashboard_1.default);
app.use("/api/reports", auth_2.authMiddleware, reports_1.default);
app.use("/api/service-types", auth_2.authMiddleware, serviceTypes_1.default);
app.use("/api/cm", auth_2.authMiddleware, cmDashboard_1.default);
app.use(errorHandler_1.errorHandler);
// 🔹 Admin-only user management
app.use("/api/users", auth_2.authMiddleware, users_1.default);
// 🔹 Org billing rules (GET for any authed user, POST is admin-only inside the route)
app.use("/api/billing/rules", auth_2.authMiddleware, billingRules_1.default);
// 🔹 Non-webhook Stripe routes (currently stubbed)
app.use("/api/stripe", stripe_1.default);
app.use("/api/org", auth_2.authMiddleware, org_1.default);
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`Backend API running on port ${PORT}`);
});
