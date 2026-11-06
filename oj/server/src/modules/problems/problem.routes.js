import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './problem.controller.js';
import {
  listQuerySchema,
  objectIdParamsSchema,
  problemBodySchema,
  problemUpdateBodySchema,
  slugParamsSchema,
  testcaseBodySchema,
  testcaseParamsSchema,
  testcaseUpdateBodySchema,
  aiNotesReviewBodySchema,
} from './problem.validation.js';

export function createProblemRouter() {
  const router = Router();
  const requireAdmin = [requireAuth, requireRole('admin')];

  router.get(
    '/admin/list',
    ...requireAdmin,
    validate({ query: listQuerySchema }),
    controller.listAdmin,
  );
  router.get('/', validate({ query: listQuerySchema }), controller.listPublic);
  router.get('/:slug', validate({ params: slugParamsSchema }), controller.getPublic);

  router.post('/', ...requireAdmin, validate({ body: problemBodySchema }), controller.create);
  router.put(
    '/:id',
    ...requireAdmin,
    validate({ params: objectIdParamsSchema, body: problemUpdateBodySchema }),
    controller.update,
  );
  router.post(
    '/:id/ai-context/review',
    ...requireAdmin,
    validate({ params: objectIdParamsSchema, body: aiNotesReviewBodySchema }),
    controller.reviewAiNotes,
  );
  router.delete(
    '/:id',
    ...requireAdmin,
    validate({ params: objectIdParamsSchema }),
    controller.remove,
  );

  router.get(
    '/:id/testcases',
    ...requireAdmin,
    validate({ params: objectIdParamsSchema }),
    controller.listTestCases,
  );
  router.post(
    '/:id/testcases',
    ...requireAdmin,
    validate({ params: objectIdParamsSchema, body: testcaseBodySchema }),
    controller.createTestCase,
  );
  router.put(
    '/:id/testcases/:testCaseId',
    ...requireAdmin,
    validate({ params: testcaseParamsSchema, body: testcaseUpdateBodySchema }),
    controller.updateTestCase,
  );
  router.delete(
    '/:id/testcases/:testCaseId',
    ...requireAdmin,
    validate({ params: testcaseParamsSchema }),
    controller.deleteTestCase,
  );

  return router;
}
