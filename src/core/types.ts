// 全应用数据模型。所有持久化对象都可 JSON 序列化(导出/导入与 localStorage 共用)。

export type TankKind = 'planar' | 'cylinder' | 'tunnel';

/** 缸体几何参数, 单位米 */
export interface TankGeometry {
  kind: TankKind;
  /** 亚克力壁厚 t (米) */
  wallThickness: number;
  /** 平面缸: 面板宽度/高度; 圆柱/隧道: 缸体半径 R(外壁曲率半径) */
  width: number;
  height: number;
  /** 圆柱/隧道外壁曲率半径 R(米); 平面缸忽略 */
  radius: number;
  /** 隧道拱形: 半圆柱覆盖的弦长方向跨度(米), 隧道专用 */
  tunnelSpan: number;
  /** 缸体沿光轴/轴向的纵深长度(米) */
  depth: number;
}

/** 光学参数 */
export interface OpticsConfig {
  /** 水温 °C, 决定水的折射率 */
  waterTemperature: number;
  /** 手动覆盖水的折射率; null 表示由温度自动计算 */
  waterIorOverride: number | null;
  /** 亚克力折射率 */
  acrylicIor: number;
  /** 空气折射率 */
  airIor: number;
  /** 参考波长 nm(预留色散扩展) */
  wavelengthNm: number;
}

export interface FishSchool {
  id: string;
  name: string;
  count: number;
  /** 鱼群中心位置(米) */
  center: [number, number, number];
  /** 巡游半径(米) */
  swimRadius: number;
  /** 巡游速度(圈/秒) */
  swimSpeed: number;
  /** 鱼体典型长度(米) */
  fishLength: number;
  color: string;
}

export interface Rock {
  id: string;
  name: string;
  /** 中心位置(米) */
  position: [number, number, number];
  /** 椭球半轴(米) */
  scale: [number, number, number];
  color: string;
}

export interface Aquascape {
  schools: FishSchool[];
  rocks: Rock[];
  /** 背景参考网格平面距离内壁的距离(米), 畸变分析用 */
  referenceDistance: number;
  /** 背景网格密度(每米格线数) */
  gridDensity: number;
}

/** 游客视点(相机) */
export interface ViewPoint {
  /** 相机位置(米) */
  position: [number, number, number];
  /** 注视点(米) */
  target: [number, number, number];
  /** 视场角(度, 竖直) */
  fovY: number;
}

export interface RenderSettings {
  /** 渲染分辨率相对窗口的比例(性能调节, 0.5~1) */
  resolutionScale: number;
  /** 是否显示背景参考网格 */
  showGrid: boolean;
  /** 是否显示光路调试(屏幕中心单条光线) */
  debugRay: boolean;
  /** 鱼群动画开关(关闭后静态, 降低功耗) */
  animateFish: boolean;
  /** 曝光 */
  exposure: number;
}

export interface DistortionSettings {
  /** 畸变分析网格分辨率(每边 N×N) */
  gridResolution: number;
  /** 着色度量: magnification 放大率 / offset 偏移量 */
  metric: 'magnification' | 'offset';
  /** 偏移量着色上限(毫米), 用于归一化配色 */
  offsetMaxMm: number;
}

export interface ProjectData {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  geometry: TankGeometry;
  optics: OpticsConfig;
  aquascape: Aquascape;
  viewpoint: ViewPoint;
  render: RenderSettings;
  distortion: DistortionSettings;
}

/** 导出文件的信封格式 */
export interface ExportEnvelope {
  format: 'aquarium-refraction-studio';
  version: 1;
  exportedAt: number;
  projects: ProjectData[];
}

export const DEFAULT_GEOMETRY: TankGeometry = {
  kind: 'planar',
  wallThickness: 0.05,
  width: 6,
  height: 4,
  radius: 3,
  tunnelSpan: 6,
  depth: 5,
};

export const DEFAULT_OPTICS: OpticsConfig = {
  waterTemperature: 25,
  waterIorOverride: null,
  acrylicIor: 1.491,
  airIor: 1.000293,
  wavelengthNm: 589,
};

export const DEFAULT_RENDER: RenderSettings = {
  resolutionScale: 1,
  showGrid: true,
  debugRay: false,
  animateFish: true,
  exposure: 1,
};

export const DEFAULT_DISTORTION: DistortionSettings = {
  gridResolution: 48,
  metric: 'offset',
  offsetMaxMm: 30,
};

export const DEFAULT_VIEWPOINT: ViewPoint = {
  position: [0, 1.6, 4.5],
  target: [0, 1.4, 0],
  fovY: 50,
};
