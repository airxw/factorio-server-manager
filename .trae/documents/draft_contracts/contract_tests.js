const Ajv = require('ajv');
const fs = require('fs');
const path = require('path');

const ajv = new Ajv({ strict: false });

function testSchema(schemaName, data, expectedValid) {
  const schemaPath = path.join(__dirname, schemaName);
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const validate = ajv.compile(schema);
  const valid = validate(data);
  
  if (valid !== expectedValid) {
    console.error(`❌ Test failed for ${schemaName}`);
    console.error(`Expected valid: ${expectedValid}, but got: ${valid}`);
    if (!valid) console.error(validate.errors);
    process.exit(1);
  } else {
    console.log(`✅ Test passed for ${schemaName}`);
  }
}

console.log("Running Contract Tests...");

// 1. Test GlobalAsset Schema
testSchema('global_asset.schema.json', {
  id: "global_1",
  type: "COMMODITY",
  name: "Basic VIP",
  is_active: true
}, true);

testSchema('global_asset.schema.json', {
  id: "global_2",
  type: "INVALID_TYPE", // Should fail enum
  name: "Basic VIP",
  is_active: true
}, false);

// 2. Test InstanceAsset Schema
testSchema('instance_asset.schema.json', {
  id: "inst_1",
  instance_id: "server_1",
  global_asset_id: "global_1",
  is_ugc: false
}, true);

testSchema('instance_asset.schema.json', {
  id: "inst_2",
  // Missing instance_id
  is_ugc: true
}, false);

// 3. Test Config Schema
testSchema('commercial_config.schema.json', {
  max_ugc_assets_per_instance: 50,
  rcon_sandbox_allowed_patterns: ["^[a-zA-Z]+$"],
  asset_retention_days: 30
}, true);

testSchema('commercial_config.schema.json', {
  max_ugc_assets_per_instance: -10, // Minimum is 0
  rcon_sandbox_allowed_patterns: ["^[a-zA-Z]+$"],
  asset_retention_days: 30
}, false);

console.log("All contract tests passed successfully!");
