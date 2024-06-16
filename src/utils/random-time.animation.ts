export const getRandomAnimationTime = (max: number, min: number) => {
  const randomInt = Math.random() * (max - min + 1) + min;

  return randomInt > max ? max : randomInt;
};
