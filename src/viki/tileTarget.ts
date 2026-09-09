/** Shared target sampling keeps simulated tiles attached to the live speaking face. */
export const TILE_TARGET_GLSL = /* glsl */ `
uniform sampler2D uFront, uBack;
uniform float uCell, uFill, uStep, uTime, uVariation, uExtent, uCenterY, uFloor;
uniform vec3 uHeadOffset, uHeadScale;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
struct TileTarget { vec3 head; vec3 rest; float valid; float free; float seed; };
TileTarget tileTarget(vec2 aCell, float aBack) {
  vec2 uv = aCell * 0.5 + 0.5;
  vec4 face = texture2D(uFront, uv);
  vec4 rear = texture2D(uBack, vec2(1.0 - uv.x, uv.y));
  vec2 cellPosition = aCell * uExtent + vec2(0.0, uCenterY);
  float localY = (cellPosition.y - uHeadOffset.y) * 0.29 / uHeadScale.y;
  float valid = step(0.08, face.b) * step(-0.11, localY);
  float seed = hash(aCell + aBack * 3.1);
  float r2 = hash(aCell.yx + 4.7 + aBack);
  float r3 = hash(aCell + 11.3 + aBack);
  float zFront = floor(face.r / uStep) * uStep;
  float zBack = floor(rear.r / uStep) * uStep;
  if (aBack > 0.5) valid *= step(0.08, rear.b);
  vec3 assembled = vec3(cellPosition, mix(zFront, zBack, aBack));
  // The crown opens into scattered flakes; the facial landmarks stay intact.
  float crown = smoothstep(0.85, 1.15, localY);
  float loose = step(seed, crown * (0.65 + uVariation * 0.45));
  loose = max(loose, step(0.996, r3));
  float orbit = r2 * 6.283185;
  vec3 floating = vec3(cos(orbit) * uExtent * (0.70 + r3 * 0.22),
    uCenterY + sin(orbit) * uExtent * 0.72, (r3 - 0.5) * 0.7);
  floating += vec3(sin(uTime * 0.32 + r2 * 30.0),
    sin(uTime * 0.5 + r3 * 20.0), cos(uTime * 0.3 + r2 * 10.0)) * 0.025;
  // Three reproducible low mounds. Every tile keeps its resting place.
  float mound = floor(r3 * 3.0);
  float radius = sqrt(seed) * uExtent * (0.35 + 0.07 * mound);
  float angle = r2 * 6.283185;
  vec3 resting = vec3((mound - 1.0) * uExtent * 0.63 + cos(angle) * radius,
    uFloor + 0.025 + (1.0 - seed) * (0.08 + 0.12 * hash(aCell + 25.0)),
    sin(angle) * radius * 0.6 + (mound - 1.0) * 0.09);
  // Most missing crown pieces stay on the floor; only a few hover nearby.
  float hovering = step(0.84, hash(aCell + 42.9 + aBack));
  assembled = mix(assembled, mix(resting, floating, hovering), loose);

  return TileTarget(assembled, resting, valid, loose * hovering, seed);
}
// A low collision bed represents accumulated tiles, rather than tile-pair collisions.
float tileFloor(vec2 p) {
  float height = 0.0;
  for (int i=0; i<3; i++) {
    vec2 center = vec2(float(i-1)*uExtent*0.56, float(i-1)*0.09);
    vec2 q = (p-center) / (uExtent * vec2(0.36,0.24));
    height = max(height, exp(-dot(q,q)*1.7) * (0.11 + float(i)*0.025));
  }
  return uFloor + height + uCell * 0.75;
}
`;
