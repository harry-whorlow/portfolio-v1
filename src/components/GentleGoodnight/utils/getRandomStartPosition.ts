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
  let randomPoint = (window.screen.width - element.clientWidth) * Math.random();
  let startVector: number;

  if (randomPoint > element.offsetLeft) {
    startVector = randomPoint - element.offsetLeft;
  } else {
    startVector = (element.offsetLeft - randomPoint) * -1;
  }

  const newRandomPosition: PositionType = [randomPoint - 5, randomPoint + element.clientWidth];

  switch (true) {
    case locationMap[element.offsetTop] == undefined:
      locationMap[element.offsetTop] = [newRandomPosition];
      break;

    case locationMap[element.offsetTop].some((existingPosition) =>
      checkCellBounds(newRandomPosition, existingPosition)
    ):
      startVector = getRandomStartPosInt(element, locationMap);
      break;

    default:
      locationMap[element.offsetTop] = [...locationMap[element.offsetTop], ...[newRandomPosition]];
  }

  return startVector;
};
