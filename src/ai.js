import { cleanText } from "./net.js";

const AI_ENDPOINT = process.env.AI_ENDPOINT || "";
const AI_KEY = process.env.AI_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "gpt-4o-mini";

export const aiEnabled = () => Boolean(AI_ENDPOINT && AI_KEY);

/**
 * Optional LLM judge: given the merged search results, have the model verify
 * which one is the most correct / authoritative answer. Degrades gracefully to
 * the heuristic ranking when no AI endpoint is configured.
 *
 * @returns {Promise<{answer:string,bestId:number|null,confidence:number}|null>}
 */
export async function aiJudge(query, ranked, { timeout = 30000 } = {}) {
  if (!aiEnabled()) return null;

  const list = ranked
    .slice(0, 8)
    .map((r, i) => `${i}. TITLE: ${r.title}\n   URL: ${r.url}\n   SNIPPET: ${r.snippet || "（无）"}`)
    .join("\n\n");

  const prompt =
    `你是搜索答案裁判。根据以下从 Bing 和百度抓取的候选搜索结果，针对查询判断哪一条` +
    `内容最正确、最权威、最相关。请只输出 JSON（不要其他文字）：\n` +
    `{"answer":"用中文给出该查询的准确答案（1-3句，引用最佳来源）","bestId":<候选编号>,"confidence":<0-100>,"sourceIndexes":[<你认为可靠的前3条编号>]}\n\n` +
    `查询：${query}\n\n候选结果：\n${list}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${AI_ENDPOINT}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": AI_KEY,
        "User-Agent": "Mozilla/5.0 (search-neo/Vexify)",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a strict search-result judge. Reply only with valid JSON. Use Chinese for the answer field.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        max_tokens: 500,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const jsonStr = content.match(/\{[\s\S]*\}/);
    if (!jsonStr) return null;
    const parsed = JSON.parse(jsonStr[0]);
    return {
      answer: cleanText(parsed.answer || ""),
      bestId: Number.isFinite(parsed.bestId) ? parsed.bestId : null,
      confidence: Number.isFinite(parsed.confidence) ? parsed.confidence : 50,
      sourceIndexes: Array.isArray(parsed.sourceIndexes) ? parsed.sourceIndexes : [],
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
