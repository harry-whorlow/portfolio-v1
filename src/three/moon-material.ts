import * as THREE from "three";

const RAMP = ["#2b1a5e", "#2f4fa8", "#2a9bb5", "#55b86b", "#d8c95a", "#d9813a", "#b8402e", "#f4ede4"];
const CONTOUR_INTERVAL_KM = 0.25;
const FILL_COLOR = "#090b10";

export interface TopoMaterial extends THREE.MeshBasicMaterial {
  setHeatmap(enabled: boolean): void;
}

export function createTopoMaterial(heightMap: THREE.DataTexture, minKm: number, maxKm: number, heatmap: boolean): TopoMaterial {
  const uniforms = {
    uHeightMap: { value: heightMap },
    uMinKm: { value: minKm },
    uMaxKm: { value: maxKm },
    uContourInterval: { value: CONTOUR_INTERVAL_KM },
    uRamp: { value: RAMP.map((hex) => new THREE.Color(hex)) },
    uHeatmap: { value: heatmap },
    uFillColor: { value: new THREE.Color(FILL_COLOR) },
  };

  const material = new THREE.MeshBasicMaterial() as TopoMaterial;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 gridUv;\nvarying vec2 vGridUv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGridUv = gridUv;");

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        #define RAMP_SIZE ${RAMP.length}
        uniform sampler2D uHeightMap;
        uniform float uMinKm;
        uniform float uMaxKm;
        uniform float uContourInterval;
        uniform vec3 uRamp[RAMP_SIZE];
        uniform bool uHeatmap;
        uniform vec3 uFillColor;
        varying vec2 vGridUv;

        float heightAt(ivec2 p, ivec2 size) {
          p.x = (p.x % size.x + size.x) % size.x;
          p.y = clamp(p.y, 0, size.y - 1);
          return texelFetch(uHeightMap, p, 0).r;
        }

        vec4 bspline(float f) {
          float f2 = f * f;
          float f3 = f2 * f;
          return vec4(
            (1.0 - 3.0 * f + 3.0 * f2 - f3),
            (4.0 - 6.0 * f2 + 3.0 * f3),
            (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3),
            f3
          ) / 6.0;
        }

        float smoothHeight(vec2 uv) {
          ivec2 size = textureSize(uHeightMap, 0);
          vec2 p = uv * vec2(float(size.x), float(size.y - 1));
          vec2 cell = floor(p);
          vec2 f = p - cell;
          ivec2 base = ivec2(cell) - 1;
          vec4 wx = bspline(f.x);
          vec4 wy = bspline(f.y);
          float h = 0.0;
          for (int y = 0; y < 4; y++) {
            float row = 0.0;
            for (int x = 0; x < 4; x++) {
              row += wx[x] * heightAt(base + ivec2(x, y), size);
            }
            h += wy[y] * row;
          }
          return h;
        }

        vec3 ramp(float t) {
          float x = clamp(t, 0.0, 1.0) * float(RAMP_SIZE - 1);
          int i = int(min(floor(x), float(RAMP_SIZE - 2)));
          return mix(uRamp[i], uRamp[i + 1], x - float(i));
        }

        float contour(float h, float interval, float width) {
          float t = h / interval;
          float d = abs(fract(t - 0.5) - 0.5) / fwidth(t);
          float halfWidth = 0.5 * width;
          return clamp(min(d + 0.5, halfWidth) - max(d - 0.5, -halfWidth), 0.0, 1.0);
        }`,
      )
      .replace(
        "#include <opaque_fragment>",
        /* glsl */ `float vHeight = smoothHeight(vGridUv);
        float heightT = clamp((vHeight - uMinKm) / (uMaxKm - uMinKm), 0.0, 1.0);
        vec3 baseColor = uHeatmap ? ramp(heightT) : vec3(1.0);
        vec3 minorColor = uHeatmap ? baseColor : vec3(mix(0.15, 1.0, heightT));
        float minorLine = contour(vHeight, uContourInterval, 0.6);
        float majorLine = contour(vHeight, uContourInterval * 5.0, 1.2);
        outgoingLight = mix(uFillColor, minorColor, minorLine * 0.6);
        outgoingLight = mix(outgoingLight, baseColor, majorLine);
        #include <opaque_fragment>`,
      );
  };

  material.setHeatmap = (enabled) => {
    uniforms.uHeatmap.value = enabled;
  };

  return material;
}
