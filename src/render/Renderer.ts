import {
  ACESFilmicToneMapping, AmbientLight, Color, DirectionalLight, FogExp2, HalfFloatType, HemisphereLight, Material,
  PCFShadowMap, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Quality } from '../core/Settings';

/** Afternoon sun behind the shooter's right shoulder: downrange is lit, never into the glare. */
const SUN_ELEVATION = 38, SUN_AZIMUTH = 60;
export const HAZE = new Color(0xb8c4cf);

/**
 * Owns the WebGL renderer and everything about how the frame looks:
 * physical sky + image-based lighting from it, cascaded sun shadows (high) or one shadow map (low),
 * exponential haze, and post (MSAA or SMAA, subtle bloom, ACES tone mapping).
 * The first-person weapon is drawn in a second pass with its own camera so it never clips into walls.
 */
export class Renderer {
  readonly gl: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly vmScene = new Scene();
  readonly vmCamera: PerspectiveCamera;
  readonly sunDir: Vector3;
  private composer: EffectComposer;
  private csm: CSM | null = null;
  private sun: DirectionalLight | null = null;
  private bloom: UnrealBloomPass;
  private sky: Sky;

  constructor(readonly quality: Quality) {
    const high = quality === 'high';
    this.gl = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.gl.setPixelRatio(Math.min(devicePixelRatio, high ? 2 : 1));
    this.gl.setSize(innerWidth, innerHeight);
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 0.95;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = PCFShadowMap;
    document.body.prepend(this.gl.domElement);

    this.camera = new PerspectiveCamera(80, innerWidth / innerHeight, 0.05, 2000);
    this.vmCamera = new PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 10);

    // Sun direction from elevation/azimuth (pointing FROM the sun toward the ground).
    const phi = (90 - SUN_ELEVATION) * Math.PI / 180, theta = SUN_AZIMUTH * Math.PI / 180;
    const toSun = new Vector3().setFromSphericalCoords(1, phi, theta);
    this.sunDir = toSun.clone().negate();

    // Physical sky, also baked into a PMREM environment map for image-based lighting.
    // The stock shader is calibrated for exposure ~0.5, so its radiance is scaled down to sit with our lighting.
    const makeSky = (sunDisc: boolean) => {
      const s = new Sky();
      s.scale.setScalar(1600); // follows the camera, so this only has to fit inside the far plane
      const u = s.material.uniforms;
      u.turbidity.value = 4.5;
      u.rayleigh.value = 1.4;
      u.mieCoefficient.value = 0.004;
      u.mieDirectionalG.value = 0.82;
      u.cloudCoverage.value = 0.35;
      u.showSunDisc.value = sunDisc ? 1 : 0;
      u.sunPosition.value.copy(toSun);
      s.material.fragmentShader = s.material.fragmentShader.replace(
        'gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * 0.42, 1.0 );');
      return s;
    };
    const sky = makeSky(true);
    // Bake the environment without the sun disc: the sun's light comes from the shadowed directional light instead,
    // and a disc thousands of times brighter than the sky would wash every reflection out.
    const pmrem = new PMREMGenerator(this.gl);
    const skyScene = new Scene();
    skyScene.add(makeSky(false));
    const env = pmrem.fromScene(skyScene, 0.02).texture;
    pmrem.dispose();
    this.scene.add(sky);
    this.sky = sky;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.55;
    this.scene.fog = new FogExp2(HAZE, 0.0019);

    this.scene.add(new HemisphereLight(0xcfe0f5, 0x5a5040, 0.35));
    if (high) {
      this.csm = new CSM({
        maxFar: 260, cascades: 3, mode: 'practical', parent: this.scene, shadowMapSize: 2048,
        lightDirection: this.sunDir, camera: this.camera, lightIntensity: 3.2, lightMargin: 120, shadowBias: -0.00012,
      });
      this.csm.fade = true;
      for (const l of this.csm.lights) l.shadow.normalBias = 0.02;
    } else {
      const sun = new DirectionalLight(0xfff1dc, 3.2);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const c = sun.shadow.camera;
      c.left = c.bottom = -45; c.right = c.top = 45; c.near = 1; c.far = 400;
      sun.shadow.bias = -0.0003;
      sun.shadow.normalBias = 0.03;
      this.scene.add(sun, sun.target);
      this.sun = sun;
    }

    // Viewmodel lighting mirrors the world so the gun sits in the same light.
    this.vmScene.environment = env;
    this.vmScene.environmentIntensity = 0.6;
    const vmSun = new DirectionalLight(0xfff1dc, 2.4);
    vmSun.position.copy(toSun);
    this.vmScene.add(vmSun, new AmbientLight(0xffffff, 0.15));

    // Post: world pass, weapon pass on top (depth cleared), bloom, AA, tone mapping.
    const size = this.gl.getDrawingBufferSize(new Vector2());
    const rt = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: high ? 4 : 0 });
    this.composer = new EffectComposer(this.gl, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const vmPass = new RenderPass(this.vmScene, this.vmCamera);
    vmPass.clear = false;
    vmPass.clearDepth = true;
    this.composer.addPass(vmPass);
    this.bloom = new UnrealBloomPass(new Vector2(innerWidth, innerHeight), 0.22, 0.4, 1.1);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    if (!high) this.composer.addPass(new SMAAPass());

    addEventListener('resize', () => this.resize());
  }

  /** Every lit world material must pass through here so cascaded shadows can patch its shader. */
  setupMaterial<T extends Material>(m: T): T {
    this.csm?.setupMaterial(m);
    return m;
  }

  setFov(fov: number) {
    if (Math.abs(this.camera.fov - fov) < 1e-3) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.csm?.updateFrustums();
  }

  /** A larger near plane up in the air keeps distant ground layers from z-fighting. */
  setNear(n: number) {
    if (Math.abs(this.camera.near - n) < 1e-3) return;
    this.camera.near = n;
    this.camera.updateProjectionMatrix();
    this.csm?.updateFrustums();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.gl.setSize(w, h);
    this.composer.setSize(w, h);
    for (const c of [this.camera, this.vmCamera]) { c.aspect = w / h; c.updateProjectionMatrix(); }
    this.csm?.updateFrustums();
  }

  render() {
    this.sky.position.copy(this.camera.position);
    if (this.csm) this.csm.update();
    else if (this.sun) {
      // Keep the single shadow frustum centred on the player, snapped to texels to stop shimmering.
      const p = this.camera.position, step = 90 / 2048;
      const cx = Math.round(p.x / step) * step, cz = Math.round(p.z / step) * step;
      this.sun.target.position.set(cx, 0, cz);
      this.sun.position.set(cx, 0, cz).addScaledVector(this.sunDir, -150);
    }
    this.composer.render();
  }
}
