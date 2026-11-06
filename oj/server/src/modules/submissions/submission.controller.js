import * as submissionService from './submission.service.js';

export async function create(req, res) {
  const created = await submissionService.createSubmission(req.user.id, req.validated.body);
  res.status(202).json({
    ok: true,
    data: {
      submission: created.submission,
      statusUrl: `/api/submissions/${created.submission._id}`,
    },
  });
}

export async function getOne(req, res) {
  const submission = await submissionService.getSubmissionForUser(
    req.user.id,
    req.validated.params.id,
  );
  res.status(200).json({ ok: true, data: submission });
}

export async function listMine(req, res) {
  const result = await submissionService.listSubmissionsForUser(req.user.id, req.validated.query);
  res.status(200).json({ ok: true, data: result });
}
