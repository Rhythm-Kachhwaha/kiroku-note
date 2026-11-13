/**
 * Kiroku Note Desktop — Spring Physics Counter Micro-Bundle
 * Self-contained, zero-CDN local counter component with spring physics.
 * Emulates React + Motion spring dynamics (stiffness: 80, damping: 60)
 * for telemetry pods, shelf badges, and metrics rollups.
 */

export function isReducedMotionPreferred() {
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
export function mountCounter(target, options = {}) {
  const el = typeof target === 'string' && typeof document !== 'undefined'
    ? document.querySelector(target)
    : target;

  if (!el) {
    return { cancel: () => {}, update: () => {} };
  }

  const targetVal = Number(options.targetValue) || 0;
  const startVal = Number(options.startValue) || 0;
  const delay = Math.max(0, Number(options.delay) || 0);
  const stiffness = Number(options.stiffness) || 80;
  const damping = Number(options.damping) || 60;
  const mass = Number(options.mass) || 1;
  const format = typeof options.format === 'function' ? options.format : (v) => Math.round(v).toLocaleString();

  if (isReducedMotionPreferred()) {
    el.textContent = format(targetVal);
    if (typeof options.onComplete === 'function') options.onComplete();
    return { cancel: () => {}, update: () => {} };
  }

  let currentVal = startVal;
  let currentVel = 0;
  let isCancelled = false;
  let animId = null;
  let delayTimer = null;

  el.textContent = format(startVal);

  function step(timestamp) {
    if (isCancelled) return;

    if (!step.lastTime) step.lastTime = timestamp;
    const deltaMs = Math.min(32, timestamp - step.lastTime);
    step.lastTime = timestamp;
    const dt = deltaMs / 1000;

    const displacement = currentVal - targetVal;
    const springForce = -stiffness * displacement;
    const dampingForce = -damping * currentVel;
    const acceleration = (springForce + dampingForce) / mass;

    currentVel += acceleration * dt;
    currentVal += currentVel * dt;

    el.textContent = format(currentVal);

    const isSettled = Math.abs(currentVal - targetVal) < 0.1 && Math.abs(currentVel) < 0.5;

    if (isSettled) {
      currentVal = targetVal;
      el.textContent = format(targetVal);
      if (typeof options.onComplete === 'function') {
        try { options.onComplete(); } catch (_) {}
      }
    } else {
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

const KirokuCounter = {
  mount: mountCounter,
  mountCounter: mountCounter,
  isReducedMotionPreferred: isReducedMotionPreferred
};

if (typeof window !== 'undefined') {
  window.KirokuCounter = KirokuCounter;
}

export default KirokuCounter;
