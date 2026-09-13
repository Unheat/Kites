/**
 * Kites Marketing Website — Interactive Comparison Slider
 */

document.addEventListener('DOMContentLoaded', () => {
  const sliderContainer = document.querySelector('.slider-container');
  const sliderInput = document.querySelector('.slider-range-input');
  const sliderOverlay = document.querySelector('.slider-overlay');
  const sliderHandleLine = document.querySelector('.slider-handle-line');

  if (sliderContainer && sliderInput && sliderOverlay && sliderHandleLine) {
    const updateSlider = (val) => {
      sliderOverlay.style.width = `${val}%`;
      sliderHandleLine.style.left = `${val}%`;
    };

    sliderInput.addEventListener('input', (e) => {
      updateSlider(e.target.value);
    });

    // Touch / Mouse smooth dragging directly on container
    let isDragging = false;

    const setPositionFromEvent = (e) => {
      const rect = sliderContainer.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      let percentage = ((clientX - rect.left) / rect.width) * 100;
      percentage = Math.max(0, Math.min(100, percentage));
      sliderInput.value = percentage;
      updateSlider(percentage);
    };

    sliderContainer.addEventListener('mousedown', (e) => {
      isDragging = true;
      setPositionFromEvent(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      setPositionFromEvent(e);
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    sliderContainer.addEventListener('touchstart', (e) => {
      isDragging = true;
      setPositionFromEvent(e);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      setPositionFromEvent(e);
    }, { passive: true });

    window.addEventListener('touchend', () => {
      isDragging = false;
    });
  }

  // Smooth scroll for nav anchor links
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      const targetElement = document.querySelector(targetId);
      if (targetElement) {
        e.preventDefault();
        targetElement.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
});
