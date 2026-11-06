import mongoose from 'mongoose';

const canarySchema = new mongoose.Schema(
  {
    phrase: { type: String, required: true, trim: true },
    level: { type: Number, required: true, min: 3, max: 4 },
  },
  { _id: false, strict: 'throw' },
);

const aiContextSchema = new mongoose.Schema(
  {
    edgeCases: { type: [String], default: [] },
    commonMistakes: { type: [String], default: [] },
    directionHint: { type: String, default: '' },
    keyInsight: { type: String, default: '' },
    outline: { type: String, default: '' },
    canaries: { type: [canarySchema], default: [] },
    reviewed: { type: Boolean, default: false },
    lintWarnings: { type: [String], default: [] },
  },
  { _id: false, strict: 'throw' },
);

const checkerSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['exact', 'token', 'float', 'custom'],
      default: 'exact',
      required: true,
    },
    epsilon: { type: Number, min: 0 },
  },
  { _id: false, strict: 'throw' },
);

const sourceSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['original', 'scraped'], default: 'original', required: true },
    url: { type: String, default: '' },
  },
  { _id: false, strict: 'throw' },
);

const problemSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    title: { type: String, required: true, trim: true },
    difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], required: true },
    tags: { type: [String], default: [] },
    statementMd: { type: String, required: true },
    inputFormat: { type: String, required: true },
    outputFormat: { type: String, required: true },
    constraints: { type: [String], default: [] },
    timeLimitMs: { type: Number, required: true, min: 1 },
    memoryLimitMb: { type: Number, required: true, min: 1 },
    checker: { type: checkerSchema, default: () => ({}) },
    aiContext: { type: aiContextSchema, default: () => ({}) },
    source: { type: sourceSchema, default: () => ({}) },
    isPublished: { type: Boolean, default: false },
  },
  { timestamps: true, strict: 'throw' },
);

problemSchema.index({ slug: 1 }, { unique: true });

export const Problem =
  mongoose.models.Problem ?? mongoose.model('Problem', problemSchema, 'problems');
