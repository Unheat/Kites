import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import HelpTooltip, {
  DEFAULT_WIDTH_SM_PX,
} from './HelpTooltip';

vi.hoisted(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('HelpTooltip', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('renders trigger button with "?" and accessibility attributes', async () => {
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <HelpTooltip
          content="Test information"
          id="test-tooltip-id"
          ariaLabel="Help for feature"
        />
      );
    });

    const trigger = container.querySelector('[role="button"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent?.trim()).toBe('?');
    expect(trigger?.getAttribute('aria-label')).toBe('Help for feature');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');

    const tooltip = container.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.id).toBe('test-tooltip-id');
    expect(tooltip?.textContent?.trim()).toBe('Test information');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('toggles visibility on focus/blur and click without event propagation', async () => {
    const root = createRoot(container);
    const parentClickHandler = vi.fn();

    await act(async () => {
      root.render(
        <div onClick={parentClickHandler}>
          <HelpTooltip content="Hover info" />
        </div>
      );
    });

    const trigger = container.querySelector<HTMLElement>('[role="button"]')!;

    // Focus
    await act(async () => {
      trigger.focus();
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    // Blur
    await act(async () => {
      trigger.blur();
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    // Click trigger - should toggle and NOT propagate to parent
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(parentClickHandler).not.toHaveBeenCalled();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('detects right boundary overflow and flips to the left', async () => {
    const root = createRoot(container);

    // Mock window innerWidth = 320px
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 600 });

    await act(async () => {
      root.render(<HelpTooltip content="Speech bubble explanation" size="sm" />);
    });

    const trigger = container.querySelector<HTMLElement>('[role="button"]')!;
    const wrapper = trigger.parentElement as HTMLSpanElement;
    const tooltip = container.querySelector('[role="tooltip"]') as HTMLDivElement;

    // Simulate trigger near right edge: left=180, right=194, width=14
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
      left: 180,
      right: 194,
      top: 200,
      bottom: 214,
      width: 14,
      height: 14,
      x: 180,
      y: 200,
      toJSON: () => {},
    });

    // Simulate tooltip dimensions: 220px wide, 60px high
    vi.spyOn(tooltip, 'getBoundingClientRect').mockReturnValue({
      left: 180,
      right: 400,
      top: 220,
      bottom: 280,
      width: DEFAULT_WIDTH_SM_PX,
      height: 60,
      x: 180,
      y: 220,
      toJSON: () => {},
    });

    Object.defineProperty(tooltip, 'offsetWidth', { configurable: true, value: DEFAULT_WIDTH_SM_PX });
    Object.defineProperty(tooltip, 'offsetHeight', { configurable: true, value: 60 });

    await act(async () => {
      trigger.focus();
    });

    // Right would overflow: 180 + 220 = 400 > 312
    // Flipped to left: target left in viewport = max(8, min(312 - 220 = 92, 194 - 220 = -26 -> clamped to 8))
    // Relative left to container = 8 - 180 = -172px
    expect(tooltip.style.left).toBe('-172px');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps normal right-facing orientation when right boundary has sufficient space', async () => {
    const root = createRoot(container);

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 600 });

    await act(async () => {
      root.render(<HelpTooltip content="Left aligned header info" size="sm" />);
    });

    const trigger = container.querySelector<HTMLElement>('[role="button"]')!;
    const wrapper = trigger.parentElement as HTMLSpanElement;
    const tooltip = container.querySelector('[role="tooltip"]') as HTMLDivElement;

    // Trigger on left: left=20, right=34, width=14
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      right: 34,
      top: 100,
      bottom: 114,
      width: 14,
      height: 14,
      x: 20,
      y: 100,
      toJSON: () => {},
    });

    vi.spyOn(tooltip, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      right: 240,
      top: 120,
      bottom: 180,
      width: DEFAULT_WIDTH_SM_PX,
      height: 60,
      x: 20,
      y: 120,
      toJSON: () => {},
    });
    Object.defineProperty(tooltip, 'offsetWidth', { configurable: true, value: DEFAULT_WIDTH_SM_PX });
    Object.defineProperty(tooltip, 'offsetHeight', { configurable: true, value: 60 });

    await act(async () => {
      trigger.focus();
    });

    // 20 + 220 = 240 <= 312 -> fits on right without overflow
    // Relative left to container = 0px
    expect(tooltip.style.left).toBe('0px');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('flips to the left from far-right trigger without overflowing viewport left', async () => {
    const root = createRoot(container);

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 600 });

    await act(async () => {
      root.render(<HelpTooltip content="Auth required" size="sm" width={210} />);
    });

    const trigger = container.querySelector<HTMLElement>('[role="button"]')!;
    const wrapper = trigger.parentElement as HTMLSpanElement;
    const tooltip = container.querySelector('[role="tooltip"]') as HTMLDivElement;

    // Trigger on far right: left=295, right=309
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
      left: 295,
      right: 309,
      top: 100,
      bottom: 114,
      width: 14,
      height: 14,
      x: 295,
      y: 100,
      toJSON: () => {},
    });

    vi.spyOn(tooltip, 'getBoundingClientRect').mockReturnValue({
      left: 295,
      right: 505,
      top: 120,
      bottom: 180,
      width: 210,
      height: 60,
      x: 295,
      y: 120,
      toJSON: () => {},
    });
    Object.defineProperty(tooltip, 'offsetWidth', { configurable: true, value: 210 });
    Object.defineProperty(tooltip, 'offsetHeight', { configurable: true, value: 60 });

    await act(async () => {
      trigger.focus();
    });

    // Right overflows: 295 + 210 = 505 > 312
    // Left edge if aligned to right: 309 - 210 = 99px (which is >= 8px)
    // Relative left to container = 99 - 295 = -196px
    expect(tooltip.style.left).toBe('-196px');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('detects bottom boundary overflow and flips to the top', async () => {
    const root = createRoot(container);

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 400 });

    await act(async () => {
      root.render(<HelpTooltip content="Bottom edge item" size="sm" />);
    });

    const trigger = container.querySelector<HTMLElement>('[role="button"]')!;
    const wrapper = trigger.parentElement as HTMLSpanElement;
    const tooltip = container.querySelector('[role="tooltip"]') as HTMLDivElement;

    // Trigger near bottom: bottom=370, top=356
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      right: 34,
      top: 356,
      bottom: 370,
      width: 14,
      height: 14,
      x: 20,
      y: 356,
      toJSON: () => {},
    });

    vi.spyOn(tooltip, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      right: 240,
      top: 376,
      bottom: 436,
      width: DEFAULT_WIDTH_SM_PX,
      height: 60,
      x: 20,
      y: 376,
      toJSON: () => {},
    });
    Object.defineProperty(tooltip, 'offsetWidth', { configurable: true, value: DEFAULT_WIDTH_SM_PX });
    Object.defineProperty(tooltip, 'offsetHeight', { configurable: true, value: 60 });

    await act(async () => {
      trigger.focus();
    });

    // Bottom overflows: 370 + 60 + 6 = 436 > 392 (400 - 8).
    // Flipped to top:
    expect(tooltip.style.bottom).toBe('100%');
    expect(tooltip.style.top).toBe('auto');
    expect(tooltip.style.marginBottom).toBe('6px');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
