"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripeWebhookHandler = stripeWebhookHandler;
// src/routes/stripe.ts
const express_1 = require("express");
// 🔹 Placeholder webhook handler so /api/stripe/webhook doesn't break.
// This does NOT validate real Stripe signatures or process real events.
function stripeWebhookHandler(req, res) {
    console.log("Stripe webhook placeholder hit");
    return res.status(200).send("ok");
}
// 🔹 Basic router stub for /api/stripe routes.
// All endpoints just say "Stripe not configured" for now.
const router = (0, express_1.Router)();
router.get("/config", (_req, res) => {
    return res.json({
        stripeEnabled: false,
        message: "Stripe is not configured on this environment.",
    });
});
router.post("/checkout-session", (_req, res) => {
    return res.status(501).json({
        error: "Stripe checkout is not enabled yet.",
    });
});
exports.default = router;
