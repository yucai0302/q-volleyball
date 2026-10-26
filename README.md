# Q 版排球（q-volleyball）

网页端开箱即玩的 Q 版 3D 排球，人机对战版。固定 3/4 俯视角、2v2 对战、先到 7 分、三局两胜。

## 一期已完成

- 3D 球场、Q 版角色、排球与场景渲染（Three.js + Rapier 物理）
- 完整对局流程：发球蓄力 → 一传/二传/扣杀 → 拦网 → 得分 → 换发 → 局间 → 结算
- 人机 AI（简单 / 普通 / 困难三档），队友 AI 自动跑位接应
- 打击反馈：触球数字、连击、粒子与镜头特效、音效（`M` 静音）
- HUD：记分板、倒计时、触球次数、发球蓄力条、播报与结算 MVP
- 妙搭在线部署

## 操作

| 按键 | 作用 |
| --- | --- |
| `W` `A` `S` `D` | 移动 |
| `Shift` | 冲刺 / 扑救 |
| `Space` | 跳跃 |
| `J` | 击球 / 扣球（可按住持续挥击） |
| `K` | 网前自动起跳拦网 |
| `Esc` | 暂停 |
| `M` | 音效开关 |

## 本地运行

```bash
npm install
npm run dev      # 开发预览
npm run build    # 类型检查 + 生产构建（输出 dist/）
npm run preview  # 预览构建产物
```

## 项目结构

```
src/
  main.ts            入口，初始化场景与 UI 绑定
  game.ts            对局主循环与状态机
  sim/               纯逻辑层：物理、球、AI、阵型、配置
  render/            表现层：场景、球场、角色、排球、特效
  input/             键盘输入
  ui/hud.ts          HUD 与各界面
  audio/audio.ts     音效合成
  core/              事件总线与数学工具
.trae/               需求文档与美术参考图
```

## 版本发布规范

版本号遵循语义化版本（SemVer），与 `package.json` 的 `version` 保持一致。

每次版本更新按以下流程执行：

1. 更新 `package.json` 中的 `version`
2. 更新下方「版本记录」
3. 提交：`git commit -m "release: vX.Y.Z <简述>"`
4. 打标签并推送：`git tag -a vX.Y.Z -m "vX.Y.Z"` → `git push origin main --tags`
5. 在 GitHub 上创建同名 Release，填写本次变更点

日常开发提交使用 `feat: / fix: / refactor: / docs: / chore:` 前缀；发布提交统一使用 `release:` 前缀。

## 版本记录

### v0.1.0 — 一期

- 人机对战完整对局可玩
- 三档 AI 难度、队友 AI 跑位
- 打击特效、音效、HUD 全量接入
- 妙搭在线部署上线
