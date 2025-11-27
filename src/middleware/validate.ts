// src/middleware/validate.ts
import { Request, Response, NextFunction } from "express";
import { ZodObject } from "zod";
import { AppError } from "./errorHandler";

type Source = "body" | "query" | "params";

export function validate(schema: ZodObject, source: Source = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const data =
        source === "body"
          ? req.body
          : source === "query"
          ? req.query
          : req.params;

      const parsed = schema.parse(data);

      if (source === "body") (req as any).body = parsed;
      if (source === "query") (req as any).query = parsed;
      if (source === "params") (req as any).params = parsed;

      next();
    } catch (err: any) {
      // Let errorHandler handle Zod errors and AppErrors
      if (err.name === "ZodError") {
        return next(err);
      }
      return next(
        new AppError(
          "Invalid request",
          400,
          "VALIDATION_ERROR"
        )
      );
    }
  };
}
