import { Types } from 'mongoose';

export class SkillsModuleError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.name = 'SkillsModuleError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export interface PaginationOptions {
  page: number;
  limit: number;
  skip: number;
}

export type SortOrder = 'asc' | 'desc';

export function ensureObjectId(id: string, fieldName: string): void {
  if (!Types.ObjectId.isValid(id)) {
    throw new SkillsModuleError(`${fieldName} must be a valid ObjectId`, 400);
  }
}

export function ensureRequiredString(
  value: unknown,
  fieldName: string,
  maxLength?: number,
): string {
  if (typeof value !== 'string') {
    throw new SkillsModuleError(`${fieldName} is required`, 400);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new SkillsModuleError(`${fieldName} is required`, 400);
  }

  if (maxLength && trimmed.length > maxLength) {
    throw new SkillsModuleError(
      `${fieldName} cannot exceed ${maxLength} characters`,
      400,
    );
  }

  return trimmed;
}

export function ensureOptionalString(
  value: unknown,
  fieldName: string,
  maxLength?: number,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new SkillsModuleError(`${fieldName} must be a string`, 400);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (maxLength && trimmed.length > maxLength) {
    throw new SkillsModuleError(
      `${fieldName} cannot exceed ${maxLength} characters`,
      400,
    );
  }

  return trimmed;
}

export function ensureStringArray(
  value: unknown,
  fieldName: string,
): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new SkillsModuleError(`${fieldName} must be an array of strings`, 400);
  }

  const parsed = value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => (entry as string).trim())
    .filter(Boolean);

  return parsed;
}

export function ensureProficiencyLevel(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 5) {
    throw new SkillsModuleError('proficiencyLevel must be an integer from 1 to 5', 400);
  }
  return numeric;
}

export function ensureNonNegativeNumber(
  value: unknown,
  fieldName: string,
): number {
  const numeric = Number(value);
  if (Number.isNaN(numeric) || numeric < 0) {
    throw new SkillsModuleError(`${fieldName} must be a number greater than or equal to 0`, 400);
  }
  return numeric;
}

export function ensureOptionalDate(value: unknown, fieldName: string): Date | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const dateValue = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(dateValue.getTime())) {
    throw new SkillsModuleError(`${fieldName} must be a valid date`, 400);
  }

  return dateValue;
}

export function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true') {
      return true;
    }
    if (lowered === 'false') {
      return false;
    }
  }

  throw new SkillsModuleError('Boolean query value must be true or false', 400);
}

export function parsePagination(
  page?: unknown,
  limit?: unknown,
  maxLimit = 100,
): PaginationOptions {
  const resolvedPage = Math.max(1, Number(page) || 1);
  const resolvedLimit = Math.max(1, Math.min(maxLimit, Number(limit) || 10));

  return {
    page: resolvedPage,
    limit: resolvedLimit,
    skip: (resolvedPage - 1) * resolvedLimit,
  };
}

export function parseSort(
  sortBy: unknown,
  sortOrder: unknown,
  defaultSortBy: string,
): { [key: string]: 1 | -1 } {
  const resolvedSortBy =
    typeof sortBy === 'string' && sortBy.trim() ? sortBy.trim() : defaultSortBy;

  const orderString =
    typeof sortOrder === 'string' ? sortOrder.trim().toLowerCase() : 'asc';
  const resolvedOrder: 1 | -1 = orderString === 'desc' ? -1 : 1;

  return { [resolvedSortBy]: resolvedOrder };
}

export function toSkillsModuleError(error: unknown): SkillsModuleError {
  if (error instanceof SkillsModuleError) {
    return error;
  }

  const errorObject = error as {
    code?: number;
    message?: string;
    name?: string;
    keyPattern?: Record<string, number>;
    keyValue?: Record<string, unknown>;
    errors?: Record<string, { message: string }>;
    path?: string;
  };

  if (errorObject?.code === 11000) {
    const duplicateField =
      Object.keys(errorObject.keyPattern || {})[0] ||
      Object.keys(errorObject.keyValue || {})[0] ||
      'value';
    return new SkillsModuleError(`${duplicateField} already exists`, 409, errorObject.keyValue);
  }

  if (errorObject?.name === 'ValidationError') {
    const details = Object.values(errorObject.errors || {}).map((item) => item.message);
    return new SkillsModuleError('Validation failed', 400, details);
  }

  if (errorObject?.name === 'CastError') {
    return new SkillsModuleError(
      `${errorObject.path || 'value'} has an invalid format`,
      400,
    );
  }

  if (error instanceof Error) {
    return new SkillsModuleError(error.message, 500);
  }

  return new SkillsModuleError('Unexpected error while processing skills module request', 500);
}
