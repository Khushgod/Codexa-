import { MongoJobQueue } from './MongoJobQueue.js';

const queue = new MongoJobQueue();

export async function enqueueJudgeJob(submissionId) {
  return queue.enqueue(submissionId);
}
