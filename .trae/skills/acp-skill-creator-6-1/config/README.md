
# Backend 配置说明

## Claude Code 环境

✅ **无需此配置**，Claude Code使用内置的Claude后端。

---

## 非Claude Code 环境

需要配置 `config/backend.json`。

### 配置步骤

1. 复制 `config/backend.json` 到你的本地环境
2. 修改以下字段：
   - `model`: 你的模型名称
   - `api_key`: 你的API密钥
   - `base_url`: API基础URL（如OpenAI兼容端点）
   - `timeout`: 超时时间（秒，默认300）

### OpenAI兼容配置示例

```json
{
  "default": {
    "type": "openai_compatible",
    "model": "gpt-4-turbo",
    "api_key": "sk-...",
    "base_url": "https://api.openai.com/v1",
    "timeout": 300
  }
}
```

### 其他兼容端点

对于兼容OpenAI API的服务（如本地部署的模型、第三方服务等），只需修改`base_url`和`model`即可。

---

## ⚠️ 安全边界

**重要提醒：**

- 🔒 API密钥只保存在本地个人环境
- 🚫 不要将包含真实密钥的 `backend.json` 提交到版本控制
- 📋 建议在 `.gitignore` 中添加 `config/backend.json`（如果需要修改此文件）
- 📝 进入版本控制前请自行忽略/脱敏
