import type { DomainErrorShape, JsonObject } from "./types.js";

export class DomainError extends Error implements DomainErrorShape {
  readonly code: string;
  readonly category: DomainErrorShape["category"];
  readonly retryable: boolean;
  readonly outcomeCertainty: DomainErrorShape["outcomeCertainty"];
  readonly details?: JsonObject;

  constructor(shape: DomainErrorShape) {
    super(shape.message);
    this.name = "DomainError";
    this.code = shape.code;
    this.category = shape.category;
    this.retryable = shape.retryable;
    this.outcomeCertainty = shape.outcomeCertainty;
    if (shape.details !== undefined) this.details = shape.details;
  }
}

export const validationError = (code: string, message: string, details?: JsonObject): DomainError =>
  new DomainError({
    code,
    category: "validation",
    message,
    retryable: false,
    outcomeCertainty: "certain",
    ...(details ? { details } : {})
  });

export const securityError = (code: string, message: string, details?: JsonObject): DomainError =>
  new DomainError({
    code,
    category: "security",
    message,
    retryable: false,
    outcomeCertainty: "certain",
    ...(details ? { details } : {})
  });
