import { Validator } from 'jsonschema';
import * as fs from 'fs';
import * as path from 'path';

const validator = new Validator();

function loadSchema(filename: string) {
  const schemaPath = path.resolve(__dirname, '../../schema', filename);
  if (!fs.existsSync(schemaPath)) {
    const configPath = path.resolve(__dirname, '../../config_template', filename);
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

function runTests() {
  let passed = true;

  console.log('--- 开始契约合规性验证 ---');

  // 1. 测试数据契约
  try {
    const serverInstanceSchema = loadSchema('server_instance.schema.json');
    const validInstance = {
      id: "inst-123",
      nodeId: "node-456",
      packId: "pack-789",
      status: "running",
      tags: ["env:prod"],
      metrics: { cpu: 10, memory: 1024, players: 5 }
    };
    const result = validator.validate(validInstance, serverInstanceSchema);
    if (!result.valid) {
      console.error('❌ Data Schema 测试失败:', result.errors);
      passed = false;
    } else {
      console.log('✅ Data Schema (ServerInstance) 验证通过');
    }
  } catch (e) {
    console.error('❌ 加载 Data Schema 失败', e);
    passed = false;
  }

  // 2. 测试配置契约 (验证是否包含默认值)
  try {
    const routingSchema = loadSchema('frontend_routing.schema.json');
    const hasDefaultView = routingSchema.properties.defaultView.default !== undefined;
    const hasViewPerms = routingSchema.properties.viewPermissions.properties.admin.default !== undefined;
    
    if (hasDefaultView && hasViewPerms) {
      console.log('✅ Config Schema 默认值验证通过');
    } else {
      console.error('❌ Config Schema 缺少默认值约束');
      passed = false;
    }
  } catch (e) {
    console.error('❌ 加载 Config Schema 失败', e);
    passed = false;
  }

  // 3. 验证接口存根是否包含 @throws
  try {
    const stubPath = path.resolve(__dirname, '../../interface_stub/unified_api.d.ts');
    const stubContent = fs.readFileSync(stubPath, 'utf8');
    if (stubContent.includes('@throws')) {
      console.log('✅ Interface Stub 包含异常抛出 (@throws) 声明');
    } else {
      console.error('❌ Interface Stub 缺少异常抛出声明');
      passed = false;
    }
  } catch (e) {
    console.error('❌ 加载 Interface Stub 失败', e);
    passed = false;
  }

  console.log(passed ? '\n🎉 所有契约验证均已通过！' : '\n💥 契约验证存在失败项。');
  process.exit(passed ? 0 : 1);
}

runTests();
