function isElementRightOfMouse(element: HTMLElement, event: MouseEvent): boolean {
  const mouseX = event.pageX;
  const elementCenterX = element.offsetLeft + element.offsetWidth / 2;
  return mouseX < elementCenterX;
}
function getDistanceToClosestSide(element: HTMLElement, mouse: MouseEvent): number {
  const elementX = element.offsetLeft;
  const elementY = element.offsetTop;
  const elementWidth = element.clientWidth;
  const elementHeight = element.clientHeight;

  const elementCenterX = elementX + elementWidth / 2;
  const elementCenterY = elementY + elementHeight / 2;

  const distanceX = Math.abs(mouse.pageX - elementCenterX);
  const distanceY = Math.abs(mouse.pageY - elementCenterY);

  if (distanceX <= elementWidth / 2 && distanceY <= elementHeight / 2) {
    return 0; // Inside the element
  }

  const distanceToClosestSide = Math.sqrt(
    Math.pow(Math.max(distanceX - elementWidth / 2, 0), 2) + Math.pow(Math.max(distanceY - elementHeight / 2, 0), 2)
  );

  return distanceToClosestSide;
}

export const animateDisperseElement = (element: HTMLElement, mouse: MouseEvent) => {
  const targetDist = 60;

  const distanceToTarget = getDistanceToClosestSide(element, mouse);

  if (distanceToTarget < targetDist) {
    if (isElementRightOfMouse(element, mouse)) {
      return Math.abs(distanceToTarget - targetDist);
    } else {
      return Math.abs(distanceToTarget - targetDist) * -1;
    }
  } else {
    if (distanceToTarget > targetDist && parseInt(element?.dataset?.homeX as string) != element.offsetLeft) {
      return parseInt(element?.dataset?.homeX as string) - element.offsetLeft;
    } else {
      return 0;
    }
  }
};
