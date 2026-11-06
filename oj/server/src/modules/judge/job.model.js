import mongoose from 'mongoose';
import { env } from '../../config/env.js';

const jobSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['judge'], default: 'judge', required: true },
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Submission',
      required: true,
      unique: true,
    },
    state: {
      type: String,
      enum: ['QUEUED', 'COMPILING', 'RUNNING', 'DONE', 'ERROR'],
      default: 'QUEUED',
      required: true,
    },
    attempts: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    leaseExpiresAt: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true }, strict: 'throw' },
);

jobSchema.index({ state: 1, leaseExpiresAt: 1 });
jobSchema.index(
  { finishedAt: 1 },
  { expireAfterSeconds: env.JUDGE_JOB_RETENTION_DAYS * 24 * 60 * 60 },
);

export const Job = mongoose.models.Job ?? mongoose.model('Job', jobSchema, 'jobs');
