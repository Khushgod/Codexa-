import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.jsx';
import { isTerminalSubmission } from '../hooks/useSubmissionStatus.js';
import { draftKey, readDraft, STARTER_CODE } from './WorkspacePage.jsx';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange, language }) => (
    <textarea
      aria-label={`${language} code editor`}
      data-testid="code-editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children, ...props }) => <div {...props}>{children}</div>,
  Panel: ({ children }) => <section>{children}</section>,
  PanelResizeHandle: (props) => <div {...props} />,
}));

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path) => {
      if (path === '/api/auth/refresh') {
        return jsonResponse(
          { ok: false, error: { code: 'INVALID_REFRESH_TOKEN', message: 'Session expired.' } },
          401,
        );
      }
      if (path.startsWith('/api/problems?')) {
        return jsonResponse({
          ok: true,
          data: {
            items: [
              {
                _id: 'p-1',
                slug: 'm5-array-challenge',
                title: 'Array Challenge',
                difficulty: 'Easy',
                tags: ['arrays'],
              },
            ],
            pagination: { page: 1, limit: 20, total: 1, pages: 1 },
          },
        });
      }
      if (path === '/api/problems/m5-workspace-challenge') {
        return jsonResponse({
          ok: true,
          data: {
            _id: 'p-2',
            slug: 'm5-workspace-challenge',
            title: 'Workspace Challenge',
            difficulty: 'Medium',
            tags: ['strings'],
            statementMd: 'Find the **matching** value.',
            inputFormat: 'One line.',
            outputFormat: 'One value.',
            constraints: ['1 <= n <= 10'],
            sampleTestCases: [{ order: 1, input: 'a', expectedOutput: 'a' }],
          },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
});

describe('M5 problem UI', () => {
  it('loads published problems and applies a difficulty filter', async () => {
    renderAt('/problems');

    expect(await screen.findByRole('link', { name: 'Array Challenge' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Easy' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/problems?difficulty=Medium&page=1&limit=20',
        expect.objectContaining({ credentials: 'include' }),
      );
    });
  });

  it('loads statement samples and saves code drafts per language', async () => {
    const slug = 'm5-workspace-challenge';
    const initialDraft = 'print("saved draft")';
    window.localStorage.setItem(draftKey(slug, 'python'), initialDraft);
    renderAt(`/problems/${slug}`);

    expect(await screen.findByRole('heading', { name: 'Workspace Challenge' })).toBeInTheDocument();
    expect(screen.getByText('matching')).toBeInTheDocument();
    expect(screen.getByText('One line.')).toBeInTheDocument();
    expect(screen.getByTestId('code-editor')).toHaveValue(STARTER_CODE.cpp);

    fireEvent.change(screen.getByLabelText('Programming language'), {
      target: { value: 'python' },
    });
    expect(await screen.findByTestId('code-editor')).toHaveValue(initialDraft);
    fireEvent.change(screen.getByTestId('code-editor'), {
      target: { value: 'print("updated")' },
    });
    expect(window.localStorage.getItem(draftKey(slug, 'python'))).toBe('print("updated")');

    fireEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(screen.getByRole('link', { name: 'Sign in to run code' })).toBeInTheDocument();
  });

  it('queues an authenticated sample run and displays the returned output', async () => {
    const user = {
      id: 'user-1',
      username: 'student',
      email: 'student@example.com',
      role: 'user',
      stats: { solved: 0, attempts: 0 },
    };
    const fetchMock = vi.fn(async (path, options = {}) => {
      if (path === '/api/auth/refresh') {
        return jsonResponse({ ok: true, data: { user, accessToken: 'student-access' } });
      }
      if (path === '/api/problems/m5-workspace-challenge') {
        return jsonResponse({
          ok: true,
          data: {
            _id: 'problem-1',
            slug: 'm5-workspace-challenge',
            title: 'Workspace Challenge',
            difficulty: 'Medium',
            tags: ['strings'],
            statementMd: 'Find the matching value.',
            inputFormat: 'One line.',
            outputFormat: 'One value.',
            constraints: [],
            sampleTestCases: [{ order: 1, input: 'a', expectedOutput: 'a' }],
          },
        });
      }
      if (path === '/api/submissions' && options.method === 'POST') {
        return jsonResponse(
          {
            ok: true,
            data: {
              submission: { _id: 'submission-1' },
              statusUrl: '/api/submissions/submission-1',
            },
          },
          202,
        );
      }
      if (path === '/api/submissions/submission-1') {
        return jsonResponse({
          ok: true,
          data: {
            _id: 'submission-1',
            status: 'DONE',
            verdict: 'AC',
            runtimeMs: 3,
            sampleResults: [{ testIndex: 0, verdict: 'AC', output: 'sample output\n' }],
          },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/problems/m5-workspace-challenge');

    fireEvent.click(await screen.findByRole('button', { name: /run/i }));

    expect(await screen.findByText('sample output')).toBeInTheDocument();
    expect(screen.getAllByText('AC').length).toBeGreaterThan(0);
    const post = fetchMock.mock.calls.find(
      ([path, options]) => path === '/api/submissions' && options.method === 'POST',
    );
    expect(JSON.parse(post[1].body)).toMatchObject({
      problemId: 'problem-1',
      language: 'cpp',
      mode: 'run',
    });
  });

  it('uses starter code when no per-problem draft exists', () => {
    expect(readDraft('brand-new', 'java')).toBe(STARTER_CODE.java);
  });

  it('lets an authenticated admin update and publish a draft', async () => {
    const user = {
      id: 'admin-1',
      username: 'admin',
      email: 'admin@example.com',
      role: 'admin',
      stats: { solved: 0, attempts: 0 },
    };
    const draft = {
      _id: 'admin-problem-1',
      slug: 'reviewed-draft',
      title: 'Reviewed Draft',
      difficulty: 'Easy',
      tags: ['arrays'],
      statementMd: 'A draft statement.',
      inputFormat: 'A value.',
      outputFormat: 'A result.',
      constraints: ['1 <= n <= 10'],
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      checker: { type: 'exact' },
      aiContext: {
        edgeCases: [],
        commonMistakes: [],
        directionHint: '',
        keyInsight: '',
        outline: '',
        canaries: [],
        reviewed: false,
        lintWarnings: [],
      },
      source: { type: 'original', url: '' },
      isPublished: false,
    };
    let savedProblem = draft;
    const fetchMock = vi.fn(async (path, options = {}) => {
      if (path === '/api/auth/refresh') {
        return jsonResponse({ ok: true, data: { user, accessToken: 'admin-access' } });
      }
      if (path === '/api/problems/admin/list?page=1&limit=100') {
        return jsonResponse({
          ok: true,
          data: { items: [savedProblem], pagination: { page: 1, limit: 100, total: 1, pages: 1 } },
        });
      }
      if (path === `/api/problems/${draft._id}/testcases` && options.method === 'POST') {
        return jsonResponse(
          {
            ok: true,
            data: {
              testCase: {
                _id: 'file-case-1',
                order: 1,
                fileRef: 'cases/input.txt',
                sha256: 'a'.repeat(64),
                expectedOutput: 'expected output',
                isSample: false,
                category: 'large-case',
              },
            },
          },
          201,
        );
      }
      if (path === `/api/problems/${draft._id}/testcases`) {
        return jsonResponse({ ok: true, data: { testCases: [] } });
      }
      if (path === `/api/problems/${draft._id}` && options.method === 'PUT') {
        savedProblem = { ...draft, ...JSON.parse(options.body) };
        return jsonResponse({ ok: true, data: { problem: savedProblem } });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/admin');

    fireEvent.click(await screen.findByRole('button', { name: /Reviewed Draft/ }));
    fireEvent.change(await screen.findByLabelText('Title'), {
      target: { value: 'Reviewed and published' },
    });
    fireEvent.click(screen.getByLabelText('Published publicly'));
    fireEvent.click(screen.getByRole('button', { name: 'Save problem' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Problem saved.');
    await waitFor(() => {
      const update = fetchMock.mock.calls.find(
        ([path, options]) => path === `/api/problems/${draft._id}` && options.method === 'PUT',
      );
      expect(JSON.parse(update[1].body)).toMatchObject({
        title: 'Reviewed and published',
        isPublished: true,
      });
    });

    fireEvent.change(await screen.findByLabelText('Storage'), {
      target: { value: 'file' },
    });
    fireEvent.change(screen.getByLabelText('Relative file reference'), {
      target: { value: 'cases/input.txt' },
    });
    fireEvent.change(screen.getByLabelText('SHA-256'), {
      target: { value: 'a'.repeat(64) },
    });
    fireEvent.change(screen.getByLabelText('Expected output'), {
      target: { value: 'expected output' },
    });
    expect(screen.getByLabelText('Public sample case')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add test case' }));

    await waitFor(() => {
      const createTestCase = fetchMock.mock.calls.find(
        ([path, options]) =>
          path === `/api/problems/${draft._id}/testcases` && options.method === 'POST',
      );
      expect(JSON.parse(createTestCase[1].body)).toMatchObject({
        fileRef: 'cases/input.txt',
        sha256: 'a'.repeat(64),
        expectedOutput: 'expected output',
        isSample: false,
      });
    });
  });

  it('stops polling when a submission reaches a terminal state', () => {
    expect(isTerminalSubmission({ status: 'QUEUED' })).toBe(false);
    expect(isTerminalSubmission({ status: 'RUNNING' })).toBe(false);
    expect(isTerminalSubmission({ status: 'DONE', verdict: 'AC' })).toBe(true);
    expect(isTerminalSubmission({ status: 'ERROR' })).toBe(true);
  });
});
