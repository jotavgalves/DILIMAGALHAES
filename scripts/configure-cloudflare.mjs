import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

const PROJECT = 'dilimagalhaes';
const [jsonPath, driveFileId] = process.argv.slice(2);

if (!jsonPath || !driveFileId) {
  console.error('Uso: npm run cf:secrets -- "C:\\caminho\\chave.json" "GOOGLE_DRIVE_FILE_ID"');
  process.exit(1);
}

const raw = await fs.readFile(jsonPath, 'utf8');
const credentials = JSON.parse(raw);

for (const field of ['project_id', 'client_email', 'private_key']) {
  if (!credentials[field]) {
    console.error(`Campo obrigatório ausente no JSON: ${field}`);
    process.exit(1);
  }
}

const secrets = {
  GOOGLE_PROJECT_ID: credentials.project_id,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: credentials.client_email,
  GOOGLE_PRIVATE_KEY: credentials.private_key,
  GOOGLE_DRIVE_FILE_ID: driveFileId,
};

function putSecret(name, value) {
  return new Promise((resolve, reject) => {
    console.log(`Configurando ${name}...`);
    const child = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['wrangler', 'pages', 'secret', 'put', name, '--project-name', PROJECT],
      { stdio: ['pipe', 'inherit', 'inherit'] }
    );
    child.stdin.write(String(value));
    child.stdin.end();
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Falha ao configurar ${name}. Código ${code}`)));
    child.on('error', reject);
  });
}

for (const [name, value] of Object.entries(secrets)) {
  await putSecret(name, value);
}

console.log('\nSecrets configurados com sucesso.');
console.log('Confira com: npx wrangler pages secret list --project-name dilimagalhaes');
console.log('Depois, um novo deploy pode ser feito com: npm run deploy');
