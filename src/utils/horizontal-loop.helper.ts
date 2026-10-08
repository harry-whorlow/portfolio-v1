import gsap from 'gsap';

interface HorizontalLoopConfig {
  speed?: number;
  paused?: boolean;
  repeat?: number;
  reversed?: boolean;
  paddingRight?: number;
  snap?: number | false;
  center?: boolean | Element | string;
  onChange?: (element: HTMLElement, index: number) => void;
}

interface HorizontalLoopTimeline extends gsap.core.Timeline {
  next: (vars?: gsap.TweenVars) => gsap.core.Tween | gsap.core.Timeline;
  previous: (vars?: gsap.TweenVars) => gsap.core.Tween | gsap.core.Timeline;
  toIndex: (index: number, vars?: gsap.TweenVars) => gsap.core.Tween | gsap.core.Timeline;
  current: () => number;
  closestIndex: (setCurrent?: boolean) => number;
  times: number[];
  // removes the resize listener and reverts every inline style the loop set
  destroy: () => void;
}

// Port of GSAP's responsive horizontalLoop helper: https://gsap.com/docs/v3/HelperFunctions/helpers/seamlessLoop
export function horizontalLoop(
  items: Element[] | NodeListOf<Element> | string,
  config: HorizontalLoopConfig = {}
): HorizontalLoopTimeline {
  const elements = gsap.utils.toArray<HTMLElement>(items);
  let timeline!: HorizontalLoopTimeline;

  // context so the resize listener is cleaned up if this is called inside another context / matchMedia
  const ctx = gsap.context(() => {
    const onChange = config.onChange;
    let lastIndex = 0;
    const tl = gsap.timeline({
      repeat: config.repeat,
      paused: config.paused,
      defaults: { ease: 'none' },
      onUpdate: onChange
        ? () => {
            const i = tl.closestIndex();
            if (lastIndex !== i) {
              lastIndex = i;
              onChange(elements[i], i);
            }
          }
        : undefined,
      onReverseComplete: () => {
        tl.totalTime(tl.rawTime() + tl.duration() * 100);
      },
    }) as HorizontalLoopTimeline;

    const length = elements.length;
    const startX = elements[0].offsetLeft;
    const times: number[] = [];
    const widths: number[] = [];
    const spaceBefore: number[] = [];
    const xPercents: number[] = [];
    let curIndex = 0;
    const center = config.center;
    const pixelsPerSecond = (config.speed || 1) * 100;
    const snap = config.snap === false ? (v: number) => v : gsap.utils.snap(config.snap || 1);
    let timeOffset = 0;
    const container =
      center === true || !center
        ? (elements[0].parentNode as HTMLElement)
        : gsap.utils.toArray<HTMLElement>(center)[0] || (elements[0].parentNode as HTMLElement);
    let totalWidth = 0;
    let timeWrap: (value: number) => number = (v) => v;

    const getTotalWidth = () => {
      const last = elements[length - 1];
      return (
        last.offsetLeft +
        (xPercents[length - 1] / 100) * widths[length - 1] -
        startX +
        spaceBefore[0] +
        last.offsetWidth * (gsap.getProperty(last, 'scaleX') as number) +
        // offsetWidth stops at the border box, so the gap after the last item has to be added back for the seam
        (parseFloat(getComputedStyle(last).marginRight) || 0) +
        (config.paddingRight || 0)
      );
    };

    // convert "x" to "xPercent" so things stay responsive, and cache widths/xPercents for fast lookups
    const populateWidths = () => {
      let b1 = container.getBoundingClientRect();
      let b2: DOMRect;
      elements.forEach((el, i) => {
        widths[i] = parseFloat(gsap.getProperty(el, 'width', 'px') as string);
        xPercents[i] = snap(
          (parseFloat(gsap.getProperty(el, 'x', 'px') as string) / widths[i]) * 100 +
            (gsap.getProperty(el, 'xPercent') as number)
        );
        b2 = el.getBoundingClientRect();
        spaceBefore[i] = b2.left - (i ? b1.right : b1.left);
        b1 = b2;
      });
      gsap.set(elements, { xPercent: (i) => xPercents[i] });
      totalWidth = getTotalWidth();
    };

    const populateOffsets = () => {
      timeOffset = center ? (tl.duration() * (container.offsetWidth / 2)) / totalWidth : 0;
      if (center) {
        times.forEach((_, i) => {
          times[i] = timeWrap(tl.labels[`label${i}`] + (tl.duration() * widths[i]) / 2 / totalWidth - timeOffset);
        });
      }
    };

    const getClosest = (values: number[], value: number, wrap: number) => {
      let i = values.length;
      let closest = 1e10;
      let index = 0;
      while (i--) {
        let d = Math.abs(values[i] - value);
        if (d > wrap / 2) d = wrap - d;
        if (d < closest) {
          closest = d;
          index = i;
        }
      }
      return index;
    };

    const populateTimeline = () => {
      tl.clear();
      for (let i = 0; i < length; i++) {
        const item = elements[i];
        const curX = (xPercents[i] / 100) * widths[i];
        const distanceToStart = item.offsetLeft + curX - startX + spaceBefore[0];
        const distanceToLoop = distanceToStart + widths[i] * (gsap.getProperty(item, 'scaleX') as number);

        tl.to(
          item,
          { xPercent: snap(((curX - distanceToLoop) / widths[i]) * 100), duration: distanceToLoop / pixelsPerSecond },
          0
        )
          .fromTo(
            item,
            { xPercent: snap(((curX - distanceToLoop + totalWidth) / widths[i]) * 100) },
            {
              xPercent: xPercents[i],
              duration: (curX - distanceToLoop + totalWidth - curX) / pixelsPerSecond,
              immediateRender: false,
            },
            distanceToLoop / pixelsPerSecond
          )
          .add(`label${i}`, distanceToStart / pixelsPerSecond);

        times[i] = distanceToStart / pixelsPerSecond;
      }
      timeWrap = gsap.utils.wrap(0, tl.duration());
    };

    // re-measure and rebuild while keeping the playhead where it was
    const refresh = (deep: boolean) => {
      const progress = tl.progress();
      tl.progress(0, true);
      populateWidths();
      if (deep) populateTimeline();
      populateOffsets();
      tl.progress(progress, true);
    };

    const onResize = () => refresh(true);

    gsap.set(elements, { x: 0 });
    populateWidths();
    populateTimeline();
    populateOffsets();
    window.addEventListener('resize', onResize);

    function toIndex(index: number, vars: gsap.TweenVars = {}) {
      // always go in the shortest direction
      if (Math.abs(index - curIndex) > length / 2) {
        index += index > curIndex ? -length : length;
      }
      const newIndex = gsap.utils.wrap(0, length, index);
      let time = times[newIndex];

      // wrapping the playhead
      if (time > tl.time() !== index > curIndex && index !== curIndex) {
        time += tl.duration() * (index > curIndex ? 1 : -1);
      }
      if (time < 0 || time > tl.duration()) {
        vars.modifiers = { time: timeWrap };
      }

      curIndex = newIndex;
      vars.overwrite = true;
      return vars.duration === 0 ? tl.time(timeWrap(time)) : tl.tweenTo(time, vars);
    }

    tl.toIndex = (index, vars) => toIndex(index, vars);
    tl.closestIndex = (setCurrent) => {
      const index = getClosest(times, tl.time(), tl.duration());
      if (setCurrent) curIndex = index;
      return index;
    };
    tl.current = () => curIndex;
    tl.next = (vars) => toIndex(tl.current() + 1, vars);
    tl.previous = (vars) => toIndex(tl.current() - 1, vars);
    tl.times = times;

    // pre-render for performance
    tl.progress(1, true).progress(0, true);

    if (config.reversed) {
      tl.vars.onReverseComplete?.();
      tl.reverse();
    }

    tl.closestIndex(true);
    lastIndex = curIndex;
    onChange?.(elements[curIndex], curIndex);

    timeline = tl;

    return () => window.removeEventListener('resize', onResize);
  });

  timeline.destroy = () => ctx.revert();

  return timeline;
}
