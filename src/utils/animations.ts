import { prefersReducedMotion } from './motion';

const EVENT = 'animations:change';
const root = () => document.documentElement;

export const animationsPaused = () => {
  const value = root().dataset.animationsPaused;
  return value === undefined ? prefersReducedMotion() : value === 'true';
};

export const setAnimationsPaused = (paused: boolean) => {
  if (root().dataset.animationsPaused === String(paused)) return;
  root().dataset.animationsPaused = String(paused);
  document.dispatchEvent(new CustomEvent(EVENT, { detail: paused }));
};

export const toggleAnimations = () => setAnimationsPaused(!animationsPaused());

export const onAnimationsPaused = (callback: (paused: boolean) => void) => {
  const listener = () => callback(animationsPaused());
  document.addEventListener(EVENT, listener);
  listener();
  return () => document.removeEventListener(EVENT, listener);
};
