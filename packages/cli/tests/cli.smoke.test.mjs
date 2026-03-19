import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const cliDistEntry = path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js');

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-9;]*m/g, '');
}

async function startApiServer() {
  const requests = [];

  const server = createServer(async (req, res) => {
    const bodyChunks = [];

    for await (const chunk of req) {
      bodyChunks.push(Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(bodyChunks).toString('utf8');
    const body = rawBody ? JSON.parse(rawBody) : null;

    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
    });

    if (req.method === 'POST' && req.url === '/api/auth/login') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ token: 'test-token' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/companies') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ id: 'company-123', name: 'QA Test Corp' }]));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/templates/import') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ imported: true, company_id: 'company-123' }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  return {
    baseUrl: `http://127.0.0.1:${address.port}/api`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      }),
  };
}

async function runCli(args, extraEnv) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliDistEntry, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code,
        stdout: stripAnsi(stdout),
        stderr: stripAnsi(stderr),
      });
    });
  });
}

test('login persists auth state and status reuses it for authorized company-scoped requests', async () => {
  const api = await startApiServer();
  const configHome = await mkdtemp(path.join(tmpdir(), 'biuro-cli-smoke-'));

  try {
    const env = {
      BIURO_API_URL: api.baseUrl,
      APPDATA: configHome,
      LOCALAPPDATA: configHome,
      XDG_CONFIG_HOME: configHome,
      HOME: configHome,
      USERPROFILE: configHome,
    };

    const loginResult = await runCli(
      ['login', 'ada@example.com', 'password123', '--company', 'company-123'],
      env
    );

    assert.equal(loginResult.code, 0);
    assert.match(loginResult.stdout, /Successfully logged in!/);

    const statusResult = await runCli(['status'], env);

    assert.equal(statusResult.code, 0);
    assert.match(statusResult.stdout, /--- Biuro Status ---/);
    assert.match(statusResult.stdout, /QA Test Corp/);

    const loginRequest = api.requests.find(
      (request) =>
        request.method === 'POST' && request.url === '/api/auth/login'
    );
    assert.deepEqual(loginRequest?.body, {
      email: 'ada@example.com',
      password: 'password123',
    });

    const statusRequest = api.requests.find(
      (request) => request.method === 'GET' && request.url === '/api/companies'
    );
    assert.equal(statusRequest?.headers.authorization, 'Bearer test-token');
    assert.equal(statusRequest?.headers['x-company-id'], 'company-123');
  } finally {
    await api.close();
  }
});

test('deploy uploads a local template JSON file to the import endpoint', async () => {
  const api = await startApiServer();
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'biuro-cli-deploy-'));
  const templatePath = path.join(tempRoot, 'template.json');

  try {
    await writeFile(
      templatePath,
      JSON.stringify({
        version: '1.0.0',
        company: {
          name: 'Template Co',
        },
      }),
      'utf8'
    );

    const result = await runCli(['deploy', templatePath], {
      BIURO_API_URL: api.baseUrl,
      APPDATA: tempRoot,
      LOCALAPPDATA: tempRoot,
      XDG_CONFIG_HOME: tempRoot,
      HOME: tempRoot,
      USERPROFILE: tempRoot,
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Successfully deployed template:/);
    assert.match(result.stdout, /company-123/);

    const deployRequest = api.requests.find(
      (request) =>
        request.method === 'POST' && request.url === '/api/templates/import'
    );
    assert.deepEqual(deployRequest?.body, {
      version: '1.0.0',
      company: {
        name: 'Template Co',
      },
    });

    const fileContents = await readFile(templatePath, 'utf8');
    assert.match(fileContents, /Template Co/);
  } finally {
    await api.close();
  }
});
