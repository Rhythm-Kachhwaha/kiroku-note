/**
 * Kiroku Note Desktop — Spring Physics Counter Micro-Bundle
 * Self-contained, zero-CDN local counter component with spring physics.
 * Emulates React + Motion spring dynamics (stiffness: 80, damping: 60)
 * for telemetry pods, shelf badges, and metrics rollups.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KirokuCounter = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function isReducedMotionPreferred() {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  /**
   * Mounts a spring-animated counter to a DOM element.
   * @param {HTMLElement|string} target - Container element or CSS selector.
   * @param {Object} options - Counter options.
   * @param {number} options.targetValue - The final number to reach.
   * @param {number} [options.startValue=0] - Initial starting number.
   * @param {number} [options.delay=0] - Delay in milliseconds before animating.
   * @param {number} [options.stiffness=80] - Spring stiffness.
   * @param {number} [options.damping=60] - Spring damping.
   * @param {number} [options.mass=1] - Spring mass.
   * @param {Function} [options.format] - Value formatter (number) => string.
   * @param {Function} [options.onComplete] - Callback on animation completion.
   * @returns {{ cancel: Function, update: Function }}
   */
  function mountCounter(target, options = {}) {
    const el = typeof target === 'string' && typeof document !== 'undefined'
      ? document.querySelector(target)
      : target;

    if (!el) {
      return { cancel: () => {}, update: () => {} };
    }

    const targetVal = typeof options.targetValue === 'number' ? options.targetValue : 0;
    const startVal = typeof options.startValue === 'number' ? options.startValue : 0;
    const delay = typeof options.delay === 'number' ? options.delay : 0;
    const stiffness = typeof options.stiffness === 'number' ? options.stiffness : 80;
    const damping = typeof options.damping === 'number' ? options.damping : 60;
    const mass = typeof options.mass === 'number' ? options.mass : 1;
    const format = typeof options.format === 'function'
      ? options.format
      : (v) => Math.round(v).toLocaleString();

    let currentVal = startVal;
    let velocity = 0;
    let animId = null;
    let delayTimer = null;
    let isCancelled = false;

    // Fast-path for reduced motion or SSR
    if (isReducedMotionPreferred() || typeof requestAnimationFrame === 'undefined') {
      el.textContent = format(targetVal);
      if (options.onComplete) options.onComplete();
      return { cancel: () => {}, update: (nv) => { el.textContent = format(nv); } };
    }

    // Set initial display
    el.textContent = format(startVal);

    function step(timestamp) {
      if (isCancelled) return;

      let lastTime = step.lastTime || timestamp;
      let dt = Math.min((timestamp - lastTime) / 1000, 0.064); // clamp max dt to prevent explosion
      step.lastTime = timestamp;

      // Spring physics equation: F = -k * (x - x_target) - c * v
      const displacement = currentVal - targetVal;
      const springForce = -stiffness * displacement;
      const dampingForce = -damping * velocity;
      const acceleration = (springForce + dampingForce) / mass;

      velocity += acceleration * dt;
      currentVal += velocity * dt;

      // Check convergence threshold
      const isSettled = Math.abs(currentVal - targetVal) < 0.1 && Math.abs(velocity) < 0.2;

      if (isSettled) {
        currentVal = targetVal;
        el.textContent = format(targetVal);
        if (options.onComplete) options.onComplete();
      } else {
        el.textContent = format(currentVal);
        animId = requestAnimationFrame(step);
      }
    }

    if (delay > 0) {
      delayTimer = setTimeout(() => {
        if (!isCancelled) {
          step.lastTime = 0;
          animId = requestAnimationFrame(step);
        }
      }, delay);
    } else {
      step.lastTime = 0;
      animId = requestAnimationFrame(step);
    }

    return {
      cancel: () => {
        isCancelled = true;
        if (delayTimer) clearTimeout(delayTimer);
        if (animId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(animId);
      },
      update: (newTarget) => {
        isCancelled = true;
        if (delayTimer) clearTimeout(delayTimer);
        if (animId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(animId);
        return mountCounter(el, { ...options, startValue: currentVal, targetValue: newTarget });
      }
    };
  }

  return {
    mount: mountCounter,
    mountCounter: mountCounter,
    isReducedMotionPreferred: isReducedMotionPreferred
  };
});
