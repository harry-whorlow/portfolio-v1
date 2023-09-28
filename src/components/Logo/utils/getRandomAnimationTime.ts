export const getRandomAnimationTime = (max: number, min: number) => {
  return Math.random() * (max - min + 1) + min;
};
