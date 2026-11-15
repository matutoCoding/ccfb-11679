// 项目持久化: localStorage 存储 + 导出/导入 JSON。
import {
  ProjectData,
  ExportEnvelope,
  DEFAULT_GEOMETRY,
  DEFAULT_OPTICS,
  DEFAULT_RENDER,
  DEFAULT_DISTORTION,
  DEFAULT_VIEWPOINT,
  Aquascape,
} from './types';
import { waterIorAt } from './waterIor';

const STORAGE_KEY = 'aquarium-refraction-studio.projects.v1';

export function createId(): string {
  // 避免在极端环境下 crypto 不可用
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `p-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function defaultAquascape(): Aquascape {
  return {
    schools: [
      {
        id: createId(),
        name: '主鱼群',
        count: 40,
        center: [0, 1.2, -2.5],
        swimRadius: 1.2,
        swimSpeed: 0.15,
        fishLength: 0.25,
        color: '#ff9d3c',
      },
    ],
    rocks: [
      { id: createId(), name: '主礁石', position: [-1.5, 0.3, -2], scale: [0.8, 0.6, 0.7], color: '#8a8f98' },
      { id: createId(), name: '珊瑚基座', position: [1.6, 0.25, -1.4], scale: [0.5, 0.5, 0.5], color: '#c96f8f' },
    ],
    referenceDistance: 0.5,
    gridDensity: 4,
  };
}

export function createProject(name = '未命名缸体方案'): ProjectData {
  const now = Date.now();
  return {
    id: createId(),
    name,
    createdAt: now,
    updatedAt: now,
    geometry: structuredClone(DEFAULT_GEOMETRY),
    optics: structuredClone(DEFAULT_OPTICS),
    aquascape: defaultAquascape(),
    viewpoint: structuredClone(DEFAULT_VIEWPOINT),
    render: structuredClone(DEFAULT_RENDER),
    distortion: structuredClone(DEFAULT_DISTORTION),
  };
}

/** 深拷贝项目并赋予新 id(用于"复制") */
export function duplicateProject(src: ProjectData, newName?: string): ProjectData {
  const now = Date.now();
  const copy = structuredClone(src);
  copy.id = createId();
  copy.name = newName ?? `${src.name} 副本`;
  copy.createdAt = now;
  copy.updatedAt = now;
  // 水景内对象 id 重新生成, 避免副本之间共享
  copy.aquascape.schools.forEach((s) => (s.id = createId()));
  copy.aquascape.rocks.forEach((r) => (r.id = createId()));
  return copy;
}

export function loadProjects(): ProjectData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProjectData[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(migrateProject);
  } catch (err) {
    console.error('读取项目失败', err);
    return [];
  }
}

export function saveProjects(projects: ProjectData[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

/** 容错: 对缺少字段的旧数据补默认值, 防止版本演进导致崩溃 */
export function migrateProject(raw: unknown): ProjectData {
  const p = (raw ?? {}) as Partial<ProjectData>;
  const base = createProject();
  return {
    ...base,
    ...(p as object),
    geometry: { ...base.geometry, ...(p.geometry ?? {}) },
    optics: { ...base.optics, ...(p.optics ?? {}) },
    aquascape: { ...base.aquascape, ...(p.aquascape ?? {}) },
    viewpoint: { ...base.viewpoint, ...(p.viewpoint ?? {}) },
    render: { ...base.render, ...(p.render ?? {}) },
    distortion: { ...base.distortion, ...(p.distortion ?? {}) },
    id: p.id ?? base.id,
    name: p.name ?? base.name,
  } as ProjectData;
}

export function exportProjects(projects: ProjectData[]): ExportEnvelope {
  return {
    format: 'aquarium-refraction-studio',
    version: 1,
    exportedAt: Date.now(),
    projects,
  };
}

/** 解析导入文件; 校验格式并迁移数据。失败抛出带中文说明的错误 */
export function parseImport(jsonText: string): ProjectData[] {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('文件不是合法的 JSON, 请选择本系统导出的 .json 文件');
  }
  const envelope = data as Partial<ExportEnvelope>;
  if (envelope?.format === 'aquarium-refraction-studio' && Array.isArray(envelope.projects)) {
    return envelope.projects.map(migrateProject);
  }
  if (Array.isArray(data)) {
    // 兼容直接导出的项目数组
    return (data as unknown[]).map(migrateProject);
  }
  throw new Error('未识别的文件格式: 缺少 format 标识或 projects 数组');
}

/** 计算项目当前的实际水折射率(温度自动/手动覆盖), 供 UI 显示 */
export function effectiveWaterIor(p: ProjectData): number {
  return p.optics.waterIorOverride ?? waterIorAt(p.optics.waterTemperature);
}
