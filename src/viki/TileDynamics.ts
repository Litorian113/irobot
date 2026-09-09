import * as THREE from 'three'
import { GPUComputationRenderer, type Variable } from 'three/addons/misc/GPUComputationRenderer.js'
import { TILE_TARGET_GLSL } from './tileTarget'

const COMMON = /* glsl */ `
${TILE_TARGET_GLSL}
uniform float uDt, uElapsed, uAwake, uRelease, uReset;
void inputs(out vec2 uv, out vec2 cell, out float back) {
  uv = gl_FragCoord.xy / resolution.xy;
  back = floor(uv.y * 2.0);
  cell = vec2(uv.x, fract(uv.y * 2.0)) * 2.0 - 1.0;
}
// Gravity, bounce, ground friction and tumbling - shared by the shutdown fall
// and by unused tiles dropping out of the levitation once the head gathers.
void fallStep(inout vec4 v, vec4 p, float seed, float r2) {
  float floorY = tileFloor(p.xz);
  // A tile already lying on the ground stays put at any step size. Without
  // this, one large frame step accumulates enough fall speed to cross the
  // bounce threshold every frame - endless skittering on the floor.
  if (p.y <= floorY + 0.002 && v.y <= 0.0 && -v.y <= 9.8*uDt*1.25 && length(v.xz) < 0.02) {
    v.xyz = vec3(0.0);
    v.w *= exp(-uDt*8.0);
    return;
  }
  v.y -= 9.8*uDt;
  if (p.y+v.y*uDt <= floorY && v.y < 0.0) {
    float impact = -v.y;
    // Restitution varies per tile; subsequent impacts die out naturally.
    v.y = impact > 0.24 ? impact*(0.24+seed*0.17) : 0.0;
    if (impact > 0.24) {
      v.xz += vec2(seed-0.5,r2-0.5)*impact*0.18;
      v.w += impact*(r2-0.5)*0.35;
    }
  }
  if (p.y < floorY+uCell*1.6) {
    v.xz *= exp(-uDt*5.0);
    if (length(v.xz)<0.012) v.xz=vec2(0.0);
  } else v.xz *= exp(-uDt*0.25);
  // Integrated tumbling continues through bounces and comes to rest with speed.
  v.w += (length(v.xyz)*2.8)*(r2<0.5 ? -1.0 : 1.0)*uDt;
}
`;

const POSITION = /* glsl */ `
${COMMON}
void main() {
  vec2 uv, cell; float back; inputs(uv,cell,back);
  TileTarget tile = tileTarget(cell,back);
  vec4 p = texture2D(texturePosition,uv);
  vec4 v = texture2D(textureVelocity,uv);
  if (uReset > 0.5) {
    vec3 rest = tile.rest;
    rest.y = tileFloor(rest.xz) + hash(cell+7.3)*uCell*2.0;
    gl_FragColor = vec4(rest,0.0); return;
  }
  p.xyz += v.xyz * uDt;
  p.y = max(p.y,tileFloor(p.xz));
  // The face releases immediately; no per-tile delay on the way down.
  if (uAwake < 0.5) p.w = max(0.0,p.w-uDt*5.0);
  else if (length(tile.head-tile.rest) < 0.001) {
    // Unused tiles never assemble: they drop back and must not snap anywhere.
    p.w = 0.0;
  } else {
    float gathered = smoothstep(1.6,3.1,uElapsed);
    p.w = min(gathered, p.w + uDt*1.8);
    if (p.w > 0.999) p.xyz = tile.head;
  }
  gl_FragColor = p;
}
`;

