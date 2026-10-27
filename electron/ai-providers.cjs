// AI 服务商预设：切换服务商时自动带出对应的接口地址与默认模型。
// OpenAI 兼容接口不预设（由用户按自建网关/第三方文档填写）。
const AI_PROVIDERS = [
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { id: "zhipu", label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  { id: "qwen", label: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { id: "kimi", label: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { id: "openai-compatible", label: "OpenAI 兼容接口", baseUrl: "", model: "" }
];

const DEFAULT_PROVIDER = "deepseek";

function providerPreset(id) {
  return AI_PROVIDERS.find((provider) => provider.id === id) || null;
}

module.exports = { AI_PROVIDERS, DEFAULT_PROVIDER, providerPreset };
