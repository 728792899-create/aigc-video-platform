# 数据模型与持久化

当前数据库 schema 版本为 **8**。Electron 发布包使用 `better-sqlite3`，开发/兼容测试可通过 `DB_DRIVER=sqljs` 显式切换到 sql.js。Electron 将数据库放在用户数据目录；开发模式默认位于 `server/db/database.sqlite`，测试通过 `DB_PATH` 指向隔离临时目录。

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
  PROJECTS ||--o{ STAGE_ARTIFACTS : versions
  PROJECTS ||--o{ PROJECT_VIEW_STATES : layouts
  PROJECTS }o--|| SERIES : belongs_to
  SERIES ||--o{ STORY_BIBLES : defines
  SERIES ||--o{ CHARACTERS : owns
  CHARACTERS ||--o{ CHARACTER_ASSETS : references
  STORYBOARDS ||--o{ STORYBOARD_CHARACTERS : binds
  CHARACTERS ||--o{ STORYBOARD_CHARACTERS : appears_in
  STORYBOARDS ||--o{ STORYBOARD_ASSET_BINDINGS : snapshots
  CHARACTER_ASSETS ||--o{ STORYBOARD_ASSET_BINDINGS : bound_variant
  ASSET_UNITS ||--o{ ASSET_VARIANTS : owns
  ASSET_UNITS ||--o{ STORYBOARD_ASSET_BINDINGS : binds
  IDEMPOTENCY_RECORDS {
    TEXT scope PK
    TEXT key PK
    TEXT request_hash
    TEXT status
    INTEGER expires_at
  }
  PROJECT_VIEW_STATES {
    INTEGER project_id PK
    TEXT user_key PK
    TEXT view_key PK
    INTEGER revision
    TEXT layout_json
  }
  STAGE_ARTIFACTS {
    TEXT id PK
    INTEGER project_id FK
    TEXT stage
    INTEGER revision
    TEXT status
    TEXT input_hash
    TEXT payload_hash
  }
  CHARACTER_ASSETS {
    INTEGER id PK
    INTEGER character_id
    TEXT variant_key
    INTEGER revision
    INTEGER selected
    TEXT media_reference
  }
  STORYBOARD_ASSET_BINDINGS {
    INTEGER id PK
    INTEGER storyboard_id FK
    TEXT asset_type
    INTEGER asset_id
    INTEGER variant_id
    INTEGER revision
    TEXT snapshot
  }
  ASSET_UNITS {
    TEXT id PK
    TEXT asset_type
    TEXT scope
    INTEGER project_id
    INTEGER series_id
    TEXT selected_variant_id
  }
  ASSET_VARIANTS {
    TEXT id PK
    TEXT asset_unit_id FK
    INTEGER revision
    TEXT status
    INTEGER selected
    TEXT media_reference
  }
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

`selected_image_id` 是逻辑引用。删除图片时服务层必须显式清空它；增量 reconcile 会保留未变化镜头的 id 和资产。内容变化时，镜头进入 `sync_status=stale`、`assets_stale=1`，但原 `selected_image_id`、音频和视频仍保留，等待用户复查或局部重生成。

### images / Candidate

每行是一个拥有稳定 ID 的分镜 Candidate，保存提示词、相对文件位置、状态和尺寸。schema v6 追加了：

- `task_id / provider / model`：真实生成来源；
- `input_snapshot`：已脱离 Provider payload 的 Prompt、参考图 ID 和一致性模式；
- `media_reference`：不含签名 query 或凭据的受控媒体引用；
- `parent_image_id`：基于某候选再生成的血缘；
- `favorite / archived_at / selected_at`：用户评审状态。

`storyboards.selected_image_id` 指向当前使用的 Candidate。切换只更改这个稳定引用，不覆盖其他候选。`stale/stale_reason` 标识候选所依据的脚本已变化；归档与 stale 都不删除媒体。物理删除会拒绝正在被分镜或资产 Variant 引用的 Candidate。

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
| `status` | pending、waiting、running、success、partial、failed、canceled、interrupted、orphaned |
| `progress` | 0–100 |
| `message` | 用户可读状态 |
| `provider / model / provider_task_id` | 实际 Provider 路由和可查询的远端任务 ID |
| `attempt / parent_task_id` | 重试 attempt 及父任务血缘 |
| `idempotency_key / correlation_id` | 防重复提交与诊断关联 |
| `started_at / finished_at / timeout_at` | 真实任务时间边界 |
| `retryable / cancel_state` | 稳定重试语义和本地/Provider 取消状态 |
| `input_snapshot / media_snapshot` | 已脱敏、不可变的实际输入与媒体引用快照 |
| `meta` | workflow、恢复类型、参数和诊断 JSON |
| `result` | 终态结果 JSON |
| `error` | 已脱敏错误 |
| `created_at / updated_at` | 毫秒时间戳 |

任务更新同步进入 SQLite，进程启动时加载最近 200 条。终态任务可以从内存卸载，但数据库保留历史。

重试任务同时在兼容 `meta` 和 schema v7 一等列中保存父任务与递增 `attempt`，原任务保持失败/部分成功/结果不确定终态，不被新尝试覆盖。拥有 `provider_task_id` 且 adapter 支持查询的任务在重启后执行只读对账；缺少可核对证据时进入 `orphaned`，不会重新提交可能收费的任务。

### idempotency_records

高成本入口的持久化请求意图。主键为 `scope + key`，`request_hash` 防止把同一 key 误用于不同输入。`pending` 在进入 Provider 调用前同步落盘；成功后保存可回放响应。进程退出后仍为 pending 的记录不会自动重提，避免远端结果不明时重复计费。

### stage_artifacts

项目阶段产物的版本历史。每个 `(project_id, stage)` revision 单调递增，状态为：

- `current`：当前被下游引用的版本；
- `stale`：上游 revision 已变化，但产物仍保留；
- `superseded`：同阶段已有更新 revision。

记录包含 `schema_version`、`prompt_version`、Provider/model、输入和 payload hash、dependency snapshot、产物 payload 与 stale 原因。自动生产会依次发布 `script → storyboard → image → voice → subtitle → timeline → export`；手工脚本保存至少发布 script/storyboard。发布相同输入和依赖会复用原 revision，不制造重复历史。

结构化脚本 payload 本身带有 `schema_version / prompt_version / input_hash / language / style / generation`。服务端在保存前再次通过 Zod 运行时契约；不合格输出只返回诊断摘要 hash 和字段路径，不落库，也不回显原始响应。

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
| `character_assets` | 角色 Variant；含稳定 key、revision、默认选择、血缘、生成来源和 MediaReference |
| `asset_units` | 通用 Character/Scene/Prop/Style/Voice/Music 资产；含稳定字符串 ID、作用域和 selected Variant |
| `asset_variants` | 通用资产不可变 revision、生成来源、MediaReference、选择/收藏/归档状态 |
| `storyboard_characters` | 镜头与角色的动作、情绪和服装关系 |
| `storyboard_asset_bindings` | 镜头对指定 Variant revision 的不可变快照绑定 |
| `storyboard_field_revisions` | 分镜字段 hash、变更来源和字段级 stale 传播证据 |
| `prompt_revisions` | script/image/video/voice/negative Prompt 的不可变版本、血缘和实际模型信息 |
| `continuity_checks` | 连续性问题、评分、建议和修复动作 |
| `workbench_checks` | 最近一次项目健康检查 |

这些表中的提示词和引用可能包含用户创作内容，诊断或遥测不得自动上传完整记录。

Character 继续由原兼容表提供稳定 API，并在 v7 幂等投影到通用资产层。Scene/Prop/Style/Voice/Music 通过 `asset_units / asset_variants` 持久化；解析顺序为 Episode → Series → Global。Character Binding 保留旧数字 ID，通用资产 Binding 使用稳定 AssetUnit 字符串 ID；历史负数 surrogate 在 API 输出时归一化。镜头绑定同时记录 Variant key、revision、来源作用域和不可变快照。

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
- 启动时不会把运行中任务粗暴改成失败；明确安全的 Demo/local 任务交给恢复器续跑，云/未知任务进入 `orphaned` 人工核对；
- 恢复次数超过上限的任务进入可诊断终态。

## schema 迁移

启动顺序：

~~~mermaid
flowchart TD
  Open["打开数据库"] --> Version["读取 PRAGMA user_version"]
  Version -->|旧版本| Backup["创建 data/backups/database-vN-*.sqlite"]
  Backup --> DDL["创建表 / 增加列 / 创建索引"]
  Version -->|当前版本| DDL
  Version -->|高于程序版本| Reject["拒绝打开且不改写"]
  DDL --> Backfill6["v6 幂等回填 Candidate / Character Variant"]
  Backfill6 --> Backfill7["v7 投影 AssetUnit / Task canonical fields"]
  Backfill7 --> Layout8["v8 创建 project_view_states"]
  Layout8 --> Lineage9["v9 资产 lineage / 字段 stale / Prompt revision"]
  Lineage9 --> Set["写入 schema v9"]
  Set --> Flush["同步写盘"]
~~~

迁移备份按时间保留最近五份。新增 schema 时必须：

1. 提高 `SCHEMA_VERSION`；
2. 在迁移前保留原数据库；
3. 测试空库、旧库和高版本库；
4. 验证 foreign keys 与索引；
5. 更新本页和备份恢复说明。

v5 升级 v6 时，旧 `character_assets` 按创建顺序获得单调 revision，最新可用参考图成为默认 Variant；旧已选图获得 `selected_at`。MediaReference 回填会剔除 URL query/fragment。v7 再把旧 Character/Variant 幂等投影到通用 `asset_units / asset_variants`，并把 Provider 对账、attempt、幂等、时间边界、取消和快照提升为任务一等字段。v8 仅新增画布布局表；使用 `revision` 乐观并发保护。v9 以 additive migration 增加资产 fork lineage、`stale_fields/stale_sources`、分镜字段 revision 和 Prompt revision，不删除旧 Candidate、选择或导出。迁移重复运行不会重排 revision、复制资产或改变既有快照。

## 不变量

- 项目删除不得留下可见的孤儿分镜；
- Candidate 物理删除前必须确认没有 selected image 或 Asset Variant 引用；
- Variant 归档前必须已切换默认版本并重新绑定所有镜头；
- 阶段成功必须先保存资产，再提交检查点；
- 失败和取消不能删除上游成功输出；
- 上游内容变化只能把相关下游标为 stale，不能静默覆盖或删除旧候选；
- 备份和配置导出不得包含系统凭证；
- HTTP 错误、日志和遥测不得包含原始密钥；
- 文件路径必须位于受管媒体目录或用户明确选择的导出目录。