const VELOCITY = /* glsl */ `
${COMMON}
void main() {
  vec2 uv, cell; float back; inputs(uv,cell,back);
  vec4 p = texture2D(texturePosition,uv);
  vec4 v = texture2D(textureVelocity,uv);
  if (uReset > 0.5) { gl_FragColor=vec4(0.0); return; }
  float seed = hash(cell+back*3.1);
  float r2 = hash(cell.yx+4.7+back);
  if (uAwake > 0.5) {
    TileTarget tile = tileTarget(cell,back);
    // Levitation first: lift above the piles before drawing the tiles into the face.
    float delay = seed*0.42;
    float age = max(0.0,uElapsed-delay);
    float gather = smoothstep(0.5,2.25,age);
    if (length(tile.head-tile.rest) < 0.001 && age > 0.85) {
      // This tile is not part of the head: after riding the levitation up,
      // it simply falls - same gravity and bounces as the shutdown.
      fallStep(v, p, seed, r2);
      gl_FragColor=v; return;
    }
    vec3 lifted = vec3(p.x, max(tile.rest.y+0.38,tile.head.y*0.5), p.z);
    vec3 goal = mix(lifted,tile.head,gather);
    float magic = sin(clamp(age/2.6,0.0,1.0)*3.141593);
    goal += magic * vec3(sin(age*1.4+r2*15.0)*0.13,
      sin(age*1.1+seed*8.0)*0.035, cos(age*1.4+r2*15.0)*0.10);
    float stiffness = mix(9.0,65.0,gather);
    vec3 force = (goal-p.xyz)*stiffness-v.xyz*(2.0*sqrt(stiffness));
    v.xyz += force*uDt;
    v.w *= exp(-uDt*2.8);
    if (p.w>0.999) v.xyz=vec3(0.0);
  } else {
    if (uRelease > 0.5) {
      v.xyz += vec3((seed-0.5)*0.13,-0.35,(r2-0.5)*0.12);
    }
    fallStep(v, p, seed, r2);
  }
  gl_FragColor=v;
}
`;

/** GPU gravity + mound contacts; no expensive all-pairs rigid-body solver. */
export class TileDynamics {
  private gpu: GPUComputationRenderer
  private positions: Variable
  private velocities: Variable
  private first = true
  private uniforms: Record<string, THREE.IUniform>

  constructor(renderer: THREE.WebGLRenderer, count: number, shared: Record<string, THREE.IUniform>) {
    this.gpu = new GPUComputationRenderer(count,count*2,renderer)
    this.uniforms = { ...shared, uDt:{value:0},uElapsed:{value:0},uAwake:{value:0},uRelease:{value:0},uReset:{value:1} }
    this.positions = this.gpu.addVariable('texturePosition',POSITION,this.gpu.createTexture())
    this.velocities = this.gpu.addVariable('textureVelocity',VELOCITY,this.gpu.createTexture())
    for (const variable of [this.positions,this.velocities]) {
      Object.assign(variable.material.uniforms,this.uniforms)
      this.gpu.setVariableDependencies(variable,[this.positions,this.velocities])
    }
    const error = this.gpu.init()
    if (error) { this.gpu.dispose(); throw new Error(`Tile dynamics: ${error}`) }
  }

  step(dt: number, awake: boolean, elapsed: number, release: boolean) {
    // Once settled, keep the state textures without spending compute on idle tiles.
    if (!this.first && !awake && elapsed > 7 && !release) return
    const u = this.uniforms
    u.uAwake.value = awake ? 1 : 0
    u.uElapsed.value = elapsed
    if (this.first) {
      u.uReset.value=1
      this.gpu.compute()
      u.uReset.value=0
      this.first=false
    }
    // Fine substeps until every straggler has landed (~8s); the coarse
    // single-step mode afterwards is safe because resting tiles are clamped.
    const steps = awake && elapsed > 8 ? 1 : Math.max(1,Math.ceil(Math.min(dt,0.1)/(1/90)))
    u.uDt.value = Math.min(dt,0.1)/steps
    for (let i=0;i<steps;i++) {
      u.uRelease.value=release && i===0 ? 1 : 0
      this.gpu.compute()
    }
  }

  get position() { return this.gpu.getCurrentRenderTarget(this.positions).texture }
  get velocity() { return this.gpu.getCurrentRenderTarget(this.velocities).texture }
  dispose() { this.gpu.dispose() }
}
