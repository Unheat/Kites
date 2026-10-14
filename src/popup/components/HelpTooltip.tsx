import React, { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react';

/** Minimum safe clearance in pixels between tooltip bubble and viewport boundary. */
export const VIEWPORT_PADDING_PX = 8;

/** Vertical spacing in pixels between trigger and tooltip bubble. */
export const VERTICAL_OFFSET_PX = 6;

/** Default width in pixels for small variant ('sm'). */
export const DEFAULT_WIDTH_SM_PX = 220;

/** Default width in pixels for medium variant ('md'). */
export const DEFAULT_WIDTH_MD_PX = 260;

/** Fallback estimated height in pixels before DOM measurement occurs. */
export const FALLBACK_TOOLTIP_HEIGHT_PX = 60;

/** Fallback extension popup viewport width in pixels. */
export const DEFAULT_POPUP_WIDTH_PX = 320;

/** Fallback extension popup viewport height in pixels. */
export const DEFAULT_POPUP_HEIGHT_PX = 600;

export interface HelpTooltipProps {
  /** The tooltip content or message node. */
  content: React.ReactNode;
  /** Size variant: 'sm' (14px circle, 9px text) or 'md' (16px circle, 10px text). */
  size?: 'sm' | 'md';
  /** Optional custom width in pixels (defaults to 220 for 'sm', 260 for 'md'). */
  width?: number;
  /** Optional accessible ID for aria-describedby linkage. */
  id?: string;
  /** Optional accessibility label for the trigger button. */
  ariaLabel?: string;
  /** Optional custom class name for the outer container span. */
  className?: string;
  /** Optional custom class name for the inner tooltip bubble. */
  tooltipClassName?: string;
}

/**
 * Reusable help tooltip icon component that dynamically prevents viewport overflow.
 *
 * Flips horizontally (left/right) and vertically (top/bottom) when boundary collisions
 * are detected, ensuring tooltips remain fully readable within constrained extension popups.
 *
 * @param props - Configuration properties including content, size, and styling overrides.
 * @returns The rendered help tooltip element.
 */
export default function HelpTooltip({
  content,
  size = 'sm',
  width,
  id,
  ariaLabel = 'Help information',
  className = '',
  tooltipClassName = '',
}: HelpTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const defaultWidth = width ?? (size === 'md' ? DEFAULT_WIDTH_MD_PX : DEFAULT_WIDTH_SM_PX);

  /**
   * Recalculates tooltip coordinates relative to trigger container and clamps
   * within viewport boundaries to prevent right/left or top/bottom clipping.
   *
   * @returns void
   */
  const updatePosition = useCallback(() => {
    const container = containerRef.current;
    const tooltip = tooltipRef.current;
    if (!container || !tooltip) return;

    const containerRect = container.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    const tooltipWidth = tooltip.offsetWidth || tooltipRect.width || defaultWidth;
    const tooltipHeight = tooltip.offsetHeight || tooltipRect.height || FALLBACK_TOOLTIP_HEIGHT_PX;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || DEFAULT_POPUP_WIDTH_PX;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || DEFAULT_POPUP_HEIGHT_PX;

    // 1. HORIZONTAL COLLISION DETECTION & PLACEMENT
    // Check if opening to the right (left aligned with trigger) exceeds right boundary:
    const rightIfShowRight = containerRect.left + tooltipWidth;
    const rightOverflow = rightIfShowRight - (viewportWidth - VIEWPORT_PADDING_PX);

    // Check if opening to the left (right aligned with trigger) exceeds left boundary:
    const leftIfShowLeft = containerRect.right - tooltipWidth;
    const leftUnderflow = VIEWPORT_PADDING_PX - leftIfShowLeft;

    let targetLeftViewport: number;

    if (rightOverflow > 0) {
      // Right is out of place -> show to the left
      if (leftUnderflow <= 0) {
        // Fits comfortably to the left
        targetLeftViewport = leftIfShowLeft;
      } else {
        // Both sides overflow if anchored to trigger edges (e.g. center trigger + wide tooltip).
        // Shift right just enough to fit within left boundary while staying as far left as possible.
        targetLeftViewport = Math.max(
          VIEWPORT_PADDING_PX,
          Math.min(viewportWidth - VIEWPORT_PADDING_PX - tooltipWidth, leftIfShowLeft + leftUnderflow)
        );
      }
    } else if (containerRect.left < VIEWPORT_PADDING_PX) {
      // Left is out of place -> show to the right
      targetLeftViewport = Math.max(
        VIEWPORT_PADDING_PX,
        Math.min(viewportWidth - VIEWPORT_PADDING_PX - tooltipWidth, containerRect.left)
      );
    } else {
      // Default: show to the right
      targetLeftViewport = containerRect.left;
    }

    // Safety clamp within viewport padding bounds
    const maxAllowedLeft = Math.max(VIEWPORT_PADDING_PX, viewportWidth - VIEWPORT_PADDING_PX - tooltipWidth);
    targetLeftViewport = Math.max(VIEWPORT_PADDING_PX, Math.min(maxAllowedLeft, targetLeftViewport));

    // Convert viewport coordinate into container-relative offset
    const relativeLeft = Math.round(targetLeftViewport - containerRect.left);

    // 2. VERTICAL COLLISION DETECTION & PLACEMENT
    const bottomIfShowBottom = containerRect.bottom + tooltipHeight + VERTICAL_OFFSET_PX;
    const bottomOverflow = bottomIfShowBottom - (viewportHeight - VIEWPORT_PADDING_PX);

    const topIfShowTop = containerRect.top - tooltipHeight - VERTICAL_OFFSET_PX;
    const topUnderflow = VIEWPORT_PADDING_PX - topIfShowTop;

    let showOnTop = false;
    if (bottomOverflow > 0 && topUnderflow <= 0) {
      // Bottom overflows, top has space -> flip to top
      showOnTop = true;
    } else if (bottomOverflow > 0 && topIfShowTop > (viewportHeight - containerRect.bottom)) {
      // Both constrained, but top provides more room
      showOnTop = true;
    }

    // Apply inline positioning styles directly
    tooltip.style.left = `${relativeLeft}px`;
    tooltip.style.right = 'auto';

    if (showOnTop) {
      tooltip.style.top = 'auto';
      tooltip.style.bottom = '100%';
      tooltip.style.marginTop = '0px';
      tooltip.style.marginBottom = `${VERTICAL_OFFSET_PX}px`;
    } else {
      tooltip.style.top = '100%';
      tooltip.style.bottom = 'auto';
      tooltip.style.marginTop = `${VERTICAL_OFFSET_PX}px`;
      tooltip.style.marginBottom = '0px';
    }
  }, [defaultWidth]);

  /**
   * Mouse enter handler to synchronously update position and show tooltip.
   */
  const handleMouseEnter = () => {
    updatePosition();
    setIsVisible(true);
  };

  /**
   * Mouse leave handler to hide tooltip.
   */
  const handleMouseLeave = () => {
    setIsVisible(false);
  };

  /**
   * Focus handler for keyboard accessibility.
   */
  const handleFocus = () => {
    updatePosition();
    setIsVisible(true);
  };

  /**
   * Blur handler for keyboard accessibility.
   */
  const handleBlur = () => {
    setIsVisible(false);
  };

  /**
   * Click handler to toggle tooltip visibility without bubbling to parents.
   *
   * @param e - Mouse event
   */
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    updatePosition();
    setIsVisible((prev) => !prev);
  };

  useLayoutEffect(() => {
    if (isVisible) {
      updatePosition();
    }
  }, [isVisible, updatePosition]);

  useEffect(() => {
    if (!isVisible) return;
    const handleRecalculate = () => updatePosition();
    window.addEventListener('resize', handleRecalculate);
    window.addEventListener('scroll', handleRecalculate, true);
    return () => {
      window.removeEventListener('resize', handleRecalculate);
      window.removeEventListener('scroll', handleRecalculate, true);
    };
  }, [isVisible, updatePosition]);

  const triggerSizeClass = size === 'md'
    ? 'w-4 h-4 text-[10px]'
    : 'w-3.5 h-3.5 text-[9px]';

  const cardPaddingAndTextClass = size === 'md'
    ? 'p-2.5 text-xs'
    : 'p-2 text-[11px]';

  return (
    <span
      ref={containerRef}
      className={`relative inline-flex items-center align-middle ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-expanded={isVisible}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            updatePosition();
            setIsVisible((prev) => !prev);
          }
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={`peer rounded-full border border-[var(--color-dust)] flex items-center justify-center font-normal text-[var(--color-dust)] cursor-help hover:bg-[var(--color-dust)] hover:text-[var(--color-paper)] focus:outline-none focus:ring-1 focus:ring-[var(--color-editorial)] transition-colors flex-shrink-0 select-none bg-transparent ${triggerSizeClass}`}
      >
        ?
      </span>

      <div
        ref={tooltipRef}
        role="tooltip"
        id={id}
        style={{
          width: `${defaultWidth}px`,
          maxWidth: `calc(100vw - ${VIEWPORT_PADDING_PX * 2}px)`,
        }}
        className={`absolute z-[100] pointer-events-none transition-opacity duration-150 ${
          isVisible ? 'opacity-100' : 'opacity-0'
        } peer-hover:opacity-100`}
      >
        <div
          className={`bg-[var(--color-ink)] text-[var(--color-paper)] font-normal leading-snug rounded-md shadow-xl border border-[var(--color-dust)]/20 ${cardPaddingAndTextClass} ${tooltipClassName}`}
        >
          {content}
        </div>
      </div>
    </span>
  );
}
