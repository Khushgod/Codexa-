import { useQuery } from '@tanstack/react-query';
import { getSubmission } from '../api/problems.js';

const TERMINAL_STATUSES = new Set(['DONE', 'ERROR', 'FAILED', 'COMPLETED']);

export function isTerminalSubmission(submission) {
  return Boolean(
    TERMINAL_STATUSES.has(submission?.status) ||
    (submission?.verdict && submission.verdict !== 'QUEUED' && submission.verdict !== 'RUNNING'),
  );
}

export function useSubmissionStatus(submissionId) {
  return useQuery({
    queryKey: ['submission', submissionId],
    queryFn: () => getSubmission(submissionId),
    enabled: Boolean(submissionId),
    refetchInterval: (query) => (isTerminalSubmission(query.state.data) ? false : 1000),
    refetchIntervalInBackground: true,
  });
}
