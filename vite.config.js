import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

// Comprueba si un puerto de la API local está disponible.
const isFree = port => new Promise((resolve, reject) => {
  const probe = createServer();

  probe.once('error', error => {
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
      resolve(false);
    } else {
      reject(error);
    }
  });

  probe.listen(port, '127.0.0.1', () => {
    probe.close(() => resolve(true));
  });
});

// Si 8766 está ocupado, busca el siguiente puerto libre.
async function availablePort() {
  const requested = Number(process.env.API_PORT || 8766);
  const first =
    Number.isInteger(requested) && requested > 0 && requested < 65536
      ? requested
      : 8766;

  for (let port = first; port < Math.min(first + 100, 65536); port++) {
    if (await isFree(port)) return port;
  }

  throw Error(
    `No se encontró un puerto disponible para la API local desde ${first}.`
  );
}

export default defineConfig(async ({ command }) => {
  // La API local solo se inicia durante npm run dev.
  if (command !== 'serve') return {};

  const apiPort = await availablePort();

  return {
    plugins: [
      {
        name: 'local-integration-api',

        configureServer(server) {
          const child = spawn('python3', ['local_server.py'], {
            cwd: process.cwd(),
            env: {
              ...process.env,
              API_PORT: String(apiPort)
            },
            stdio: ['ignore', 'inherit', 'inherit']
          });

          child.on('error', error => {
            console.error(
              'No se pudo iniciar la API local:',
              error.message
            );
          });

          server.httpServer?.once('close', () => {
            if (!child.killed) child.kill();
          });
        }
      }
    ],

    server: {
      proxy: {
        '/api': `http://127.0.0.1:${apiPort}`
      }
    }
  };
});