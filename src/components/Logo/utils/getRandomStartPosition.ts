type PositionType = [number, number];

export interface LocationMap {
  [key: string]: PositionType[];
}

const isBetween = ({ largerEl, smallerEl }: { largerEl: [number, number]; smallerEl: [number, number] }) => {
  const leftBound = smallerEl[0] >= largerEl[0] && smallerEl[0] <= largerEl[1];
  const rightBound = smallerEl[1] >= largerEl[0] && smallerEl[1] <= largerEl[1];

  return leftBound || rightBound;
};

const checkCellBounds = (newElement: [number, number], existingElement: [number, number]) => {
  if (newElement[1] - newElement[0] > existingElement[1] - existingElement[0]) {
    // if new element if smaller than old element

    return isBetween({ largerEl: newElement, smallerEl: existingElement });
  } else {
    // re-ordered so that were comparing the smaller span to larger to save on more maths

    return isBetween({ largerEl: existingElement, smallerEl: newElement });
  }
};

export const getRandomStartPosInt = (element: HTMLElement, locationMap: LocationMap): number => {
  const [, row] = element.id.split('-');

  const { left: elementLeftPoint, width: elementWidth } = element.getBoundingClientRect();

  let randomPoint = (window.screen.width - elementWidth) * Math.random();
  let startVector: number;

  if (randomPoint > elementLeftPoint) {
    startVector = randomPoint - elementLeftPoint;
  } else {
    startVector = (elementLeftPoint - randomPoint) * -1;
  }

  const newRandomPosition: PositionType = [randomPoint - 5, randomPoint + elementWidth];

  switch (true) {
    case locationMap[row] == undefined:
      locationMap[row] = [newRandomPosition];
      break;

    case locationMap[row].some((existingPosition) => checkCellBounds(newRandomPosition, existingPosition)):
      startVector = getRandomStartPosInt(element, locationMap);
      break;

    default:
      locationMap[row] = [...locationMap[row], ...[newRandomPosition]];
  }

  return startVector;
};
