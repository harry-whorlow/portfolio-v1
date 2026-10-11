import * as THREE from 'three';

const OFFSET_UP = 5.9;
const OFFSET_LEFT = 2.7;
const ANGULAR_DIAMETER = 1.7;
const DISTANCE = 60;
const PHASE_ANGLE = 125;
const LIGHT_TILT = 6;

const OCEAN = '#5f8ccc';
const CLOUD = '#f4f7fc';
const ATMOSPHERE = '#5b8fe8';

const noise = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z
    );
  }

  float fbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * valueNoise(p);
      p *= 2.03;
      amp *= 0.5;
    }
    return sum;
  }
`;

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    vLocal = position;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const surfaceShader = /* glsl */ `
  uniform vec3 uLight;
  uniform vec3 uOcean;
  uniform vec3 uCloud;
  uniform vec3 uAtmosphere;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  ${noise}

  void main() {
    vec3 n = normalize(vNormal);
    float ndl = dot(n, uLight);
    float day = smoothstep(-0.02, 0.12, ndl);
    float clouds = smoothstep(0.32, 0.6, fbm(normalize(vLocal) * 6.0));
    vec3 surface = mix(uOcean, uCloud, clouds) * (0.6 + 0.8 * max(ndl, 0.0));
    float fresnel = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 3.0);
    vec3 color = surface * day + uAtmosphere * fresnel * smoothstep(0.0, 0.4, ndl);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const haloShader = /* glsl */ `
  uniform vec3 uLight;
  uniform vec3 uAtmosphere;
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    vec3 n = normalize(vNormal);
    // Zero at the shell's silhouette, peaking where it meets the Earth's limb (-dot = 0.27 for a 1.04 shell).
    float rim = pow(clamp(-dot(n, normalize(vView)) / 0.27, 0.0, 1.0), 2.0);
    float lit = smoothstep(0.0, 0.5, dot(n, uLight));
    gl_FragColor = vec4(uAtmosphere * rim * lit * 1.2, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createEarth(home: THREE.Camera): THREE.Object3D {
  const radius = DISTANCE * Math.tan(THREE.MathUtils.degToRad(ANGULAR_DIAMETER / 2));
  const deg = THREE.MathUtils.degToRad;

  const direction = new THREE.Vector3(-Math.tan(deg(OFFSET_LEFT)), Math.tan(deg(OFFSET_UP)), -1)
    .normalize()
    .applyQuaternion(home.quaternion);

  const phase = deg(PHASE_ANGLE);
  const tilt = deg(LIGHT_TILT);
  const light = new THREE.Vector3(Math.sin(phase) * Math.sin(tilt), Math.sin(phase) * Math.cos(tilt), Math.cos(phase))
    .normalize()
    .applyQuaternion(home.quaternion);

  const uniforms = {
    uLight: { value: light },
    uOcean: { value: new THREE.Color(OCEAN) },
    uCloud: { value: new THREE.Color(CLOUD) },
    uAtmosphere: { value: new THREE.Color(ATMOSPHERE) },
  };

  const earth = new THREE.Group();
  earth.position.copy(home.position).addScaledVector(direction, DISTANCE);

  earth.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(radius, 48, 32),
      new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader: surfaceShader })
    ),
    new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.04, 48, 32),
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader: haloShader,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      })
    )
  );
  return earth;
}
