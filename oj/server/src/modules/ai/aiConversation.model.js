import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true, maxlength: 20_000 },
    level: { type: Number, required: true, min: 0, max: 4, validate: Number.isInteger },
    feedback: { type: String, enum: ['up', 'down'] },
    createdAt: { type: Date, default: Date.now, required: true },
  },
  { _id: false, strict: 'throw' },
);

const aiConversationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    problemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', required: true },
    messages: { type: [messageSchema], default: [] },
    summary: {
      text: { type: String, default: '' },
      level: { type: Number, default: 0, min: 0, max: 4, validate: Number.isInteger },
    },
    hintLevelUnlocked: { type: Number, default: 1, min: 0, max: 4, validate: Number.isInteger },
    lastUnlockAt: { type: Date, default: null },
    tokenUsage: {
      prompt: { type: Number, default: 0, min: 0 },
      completion: { type: Number, default: 0, min: 0 },
      total: { type: Number, default: 0, min: 0 },
    },
  },
  { timestamps: true, strict: 'throw' },
);

aiConversationSchema.index({ userId: 1, problemId: 1, updatedAt: -1 });
aiConversationSchema.index(
  { userId: 1, problemId: 1 },
  { unique: true, name: 'unique_user_problem_conversation' },
);

export const AiConversation =
  mongoose.models.AiConversation ??
  mongoose.model('AiConversation', aiConversationSchema, 'aiConversations');
