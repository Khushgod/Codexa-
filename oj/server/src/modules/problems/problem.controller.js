import * as problemService from './problem.service.js';

const response = (res, data, status = 200) => res.status(status).json({ ok: true, data });

export async function listPublic(req, res) {
  return response(res, await problemService.listPublishedProblems(req.validated.query));
}

export async function getPublic(req, res) {
  return response(res, await problemService.getPublishedProblem(req.validated.params.slug));
}

export async function listAdmin(req, res) {
  return response(res, await problemService.listProblemsForAdmin(req.validated.query));
}

export async function create(req, res) {
  return response(res, { problem: await problemService.createProblem(req.validated.body) }, 201);
}

export async function update(req, res) {
  return response(res, {
    problem: await problemService.updateProblem(req.validated.params.id, req.validated.body),
  });
}

export async function reviewAiNotes(req, res) {
  return response(res, {
    problem: await problemService.reviewAiNotes(req.validated.params.id, req.validated.body),
  });
}

export async function remove(req, res) {
  return response(res, { problem: await problemService.unpublishProblem(req.validated.params.id) });
}

export async function listTestCases(req, res) {
  return response(res, {
    testCases: await problemService.listTestCasesForAdmin(req.validated.params.id),
  });
}

export async function createTestCase(req, res) {
  return response(
    res,
    {
      testCase: await problemService.createTestCase(req.validated.params.id, req.validated.body),
    },
    201,
  );
}

export async function updateTestCase(req, res) {
  return response(res, {
    testCase: await problemService.updateTestCase(
      req.validated.params.id,
      req.validated.params.testCaseId,
      req.validated.body,
    ),
  });
}

export async function deleteTestCase(req, res) {
  return response(
    res,
    await problemService.deleteTestCase(req.validated.params.id, req.validated.params.testCaseId),
  );
}
