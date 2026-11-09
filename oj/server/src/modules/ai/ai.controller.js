import * as aiService from './ai.service.js';

function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function conversation(req, res, next) {
  try {
    res.json({
      ok: true,
      data: await aiService.getConversation(req.user.id, req.validated.query.problemId),
    });
  } catch (error) {
    next(error);
  }
}

export async function unlock(req, res, next) {
  try {
    res.json({
      ok: true,
      data: await aiService.unlockNextHint(req.user.id, req.validated.body.problemId),
    });
  } catch (error) {
    next(error);
  }
}

export async function chat(req, res, next) {
  try {
    const input = await aiService.validateChatRequest(req.validated.body);
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const result = await aiService.chat(req.user.id, input);
    if (result.replaced && !result.providerFailed) {
      sendEvent(res, 'replaced', { reason: 'safety_guard' });
    }
    if (result.providerFailed) sendEvent(res, 'fallback', { reason: 'provider_unavailable' });
    sendEvent(res, 'delta', { content: result.reply });
    sendEvent(res, 'done', { level: result.level });
    res.end();
  } catch (error) {
    if (res.headersSent) {
      sendEvent(res, 'error', { message: 'Tutor request could not be completed.' });
      res.end();
      return;
    }
    next(error);
  }
}

export async function feedback(req, res, next) {
  try {
    await aiService.rateReply(req.user.id, req.validated.body);
    res.json({ ok: true, data: { saved: true } });
  } catch (error) {
    next(error);
  }
}
