import { Client } from 'ssh2';

export interface WindowsSshExecParams {
  host: string;
  port: number;
  username: string;
  privateKey: string | Buffer;
  command: string;
  timeoutMs: number;
}

export interface WindowsSshExecResult {
  code: number | null;
  signal?: string;
  stdout: string;
  stderr: string;
}

export type WindowsCommandExecutor = (
  params: WindowsSshExecParams,
) => Promise<WindowsSshExecResult>;

export type WindowsExecutorErrorKind = 'TIMEOUT' | 'AUTH_FAILED' | 'CONNECTION_FAILED';

export class WindowsCollectorError extends Error {
  readonly kind: WindowsExecutorErrorKind;

  constructor(kind: WindowsExecutorErrorKind, message: string) {
    super(message);
    this.name = 'WindowsCollectorError';
    this.kind = kind;
  }
}

const MAX_OUTPUT_BYTES = 1024 * 1024;

function classifySshError(error: Error & { level?: string; code?: string }): WindowsCollectorError {
  const msg = error.message.toLowerCase();
  if (
    error.level === 'client-authentication' ||
    msg.includes('authentication') ||
    msg.includes('all configured authentication methods failed')
  ) {
    return new WindowsCollectorError('AUTH_FAILED', 'SSH 认证失败，请检查用户名或私钥');
  }

  if (error.code === 'ETIMEDOUT' || error.level === 'client-timeout' || msg.includes('timed out')) {
    return new WindowsCollectorError('TIMEOUT', 'SSH 连接或命令执行超时');
  }

  return new WindowsCollectorError('CONNECTION_FAILED', '连接被拒绝或主机不可达');
}

/**
 * 使用纯 JS ssh2 客户端执行单条远端命令，包含连接超时与整体执行超时保护。
 */
export function executeSshCommand(params: WindowsSshExecParams): Promise<WindowsSshExecResult> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      try {
        conn.end();
      } catch {
        // 忽略关闭异常
      }
      try {
        conn.destroy();
      } catch {
        // 忽略销毁异常
      }
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const succeed = (result: WindowsSshExecResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const timer = setTimeout(() => {
      fail(new WindowsCollectorError('TIMEOUT', 'SSH 连接或命令执行超时'));
    }, params.timeoutMs);

    conn.on('error', (err) => {
      fail(classifySshError(err as Error & { level?: string; code?: string }));
    });

    conn.on('ready', () => {
      conn.exec(params.command, (execErr, stream) => {
        if (execErr) {
          fail(
            new WindowsCollectorError('CONNECTION_FAILED', '无法启动远端 SSH 会话，请检查主机配置'),
          );
          return;
        }

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;

        stream.on('data', (chunk: Buffer) => {
          if (stdoutBytes < MAX_OUTPUT_BYTES) {
            const slice = chunk.subarray(0, MAX_OUTPUT_BYTES - stdoutBytes);
            stdoutChunks.push(slice);
            stdoutBytes += slice.length;
          }
        });

        stream.stderr.on('data', (chunk: Buffer) => {
          if (stderrBytes < MAX_OUTPUT_BYTES) {
            const slice = chunk.subarray(0, MAX_OUTPUT_BYTES - stderrBytes);
            stderrChunks.push(slice);
            stderrBytes += slice.length;
          }
        });

        stream.on('close', (code: number | null, signal?: string) => {
          succeed({
            code: typeof code === 'number' ? code : null,
            ...(signal ? { signal } : {}),
            stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
            stderr: Buffer.concat(stderrChunks).toString('utf-8'),
          });
        });
      });
    });

    try {
      conn.connect({
        host: params.host,
        port: params.port,
        username: params.username,
        privateKey: params.privateKey,
        readyTimeout: params.timeoutMs,
      });
    } catch (error) {
      fail(
        classifySshError(
          error instanceof Error
            ? (error as Error & { level?: string; code?: string })
            : new Error('连接初始化失败'),
        ),
      );
    }
  });
}
