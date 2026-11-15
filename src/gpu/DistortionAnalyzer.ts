// 畸变分析器: 运行 compute shader, 回读网格节点的偏移量与放大率。
import distortionWgsl from './distortion.wgsl?raw';
import { ProjectData } from '../core/types';
import { waterIorAt } from '../core/waterIor';

export interface DistortionCell {
  offsetMm: number;
  magnification: number;
  x: number;
  y: number;
}

export interface DistortionResult {
  n: number;
  cells: DistortionCell[];
  offsetStats: { min: number; max: number; mean: number; rms: number };
  magStats: { min: number; max: number; mean: number };
}

const CELL_FLOATS = 4; // offsetMm, magnification, x, y
const CELL_BYTES = CELL_FLOATS * 4;

export class DistortionAnalyzer {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  private uniformBuffer: GPUBuffer;
  private cellBuffer: GPUBuffer;
  private readback: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private maxN: number;

  constructor(device: GPUDevice, maxN = 128) {
    this.device = device;
    this.maxN = maxN;
    const module = device.createShaderModule({ code: distortionWgsl });
    this.pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'csMain' },
    });
    // DUniforms: 20 个 f32
    this.uniformBuffer = device.createBuffer({ size: 20 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const cellBytes = maxN * maxN * CELL_BYTES;
    this.cellBuffer = device.createBuffer({ size: cellBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.readback = device.createBuffer({ size: cellBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.cellBuffer } },
      ],
    });
  }

  async analyze(project: ProjectData): Promise<DistortionResult> {
    const n = Math.min(this.maxN, project.distortion.gridResolution);
    const p = project;
    const nWater = p.optics.waterIorOverride ?? waterIorAt(p.optics.waterTemperature);
    const kind = p.geometry.kind === 'planar' ? 0 : p.geometry.kind === 'cylinder' ? 1 : 2;
    // 平面缸取 2m 采样跨度(半幅 1m, 对应约 11° 入射角的工程常见范围);
    // 圆柱/隧道按曲率半径取 1.6 倍, 覆盖弧形视野
    const span = p.geometry.kind === 'planar' ? Math.min(2, p.geometry.width) : p.geometry.radius * 1.6;

    const u = new Float32Array(new ArrayBuffer(20 * 4));
    let i = 0;
    u[i++] = p.viewpoint.position[0]; u[i++] = p.viewpoint.position[1]; u[i++] = p.viewpoint.position[2];
    u[i++] = n;
    u[i++] = kind;
    u[i++] = p.geometry.wallThickness;
    u[i++] = p.geometry.radius;
    u[i++] = span;
    u[i++] = p.aquascape.referenceDistance;
    u[i++] = p.distortion.metric === 'magnification' ? 1 : 0;
    u[i++] = p.distortion.offsetMaxMm;
    u[i++] = p.optics.airIor;
    u[i++] = p.optics.acrylicIor;
    u[i++] = nWater;
    u[i++] = 0; u[i++] = 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, u);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(n / 8), Math.ceil(n / 8));
    pass.end();
    encoder.copyBufferToBuffer(this.cellBuffer, 0, this.readback, 0, n * n * CELL_BYTES);
    this.device.queue.submit([encoder.finish()]);

    await this.readback.mapAsync(GPUMapMode.READ);
    const raw = new Float32Array(this.readback.getMappedRange().slice(0, n * n * CELL_BYTES));
    this.readback.unmap();

    const cells: DistortionCell[] = [];
    let oMin = Infinity, oMax = -Infinity, oSum = 0, oSq = 0;
    let mMin = Infinity, mMax = -Infinity, mSum = 0;
    for (let k = 0; k < n * n; k++) {
      const cell: DistortionCell = {
        offsetMm: raw[k * 4],
        magnification: raw[k * 4 + 1],
        x: raw[k * 4 + 2],
        y: raw[k * 4 + 3],
      };
      cells.push(cell);
      oMin = Math.min(oMin, cell.offsetMm);
      oMax = Math.max(oMax, cell.offsetMm);
      oSum += cell.offsetMm;
      oSq += cell.offsetMm * cell.offsetMm;
      mMin = Math.min(mMin, cell.magnification);
      mMax = Math.max(mMax, cell.magnification);
      mSum += cell.magnification;
    }
    const count = n * n;
    return {
      n,
      cells,
      offsetStats: { min: oMin, max: oMax, mean: oSum / count, rms: Math.sqrt(oSq / count) },
      magStats: { min: mMin, max: mMax, mean: mSum / count },
    };
  }

  /** 导出为 CSV 文本 */
  static toCsv(result: DistortionResult): string {
    const { n, cells } = result;
    const lines = ['row,col,x_m,y_m,offset_mm,magnification'];
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const c = cells[row * n + col];
        lines.push(`${row},${col},${c.x.toFixed(6)},${c.y.toFixed(6)},${c.offsetMm.toFixed(6)},${c.magnification.toFixed(6)}`);
      }
    }
    return lines.join('\n');
  }

  destroy(): void {
    this.uniformBuffer.destroy();
    this.cellBuffer.destroy();
    this.readback.destroy();
  }
}
