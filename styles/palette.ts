import plugin from 'tailwindcss/plugin';

import { RAMP } from '../src/three/palette';

// Elevation colors for utilities like text-low, sourced from the contour ramp so the page always matches the shader.
export default plugin(() => {}, {
  theme: {
    extend: {
      colors: {
        low: RAMP[2],
        mid: RAMP[4],
        high: RAMP[6],
      },
    },
  },
});
