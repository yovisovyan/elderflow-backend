"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
exports.errorHandler = errorHandler;
const zod_1 = require("zod");
class AppError extends Error {
    constructor(message, statusCode = 500, code) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }
}
exports.AppError = AppError;
function errorHandler(err, req, res, _next) {
    console.error("Unhandled error:", err);
    // Zod validation error
    if (err instanceof zod_1.ZodError) {
        return res.status(400).json({
            error: "Validation error",
            details: err.issues.map((i) => ({
                path: i.path.join("."),
                message: i.message,
            })),
        });
    }
    // Our custom AppError
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            error: err.message,
            code: err.code,
        });
    }
    // Generic fallback
    return res.status(500).json({
        error: "Internal server error",
    });
}
