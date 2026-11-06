import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './submission.controller.js';
import {
  createSubmissionSchema,
  submissionIdParamsSchema,
  submissionListQuerySchema,
} from './submission.validation.js';

export function createSubmissionRouter() {
  const router = Router();
  router.use(requireAuth);
  router.get('/mine', validate({ query: submissionListQuerySchema }), controller.listMine);
  router.post('/', validate({ body: createSubmissionSchema }), controller.create);
  router.get('/:id', validate({ params: submissionIdParamsSchema }), controller.getOne);
  return router;
}
