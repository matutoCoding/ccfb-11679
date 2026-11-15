// WebGPU 渲染器: 编译全屏光线追踪管线, 维护 uniform/storage 缓冲与渲染循环。
import shaderCode from './shaders.wgsl?raw';
import { ProjectData } from '../core/types';
import { waterIorAt } from '../core/waterIor';
import { Vec3, normalize, cross, sub } from '../core/vector';

// uniform 块字节布局(全部 vec4 对齐, 与 WGSL Uniforms 结构一一对应)
// 10 组 × 4 float = 40 个 f32 = 160 字节
const UNIFORM_FLOATS = 40;
const UNIFORM_BYTES = UNIFORM_FLOATS * 4;

interface FishGpu {
  center: Vec3;
  color: Vec3;
  swimRadius: number;
  swimSpeed: number;
  fishLength: number;
  count: number;
}
interface RockGpu {
  center: Vec3;
  color: Vec3;
  scale: Vec3;
}

function hexToRgb(hex: string): Vec3 {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return { x: 0.7, y: 0.7, z: 0.7 };
  return {
    x: parseInt(m[1], 16) / 255,
    y: parseInt(m[2], 16) / 255,
    z: parseInt(m[3], 16) / 255,
  };
}

export interface FpsStats {
  fps: number;
  frameMs: number;
}

export class RefractionRenderer {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private pipeline!: GPURenderPipeline;
  private uniformBuffer!: GPUBuffer;
  private fishBuffer!: GPUBuffer;
  private rockBuffer!: GPUBuffer;
  private bindGroup!: GPUBindGroup;

