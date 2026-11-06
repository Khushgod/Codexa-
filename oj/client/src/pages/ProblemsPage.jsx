import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listProblems } from '../api/problems.js';
import { PlatformLayout } from '../components/PlatformLayout.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

function ProblemRows({ problems, signedIn }) {
  if (!problems.length) {
    return (
      <div className="empty-state">
        <h2>No published problems match these filters</h2>
        <p>Try a different difficulty or tag, or check back after an admin publishes problems.</p>
      </div>
    );
  }

  return (
    <div className="problem-table-wrap">
      <table className="problem-table">
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Problem</th>
            <th scope="col">Difficulty</th>
            <th scope="col">Topics</th>
          </tr>
        </thead>
        <tbody>
          {problems.map((problem) => (
            <tr key={problem._id}>
              <td>
                <span className="status-unknown" title="Solved status is available with judging">
                  {signedIn ? '—' : '·'}
                </span>
              </td>
              <td>
                <Link className="problem-title-link" to={`/problems/${problem.slug}`}>
                  {problem.title}
                </Link>
              </td>
              <td>
                <span className={`difficulty difficulty-${problem.difficulty.toLowerCase()}`}>
                  {problem.difficulty}
                </span>
              </td>
              <td className="tag-cell">
                {problem.tags?.map((tag) => (
                  <span className="tag-chip" key={tag}>
                    {tag}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {signedIn && (
        <p className="inline-note">
          Solved-status tracking will be available when submissions arrive.
        </p>
      )}
    </div>
  );
}

export function ProblemsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tagInput, setTagInput] = useState(searchParams.get('tag') ?? '');
  const difficulty = searchParams.get('difficulty') ?? '';
  const page = Number(searchParams.get('page') ?? 1);
  const query = useQuery({
    queryKey: ['problems', { tag: searchParams.get('tag'), difficulty, page }],
    queryFn: () =>
      listProblems({
        tag: searchParams.get('tag') ?? '',
        difficulty,
        page,
        limit: 20,
      }),
  });

  function applyFilters(event) {
    event.preventDefault();
    const next = new URLSearchParams();
    const tag = tagInput.trim();
    if (tag) next.set('tag', tag);
    if (difficulty) next.set('difficulty', difficulty);
    setSearchParams(next);
  }

  function setDifficulty(value) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('difficulty', value);
    else next.delete('difficulty');
    next.delete('page');
    setSearchParams(next);
  }

  return (
    <PlatformLayout>
      <main className="platform-main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">PRACTICE LIBRARY</p>
            <h1>Problems</h1>
            <p>Pick a challenge, explore the examples, and work through it at your own pace.</p>
          </div>
          <span className="count-pill">{query.data?.pagination?.total ?? '—'} problems</span>
        </div>

        <form className="filter-bar" onSubmit={applyFilters}>
          <label className="filter-field">
            <span>Topic</span>
            <input
              aria-label="Filter by topic"
              placeholder="e.g. arrays"
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
            />
          </label>
          <div className="difficulty-filter" aria-label="Filter by difficulty">
            {['', 'Easy', 'Medium', 'Hard'].map((value) => (
              <button
                className={`filter-chip ${difficulty === value ? 'active' : ''}`}
                key={value || 'all'}
                type="button"
                aria-pressed={difficulty === value}
                onClick={() => setDifficulty(value)}
              >
                {value || 'All'}
              </button>
            ))}
          </div>
          <button className="button button-small" type="submit">
            Apply filters
          </button>
        </form>

        {query.isPending ? (
          <p className="route-status">Loading problems…</p>
        ) : query.isError ? (
          <p className="route-error" role="alert">
            {query.error.message || 'Could not load problems. Check the API connection.'}
          </p>
        ) : (
          <>
            <ProblemRows problems={query.data.items} signedIn={Boolean(user)} />
            {query.data.pagination.pages > 1 && (
              <div className="pagination-row">
                <button
                  className="button button-quiet"
                  type="button"
                  disabled={page <= 1}
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.set('page', String(page - 1));
                    setSearchParams(next);
                  }}
                >
                  Previous
                </button>
                <span>
                  Page {page} of {query.data.pagination.pages}
                </span>
                <button
                  className="button button-quiet"
                  type="button"
                  disabled={page >= query.data.pagination.pages}
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.set('page', String(page + 1));
                    setSearchParams(next);
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </PlatformLayout>
  );
}
