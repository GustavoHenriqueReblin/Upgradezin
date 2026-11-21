/**
 * Endereço público temporário para mostrar o app a alguém (Cloudflare Quick Tunnel, sem conta).
 *   pnpm serve   (num terminal: build + servidor)
 *   pnpm share   (em outro)
 *
 * Na primeira vez baixa o cloudflared oficial para .tools/ (fora do git) e confere o SHA-256.
 * O link (https://….trycloudflare.com) muda a cada execução e some ao fechar (Ctrl+C).
 * O app ainda não tem login: mande o link só para quem deve usar e feche quando terminar.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '2026.10.7';
/** Digests publicados no release oficial (github.com/cloudflare/cloudflared/releases). */
const ASSETS = {
  'win32-x64': { file: 'cloudflared-windows-amd64.exe', sha256: '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343' },
  'linux-x64': { file: 'cloudflared-linux-amd64', sha256: '1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872' },
  'linux-arm64': { file: 'cloudflared-linux-arm64', sha256: '3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775' },
};

const asset = ASSETS[`${platform()}-${arch()}`];
if (!asset) {
  console.error(`Sistema não suportado pelo script (${platform()}-${arch()}). Instale o cloudflared manualmente.`);
  process.exit(1);
}

const binDir = join(ROOT, '.tools');
const bin = join(binDir, `cloudflared-${VERSION}${platform() === 'win32' ? '.exe' : ''}`);

if (!existsSync(bin)) {
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/${asset.file}`;
  console.log(`Baixando cloudflared ${VERSION}…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download falhou: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  const digest = createHash('sha256').update(data).digest('hex');
  if (digest !== asset.sha256) throw new Error(`SHA-256 não confere (${digest}); download descartado.`);
  mkdirSync(binDir, { recursive: true });
  writeFileSync(`${bin}.part`, data);
  renameSync(`${bin}.part`, bin);
  if (platform() !== 'win32') chmodSync(bin, 0o755);
  console.log('cloudflared salvo em .tools/ (hash conferido).');
}

// Porta do servidor: PORT do .env, senão 8787.
let port = process.env.PORT;
const envFile = join(ROOT, '.env');
if (!port && existsSync(envFile)) port = readFileSync(envFile, 'utf8').match(/^PORT=(\d+)/m)?.[1];
port ??= '8787';

const up = await fetch(`http://127.0.0.1:${port}/api/stores`).then((r) => r.ok).catch(() => false);
if (!up) {
  console.error(`O app não está respondendo em http://localhost:${port}. Rode antes, em outro terminal:\n  pnpm serve`);
  process.exit(1);
}

console.log(`Abrindo túnel para http://localhost:${port} … o link aparece abaixo (procure "trycloudflare.com").`);
const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
const onLine = (buf) => {
  const link = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (link) console.log(`\n  Link público: ${link[0]}\n  (Ctrl+C fecha o túnel)\n`);
};
child.stdout.on('data', onLine);
child.stderr.on('data', onLine);
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
