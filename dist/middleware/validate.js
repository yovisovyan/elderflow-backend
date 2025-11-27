"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = validate;
const errorHandler_1 = require("./errorHandler");
function validate(schema, source = "body") {
    return (req, _res, next) => {
        try {
            const data = source === "body"
                ? req.body
                : source === "query"
                    ? req.query
                    : req.params;
            const parsed = schema.parse(data);
            if (source === "body")
                req.body = parsed;
            if (source === "query")
                req.query = parsed;
            if (source === "params")
                req.params = parsed;
            next();
        }
        catch (err) {
            // Let errorHandler handle Zod errors and AppErrors
            if (err.name === "ZodError") {
                return next(err);
            }
            return next(new errorHandler_1.AppError("Invalid request", 400, "VALIDATION_ERROR"));
        }
    };
}
