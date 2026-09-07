// Quiet data field around the surface portrait. The face itself is rendered
// by SurfacePortrait so volumetric cells cannot overwrite its features.
export const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uFace;
uniform float uTurb;
uniform float uCage;
uniform float uFlicker;
uniform float uPointBase;
uniform float uCamDist;
attribute float aSeed;
varying float vIntensity;
void main() {
  vec3 p = position;
  p += sin(vec3(aSeed * 70.0, aSeed * 30.0, aSeed * 90.0) + uTime * 0.3)
       * (0.006 + 0.04 * uTurb);
  float pulse = 0.75 + 0.25 * sin(uTime * 0.6 + aSeed * 50.0);
  vIntensity = uCage * (0.10 + 0.22 * aSeed) * mix(1.0, pulse, uFlicker) * (1.0 - 0.25 * uFace);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPointBase * (uCamDist / -mv.z);
}
`

export const fragmentShader = /* glsl */ `
uniform vec3 uColorDim;
varying float vIntensity;
void main() {
  float dotMask = 1.0 - smoothstep(0.2, 0.5, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(uColorDim, dotMask * vIntensity);
}
`
