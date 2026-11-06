import { z } from 'zod';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'must be a valid email address' }));

export const signupSchema = z.strictObject({
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{3,30}$/, 'must be 3-30 characters: letters, digits, underscore')
    .transform((value) => value.toLowerCase()),
  email,
  password: z
    .string()
    .min(8, 'must be at least 8 characters')
    .max(128, 'must be at most 128 characters'),
});

export const loginSchema = z.strictObject({
  email,
  password: z.string().min(1, 'is required').max(128),
});

/** refresh/logout take no body fields; the token comes from the httpOnly cookie. */
export const emptyBodySchema = z.strictObject({});
