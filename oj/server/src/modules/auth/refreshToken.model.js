import mongoose from 'mongoose';

/**
 * Only a SHA-256 hash of each refresh token is stored. Tokens issued from the
 * same login share a familyId; presenting an already-rotated token revokes
 * the whole family (stolen-token detection).
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    familyId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByHash: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' },
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ familyId: 1 });
refreshTokenSchema.index({ userId: 1 });
// MongoDB removes expired tokens automatically.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken =
  mongoose.models.RefreshToken ??
  mongoose.model('RefreshToken', refreshTokenSchema, 'refreshTokens');
