type PositionType = [number, number];

export interface LocationMap {
  [key: string]: PositionType[];
}

const isBetween = (largerEl: PositionType, smallerEl: PositionType) => {
  const leftBound = smallerEl[0] >= largerEl[0] && smallerEl[0] <= largerEl[1];
  const rightBound = smallerEl[1] >= largerEl[0] && smallerEl[1] <= largerEl[1];

  return leftBound || rightBound;
};

const checkCellBounds = (newElement: [number, number], existingElement: [number, number]) => {
  if (newElement[1] - newElement[0] > existingElement[1] - existingElement[0]) {
    return isBetween(newElement, existingElement);
  } else {
    return isBetween(existingElement, newElement);
  }
};

export const getRandomStartPosInt = (element: HTMLElement, locationMap: LocationMap): number => {
  let randomPoint = (window.screen.width - element.clientWidth) * Math.random();
  let startVector: number;

  if (randomPoint > element.offsetLeft) {
    startVector = randomPoint - element.offsetLeft;
  } else {
    startVector = (element.offsetLeft - randomPoint) * -1;
  }

  const newRandomPosition: PositionType = [randomPoint - 5, randomPoint + element.clientWidth];

  const existingPositions = locationMap[element.offsetTop] || [];
  const overlaps = existingPositions.some((existingPosition) => checkCellBounds(newRandomPosition, existingPosition));

  if (overlaps) {
    startVector = getRandomStartPosInt(element, locationMap);
  } else {
    locationMap[element.offsetTop] = [...existingPositions, newRandomPosition];
  }

  return startVector;
};
