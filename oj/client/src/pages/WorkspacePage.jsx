import Editor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { createSubmission, getProblem, listMySubmissions } from '../api/problems.js';
import { PlatformLayout } from '../components/PlatformLayout.jsx';
import { AITutorPanel } from '../components/AITutorPanel.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { useSubmissionStatus } from '../hooks/useSubmissionStatus.js';

const LANGUAGES = [
  { id: 'cpp', label: 'C++17', editor: 'cpp', extension: 'cpp' },
  { id: 'python', label: 'Python 3', editor: 'python', extension: 'py' },
  { id: 'java', label: 'Java', editor: 'java', extension: 'java' },
];

const STARTER_CODE = {
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // Write your solution here\n    return 0;\n}\n',
  python:
    'import sys\n\ndef solve():\n    data = sys.stdin.read().strip().split()\n    # Write your solution here\n\nif __name__ == "__main__":\n    solve()\n',
  java: 'import java.io.*;\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) throws Exception {\n        // Write your solution here\n    }\n}\n',
};

function draftKey(slug, language) {
  return `oj:draft:${slug}:${language}`;
}

function readDraft(slug, language) {
  return window.localStorage.getItem(draftKey(slug, language)) ?? STARTER_CODE[language];
}

function DescriptionContent({ problem }) {
  return (
    <div className="description-scroll">
      <div className="workspace-title">
        <span className={`difficulty difficulty-${problem.difficulty.toLowerCase()}`}>
          {problem.difficulty}
        </span>
        <span className="tag-row">
          {problem.tags?.map((tag) => (
            <span className="tag-chip" key={tag}>
              {tag}
            </span>
          ))}
        </span>
      </div>
      <h1>{problem.title}</h1>
      <section className="problem-section">
        <h2>Description</h2>
        <div className="statement-copy markdown-copy">
          <ReactMarkdown>{problem.statementMd}</ReactMarkdown>
        </div>
      </section>
      <section className="problem-section">
        <h2>Input format</h2>
        <pre className="statement-copy">{problem.inputFormat}</pre>
      </section>
      <section className="problem-section">
        <h2>Output format</h2>
        <pre className="statement-copy">{problem.outputFormat}</pre>
      </section>
      {problem.constraints?.length > 0 && (
        <section className="problem-section">
          <h2>Constraints</h2>
          <ul className="constraint-list">
            {problem.constraints.map((constraint) => (
              <li key={constraint}>{constraint}</li>
            ))}
          </ul>
        </section>
      )}
      {problem.sampleTestCases?.length > 0 && (
        <section className="problem-section">
          <h2>Examples</h2>
          {problem.sampleTestCases.map((testCase, index) => (
            <article className="sample-case" key={testCase._id ?? testCase.order}>
              <h3>Example {index + 1}</h3>
              <div>
                <strong>Input</strong>
                <pre>{testCase.input}</pre>
              </div>
              <div>
                <strong>Output</strong>
                <pre>{testCase.expectedOutput}</pre>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function SubmissionsContent({ problemId, user }) {
  const { isLoading: authLoading } = useAuth();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['my-submissions', problemId],
    queryFn: () => listMySubmissions({ problemId, limit: 30 }),
    enabled: !authLoading && Boolean(user && problemId),
  });

  if (!user) {
    return (
      <div className="reserved-panel">
        <h2>Submissions</h2>
        <p>Sign in to view your submission history for this problem.</p>
        <Link to="/login" className="button button-quiet">Sign in</Link>
      </div>
    );
  }

  if (isPending) {
    return <p className="route-status">Loading submissions…</p>;
  }

  if (isError) {
    return <p className="route-error">{error.message || 'Could not load submissions.'}</p>;
  }

  const submissions = data?.items ?? [];

  if (submissions.length === 0) {
    return (
      <div className="reserved-panel">
        <h2>No submissions yet</h2>
        <p>Run or submit your solution to see your attempts and verdicts here.</p>
      </div>
    );
  }

  return (
    <div className="workspace-submissions-list">
      <div className="submissions-header-row">
        <h3>Past Attempts ({submissions.length})</h3>
        <Link to="/submissions" className="text-link">All problems</Link>
      </div>
      <div className="submissions-cards">
        {submissions.map((sub) => (
          <div className="submission-history-card" key={sub._id}>
            <div className="submission-card-top">
              <span className={`verdict-badge verdict-${(sub.verdict || sub.status || 'unknown').toLowerCase()}`}>
                {sub.verdict || sub.status}
              </span>
              <span className="submission-card-date">
                {sub.createdAt ? new Date(sub.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
              </span>
            </div>
            <div className="submission-card-details">
              <span className="tag-chip">{sub.language}</span>
              <span className="tag-chip">{sub.mode}</span>
              {sub.runtimeMs !== undefined && <span>{sub.runtimeMs} ms</span>}
              {sub.memoryKb !== undefined && <span>{Math.round(sub.memoryKb / 1024)} MB</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorkspacePage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const problemQuery = useQuery({
    queryKey: ['problem', slug],
    queryFn: () => getProblem(slug),
  });
  const [language, setLanguage] = useState('cpp');
  const [code, setCode] = useState(() => readDraft(slug, 'cpp'));
  const [activeTab, setActiveTab] = useState('description');
  const [consoleMessage, setConsoleMessage] = useState(
    'Run sample tests or submit your solution to the judge.',
  );
  const [submissionId, setSubmissionId] = useState('');
  const [consoleTab, setConsoleTab] = useState('testcase');
  const [selectedCaseIndex, setSelectedCaseIndex] = useState(0);
  const submissionQuery = useSubmissionStatus(submissionId);
  const createMutation = useMutation({
    mutationFn: createSubmission,
    onSuccess: (submission) => {
      setSubmissionId(submission._id);
      setConsoleMessage('Queued. Waiting for the judge worker…');
      queryClient.invalidateQueries({ queryKey: ['my-submissions'] });
    },
    onError: (error) => setConsoleMessage(error.message || 'Could not queue this submission.'),
  });
  const languageConfig = useMemo(() => LANGUAGES.find((item) => item.id === language), [language]);

  useEffect(() => {
    setCode(readDraft(slug, language));
    setSubmissionId('');
  }, [slug, language]);

  useEffect(() => {
    const submission = submissionQuery.data;
    if (!submission) return;
    setConsoleTab('result');
    if (submission.status === 'QUEUED') setConsoleMessage('Queued. Waiting for the judge worker…');
    else if (submission.status === 'COMPILING') setConsoleMessage('Compiling your solution…');
    else if (submission.status === 'RUNNING') setConsoleMessage('Running test cases…');
    else if (submission.status === 'ERROR') {
      setConsoleMessage('The judge encountered an internal error. Your code was not blamed.');
    } else if (submission.status === 'DONE') {
      setConsoleMessage(`${submission.verdict ?? 'Finished'} · ${submission.runtimeMs ?? 0} ms`);
    }
  }, [submissionQuery.data]);

  useEffect(() => {
    function onKeyDown(event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        onRun('run');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function updateCode(value) {
    const next = value ?? '';
    setCode(next);
    window.localStorage.setItem(draftKey(slug, language), next);
  }

  function onRun(mode) {
    setConsoleTab('result');
    if (!user) {
      setConsoleMessage('Sign in before running or submitting code.');
      return;
    }
    if (!problemQuery.data?._id) return;
    setConsoleMessage(mode === 'run' ? 'Queueing sample run…' : 'Queueing submission…');
    createMutation.mutate({
      problemId: problemQuery.data._id,
      language,
      code,
      mode,
    });
  }

  if (problemQuery.isPending) {
    return (
      <PlatformLayout className="workspace-platform">
        <p className="route-status">Loading problem…</p>
      </PlatformLayout>
    );
  }
  if (problemQuery.isError) {
    return (
      <PlatformLayout className="workspace-platform">
        <main className="platform-main">
          <p className="route-error" role="alert">
            {problemQuery.error.message || 'Could not load this problem.'}
          </p>
          <Link className="button button-outline" to="/problems">
            Back to problems
          </Link>
        </main>
      </PlatformLayout>
    );
  }

  const problem = problemQuery.data;
  return (
    <PlatformLayout className="workspace-platform">
      <main className="workspace-main">
        <div className="workspace-crumb">
          <Link to="/problems">Problems</Link>
          <span aria-hidden="true">/</span>
          <span>{problem.title}</span>
        </div>
        <PanelGroup className="workspace-panels" direction="horizontal" autoSaveId="oj-workspace">
          <Panel className="workspace-pane" defaultSize={42} minSize={28}>
            <div className="left-workspace">
              <div className="workspace-tabs" role="tablist" aria-label="Problem panels">
                {[
                  ['description', 'Description'],
                  ['submissions', 'Submissions'],
                  ['tutor', 'AI Tutor'],
                ].map(([tab, label]) => (
                  <button
                    className={activeTab === tab ? 'active' : ''}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {activeTab === 'description' ? (
                <DescriptionContent problem={problem} />
              ) : activeTab === 'submissions' ? (
                <SubmissionsContent problemId={problem._id} user={user} />
              ) : null}
              <AITutorPanel
                problemId={problem._id}
                editorCode={code}
                hidden={activeTab !== 'tutor'}
              />
            </div>
          </Panel>
          <PanelResizeHandle
            className="panel-resize-handle"
            aria-label="Resize problem and editor panes"
          />
          <Panel className="workspace-pane" defaultSize={58} minSize={35}>
            <section className="editor-column" aria-label="Code workspace">
              <div className="editor-toolbar">
                <label htmlFor="language-select" className="visually-hidden">
                  Programming language
                </label>
                <select
                  id="language-select"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                >
                  {LANGUAGES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <span className="draft-indicator">Saved in this browser</span>
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={() => onRun('run')}
                  disabled={!user || createMutation.isPending}
                  title={!user ? 'Sign in to run code' : undefined}
                >
                  Run <kbd>Ctrl ↵</kbd>
                </button>
                <button
                  className="button button-small"
                  type="button"
                  onClick={() => onRun('submit')}
                  disabled={!user || createMutation.isPending}
                  title={!user ? 'Sign in to submit code' : undefined}
                >
                  Submit
                </button>
              </div>
              <PanelGroup direction="vertical" className="editor-vertical-group" autoSaveId="oj-editor-console">
                <Panel defaultSize={65} minSize={25} className="editor-panel">
                  <div className="monaco-wrap">
                    <Editor
                      height="100%"
                      language={languageConfig.editor}
                      path={`${problem.slug}.${languageConfig.extension}`}
                      value={code}
                      onChange={updateCode}
                      theme="vs-dark"
                      options={{
                        automaticLayout: true,
                        minimap: { enabled: false },
                        fontSize: 13,
                        tabSize: 4,
                        scrollBeyondLastLine: false,
                        wordWrap: 'on',
                      }}
                    />
                  </div>
                </Panel>
                <PanelResizeHandle className="panel-resize-handle horizontal-handle" aria-label="Resize editor and console" />
                <Panel defaultSize={35} minSize={15} className="console-panel">
                  <section className="result-console" aria-live="polite">
                    <div className="console-heading">
                      <div className="console-tabs" role="tablist" aria-label="Console panels">
                        <button
                          className={`console-tab-btn ${consoleTab === 'testcase' ? 'active' : ''}`}
                          type="button"
                          role="tab"
                          aria-selected={consoleTab === 'testcase'}
                          onClick={() => setConsoleTab('testcase')}
                        >
                          Testcase
                        </button>
                        <button
                          className={`console-tab-btn ${consoleTab === 'result' ? 'active' : ''}`}
                          type="button"
                          role="tab"
                          aria-selected={consoleTab === 'result'}
                          onClick={() => setConsoleTab('result')}
                        >
                          Test Result
                        </button>
                      </div>
                      {submissionQuery.data?.verdict && (
                        <span
                          className={`verdict-badge verdict-${submissionQuery.data.verdict.toLowerCase()}`}
                        >
                          {submissionQuery.data.verdict}
                        </span>
                      )}
                    </div>

                    {consoleTab === 'testcase' ? (
                      <div className="console-testcases-view">
                        {problem.sampleTestCases?.length > 0 ? (
                          <>
                            <div className="console-case-pills">
                              {problem.sampleTestCases.map((testCase, idx) => (
                                <button
                                  key={testCase._id ?? testCase.order ?? idx}
                                  type="button"
                                  className={`console-case-pill ${selectedCaseIndex === idx ? 'active' : ''}`}
                                  onClick={() => setSelectedCaseIndex(idx)}
                                >
                                  Case {idx + 1}
                                </button>
                              ))}
                            </div>
                            {problem.sampleTestCases[selectedCaseIndex] && (
                              <div className="console-case-detail">
                                <div className="console-case-field">
                                  <span className="console-field-label">Input</span>
                                  <pre className="console-output">
                                    {problem.sampleTestCases[selectedCaseIndex].input}
                                  </pre>
                                </div>
                                <div className="console-case-field">
                                  <span className="console-field-label">Expected Output</span>
                                  <pre className="console-output">
                                    {problem.sampleTestCases[selectedCaseIndex].expectedOutput}
                                  </pre>
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="console-empty-notice">No sample test cases configured for this problem.</p>
                        )}
                      </div>
                    ) : (
                      <div className="console-result-view">
                        {/* ── Status banner ── */}
                        {(() => {
                          const sub = submissionQuery.data;
                          if (submissionQuery.isError) {
                            return <div className="console-status-banner banner-error">{submissionQuery.error.message}</div>;
                          }
                          if (!sub) {
                            return <p className="console-empty-notice">{consoleMessage}</p>;
                          }
                          if (['QUEUED', 'COMPILING', 'RUNNING'].includes(sub.status)) {
                            return (
                              <div className="console-status-banner banner-pending">
                                <span className="spinner" /> {consoleMessage}
                              </div>
                            );
                          }
                          if (sub.status === 'ERROR') {
                            return <div className="console-status-banner banner-error">Judge internal error — your code is not blamed.</div>;
                          }
                          if (sub.status === 'DONE') {
                            const isAC = sub.verdict === 'AC';
                            return (
                              <div className={`console-verdict-header ${isAC ? 'verdict-header-ac' : 'verdict-header-fail'}`}>
                                <span className="verdict-header-icon">{isAC ? '✓' : '✗'}</span>
                                <span className="verdict-header-text">
                                  {isAC ? 'Accepted' : sub.verdict}
                                </span>
                                {sub.runtimeMs !== undefined && (
                                  <span className="verdict-header-meta">{sub.runtimeMs} ms</span>
                                )}
                                {sub.memoryKb !== undefined && (
                                  <span className="verdict-header-meta">{Math.round(sub.memoryKb / 1024)} MB</span>
                                )}
                              </div>
                            );
                          }
                          return null;
                        })()}

                        {/* ── Compile log ── */}
                        {submissionQuery.data?.compileLog && (
                          <div className="console-case-field" style={{ marginTop: '8px' }}>
                            <span className="console-field-label">Compile Output</span>
                            <pre className="console-output console-output-error">{submissionQuery.data.compileLog}</pre>
                          </div>
                        )}

                        {/* ── Per-sample results ── */}
                        {submissionQuery.data?.sampleResults && submissionQuery.data.sampleResults.length > 0 ? (
                          <div className="console-sample-results-wrap">
                            <div className="console-case-pills">
                              {submissionQuery.data.sampleResults.map((result, idx) => {
                                const isPass = result.verdict === 'AC';
                                return (
                                  <button
                                    key={result.testIndex ?? idx}
                                    type="button"
                                    className={`console-case-pill ${selectedCaseIndex === idx ? 'active' : ''} ${isPass ? 'case-pass' : 'case-fail'}`}
                                    onClick={() => setSelectedCaseIndex(idx)}
                                  >
                                    <span className={`case-status-dot ${isPass ? 'dot-pass' : 'dot-fail'}`} />
                                    Case {idx + 1}
                                  </button>
                                );
                              })}
                            </div>
                            {submissionQuery.data.sampleResults[selectedCaseIndex] && (
                              <div className="console-case-detail">
                                {problem.sampleTestCases?.[selectedCaseIndex] && (
                                  <>
                                    <div className="console-case-field">
                                      <span className="console-field-label">Input</span>
                                      <pre className="console-output">
                                        {problem.sampleTestCases[selectedCaseIndex].input}
                                      </pre>
                                    </div>
                                    <div className="console-case-field">
                                      <span className="console-field-label">Expected Output</span>
                                      <pre className="console-output">
                                        {problem.sampleTestCases[selectedCaseIndex].expectedOutput}
                                      </pre>
                                    </div>
                                  </>
                                )}
                                <div className="console-case-field">
                                  <span className="console-field-label">Your Output</span>
                                  <pre className={`console-output ${submissionQuery.data.sampleResults[selectedCaseIndex].verdict !== 'AC' ? 'console-output-error' : 'console-output-pass'}`}>
                                    {submissionQuery.data.sampleResults[selectedCaseIndex].output || '(empty)'}
                                  </pre>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : null}

                        {/* ── Hidden test fail notice (submit mode) ── */}
                        {submissionQuery.data?.failedTestIndex !== undefined && (
                          <p className="console-failed-notice">
                            Failed on hidden test #{submissionQuery.data.failedTestIndex + 1}
                            {submissionQuery.data.failedCategory ? ` · ${submissionQuery.data.failedCategory}` : ''}
                          </p>
                        )}
                        {!user && (
                          <Link to="/login" className="button button-quiet" style={{ marginTop: '8px', display: 'inline-block' }}>
                            Sign in to run code
                          </Link>
                        )}
                      </div>
                    )}
                  </section>
                </Panel>
              </PanelGroup>
            </section>
          </Panel>
        </PanelGroup>
      </main>
    </PlatformLayout>
  );
}

export { draftKey, readDraft, STARTER_CODE };
