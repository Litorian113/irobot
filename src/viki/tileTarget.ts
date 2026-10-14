/** Where each tile sits on the live face. Tiles outside the head are not drawn. */
export const TILE_TARGET_GLSL = /* glsl */ `
uniform sampler2D uFront, uBack;
uniform float uCell, uFill, uStep, uTime, uVariation, uExtent, uCenterY;
uniform vec3 uHeadOffset, uHeadScale;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
struct TileTarget { vec3 head; float valid; float free; float seed; };
TileTarget tileTarget(vec2 aCell, float aBack) {
  vec2 uv = aCell * 0.5 + 0.5;
  vec4 face = texture2D(uFront, uv);
  vec4 rear = texture2D(uBack, vec2(1.0 - uv.x, uv.y));
  vec2 cellPosition = aCell * uExtent + vec2(0.0, uCenterY);
  float localY = (cellPosition.y - uHeadOffset.y) * 0.29 / uHeadScale.y;
  float valid = step(0.35, face.b) * step(-0.11, localY);
  float seed = hash(aCell + aBack * 3.1);
  float r2 = hash(aCell.yx + 4.7 + aBack);
  float r3 = hash(aCell + 11.3 + aBack);
  float zFront = floor(face.r / uStep) * uStep;
  float zBack = floor(rear.r / uStep) * uStep;
  if (aBack > 0.5) valid *= step(0.35, rear.b);
  vec3 assembled = vec3(cellPosition, mix(zFront, zBack, aBack));
  // The crown opens into a few flakes hovering around the head; the facial landmarks stay intact.
  float crown = smoothstep(0.85, 1.15, localY);
  float loose = step(seed, crown * (0.65 + uVariation * 0.45));
  loose = max(loose, step(0.996, r3));
  float orbit = r2 * 6.283185;
  vec3 floating = vec3(cos(orbit) * uExtent * (0.70 + r3 * 0.22),
    uCenterY + sin(orbit) * uExtent * 0.72, (r3 - 0.5) * 0.7);
  floating += vec3(sin(uTime * 0.32 + r2 * 30.0),
    sin(uTime * 0.5 + r3 * 20.0), cos(uTime * 0.3 + r2 * 10.0)) * 0.025;
  float hovering = step(0.84, hash(aCell + 42.9 + aBack));
  assembled = mix(assembled, floating, loose);
  // Loose pieces that do not hover are simply left out.
  valid *= 1.0 - loose * (1.0 - hovering);
  return TileTarget(assembled, valid, loose, seed);
}
`;
