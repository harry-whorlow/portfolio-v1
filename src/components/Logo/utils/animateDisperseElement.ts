function isElementRightOfMouse(element: HTMLElement, event: MouseEvent): boolean {
  const mouseX = event.clientX;
  const elementCenterX = element.getBoundingClientRect().left + element.offsetWidth / 2;
  return mouseX < elementCenterX;
}
function getDistanceToClosestSide(element: HTMLElement, mouse: MouseEvent): number {
  const rect = element.getBoundingClientRect();
  const elementX = rect.left;
  const elementY = rect.top;
  const elementWidth = rect.width;
  const elementHeight = rect.height;

  const elementCenterX = elementX + elementWidth / 2;
  const elementCenterY = elementY + elementHeight / 2;

  const distanceX = Math.abs(mouse.clientX - elementCenterX);
  const distanceY = Math.abs(mouse.clientY - elementCenterY);

  if (distanceX <= elementWidth / 2 && distanceY <= elementHeight / 2) {
    return 0; // Inside the element
  }

  const distanceToClosestSide = Math.sqrt(
    Math.pow(Math.max(distanceX - elementWidth / 2, 0), 2) + Math.pow(Math.max(distanceY - elementHeight / 2, 0), 2)
  );

  return distanceToClosestSide;
}

export const animateDisperseElement = (element: HTMLElement, mouse: MouseEvent) => {
  const targetDist = 150;

  const distanceToTarget = getDistanceToClosestSide(element, mouse);

  if (distanceToTarget < targetDist) {
    if (isElementRightOfMouse(element, mouse)) {
      return Math.abs(distanceToTarget - targetDist);
    } else {
      return Math.abs(distanceToTarget - targetDist) * -1;
    }
  } else {
    const elementLeft = element.getBoundingClientRect().left;

    if (distanceToTarget > targetDist && parseInt(element?.dataset?.homeX as string) != elementLeft) {
      return parseInt(element?.dataset?.homeX as string) - elementLeft;
    } else return 0;
  }
};
