import mongoose from 'mongoose';
import { ROLES } from '../../config/constants.js';

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true, lowercase: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.USER },
    stats: {
      solved: { type: Number, default: 0 },
      attempts: { type: Number, default: 0 },
    },
    solvedProblemIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Problem' }],
      default: [],
      select: false,
    },
  },
  { timestamps: true, strict: 'throw' },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ username: 1 }, { unique: true });

export const User = mongoose.models.User ?? mongoose.model('User', userSchema, 'users');
