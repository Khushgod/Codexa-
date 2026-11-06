import mongoose from 'mongoose';

const testCaseSchema = new mongoose.Schema(
  {
    problemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', required: true },
    order: { type: Number, required: true, min: 1, validate: Number.isInteger },
    input: { type: String },
    expectedOutput: { type: String },
    fileRef: {
      type: String,
      trim: true,
      match: /^(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[A-Za-z0-9][A-Za-z0-9._/-]*$/,
    },
    sha256: {
      type: String,
      lowercase: true,
      match: /^[a-f0-9]{64}$/,
      required() {
        return Boolean(this.fileRef);
      },
    },
    isSample: { type: Boolean, default: false },
    category: { type: String, required: true, trim: true, maxlength: 64 },
    weight: { type: Number, default: 1, min: 0 },
  },
  { timestamps: true, strict: 'throw' },
);

testCaseSchema.pre('validate', function validateInputStorage() {
  const fileBacked = typeof this.fileRef === 'string' && this.fileRef.length > 0;
  if (fileBacked) {
    if (typeof this.input === 'string') {
      this.invalidate('input', 'File-backed test cases cannot also contain inline input.');
    }
    if (typeof this.expectedOutput !== 'string') {
      this.invalidate('expectedOutput', 'Test cases require an expected output for comparison.');
    }
    if (this.isSample) {
      this.invalidate('isSample', 'File-backed test cases cannot be public samples.');
    }
  } else {
    if (typeof this.input !== 'string') {
      this.invalidate('input', 'Inline test cases require an input string.');
    }
    if (typeof this.expectedOutput !== 'string') {
      this.invalidate('expectedOutput', 'Inline test cases require an expected output string.');
    }
  }
});

testCaseSchema.index({ problemId: 1, order: 1 }, { unique: true });

export const TestCase =
  mongoose.models.TestCase ?? mongoose.model('TestCase', testCaseSchema, 'testcases');
