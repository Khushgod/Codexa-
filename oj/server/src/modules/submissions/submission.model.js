import mongoose from 'mongoose';

const VERDICTS = ['AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'OLE', 'ERROR'];
const STATUSES = ['QUEUED', 'COMPILING', 'RUNNING', 'DONE', 'ERROR'];

const perTestSchema = new mongoose.Schema(
  {
    testIndex: { type: Number, required: true, min: 0, validate: Number.isInteger },
    verdict: { type: String, enum: VERDICTS, required: true },
    runtimeMs: { type: Number, min: 0 },
    memoryKb: { type: Number, min: 0 },
    category: { type: String, trim: true },
  },
  { _id: false, strict: 'throw' },
);

const submissionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    problemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', required: true },
    language: { type: String, enum: ['cpp', 'python', 'java'], required: true },
    code: { type: String, required: true, maxlength: 64 * 1024 },
    codeHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    mode: { type: String, enum: ['run', 'submit'], default: 'submit', required: true },
    countsForHints: { type: Boolean, default: true },
    status: { type: String, enum: STATUSES, default: 'QUEUED', required: true },
    verdict: { type: String, enum: VERDICTS },
    runtimeMs: { type: Number, min: 0 },
    memoryKb: { type: Number, min: 0 },
    failedTestIndex: { type: Number, min: 0, validate: Number.isInteger },
    failedCategory: { type: String, trim: true },
    compileLog: { type: String, maxlength: 4096 },
    perTest: { type: [perTestSchema], default: [] },
    sampleResults: {
      type: [
        new mongoose.Schema(
          {
            testIndex: { type: Number, required: true, min: 0 },
            output: { type: String, maxlength: 1_000_000 },
            verdict: { type: String, enum: VERDICTS, required: true },
            runtimeMs: { type: Number, min: 0 },
          },
          { _id: false, strict: 'throw' },
        ),
      ],
      default: [],
    },
    judgedAt: { type: Date },
  },
  { timestamps: true, strict: 'throw' },
);

submissionSchema.index({ userId: 1, createdAt: -1 });
submissionSchema.index({ problemId: 1, verdict: 1 });
submissionSchema.index({ userId: 1, problemId: 1, codeHash: 1 });

export const Submission =
  mongoose.models.Submission ?? mongoose.model('Submission', submissionSchema, 'submissions');
