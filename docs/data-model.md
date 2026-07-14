# 数据模型与持久化

当前数据库 schema 版本为 **3**，使用 sql.js 运行 SQLite。Electron 将数据库放在用户数据目录；开发模式默认位于 `server/db/database.sqlite`，测试通过 `DB_PATH` 指向隔离临时目录。

## 核心关系

~~~mermaid
erDiagram
  PROJECTS ||--o{ STORYBOARDS : contains
  STORYBOARDS ||--o{ IMAGES : candidates
  PROJECTS ||--o{ EXPORTS : produces
  PROJECTS ||--o{ CHAPTERS : splits
  PROJECTS ||--o{ SNAPSHOTS : saves
  PROJECTS ||--o{ WORKBENCH_CHECKS : diagnoses
  PROJECTS ||--o{ CONTINUITY_CHECKS : validates
  PROJECTS }o--|| SERIES : belongs_to
  SERIES ||--o{ STORY_BIBLES : defines
  SERIES ||--o{ CHARACTERS : owns
  CHARACTERS ||--o{ CHARACTER_ASSETS : references
  STORYBOARDS ||--o{ STORYBOARD_CHARACTERS : binds
  CHARACTERS ||--o{ STORYBOARD_CHARACTERS : appears_in
~~~

SQLite 中只有部分关系声明为物理外键。服务层仍必须维护 selected image、文件路径和软删除快照等逻辑关系。

## 核心创作表

### projects

项目聚合根。保存名称、主题、风格、时长、画幅、脚本、封面、状态、系列关系、连续性状态和长视频属性。

关键约束：

- `name` 必填；
- 更新接口为 PATCH 语义；
- 普通删除进入回收站；
- `series_id`、`parent_project_id` 和 `continuation_mode` 描述续写关系；
- `long_video_mode` 与 `target_duration_sec` 控制长视频路径。

### storyboards

每条镜头的稳定记录，保存顺序、描述、旁白、时长、提示词、音频、字幕、转场、运镜、章节和连续性状态。

`selected_image_id` 是逻辑引用。删除图片时服务层必须显式清空它；增量 reconcile 会保留未变化镜头的 id 和资产。

### images

保存分镜候选图的提示词、相对文件位置、状态和尺寸。图片文件本身位于受管媒体目录，不存入 SQLite blob。

### exports

保存成片路径、时长、章节、外部副本和字幕状态。成片库从该表读取，不应通过扫描任意用户目录重建。

### chapters

长视频的生产和合成边界。每章拥有目标时长、状态和可选中间视频路径，最终由导出阶段拼接。

## 任务与检查点

~~~mermaid
flowchart TD
  Task["tasks row"] --> Meta["meta JSON"]
  Meta --> Recovery["recovery.kind / attempts"]
  Meta --> Workflow["workflow v1"]
  Workflow --> Topic["topic"]
  Workflow --> Script["script"]
  Workflow --> Storyboard["storyboard"]
  Workflow --> Image["image"]
  Workflow --> Voice["voice"]
  Workflow --> Subtitle["subtitle"]
  Workflow --> Timeline["timeline"]
  Workflow --> Export["export"]
  Task --> Result["result JSON"]
  Task --> Error["redacted error"]
~~~

### tasks

长任务持久化记录：

| 字段 | 含义 |
| --- | --- |
| `id` | UUID |
| `type` | auto-produce、image-batch、video 等任务类型 |
| `status` | pending、waiting、running、success、partial、failed、canceled、interrupted |
| `progress` | 0–100 |
| `message` | 用户可读状态 |
| `meta` | workflow、恢复类型、参数和诊断 JSON |
| `result` | 终态结果 JSON |
| `error` | 已脱敏错误 |
| `created_at / updated_at` | 毫秒时间戳 |

任务更新同步进入 SQLite，进程启动时加载最近 200 条。终态任务可以从内存卸载，但数据库保留历史。

### workflow JSON

固定阶段：

~~~text
topic → script → storyboard → image → voice → subtitle → timeline → export
~~~

每个阶段记录：

~~~json
{
  "status": "running",
  "attempts": 1,
  "progress": 42,
  "output": {},
  "error": null,
  "started_at": 0,
  "completed_at": null,
  "updated_at": 0
}
~~~

重试阶段会保留上游成功记录，把目标阶段设为 ready，并重置所有下游阶段，避免旧导出继续引用新旧混合资产。

### snapshots

项目草稿快照。`snapshot` 保存可恢复的项目、脚本和分镜 JSON。它用于内容回滚，不替代完整数据库备份。

## 系列与一致性

| 表 | 作用 |
| --- | --- |
| `series` | 连续项目容器 |
| `story_bibles` | 世界观、主线、时间线、锁定事实和风格锚点 |
| `characters` | 角色结构、提示词锚点和锁定状态 |
| `character_assets` | 角色参考图 |
| `storyboard_characters` | 镜头与角色的动作、情绪和服装关系 |
| `continuity_checks` | 连续性问题、评分、建议和修复动作 |
| `workbench_checks` | 最近一次项目健康检查 |

这些表中的提示词和引用可能包含用户创作内容，诊断或遥测不得自动上传完整记录。

## 运营与辅助表

| 表 | 作用 |
| --- | --- |
| `trash` | 软删除快照、文件列表和删除时间 |
| `op_logs` | 创建、删除、恢复、生成和配置变更摘要 |
| `presets` | 画风、画幅、音色、BGM 和字幕组合 |
| `skills` | 内置、自定义和导入的提示词技能 |
| `skill_versions` | 技能修改前快照 |
| `generation_cache` | 按 prompt/context hash 复用结果 |
| `image_gen_stats` | 首次成功、最终成功、降级和占位统计 |

`image_gen_stats` 不保存密钥、提示词或图片，只保存可复核的聚合字段。

## 数据与文件一致性

~~~mermaid
flowchart LR
  DB["SQLite 元数据"] <-->|相对路径| Media["uploads 受管媒体"]
  DB --> Check["资产健康检查"]
  Media --> Check
  Check -->|完整| Ready["可预览 / 导出"]
  Check -->|缺失| Repair["单阶段修复建议"]
~~~

数据库备份不自动包含媒体文件。恢复到某个时间点时，数据库和媒体目录必须来自同一备份批次。只恢复数据库可能出现“记录存在但文件缺失”；只恢复媒体可能留下孤儿文件。

## 写盘与崩溃安全

- 高频更新通过 500ms 节流合并；
- 实际写盘先输出 `.tmp`，再 rename 原子替换；
- 每次 export 后重新开启 foreign keys；
- 事务结束和进程退出执行同步 flush；
- 启动时不会把运行中任务粗暴改成失败，而是交给任务恢复器；
- 恢复次数超过上限的任务进入可诊断终态。

## schema 迁移

启动顺序：

~~~mermaid
flowchart TD
  Open["打开数据库"] --> Version["读取 PRAGMA user_version"]
  Version -->|旧版本| Backup["创建 data/backups/database-vN-*.sqlite"]
  Backup --> DDL["创建表 / 增加列 / 创建索引"]
  Version -->|当前版本| DDL
  Version -->|高于程序版本| Warn["警告并保留版本号"]
  DDL --> Set["写入 schema v3"]
  Set --> Flush["同步写盘"]
~~~

迁移备份按时间保留最近五份。新增 schema 时必须：

1. 提高 `SCHEMA_VERSION`；
2. 在迁移前保留原数据库；
3. 测试空库、旧库和高版本库；
4. 验证 foreign keys 与索引；
5. 更新本页和备份恢复说明。

## 不变量

- 项目删除不得留下可见的孤儿分镜；
- 图片删除不得留下无效 selected image；
- 阶段成功必须先保存资产，再提交检查点；
- 失败和取消不能删除上游成功输出；
- 备份和配置导出不得包含系统凭证；
- HTTP 错误、日志和遥测不得包含原始密钥；
- 文件路径必须位于受管媒体目录或用户明确选择的导出目录。
