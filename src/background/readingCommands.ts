export type ReadingCommandMessage = { type: 'TRANSLATE_HOVERED_IMAGE' | 'START_AREA_SELECTION' };

/** Minimal Chrome surface keeps registration safe in older unit-test mocks. */
export interface ReadingCommandsApi {
  commands?: {
    onCommand?: { addListener: (listener: (command: string) => void) => void };
  };
  tabs?: {
    query: (query: { active: boolean; currentWindow: boolean }, callback: (tabs: { id?: number }[]) => void) => void;
    sendMessage: (tabId: number, message: ReadingCommandMessage, options: { frameId: number }, callback: () => void) => void;
  };
  runtime?: { lastError?: { message?: string } };
}

// Route to the top frame: manifest injects into all frames, but crop UI must open once.
const TOP_FRAME_ID = 0;

/**
 * Maps only manifest command names to the existing content message vocabulary.
 * @param command - Command name emitted by chrome.commands.
 * @returns Content message, or null for another extension command.
 */
export function readingCommandMessage(command: string): ReadingCommandMessage | null {
  if (command === 'translate-hovered-image') return { type: 'TRANSLATE_HOVERED_IMAGE' };
  if (command === 'start-screen-crop') return { type: 'START_AREA_SELECTION' };
  return null;
}

/**
 * Finds the active tab and forwards a reading action, consuming Chrome delivery errors.
 * @param command - Manifest command name; unknown names are ignored without tab queries.
 * @param api - Chrome APIs, injectable for tests without extension/browser globals.
 * @returns Nothing. Restricted pages or missing content scripts are logged, not thrown.
 */
export function routeReadingCommand(command: string, api: ReadingCommandsApi): void {
  const message = readingCommandMessage(command);
  if (!message || !api.tabs) return;
  try {
    api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (api.runtime?.lastError) {
        console.warn('[Reading Shortcuts] Active tab query failed:', api.runtime.lastError.message);
        return;
      }
      const tabId = tabs[0]?.id;
      if (tabId === undefined) return;
      try {
        api.tabs!.sendMessage(tabId, message, { frameId: TOP_FRAME_ID }, () => {
          if (api.runtime?.lastError) {
            console.warn('[Reading Shortcuts] Page unavailable:', api.runtime.lastError.message);
          }
        });
      } catch (error) {
        console.error('[Reading Shortcuts] Command delivery failed:', error);
      }
    });
  } catch (error) {
    console.error('[Reading Shortcuts] Active tab lookup failed:', error);
  }
}

/**
 * Registers command routing synchronously during service-worker initialization.
 * @param api - Chrome APIs, defaulting to the current extension's API when available.
 * @returns Whether registration succeeded; absent commands APIs are a harmless no-op.
 */
export function registerReadingCommands(api: ReadingCommandsApi = globalThis.chrome ?? {}): boolean {
  if (!api.commands?.onCommand?.addListener) return false;
  api.commands.onCommand.addListener((command) => routeReadingCommand(command, api));
  console.log('[Reading Shortcuts] Browser commands registered.');
  return true;
}
