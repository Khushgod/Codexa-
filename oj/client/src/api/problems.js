import { apiRequest } from './client.js';

function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export async function listProblems(params = {}) {
  const response = await apiRequest(`/api/problems${queryString(params)}`);
  return response.data;
}

export async function getProblem(slug) {
  const response = await apiRequest(`/api/problems/${encodeURIComponent(slug)}`);
  return response.data;
}

export async function listAdminProblems(params = {}) {
  const response = await apiRequest(`/api/problems/admin/list${queryString(params)}`);
  return response.data;
}

export async function saveProblem(input, id) {
  const response = await apiRequest(id ? `/api/problems/${id}` : '/api/problems', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(input),
  });
  return response.data.problem;
}

export async function listTestCases(problemId) {
  const response = await apiRequest(`/api/problems/${problemId}/testcases`);
  return response.data.testCases;
}

export async function saveTestCase(problemId, input, testCaseId) {
  const response = await apiRequest(
    testCaseId
      ? `/api/problems/${problemId}/testcases/${testCaseId}`
      : `/api/problems/${problemId}/testcases`,
    {
      method: testCaseId ? 'PUT' : 'POST',
      body: JSON.stringify(input),
    },
  );
  return response.data.testCase;
}

export async function deleteTestCase(problemId, testCaseId) {
  return apiRequest(`/api/problems/${problemId}/testcases/${testCaseId}`, {
    method: 'DELETE',
  });
}

export async function getSubmission(submissionId) {
  const response = await apiRequest(`/api/submissions/${submissionId}`);
  return response.data;
}

export async function createSubmission({ problemId, language, code, mode }) {
  const response = await apiRequest('/api/submissions', {
    method: 'POST',
    body: JSON.stringify({ problemId, language, code, mode }),
  });
  return response.data.submission;
}

export async function listMySubmissions(params = {}) {
  const response = await apiRequest(`/api/submissions/mine${queryString(params)}`);
  return response.data;
}

export async function getMyProfile() {
  const response = await apiRequest('/api/auth/me');
  return response.data.user;
}
