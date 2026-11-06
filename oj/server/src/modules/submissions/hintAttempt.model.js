import mongoose from 'mongoose';

const hintAttemptSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    problemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', required: true },
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Submission',
      required: true,
      unique: true,
    },
    codeHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' },
);

hintAttemptSchema.index(
  { userId: 1, problemId: 1, codeHash: 1 },
  { unique: true, name: 'unique_hint_attempt_hash' },
);

export const HintAttempt =
  mongoose.models.HintAttempt ?? mongoose.model('HintAttempt', hintAttemptSchema, 'hintAttempts');
