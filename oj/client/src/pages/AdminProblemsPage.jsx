import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  deleteTestCase,
  listAdminProblems,
  listTestCases,
  saveProblem,
  saveTestCase,
} from '../api/problems.js';
import { PlatformLayout } from '../components/PlatformLayout.jsx';

function blankProblem() {
  return {
    slug: '',
    title: '',
    difficulty: 'Easy',
    tags: '',
    statementMd: '',
    inputFormat: '',
    outputFormat: '',
    constraints: '',
    timeLimitMs: '1000',
    memoryLimitMb: '256',
    checkerType: 'exact',
    epsilon: '',
    sourceType: 'original',
    sourceUrl: '',
    isPublished: false,
    edgeCases: '',
    commonMistakes: '',
    directionHint: '',
    keyInsight: '',
    outline: '',
    canaries: '[]',
    reviewed: false,
    lintWarnings: '',
  };
}

function problemToForm(problem) {
  return {
    ...blankProblem(),
    ...problem,
    tags: (problem.tags ?? []).join(', '),
    constraints: (problem.constraints ?? []).join('\n'),
    timeLimitMs: String(problem.timeLimitMs),
    memoryLimitMb: String(problem.memoryLimitMb),
    checkerType: problem.checker?.type ?? 'exact',
    epsilon: problem.checker?.epsilon == null ? '' : String(problem.checker.epsilon),
    sourceType: problem.source?.type ?? 'original',
    sourceUrl: problem.source?.url ?? '',
    edgeCases: (problem.aiContext?.edgeCases ?? []).join('\n'),
    commonMistakes: (problem.aiContext?.commonMistakes ?? []).join('\n'),
    directionHint: problem.aiContext?.directionHint ?? '',
    keyInsight: problem.aiContext?.keyInsight ?? '',
    outline: problem.aiContext?.outline ?? '',
    canaries: JSON.stringify(problem.aiContext?.canaries ?? [], null, 2),
    reviewed: problem.aiContext?.reviewed ?? false,
    lintWarnings: (problem.aiContext?.lintWarnings ?? []).join('\n'),
  };
}

function lines(value) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toProblemInput(form) {
  let canaries;
  try {
    canaries = JSON.parse(form.canaries || '[]');
  } catch {
    throw new Error('Canaries must be valid JSON, such as [].');
  }
  if (!Array.isArray(canaries)) throw new Error('Canaries must be a JSON array.');
  const checker = { type: form.checkerType };
  if (form.epsilon !== '') checker.epsilon = Number(form.epsilon);
  return {
    slug: form.slug,
    title: form.title,
    difficulty: form.difficulty,
    tags: form.tags
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    statementMd: form.statementMd,
    inputFormat: form.inputFormat,
    outputFormat: form.outputFormat,
    constraints: lines(form.constraints),
    timeLimitMs: Number(form.timeLimitMs),
    memoryLimitMb: Number(form.memoryLimitMb),
    checker,
    aiContext: {
      edgeCases: lines(form.edgeCases),
      commonMistakes: lines(form.commonMistakes),
      directionHint: form.directionHint,
      keyInsight: form.keyInsight,
      outline: form.outline,
      canaries,
      reviewed: form.reviewed,
      lintWarnings: lines(form.lintWarnings),
    },
    source: { type: form.sourceType, url: form.sourceUrl },
    isPublished: form.isPublished,
  };
}

function blankTestCase(order = 1) {
  return {
    order: String(order),
    storage: 'inline',
    input: '',
    expectedOutput: '',
    fileRef: '',
    sha256: '',
    isSample: false,
    category: 'small',
    weight: '1',
  };
}

function nextTestCaseOrder(testCases = []) {
  return testCases.reduce((max, testCase) => Math.max(max, testCase.order), 0) + 1;
}