  private canvas: HTMLCanvasElement;
  private project: ProjectData;
  private rafId = 0;
  private running = false;
  private ready = false;
  private initPromise: Promise<void> | null = null;
  private startTime = performance.now();
  private lastFrame = performance.now();
  private fpsAccum = 0;
  private fpsFrames = 0;
  private currentFps = 0;
  private onStats?: (s: FpsStats) => void;
  private resizeObserver?: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, project: ProjectData, onStats?: (s: FpsStats) => void) {
    this.canvas = canvas;
    this.project = structuredClone(project);
    this.onStats = onStats;
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  }

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    if (!RefractionRenderer.isSupported()) {
      throw new Error('当前浏览器不支持 WebGPU, 请使用最新版 Chrome/Edge 并在安全上下文(https 或 localhost)打开');
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('未找到可用的 GPU 适配器');
    this.device = await adapter.requestDevice();
    this.device.lost.then((info) => {
      if (info.reason !== 'destroyed') console.error('GPU device lost:', info.message);
    });

    this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });

    const module = this.device.createShaderModule({ code: shaderCode });
    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vsMain' },
      fragment: { module, entryPoint: 'fsMain', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });

    this.uniformBuffer = this.device.createBuffer({
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.fishBuffer = this.makeStorageBuffer(12 * 48); // 12 个 fish, 每个 48 字节
    this.rockBuffer = this.makeStorageBuffer(32 * 48); // 32 个 rock, 每个 48 字节

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.fishBuffer } },
        { binding: 2, resource: { buffer: this.rockBuffer } },
      ],
    });

    this.uploadScene();
    this.observeResize();
    this.ready = true;
  }

  private makeStorageBuffer(size: number): GPUBuffer {
    return this.device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  }

  private observeResize(): void {
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.resize();
  }

  resize(): void {
    const scale = this.project.render.resolutionScale;
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const cssW = parent.clientWidth;
    const cssH = parent.clientHeight;
    const w = Math.max(2, Math.floor(cssW * scale));
    const h = Math.max(2, Math.floor(cssH * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** 更新项目数据(设计页/视点页改动后调用)。初始化未完成时仅缓存, 由 doInit 末尾应用 */
  updateProject(project: ProjectData): void {
    this.project = structuredClone(project);
    if (!this.ready) return;
    this.resize();
    this.uploadScene();
    if (!this.running) this.renderOnce();
  }

  private uploadScene(): void {
    const fishes: FishGpu[] = this.project.aquascape.schools.map((s) => ({
      center: { x: s.center[0], y: s.center[1], z: s.center[2] },
      color: hexToRgb(s.color),
      swimRadius: s.swimRadius,
      swimSpeed: s.swimSpeed,
      fishLength: s.fishLength,
      count: s.count,
    }));
    this.device.queue.writeBuffer(this.fishBuffer, 0, this.packFish(fishes));

    const rocks: RockGpu[] = this.project.aquascape.rocks.map((r) => ({
      center: { x: r.position[0], y: r.position[1], z: r.position[2] },
      color: hexToRgb(r.color),
      scale: { x: r.scale[0], y: r.scale[1], z: r.scale[2] },
    }));
    this.device.queue.writeBuffer(this.rockBuffer, 0, this.packRock(rocks));
  }

  // WGSL: struct Fish { center:vec3(f32)+pad, color:vec3+pad, swimRadius, swimSpeed, fishLength, count } = 48B
  private packFish(fishes: FishGpu[]): Float32Array<ArrayBuffer> {
    const data = new Float32Array(new ArrayBuffer(12 * 12 * 4));
    fishes.slice(0, 12).forEach((f, i) => {
      const o = i * 12;
      data[o] = f.center.x; data[o + 1] = f.center.y; data[o + 2] = f.center.z; data[o + 3] = 0;
      data[o + 4] = f.color.x; data[o + 5] = f.color.y; data[o + 6] = f.color.z; data[o + 7] = 0;
      data[o + 8] = f.swimRadius; data[o + 9] = f.swimSpeed; data[o + 10] = f.fishLength; data[o + 11] = f.count;
    });
    return data;
  }

  // WGSL: struct Rock { center:vec3+pad, color:vec3+pad, scale:vec3+pad, _pad } = 48B
  private packRock(rocks: RockGpu[]): Float32Array<ArrayBuffer> {
    const data = new Float32Array(new ArrayBuffer(32 * 12 * 4));
    rocks.slice(0, 32).forEach((r, i) => {
      const o = i * 12;
      data[o] = r.center.x; data[o + 1] = r.center.y; data[o + 2] = r.center.z; data[o + 3] = 0;
      data[o + 4] = r.color.x; data[o + 5] = r.color.y; data[o + 6] = r.color.z; data[o + 7] = 0;
      data[o + 8] = r.scale.x; data[o + 9] = r.scale.y; data[o + 10] = r.scale.z; data[o + 11] = 0;
    });
    return data;
  }

  private writeUniforms(timeSeconds: number): void {
    const p = this.project;
    const camPos: Vec3 = { x: p.viewpoint.position[0], y: p.viewpoint.position[1], z: p.viewpoint.position[2] };
    const target: Vec3 = { x: p.viewpoint.target[0], y: p.viewpoint.target[1], z: p.viewpoint.target[2] };
    const forward = normalize(sub(target, camPos));
    const worldUp: Vec3 = { x: 0, y: 1, z: 0 };
    const right = normalize(cross(forward, worldUp));
    const up = normalize(cross(right, forward));
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const nWater = p.optics.waterIorOverride ?? waterIorAt(p.optics.waterTemperature);
    const kind = p.geometry.kind === 'planar' ? 0 : p.geometry.kind === 'cylinder' ? 1 : 2;

    const u = new Float32Array(new ArrayBuffer(UNIFORM_BYTES));
    let i = 0;
    // camPos + pad
    u[i++] = camPos.x; u[i++] = camPos.y; u[i++] = camPos.z; u[i++] = 0;
    // camTarget + pad
    u[i++] = target.x; u[i++] = target.y; u[i++] = target.z; u[i++] = 0;
    // camRight + fovY
    u[i++] = right.x; u[i++] = right.y; u[i++] = right.z; u[i++] = p.viewpoint.fovY;
    // camUp + aspect
    u[i++] = up.x; u[i++] = up.y; u[i++] = up.z; u[i++] = aspect;
    // geometry: kind, thickness, radius, depth
    u[i++] = kind; u[i++] = p.geometry.wallThickness; u[i++] = p.geometry.radius; u[i++] = p.geometry.depth;
    // optics
    u[i++] = p.optics.airIor; u[i++] = p.optics.acrylicIor; u[i++] = p.optics.waterTemperature;
    u[i++] = p.optics.waterIorOverride ?? -1;
    // render params
    u[i++] = timeSeconds; u[i++] = p.render.exposure;
    u[i++] = p.render.showGrid ? 1 : 0; u[i++] = p.render.debugRay ? 1 : 0;
    u[i++] = p.render.animateFish ? 1 : 0; u[i++] = p.render.resolutionScale;
    u[i++] = p.aquascape.schools.length; u[i++] = p.aquascape.rocks.length;
    u[i++] = p.aquascape.gridDensity; u[i++] = p.aquascape.referenceDistance;
    u[i++] = this.canvas.width; u[i++] = this.canvas.height;
    u[i++] = nWater; u[i++] = 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, u);
  }

  private frame = (): void => {
    if (!this.running) return;
    this.renderFrame();
    this.rafId = requestAnimationFrame(this.frame);
  };

  private renderFrame(): void {
    const now = performance.now();
    const elapsed = (now - this.startTime) / 1000;
    const timeSeconds = this.project.render.animateFish ? elapsed : 0;
    this.writeUniforms(timeSeconds);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.02, g: 0.05, b: 0.08, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    // FPS 统计(每 0.5s 刷新一次)
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 500) {
      this.currentFps = (this.fpsFrames * 1000) / this.fpsAccum;
      this.onStats?.({ fps: this.currentFps, frameMs: this.fpsAccum / this.fpsFrames });
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
  }

  /** 静态渲染一帧(动画暂停时) */
  renderOnce(): void {
    if (!this.ready) return;
    this.writeUniforms(0);
    this.renderFrame();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** 截图: 返回当前画布的 PNG dataURL */
  async capturePng(): Promise<string> {
    if (!this.ready) return '';
    this.renderFrame();
    await this.device.queue.onSubmittedWorkDone();
    return this.canvas.toDataURL('image/png');
  }

  getFps(): number {
    return this.currentFps;
  }

  destroy(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.uniformBuffer?.destroy();
    this.fishBuffer?.destroy();
    this.rockBuffer?.destroy();
  }
}
