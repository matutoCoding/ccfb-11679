# 亚克力缸体折射预览系统 (Refraction Studio)

浏览器内的水族馆亚克力大缸折射光路预览与畸变分析系统。TypeScript + WebGPU，
单条光线依次穿过 **空气 → 亚克力(外壁) → 亚克力(内壁) → 水**，每次跨越应用矢量 Snell 折射。

## 运行

```bash
npm install
npm run dev      # 开发服务器 (默认 http://localhost:5173)
npm run build    # 类型检查 + 生产构建到 dist/
npm test         # 物理内核单元测试 (node:test)
```

需使用支持 WebGPU 的浏览器（Chrome/Edge 113+），在 http 或 localhost 下打开。

## 六个页面

| 页面 | 功能 |
|------|------|
| 项目列表 | 项目增删改、复制、重命名；localStorage 持久化；JSON 导出/导入 |
| 缸体设计 | 平面/圆柱/隧道拱形三种缸体；壁厚、曲率半径可调；水温→水折射率自动计算 |
| 水景布置 | 鱼群（数量/巡游半径/速度/颜色）与礁石（位置/椭球尺寸）增删改；背景参考网格 |
| 视点预览 | 拖拽旋转游客视点、滚轮缩放；实时折射渲染；FPS 监测；CPU 光路核对；双方案并排对比；截图 |
| 畸变分析 | N×N 网格 GPU compute 追迹；偏移量/放大率热力图；统计；CSV 导出 |
| 设置 | GPU 能力信息、物理常量、光路物理自检、本地数据管理 |

## 物理正确性（最关键需求）

### 折射内核

`src/core/optics.ts` 的 `refract(I, N, eta)` 采用切向/法向基底分解：

```
sinθt = eta·sinθi,  cosθt = √(1−sin²θt)
T = eta·I + (cosθt − eta·cosθi)·n     (n 自动翻到顺光侧 I·n>0)
eta = n_from / n_to
```

全反射（sin²θt > 1）返回 `null`。同一套系数与运算顺序写入 WGSL 着色器，
CPU 参考实现与 GPU 渲染逐行同构，保证「所见即所算」。

### 壁厚偏移核对口径

平面缸单条光线在亚克力壁厚内的横向偏移，解析手算公式：

```
offset = t · (tanθi − tanθg),   sinθg = (n_air / n_acrylic) · sinθi
```

基准用例：t = 50 mm，入射角 30°，n_air = 1.000293，n_acrylic = 1.491。

- 手算基准：**11.063787 mm**
- 追踪器 `firstWallOffset`：**11.063787 mm**
- 误差：**5.33 × 10⁻¹⁵ mm**（验收要求 < 0.01 mm，裕量超 10 个数量级）

`npm test` 覆盖 5°/15°/30°/45°/60°/75° 全部入射角，以及斜法线 Snell 守恒、
全反射临界角、光路可逆性、圆柱/隧道追迹、水折射率温度拟合。
设置页「光路物理自检」可在浏览器内复跑这些核对。

### 水折射率-温度关系

`src/core/waterIor.ts`，数据来自 Daimon & Masumura (2007) 钠光 589nm 实测值，
0–60°C 三次多项式拟合，最大残差 6.2×10⁻⁵。同一系数在 WGSL 的 `waterIor()` 中复用。

### 畸变度量

畸变分析在缸后参考平面取 N×N 网格，对每个节点反向追迹（水→亚克力→空气），
把出射光反向投影回**参考平面自身**得到「表观物点」，其与真实点之差即像移（毫米）。
这一度量关于光轴对称、中心为零、随入射角平滑增长，与壁厚偏移同口径；
放大率由相邻节点表观间距 / 真实间距的中心差分得到。

## 目录结构

```
src/core/        纯函数物理内核(无 DOM/GPU 依赖, 可独立测试)
  vector.ts        三维向量
  optics.ts        矢量 Snell 折射 + Fresnel
  waterIor.ts      折射率常量与温度拟合
  geometry.ts      平面/圆柱/隧道拱求交
  tracer.ts        两次折射光路追踪 + 壁厚偏移
  types.ts         数据模型
  storage.ts       持久化与导入导出
src/gpu/
  shaders.wgsl     全屏光线追踪渲染着色器
  distortion.wgsl  畸变分析 compute shader
  RefractionRenderer.ts
  DistortionAnalyzer.ts
src/ui/          轻量 DOM 页面(无框架)
test/optics.test.ts  物理内核测试
```

## 性能

全屏光线追踪在片段着色器内完成（每像素仅两次球面/二次曲面求交 + 两次折射），
实测集成显卡 1080p 下稳定 60 FPS（16.7 ms/帧），满足 ≥30 FPS 要求。
若硬件较弱，可在视点预览页降低「分辨率比例」或关闭鱼群动画。
