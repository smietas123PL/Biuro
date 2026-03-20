import { Request, Response, NextFunction } from 'express';
import { z, AnyZodObject, ZodOptional, ZodEffects } from 'zod';
import { BadRequestError } from '../utils/errors.js';

type ZodSchema = AnyZodObject | ZodOptional<AnyZodObject> | ZodEffects<any>;

interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Middleware for declarative Zod validation of request body, query, and params.
 * Throws a BadRequestError if validation fails, which is caught by the global error handler.
 */
export const validate = (schemas: ValidationSchemas) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.params) {
        req.params = await schemas.params.parseAsync(req.params);
      }
      if (schemas.query) {
        req.query = await schemas.query.parseAsync(req.query);
      }
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new BadRequestError('Validation failed', error.issues));
      } else {
        next(error);
      }
    }
  };
};
