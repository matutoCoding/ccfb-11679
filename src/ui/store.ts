// 全局应用状态: 项目列表、当前项目、当前页面, 带订阅发布。
import { ProjectData } from '../core/types';
import { loadProjects, saveProjects, createProject, duplicateProject } from '../core/storage';

export type PageId = 'projects' | 'tank' | 'aquascape' | 'viewpoint' | 'distortion' | 'settings';

export interface AppState {
  projects: ProjectData[];
  currentId: string | null;
  page: PageId;
  /** 方案对比时选中的第二个项目 id */
  compareId: string | null;
}

type Listener = (state: AppState) => void;

class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor() {
    const projects = loadProjects();
    this.state = {
      projects,
      currentId: projects[0]?.id ?? null,
      page: 'projects',
      compareId: null,
    };
  }

  getState(): AppState {
    return this.state;
  }

  get current(): ProjectData | null {
    return this.state.projects.find((p) => p.id === this.state.currentId) ?? null;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.state = { ...this.state };
    this.listeners.forEach((fn) => fn(this.state));
  }

  private persist(): void {
    saveProjects(this.state.projects);
  }

  setPage(page: PageId): void {
    location.hash = page;
  }

  applyHash(): void {
    const page = (location.hash.replace('#', '') || 'projects') as PageId;
    this.state.page = page;
    this.emit();
  }

  selectProject(id: string): void {
    this.state.currentId = id;
    this.state.compareId = null;
    this.emit();
  }

  setCompare(id: string | null): void {
    this.state.compareId = id;
    this.emit();
  }

  addProject(name?: string): ProjectData {
    const p = createProject(name);
    this.state.projects = [...this.state.projects, p];
    this.state.currentId = p.id;
    this.persist();
    this.emit();
    return p;
  }

  updateProject(id: string, patch: Partial<ProjectData>): void {
    this.state.projects = this.state.projects.map((p) =>
      p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p,
    );
    this.persist();
    this.emit();
  }

  /** 嵌套字段更新(几何/光学等), 返回更新后的完整项目 */
  patchCurrent(mutator: (draft: ProjectData) => void): void {
    if (!this.state.currentId) return;
    this.state.projects = this.state.projects.map((p) => {
      if (p.id !== this.state.currentId) return p;
      const draft = structuredClone(p);
      mutator(draft);
      draft.updatedAt = Date.now();
      return draft;
    });
    this.persist();
    this.emit();
  }

  deleteProject(id: string): void {
    this.state.projects = this.state.projects.filter((p) => p.id !== id);
    if (this.state.currentId === id) {
      this.state.currentId = this.state.projects[0]?.id ?? null;
    }
    if (this.state.compareId === id) this.state.compareId = null;
    this.persist();
    this.emit();
  }

  duplicateProject(id: string): void {
    const src = this.state.projects.find((p) => p.id === id);
    if (!src) return;
    const copy = duplicateProject(src);
    this.state.projects = [...this.state.projects, copy];
    this.persist();
    this.emit();
  }

  replaceAll(projects: ProjectData[]): void {
    this.state.projects = projects;
    if (!projects.some((p) => p.id === this.state.currentId)) {
      this.state.currentId = projects[0]?.id ?? null;
    }
    this.persist();
    this.emit();
  }
}

export const store = new Store();
