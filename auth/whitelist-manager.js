#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');

const args = process.argv.slice(2);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

function showHelp() {
  console.log(`
Whitelist Manager

Commands:
  npm run whitelist add <email>       Allow user to log in
  npm run whitelist remove <email>    Remove user access
  npm run whitelist list              Show all whitelisted users
  npm run whitelist check <email>     Check user access

Examples:
  npm run whitelist add john@example.com
  npm run whitelist remove john@example.com
  npm run whitelist list
  npm run whitelist check admin@company.com
`);
}

function getNamespaceId() {
  try {
    const toml = fs.readFileSync('wrangler.toml', 'utf8');
    const match = toml.match(/binding\s*=\s*"AUTH_KV"[\s\S]*?id\s*=\s*"([^"]+)"/);
    if (match && match[1]) {
      return match[1];
    }
    throw new Error('AUTH_KV configuration not found');
  } catch (error) {
    console.error('Error: Could not find AUTH_KV configuration in wrangler.toml');
    console.error('Make sure you are running this from the auth directory.');
    process.exit(1);
  }
}

function validateEmail(email) {
  return EMAIL_REGEX.test(email) && email.length <= MAX_EMAIL_LENGTH;
}

function runCommand(command) {
  try {
    const result = execSync(command, { 
      encoding: 'utf8', 
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000
    });
    return { success: true, output: result.trim() };
  } catch (error) {
    return { 
      success: false, 
      error: error.message || 'Command execution failed'
    };
  }
}

function handleAdd(email, namespaceId) {
  if (!email) {
    console.error('Error: Please provide an email address');
    console.log('Usage: npm run whitelist add user@example.com');
    process.exit(1);
  }
  
  if (!validateEmail(email)) {
    console.error('Error: Invalid email address');
    process.exit(1);
  }
  
  console.log(`Adding ${email} to whitelist...`);
  const result = runCommand(
    `wrangler kv key put --namespace-id=${namespaceId} --remote "whitelist:${email.toLowerCase()}" "true"`
  );
  
  if (result.success) {
    console.log(`Success: ${email} can now log in`);
  } else {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
}

function handleRemove(email, namespaceId) {
  if (!email) {
    console.error('Error: Please provide an email address');
    console.log('Usage: npm run whitelist remove user@example.com');
    process.exit(1);
  }
  
  if (!validateEmail(email)) {
    console.error('Error: Invalid email address');
    process.exit(1);
  }
  
  console.log(`Removing ${email} from whitelist...`);
  const result = runCommand(
    `wrangler kv key delete --namespace-id=${namespaceId} --remote "whitelist:${email.toLowerCase()}"`
  );
  
  if (result.success) {
    console.log(`Success: ${email} can no longer log in`);
  } else {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
}

function handleCheck(email, namespaceId) {
  if (!email) {
    console.error('Error: Please provide an email address');
    console.log('Usage: npm run whitelist check user@example.com');
    process.exit(1);
  }
  
  if (!validateEmail(email)) {
    console.error('Error: Invalid email address');
    process.exit(1);
  }
  
  console.log(`Checking access for ${email}...`);
  const result = runCommand(
    `wrangler kv key get --namespace-id=${namespaceId} --remote "whitelist:${email.toLowerCase()}"`
  );
  
  if (result.success && result.output === 'true') {
    console.log(`Success: ${email} has access`);
  } else {
    console.log(`Info: ${email} does not have access`);
  }
}

function handleList(namespaceId) {
  console.log('Getting list of users with access...');
  const result = runCommand(
    `wrangler kv key list --namespace-id=${namespaceId} --remote --prefix="whitelist:"`
  );
  
  if (!result.success) {
    console.error('Error:', result.error);
    process.exit(1);
  }
  
  try {
    const keys = JSON.parse(result.output);
    
    if (!Array.isArray(keys) || keys.length === 0) {
      console.log('No users have access yet.');
      console.log('Add someone with: npm run whitelist add user@example.com');
      return;
    }
    
    console.log(`${keys.length} user${keys.length === 1 ? '' : 's'} with access:`);
    keys.forEach((key, index) => {
      const email = key.name.replace('whitelist:', '');
      console.log(`  ${index + 1}. ${email}`);
    });
  } catch (error) {
    console.error('Error: Could not parse the list:', error.message);
    process.exit(1);
  }
}

function main() {
  const command = args[0];
  const email = args[1];
  const namespaceId = getNamespaceId();

  switch (command) {
    case 'add':
      handleAdd(email, namespaceId);
      break;
    case 'remove':
      handleRemove(email, namespaceId);
      break;
    case 'check':
      handleCheck(email, namespaceId);
      break;
    case 'list':
      handleList(namespaceId);
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      showHelp();
      break;
    default:
      console.error(`Error: Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

main();
