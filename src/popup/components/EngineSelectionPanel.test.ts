import { describe, expect, it } from 'vitest';
import { orderChangedCatalog, type Engine } from './EngineSelectionPanel';

describe('orderChangedCatalog', () => {
  it('pins the default, then groups downloaded engines in lexical order', () => {
    const engines: Engine[] = [
      { id: 'pending', name: 'Beta', type: 'local', isDownloaded: false },
      { id: 'downloaded-z', name: 'Zulu', type: 'local', isDownloaded: true },
      { id: 'default', name: 'Google Translate', type: 'api', isDownloaded: true },
      { id: 'downloaded-a', name: 'Alpha', type: 'local', isDownloaded: true },
    ];

    expect(orderChangedCatalog(engines, 'default').map(engine => engine.id)).toEqual([
      'default',
      'downloaded-a',
      'downloaded-z',
      'pending',
    ]);
    expect(engines.map(engine => engine.id)).toEqual(['pending', 'downloaded-z', 'default', 'downloaded-a']);
  });
});
