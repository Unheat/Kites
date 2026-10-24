// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  toggleImageDisplay,
  replaceImageWithTranslation,
  IMAGE_DISPLAY_CHANGED_EVENT,
} from './imageReplacer';
import type { MediaTarget } from './mediaTargets';
import type { ChapterTranslationRecord } from './chapterZip';

describe('imageReplacer toggleImageDisplay', () => {
  let img: HTMLImageElement;
  let container: HTMLDivElement;
  let target: MediaTarget;
  let record: ChapterTranslationRecord;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    img = document.createElement('img');
    img.src = 'https://example.com/original.jpg';
    container.appendChild(img);
    document.body.appendChild(container);

    target = {
      kind: 'img',
      imgElement: img,
      sourceElement: img,
      surfaceElement: container,
      anchorElement: container,
      srcUrl: 'https://example.com/original.jpg',
      hiddenBacking: false,
    };

    record = {
      originalUrl: 'https://example.com/original.jpg',
      translatedUrl: 'blob:https://example.com/translated-uuid',
      jobId: 101,
      showOriginal: false,
      sourcePage: 'https://example.com/chapter-1',
      documentPath: null,
      documentY: 100,
      sequence: 1,
      sourceElement: img,
      surfaceElement: container,
    };

    // Apply translation first
    replaceImageWithTranslation(target, record);
  });

  it('correctly toggles to original view and updates record.showOriginal', () => {
    const eventSpy = vi.fn();
    document.addEventListener(IMAGE_DISPLAY_CHANGED_EVENT, eventSpy);

    toggleImageDisplay(target, true, record);

    expect(record.showOriginal).toBe(true);
    expect(img.getAttribute('data-kites-show-original')).toBe('true');
    expect(container.getAttribute('data-kites-show-original')).toBe('true');
    expect(img.src).toBe('https://example.com/original.jpg');

    expect(eventSpy).toHaveBeenCalledTimes(1);
    const detail = eventSpy.mock.calls[0][0].detail;
    expect(detail.srcUrl).toBe(target.srcUrl);
    expect(detail.showOriginal).toBe(true);
  });

  it('correctly toggles back to translated view on second call', () => {
    // 1. Toggle to original
    toggleImageDisplay(target, true, record);
    expect(record.showOriginal).toBe(true);
    expect(img.src).toBe('https://example.com/original.jpg');

    // 2. Toggle back to translated
    toggleImageDisplay(target, false, record);
    expect(record.showOriginal).toBe(false);
    expect(img.hasAttribute('data-kites-show-original')).toBe(false);
    expect(container.hasAttribute('data-kites-show-original')).toBe(false);
    expect(img.src).toBe(record.translatedUrl);
  });

  it('supports repeated toggling back and forth without state drift', () => {
    for (let i = 0; i < 4; i++) {
      // Toggle to original
      toggleImageDisplay(target, true, record);
      expect(record.showOriginal).toBe(true);
      expect(img.getAttribute('data-kites-show-original')).toBe('true');
      expect(img.src).toBe('https://example.com/original.jpg');

      // Toggle to translated
      toggleImageDisplay(target, false, record);
      expect(record.showOriginal).toBe(false);
      expect(img.hasAttribute('data-kites-show-original')).toBe(false);
      expect(img.src).toBe(record.translatedUrl);
    }
  });

  it('clears srcset when restoring translated view and restores origSrcset when showing original', () => {
    img.setAttribute('data-kites-orig-srcset', 'https://example.com/original.jpg 1x, https://example.com/high.jpg 2x');

    toggleImageDisplay(target, true, record);
    expect(img.srcset).toBe('https://example.com/original.jpg 1x, https://example.com/high.jpg 2x');

    toggleImageDisplay(target, false, record);
    expect(img.srcset).toBe('');
    expect(img.hasAttribute('srcset')).toBe(false);
  });

  it('toggles background kind media target', () => {
    const bgContainer = document.createElement('div');
    bgContainer.style.backgroundImage = 'url("https://example.com/bg-orig.png")';
    document.body.appendChild(bgContainer);

    const bgTarget: MediaTarget = {
      kind: 'background',
      sourceElement: bgContainer,
      surfaceElement: bgContainer,
      anchorElement: bgContainer,
      srcUrl: 'https://example.com/bg-orig.png',
      hiddenBacking: false,
    };

    const bgRecord: ChapterTranslationRecord = {
      originalUrl: 'https://example.com/bg-orig.png',
      translatedUrl: 'blob:https://example.com/bg-translated',
      showOriginal: false,
      sourcePage: 'https://example.com/chapter-1',
      documentPath: null,
      documentY: 200,
      sequence: 2,
    };

    replaceImageWithTranslation(bgTarget, bgRecord);
    expect(bgContainer.style.backgroundImage).toBe('url("blob:https://example.com/bg-translated")');

    toggleImageDisplay(bgTarget, true, bgRecord);
    expect(bgRecord.showOriginal).toBe(true);
    expect(bgContainer.style.backgroundImage).toBe('url("https://example.com/bg-orig.png")');

    toggleImageDisplay(bgTarget, false, bgRecord);
    expect(bgRecord.showOriginal).toBe(false);
    expect(bgContainer.style.backgroundImage).toBe('url("blob:https://example.com/bg-translated")');
  });
});
