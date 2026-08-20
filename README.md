# search-neo

> 专为 AI 设计的聚合搜索引擎 · Powered By **Vexify**

同时爬取 **Bing** 与 **百度** 的搜索结果，做跨引擎交叉验证，并按**正确度**自动排序，
最后输出一份专为 LLM 优化的 JSON 答案（也可人工查阅网页 UI）。

## 功能

- 🔍 **双引擎并行爬取** — Bing + 百度（含百度 `link` 跳转解析、`mu` 真实地址、反爬验证码自动重试）
- ⚖️ **正确度排序** — 综合以下信号打分（0–99）：
  - 相关度（标题/URL/摘要对查询词条的覆盖，支持中英混合分词）
  - **跨引擎一致性**（Bing 与百度同时命中的页面/站点 → 强正确性信号）
  - 权威域名加分、垃圾/广告/问答式标题/图片视频神曲专辑类结果降权过滤
- 🧠 **问题查询改写** — `谁是中国首位航天员` → `[中国首位航天员, 中国首位航天员 是谁]` 等变体，命中实质部分
- 🤖 可选 **LLM 裁判** — 配置 `AI_ENDPOINT` + `AI_KEY` 后，让大模型在候选结果中仲裁最正确答案
- 📄 **AI 友好输出** — `/search?q=…&compact=1` 返回精简结构，直接喂给 LLM

## 快速开始

```bash
cd /data/workspace/search-neo
npm start                 # 默认 0.0.0.0:8080
```

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8080` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `AI_ENDPOINT` | *(空)* | OpenAI 兼容地址，留空则用启发式排序 |
| `AI_KEY` | *(空)* | 上述端点的 API Key |
| `AI_MODEL` | `gpt-4o-mini` | 裁判模型名 |

## API

```bash
# 网页 UI
curl http://localhost:8080/

# 完整 JSON（含所有结果与排序）
curl "http://localhost:8080/search?q=毛遂自荐%20主人公"

# AI 精简版
curl "http://localhost:8080/search?q=毛遂自荐%20主人公&compact=1"

# 关闭 LLM 裁判，只用启发式
curl "http://localhost:8080/search?q=nodejs%20event%20loop&ai=0"
```

精简响应的核心结构：

```jsonc
{
  "query": "谁是中国首位航天员",
  "variants": ["谁是中国首位航天员", "中国首位航天员"],
  "answer": "…中文答案（引用最佳来源）…",
  "confidence": 41,
  "ai_verified": false,
  "top": [
    { "title": "…", "url": "https://…", "snippet": "…",
      "score": 54, "engines": ["bing", "baidu"] }
  ],
  "meta": { "elapsedMs": 3400, "provider": "Vexify" }
}
```

## 目录结构

```
src/
  server.js          # HTTP API + 静态 UI
  search.js          # 编排：查询改写 → 并行爬虫 → 合并 → 排序 → 可选AI裁判
  net.js             # fetch 封装、Cookie jar、HTML 清洗、会话预热
  rank.js            # 分词 + 正确度打分 + 摘要生成
  query.js           # 问题查询改写
  ai.js              # 可选 LLM 裁判
  engines/
    bing.js          # Bing 结果解析
    baidu.js         # 百度结果解析（跳转解析、验证码重试）
public/index.html    # 网页搜索界面（Powered By Vexify）
test/rank.test.js    # 单元测试
```

## 测试

```bash
npm test
```

## 说明

- “最正确”由多信号融合决定：优先两个引擎一致同意的页面/站点，
  辅以权威域名与位置信息，并用启发式过滤垃圾结果。配置好 LLM 裁判后，
  “最正确”将由大模型在候选集内进一步仲裁。
- 百度反爬时可能短暂返回验证码，已完成自动重试（`www`/`m` 双端切换 + 延迟）。

---

Powered By **Vexify** · MIT License