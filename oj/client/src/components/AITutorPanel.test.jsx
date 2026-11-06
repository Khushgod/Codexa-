import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AITutorPanel } from './AITutorPanel.jsx';

const mocks = vi.hoisted(() => ({
  user: null,
  getTutorConversation: vi.fn(),
  rateTutorReply: vi.fn(),
  streamTutorChat: vi.fn(),
  unlockTutorHint: vi.fn(),
}));

vi.mock('../auth/AuthContext.jsx', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('../api/ai.js', () => ({
  getTutorConversation: mocks.getTutorConversation,
  rateTutorReply: mocks.rateTutorReply,
  streamTutorChat: mocks.streamTutorChat,
  unlockTutorHint: mocks.unlockTutorHint,
}));

function renderPanel() {
  return render(
    <MemoryRouter>
      <AITutorPanel problemId="problem-1" editorCode="print('draft')" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = null;
  mocks.getTutorConversation.mockResolvedValue({
    hintLevelUnlocked: 1,
    nextUnlock: null,
    cooldownMs: 0,
    messages: [],
  });
  mocks.rateTutorReply.mockResolvedValue({});
  mocks.unlockTutorHint.mockResolvedValue({});
  window.confirm = vi.fn(() => true);
});

describe('AI tutor panel', () => {
  it('prompts unauthenticated users to sign in', () => {
    renderPanel();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('sends editor context, renders guarded stream events, and displays replacement notice', async () => {
    mocks.user = { id: 'user-1' };
    let replied = false;
    mocks.getTutorConversation.mockImplementation(async () => ({
      hintLevelUnlocked: 1,
      nextUnlock: null,
      cooldownMs: 0,
      messages: replied
        ? [
            { index: 0, role: 'user', content: 'Explain the problem', level: 1 },
            { index: 1, role: 'assistant', content: 'Try the smallest input.', level: 1 },
          ]
        : [],
    }));
    mocks.streamTutorChat.mockImplementation(async (input, onEvent) => {
      replied = true;
      onEvent('replaced', { reason: 'safety_guard' });
      onEvent('delta', { content: 'Try the smallest input.' });
      onEvent('done', { level: 1 });
    });

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Explain the problem' }));
    expect(await screen.findByText('Try the smallest input.')).toBeInTheDocument();
    expect(screen.getByText('A response was adjusted by safety checks.')).toBeInTheDocument();
    expect(mocks.streamTutorChat).toHaveBeenCalledWith(
      { problemId: 'problem-1', message: 'Explain the problem', editorCode: "print('draft')" },
      expect.any(Function),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }));
    await waitFor(() => {
      expect(mocks.rateTutorReply).toHaveBeenCalledWith('problem-1', 1, 'up');
    });
  });

  it('shows a spoiler confirmation before an explicit hint unlock', async () => {
    mocks.user = { id: 'user-1' };
    mocks.getTutorConversation.mockResolvedValue({
      hintLevelUnlocked: 2,
      nextUnlock: 3,
      cooldownMs: 0,
      messages: [],
    });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Unlock L3' }));
    await waitFor(() => expect(mocks.unlockTutorHint).toHaveBeenCalledWith('problem-1'));
    expect(window.confirm).toHaveBeenCalledWith(
      'Unlocking hint L3 may reveal a stronger direction. Continue?',
    );
  });
});