function testCaseToForm(testCase) {
  return {
    ...blankTestCase(testCase.order),
    ...testCase,
    order: String(testCase.order),
    storage: testCase.fileRef ? 'file' : 'inline',
    weight: String(testCase.weight ?? 1),
  };
}

function toTestCaseInput(form) {
  const input = {
    order: Number(form.order),
    isSample: form.isSample,
    category: form.category,
    weight: Number(form.weight),
  };
  if (form.storage === 'file') {
    return {
      ...input,
      fileRef: form.fileRef,
      sha256: form.sha256,
      expectedOutput: form.expectedOutput,
    };
  }
  return { ...input, input: form.input, expectedOutput: form.expectedOutput };
}

function Field({ label, className = '', as, ...props }) {
  const id = `admin-${props.name}`;
  return (
    <label className={`admin-field ${className}`} htmlFor={id}>
      <span>{label}</span>
      {as === 'textarea' ? <textarea id={id} {...props} /> : <input id={id} {...props} />}
    </label>
  );
}

export function AdminProblemsPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [problemForm, setProblemForm] = useState(blankProblem);
  const [editingTestCaseId, setEditingTestCaseId] = useState('');
  const [testCaseForm, setTestCaseForm] = useState(blankTestCase());
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const problemsQuery = useQuery({
    queryKey: ['admin-problems'],
    queryFn: () => listAdminProblems({ page: 1, limit: 100 }),
  });
  const testCasesQuery = useQuery({
    queryKey: ['admin-testcases', selectedId],
    queryFn: () => listTestCases(selectedId),
    enabled: Boolean(selectedId),
  });
  const problemMutation = useMutation({
    mutationFn: ({ input, id }) => saveProblem(input, id),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-problems'] });
      setSelectedId(saved._id);
      setProblemForm(problemToForm(saved));
      setNotice('Problem saved.');
      setFormError('');
    },
    onError: (error) => setFormError(error.message || 'Could not save this problem.'),
  });
  const testCaseMutation = useMutation({
    mutationFn: ({ input, testCaseId }) => saveTestCase(selectedId, input, testCaseId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-testcases', selectedId] });
      setEditingTestCaseId('');
      setTestCaseForm(blankTestCase(nextTestCaseOrder(testCasesQuery.data)));
      setNotice('Test case saved.');
      setFormError('');
    },
    onError: (error) => setFormError(error.message || 'Could not save this test case.'),
  });
  const deleteMutation = useMutation({
    mutationFn: (testCaseId) => deleteTestCase(selectedId, testCaseId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-testcases', selectedId] });
      setNotice('Test case deleted.');
    },
    onError: (error) => setFormError(error.message || 'Could not delete this test case.'),
  });
  const problems = problemsQuery.data?.items ?? [];
  const selectedProblem = problems.find((problem) => problem._id === selectedId);

  useEffect(() => {
    if (selectedProblem) setProblemForm(problemToForm(selectedProblem));
  }, [selectedId, selectedProblem]);

  function updateProblemForm(event) {
    const { name, value, type, checked } = event.target;
    setProblemForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
    setFormError('');
    setNotice('');
  }

  function updateTestCaseForm(event) {
    const { name, value, type, checked } = event.target;
    setTestCaseForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
      ...(name === 'storage' && value === 'file' ? { isSample: false } : {}),
    }));
    setFormError('');
    setNotice('');
  }

  function editProblem(problem) {
    setSelectedId(problem._id);
    setProblemForm(problemToForm(problem));
    setTestCaseForm(blankTestCase());
    setEditingTestCaseId('');
    setNotice('');
    setFormError('');
  }

  function startNewProblem() {
    setSelectedId('');
    setProblemForm(blankProblem());
    setTestCaseForm(blankTestCase());
    setEditingTestCaseId('');
    setNotice('');
    setFormError('');
  }

  function submitProblem(event) {
    event.preventDefault();
    setFormError('');
    try {
      problemMutation.mutate({ input: toProblemInput(problemForm), id: selectedId || undefined });
    } catch (error) {
      setFormError(error.message);
    }
  }

  function submitTestCase(event) {
    event.preventDefault();
    setFormError('');
    testCaseMutation.mutate({
      input: toTestCaseInput(testCaseForm),
      testCaseId: editingTestCaseId || undefined,
    });
  }

  return (
    <PlatformLayout>
      <main className="platform-main admin-main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">ADMINISTRATION</p>
            <h1>Problem editor</h1>
            <p>Create and review problem statements and test cases before publishing.</p>
          </div>
          <button className="button button-outline" type="button" onClick={startNewProblem}>
            New problem
          </button>
        </div>

        {problemsQuery.isError && (
          <p className="route-error" role="alert">
            {problemsQuery.error.message}
          </p>
        )}
        {formError && (
          <p className="form-error admin-message" role="alert">
            {formError}
          </p>
        )}
        {notice && (
          <p className="admin-notice" role="status">
            {notice}
          </p>
        )}

        <div className="admin-layout">
          <aside className="admin-problem-list">
            <h2>Problems</h2>
            {problemsQuery.isPending ? (
              <p className="muted">Loading…</p>
            ) : problems.length ? (
              problems.map((problem) => (
                <button
                  className={`admin-problem-option ${problem._id === selectedId ? 'active' : ''}`}
                  key={problem._id}
                  type="button"
                  onClick={() => editProblem(problem)}
                >
                  <strong>{problem.title}</strong>
                  <span>
                    {problem.slug} · {problem.isPublished ? 'Published' : 'Draft'}
                  </span>
                </button>
              ))
            ) : (
              <p className="muted">No problems yet.</p>
            )}
          </aside>

          <section className="admin-editor">
            <form onSubmit={submitProblem}>
              <div className="section-heading">
                <h2>{selectedId ? 'Edit problem' : 'Create problem'}</h2>
                {selectedId && <code>{selectedId}</code>}
              </div>
              <div className="admin-form-grid">
                <Field
                  label="Title"
                  name="title"
                  value={problemForm.title}
                  onChange={updateProblemForm}
                  required
                />
                <Field
                  label="Slug"
                  name="slug"
                  value={problemForm.slug}
                  onChange={updateProblemForm}
                  required
                />
                <label className="admin-field" htmlFor="admin-difficulty">
                  <span>Difficulty</span>
                  <select
                    id="admin-difficulty"
                    name="difficulty"
                    value={problemForm.difficulty}
                    onChange={updateProblemForm}
                  >
                    {['Easy', 'Medium', 'Hard'].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <Field
                  label="Tags (comma-separated)"
                  name="tags"
                  value={problemForm.tags}
                  onChange={updateProblemForm}
                />
                <Field
                  label="Statement (Markdown)"
                  name="statementMd"
                  as="textarea"
                  rows={7}
                  value={problemForm.statementMd}
                  onChange={updateProblemForm}
                  required
                  className="full-width"
                />
                <Field
                  label="Input format"
                  name="inputFormat"
                  as="textarea"
                  rows={3}
                  value={problemForm.inputFormat}
                  onChange={updateProblemForm}
                  required
                />
                <Field
                  label="Output format"
                  name="outputFormat"
                  as="textarea"
                  rows={3}
                  value={problemForm.outputFormat}
                  onChange={updateProblemForm}
                  required
                />
                <Field
                  label="Constraints (one per line)"
                  name="constraints"
                  as="textarea"
                  rows={4}
                  value={problemForm.constraints}
                  onChange={updateProblemForm}
                  className="full-width"
                />
                <Field
                  label="Time limit (ms)"
                  name="timeLimitMs"
                  type="number"
                  min="1"
                  value={problemForm.timeLimitMs}
                  onChange={updateProblemForm}
                  required
                />
                <Field
                  label="Memory limit (MB)"
                  name="memoryLimitMb"
                  type="number"
                  min="1"
                  value={problemForm.memoryLimitMb}
                  onChange={updateProblemForm}
                  required
                />
                <label className="admin-field" htmlFor="admin-checkerType">
                  <span>Output checker</span>
                  <select
                    id="admin-checkerType"
                    name="checkerType"
                    value={problemForm.checkerType}
                    onChange={updateProblemForm}
                  >
                    {['exact', 'token', 'float', 'custom'].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <Field
                  label="Float epsilon (optional)"
                  name="epsilon"
                  type="number"
                  min="0"
                  step="any"
                  value={problemForm.epsilon}
                  onChange={updateProblemForm}
                />
                <label className="admin-field" htmlFor="admin-sourceType">
                  <span>Source type</span>
                  <select
                    id="admin-sourceType"
                    name="sourceType"
                    value={problemForm.sourceType}
                    onChange={updateProblemForm}
                  >
                    <option value="original">Original</option>
                    <option value="scraped">Scraped</option>
                  </select>
                </label>
                <Field
                  label="Source URL"
                  name="sourceUrl"
                  type="url"
                  value={problemForm.sourceUrl}
                  onChange={updateProblemForm}
                />
                <Field
                  label="AI edge cases (one per line)"
                  name="edgeCases"
                  as="textarea"
                  rows={3}
                  value={problemForm.edgeCases}
                  onChange={updateProblemForm}
                />
                <Field
                  label="Common mistakes (one per line)"
                  name="commonMistakes"
                  as="textarea"
                  rows={3}
                  value={problemForm.commonMistakes}
                  onChange={updateProblemForm}
                />
                <Field
                  label="Direction hint"
                  name="directionHint"
                  as="textarea"
                  rows={3}
                  value={problemForm.directionHint}
                  onChange={updateProblemForm}
                />
                <Field
                  label="Key insight"
                  name="keyInsight"
                  as="textarea"
                  rows={3}
                  value={problemForm.keyInsight}
                  onChange={updateProblemForm}
                />
                <Field
                  label="Outline"
                  name="outline"
                  as="textarea"
                  rows={3}
                  value={problemForm.outline}
                  onChange={updateProblemForm}
                />
                <Field
                  label="Canaries (JSON array)"
                  name="canaries"
                  as="textarea"
                  rows={4}
                  value={problemForm.canaries}
                  onChange={updateProblemForm}
                  className="full-width"
                />
                <Field
                  label="Lint warnings (one per line)"
                  name="lintWarnings"
                  as="textarea"
                  rows={3}
                  value={problemForm.lintWarnings}
                  onChange={updateProblemForm}
                />
                <div className="admin-checks">
                  <label>
                    <input
                      name="reviewed"
                      type="checkbox"
                      checked={problemForm.reviewed}
                      onChange={updateProblemForm}
                    />
                    AI notes reviewed
                  </label>
                  <label>
                    <input
                      name="isPublished"
                      type="checkbox"
                      checked={problemForm.isPublished}
                      onChange={updateProblemForm}
                    />
                    Published publicly
                  </label>
                </div>
              </div>
              <div className="admin-form-actions">
                <button className="button" type="submit" disabled={problemMutation.isPending}>
                  {problemMutation.isPending ? 'Saving…' : 'Save problem'}
                </button>
                {problemMutation.isPending && <span className="muted">Please wait</span>}
              </div>
            </form>

            {selectedId && (
              <section className="testcase-editor">
                <div className="section-heading">
                  <div>
                    <h2>Test cases</h2>
                    <p>Hidden cases are admin-only. Review them before publishing.</p>
                  </div>
                </div>
                {testCasesQuery.isError && (
                  <p className="route-error" role="alert">
                    {testCasesQuery.error.message}
                  </p>
                )}
                {testCasesQuery.data?.map((testCase) => (
                  <div className="testcase-row" key={testCase._id}>
                    <span>
                      #{testCase.order} · {testCase.category} {testCase.isSample && '· sample'}
                    </span>
                    <div>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => {
                          setEditingTestCaseId(testCase._id);
                          setTestCaseForm(testCaseToForm(testCase));
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="text-button danger-text"
                        type="button"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Delete test case #${testCase.order}?`)) {
                            deleteMutation.mutate(testCase._id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                <form className="testcase-form" onSubmit={submitTestCase}>
                  <h3>{editingTestCaseId ? 'Edit test case' : 'Add test case'}</h3>
                  <div className="admin-form-grid">
                    <Field
                      label="Order"
                      name="order"
                      type="number"
                      min="1"
                      value={testCaseForm.order}
                      onChange={updateTestCaseForm}
                      required
                    />
                    <Field
                      label="Category"
                      name="category"
                      value={testCaseForm.category}
                      onChange={updateTestCaseForm}
                      required
                    />
                    <label className="admin-field" htmlFor="admin-storage">
                      <span>Storage</span>
                      <select
                        id="admin-storage"
                        name="storage"
                        value={testCaseForm.storage}
                        onChange={updateTestCaseForm}
                      >
                        <option value="inline">Inline input/output</option>
                        <option value="file">File reference</option>
                      </select>
                    </label>
                    <Field
                      label="Weight"
                      name="weight"
                      type="number"
                      min="0"
                      step="any"
                      value={testCaseForm.weight}
                      onChange={updateTestCaseForm}
                      required
                    />
                    {testCaseForm.storage === 'inline' ? (
                      <>
                        <Field
                          label="Input"
                          name="input"
                          as="textarea"
                          rows={5}
                          value={testCaseForm.input ?? ''}
                          onChange={updateTestCaseForm}
                          required
                          className="full-width"
                        />
                        <Field
                          label="Expected output"
                          name="expectedOutput"
                          as="textarea"
                          rows={4}
                          value={testCaseForm.expectedOutput ?? ''}
                          onChange={updateTestCaseForm}
                          required
                          className="full-width"
                        />
                      </>
                    ) : (
                      <>
                        <Field
                          label="Relative file reference"
                          name="fileRef"
                          value={testCaseForm.fileRef ?? ''}
                          onChange={updateTestCaseForm}
                          required
                        />
                        <Field
                          label="SHA-256"
                          name="sha256"
                          value={testCaseForm.sha256 ?? ''}
                          onChange={updateTestCaseForm}
                          required
                        />
                        <Field
                          label="Expected output"
                          name="expectedOutput"
                          as="textarea"
                          rows={4}
                          value={testCaseForm.expectedOutput ?? ''}
                          onChange={updateTestCaseForm}
                          required
                          className="full-width"
                        />
                      </>
                    )}
                    <label className="admin-checks">
                      <input
                        name="isSample"
                        type="checkbox"
                        checked={testCaseForm.isSample}
                        onChange={updateTestCaseForm}
                        disabled={testCaseForm.storage === 'file'}
                      />
                      Public sample case
                    </label>
                  </div>
                  <div className="admin-form-actions">
                    <button
                      className="button button-small"
                      type="submit"
                      disabled={testCaseMutation.isPending}
                    >
                      {testCaseMutation.isPending
                        ? 'Saving…'
                        : editingTestCaseId
                          ? 'Update test case'
                          : 'Add test case'}
                    </button>
                    {editingTestCaseId && (
                      <button
                        className="button button-quiet"
                        type="button"
                        onClick={() => {
                          setEditingTestCaseId('');
                          setTestCaseForm(blankTestCase(nextTestCaseOrder(testCasesQuery.data)));
                        }}
                      >
                        Cancel edit
                      </button>
                    )}
                  </div>
                </form>
              </section>
            )}
          </section>
        </div>
      </main>
    </PlatformLayout>
  );
}

export { blankProblem, problemToForm, toProblemInput, toTestCaseInput };
