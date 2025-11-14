import { Types } from 'mongoose';

/**
 * Safely converts a Mongoose ObjectId or string to string format
 * @param id - The ID to convert (can be string, ObjectId, or unknown)
 * @returns String representation of the ID
 */
export function toStringId(id: unknown): string {
  if (typeof id === 'string') {
    return id;
  }
  if (id instanceof Types.ObjectId) {
    return id.toString();
  }
  if (id && typeof id === 'object' && 'toString' in id) {
    return String(id);
  }
  throw new Error('Invalid ID type');
}

/**
 * Safely converts a string to Mongoose ObjectId
 * @param id - The string ID to convert
 * @returns Mongoose ObjectId
 */
export function toObjectId(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

/**
 * Type guard to check if value is a valid ObjectId
 */
export function isValidObjectId(id: unknown): id is Types.ObjectId | string {
  if (typeof id === 'string') {
    return Types.ObjectId.isValid(id);
  }
  return id instanceof Types.ObjectId;
}
