import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readingCommandMessage,
  registerReadingCommands,
  routeReadingCommand,
  type ReadingCommandsApi,
} from './readingCommands';

/**
 * Constructs a minimal Chrome API mock with independently-spyable commands, tabs, and runtime surfaces.
 * @param overrides - Partial browser API replacements.
 * @returns Mock browser APIs usable without a browser process.
 */
function createMockApi(overrides: Partial<ReadingCommandsApi> = {}): ReadingCommandsApi {
  return {
    commands: { onCommand: { addListener: vi.fn() } },
    tabs: {
      query: vi.fn((_query, callback) => callback([{ id: 42 }])),
      sendMessage: vi.fn((_tabId, _message, _options, callback) => callback()),
    },
    runtime: {},
    ...overrides,
  };
}

describe('readingCommandMessage', () => {
  it('maps translate-hovered-image', () => {
    expect(readingCommandMessage('translate-hovered-image')).toEqual({ type: 'TRANSLATE_HOVERED_IMAGE' });
  });

  it('maps start-screen-crop', () => {
    expect(readingCommandMessage('start-screen-crop')).toEqual({ type: 'START_AREA_SELECTION' });
  });

  it('maps open-chapter-reader', () => {
    expect(readingCommandMessage('open-chapter-reader')).toEqual({ type: 'OPEN_CHAPTER_READER' });
  });

  it.each(['unknown', '_execute_action', 'torii_translate', ''])('returns null for %s', (command) => {
    expect(readingCommandMessage(command)).toBeNull();
  });
});

describe('routeReadingCommand', () => {
  let api: ReadingCommandsApi;

  beforeEach(() => { api = createMockApi(); });

  it('queries the active tab and sends TRANSLATE_HOVERED_IMAGE', () => {
    routeReadingCommand('translate-hovered-image', api);
    expect(api.tabs!.query).toHaveBeenCalledWith({ active: true, currentWindow: true }, expect.any(Function));
    expect(api.tabs!.sendMessage).toHaveBeenCalledWith(
      42,
      { type: 'TRANSLATE_HOVERED_IMAGE' },
      { frameId: 0 },
      expect.any(Function),
    );
  });

  it('sends START_AREA_SELECTION', () => {
    routeReadingCommand('start-screen-crop', api);
    expect(api.tabs!.sendMessage).toHaveBeenCalledWith(
      42,
      { type: 'START_AREA_SELECTION' },
      { frameId: 0 },
      expect.any(Function),
    );
  });

  it('ignores unrecognized commands without querying tabs', () => {
    routeReadingCommand('_execute_action', api);
    expect(api.tabs!.query).not.toHaveBeenCalled();
  });

  it('handles tabs.query returning empty results gracefully', () => {
    api.tabs!.query = vi.fn((_query, callback) => callback([]));
    routeReadingCommand('translate-hovered-image', api);
    expect(api.tabs!.sendMessage).not.toHaveBeenCalled();
  });

  it('handles tabs.query returning tab without id', () => {
    api.tabs!.query = vi.fn((_query, callback) => callback([{}]));
    routeReadingCommand('translate-hovered-image', api);
    expect(api.tabs!.sendMessage).not.toHaveBeenCalled();
  });

  it('logs gracefully when tabs.sendMessage produces a lastError for restricted pages', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.tabs!.sendMessage = vi.fn((_tabId, _msg, _opts, callback) => {
      api.runtime!.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
      callback();
      api.runtime!.lastError = undefined;
    });
    routeReadingCommand('translate-hovered-image', api);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Page unavailable'), expect.any(String));
    warn.mockRestore();
  });

  it('logs gracefully when tabs.query produces a lastError', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.tabs!.query = vi.fn((_query, callback) => {
      api.runtime!.lastError = { message: 'No current window' };
      callback([]);
      api.runtime!.lastError = undefined;
    });
    routeReadingCommand('translate-hovered-image', api);
    expect(api.tabs!.sendMessage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Active tab query failed'), expect.any(String));
    warn.mockRestore();
  });

  it('survives missing tabs API (non-extension environment)', () => {
    routeReadingCommand('translate-hovered-image', { tabs: undefined, runtime: {} });
  });

  it('catches tabs.query exceptions without crashing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    api.tabs!.query = vi.fn(() => { throw new Error('Extension context invalidated'); });
    expect(() => routeReadingCommand('translate-hovered-image', api)).not.toThrow();
    error.mockRestore();
  });
});

describe('registerReadingCommands', () => {
  it('returns true and attaches listener to commands.onCommand', () => {
    const api = createMockApi();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(registerReadingCommands(api)).toBe(true);
    expect(api.commands!.onCommand!.addListener).toHaveBeenCalledWith(expect.any(Function));
    log.mockRestore();
  });

  it('registered listener delegates to routeReadingCommand with the same API', () => {
    const api = createMockApi();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    registerReadingCommands(api);
    const listener = (api.commands!.onCommand!.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0];
    listener('translate-hovered-image');
    expect(api.tabs!.query).toHaveBeenCalled();
  });

  it('returns false for absent commands API', () => {
    expect(registerReadingCommands({})).toBe(false);
    expect(registerReadingCommands({ commands: {} })).toBe(false);
  });
});
