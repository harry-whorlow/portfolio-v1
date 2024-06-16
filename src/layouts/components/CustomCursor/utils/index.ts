export const fadeIn = ({
  opacity,
  mouse,
  babyMouse,
}: {
  opacity: number;
  mouse: HTMLElement;
  babyMouse: HTMLElement;
}) => {
  if (opacity < 1) {
    opacity += 0.1;
    setTimeout(function () {
      fadeIn({ opacity, mouse, babyMouse });
    }, 200);
  }

  mouse.style.opacity = opacity.toString();
  babyMouse.style.opacity = opacity.toString();
};
