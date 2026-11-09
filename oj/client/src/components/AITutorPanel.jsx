import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getTutorConversation,
  rateTutorReply,
  streamTutorChat,
  unlockTutorHint,
} from '../api/ai.js';
import { useAuth } from '../auth/AuthContext.jsx';

const QUICK_ACTIONS = [
  'Explain the problem',
  'What edge cases am I missing?',
  'Is my approach fast enough?',
  'Why did I get WA?',
];

export function AITutorPanel({ problemId, editorCode, hidden = false }) {
  const { user } = useAuth();
  const [conversation, setConversation] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [safetyNotice, setSafetyNotice] = useState(false);
  const [providerNotice, setProviderNotice] = useState(false);
  const messagesEnd = useRef(null);

  const reload = useCallback(async () => {
    if (!user || !problemId) return;
    const result = await getTutorConversation(problemId);
    setConversation(result);
    setCooldown(Math.ceil((result.cooldownMs ?? 0) / 1000));
  }, [problemId, user]);

  useEffect(() => {
    setConversation(null);
    setError('');
    if (!user) return;
    reload().catch((loadError) => setError(loadError.message || 'Could not load tutor history.'));
  }, [reload, user]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (typeof messagesEnd.current?.scrollIntoView === 'function') {
      messagesEnd.current.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
  }, [conversation?.messages]);

  async function sendMessage(text) {
    const message = text.trim();
    if (!message || busy || !user) return;
    setBusy(true);
    setError('');
    setSafetyNotice(false);
    setProviderNotice(false);
    setInput('');
    setConversation((current) => ({
      ...current,
      messages: [
        ...(current?.messages ?? []),
        { role: 'user', content: message },
        { role: 'assistant', content: '', pending: true },
      ],
    }));
    try {
      await streamTutorChat({ problemId, message, editorCode }, (event, payload) => {
        if (event === 'delta') {
          setConversation((current) => {
            const messages = current?.messages ?? [];
            return {
              ...current,
              messages: messages.map((item, index) =>
                index === messages.length - 1
                  ? { ...item, content: payload.content, pending: false }
                  : item,
              ),
            };
          });
        }
        if (event === 'replaced') {
          setSafetyNotice(true);
        }
        if (event === 'fallback') {
          setProviderNotice(true);
        }
      });
      await reload();
    } catch (sendError) {
      setError(sendError.message || 'The tutor could not respond.');
      setConversation((current) => ({
        ...current,
        messages: (current?.messages ?? []).filter((item) => !item.pending),
      }));
    } finally {
      setBusy(false);
    }
  }

  async function unlock() {
    const target =
      conversation?.nextUnlock ??
      (conversation?.hintLevelUnlocked === 3 && cooldown === 0 ? 4 : null);
    if (!target || busy) return;
    const accepted = window.confirm(
      `Unlocking hint L${target} may reveal a stronger direction. Continue?`,
    );
    if (!accepted) return;
    try {
      await unlockTutorHint(problemId);
      await reload();
    } catch (unlockError) {
      setError(unlockError.message || 'The next hint is not available yet.');
    }
  }

  const nextUnlock =
    conversation?.nextUnlock ??
    (conversation?.hintLevelUnlocked === 3 && cooldown === 0 ? 4 : null);

  async function feedback(messageIndex, rating) {
    if (!Number.isInteger(messageIndex)) return;
    try {
      await rateTutorReply(problemId, messageIndex, rating);
      await reload();
    } catch (feedbackError) {
      setError(feedbackError.message || 'Could not save your rating.');
    }
  }

  if (!user) {
    return (
      <div className="ai-tutor-panel" hidden={hidden}>
        <h2>AI Tutor</h2>
        <p>Sign in to ask questions and unlock guided hints.</p>
        <Link to="/login">Sign in</Link>
      </div>
    );
  }

  return (
    <section className="ai-tutor-panel" aria-label="AI Tutor" hidden={hidden}>
      <header className="ai-tutor-header">
        <div>
          <h2>AI Tutor</h2>
          <p>Guided hints, not complete solutions.</p>
        </div>
        <span className="ai-level-badge">L{conversation?.hintLevelUnlocked ?? 1}</span>
      </header>
      <div className="ai-tutor-messages" aria-live="polite">
        {!conversation?.messages?.length && (
          <p className="ai-tutor-empty">Ask a question or choose a prompt to get started.</p>
        )}
        {conversation?.messages?.map((message, index) => (
          <article className={`ai-message ai-message-${message.role}`} key={message.index ?? index}>
            <p>{message.content || (message.pending ? 'Thinking…' : '')}</p>
            {message.role === 'assistant' && Number.isInteger(message.index) && (
              <div className="ai-feedback" aria-label="Rate tutor reply">
                <button
                  type="button"
                  aria-label="Helpful"
                  aria-pressed={message.feedback === 'up'}
                  onClick={() => feedback(message.index, 'up')}
                >
                  Helpful
                </button>
                <button
                  type="button"
                  aria-label="Not helpful"
                  aria-pressed={message.feedback === 'down'}
                  onClick={() => feedback(message.index, 'down')}
                >
                  Not helpful
                </button>
              </div>
            )}
          </article>
        ))}
        {safetyNotice && (
          <p className="ai-safety-note">A response was adjusted by safety checks.</p>
        )}
        {providerNotice && (
          <p className="ai-safety-note" role="status">
            The AI provider is currently unavailable; this is fallback guidance.
          </p>
        )}
        <div ref={messagesEnd} />
      </div>
      <div className="ai-quick-actions">
        {QUICK_ACTIONS.map((action) => (
          <button key={action} type="button" disabled={busy} onClick={() => sendMessage(action)}>
            {action}
          </button>
        ))}
      </div>
      <form
        className="ai-compose"
        onSubmit={(event) => {
          event.preventDefault();
          sendMessage(input);
        }}
      >
        <label className="visually-hidden" htmlFor="ai-tutor-input">
          Ask the AI tutor
        </label>
        <textarea
          id="ai-tutor-input"
          value={input}
          maxLength={2000}
          rows={3}
          placeholder="Ask a question about the problem…"
          onChange={(event) => setInput(event.target.value)}
        />
        <button className="button button-small" type="submit" disabled={busy || !input.trim()}>
          {busy ? 'Thinking…' : 'Send'}
        </button>
      </form>
      <div className="ai-unlock-row">
        <span>
          {cooldown > 0
            ? `Next hint cooldown: ${Math.floor(cooldown / 60)}:${String(cooldown % 60).padStart(2, '0')}`
            : 'Hints unlock through time and distinct attempts.'}
        </span>
        {nextUnlock >= 3 && (
          <button
            type="button"
            className="button button-quiet"
            onClick={unlock}
            disabled={busy || cooldown > 0}
          >
            Unlock L{nextUnlock}
          </button>
        )}
      </div>
      {error && (
        <p className="route-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
