// DevBox upload implementations: EnvD /files binary writes, md5 verify, and
// tar extraction for projects. No session, no HTTP tunnel, no file server.

import { createHash } from 'node:crypto';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { dirname as posixDirname, posix } from 'node:path';

import { classifyLocalUploadPath } from '../upload-file.ts';
import { computeMd5, createTarGz } from '../upload-project.ts';
import { execDevboxOneShot, writeDevboxFile } from './devbox-envd-client.ts';
import { withDevboxConnection } from './devbox-service-api.ts';

export interface DevboxUploadFileResult {
  ok: boolean;
  localPath: string;
  remotePath: string;
  bytes: number;
  chunks: number;
  md5: string;
  md5Verified: boolean;
}

export interface DevboxUploadProjectResult {
  ok: boolean;
  localDir: string;
  remotePath: string;
  bytes: number;
  md5: string;
  md5Verified: boolean;
  extracted: boolean;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function remoteParent(remotePath: string): string {
  const parent = posixDirname(remotePath);
  return parent && parent !== '.' ? parent : '/';
}

async function verifiedRemoteMd5(
  workspaceId: string,
  remotePath: string,
  expectedMd5: string,
  timeoutMs: number,
): Promise<boolean> {
  return withDevboxConnection(workspaceId, async (connection) => {
    const result = await execDevboxOneShot(
      connection,
      `md5sum ${shellQuote(remotePath)} | awk '{print $1}'`,
      Math.min(timeoutMs, 60000),
    );
    return result.stdout.trim() === expectedMd5;
  });
}

export async function uploadFileDevbox(
  workspaceId: string,
  localPath: string,
  remotePath: string,
  timeoutMs = 120000,
): Promise<DevboxUploadFileResult> {
  const localError = classifyLocalUploadPath(localPath, 'file');
  if (localError) throw localError;
  if (!remotePath.startsWith('/')) throw new Error('sandbox upload: remote_path must be an absolute path.');

  const data = readFileSync(localPath);
  const md5 = createHash('md5').update(data).digest('hex');

  await withDevboxConnection(workspaceId, async (connection) => {
    await execDevboxOneShot(connection, `mkdir -p ${shellQuote(remoteParent(remotePath))}`, Math.min(timeoutMs, 30000));
    await writeDevboxFile(connection, remotePath, data, timeoutMs);
  });

  const md5Verified = await verifiedRemoteMd5(workspaceId, remotePath, md5, timeoutMs);
  if (!md5Verified) {
    throw new Error(`sandbox upload: md5 mismatch after writing ${remotePath}.`);
  }
  return {
    ok: true,
    localPath,
    remotePath,
    bytes: data.length,
    chunks: 1,
    md5,
    md5Verified,
  };
}

export async function uploadProjectDevbox(
  workspaceId: string,
  localDir: string,
  remoteDir: string | undefined,
  timeoutMs = 300000,
  options: { exclude?: string[]; extract?: boolean; verify?: boolean } = {},
): Promise<DevboxUploadProjectResult> {
  const localError = classifyLocalUploadPath(localDir, 'directory');
  if (localError) throw localError;

  const projectName = posix.basename(localDir);
  const targetParentDir = remoteDir || '/workspace';
  const archiveRemotePath = `${targetParentDir}/${projectName}.tar.gz`;
  const archivePath = await createTarGz(localDir, options.exclude);

  try {
    const archiveSize = statSync(archivePath).size;
    const expectedMd5 = await computeMd5(archivePath);
    const archiveBytes = readFileSync(archivePath);

    await withDevboxConnection(workspaceId, async (connection) => {
      await execDevboxOneShot(connection, `mkdir -p ${shellQuote(targetParentDir)}`, Math.min(timeoutMs, 30000));
      await writeDevboxFile(connection, archiveRemotePath, archiveBytes, timeoutMs);
    });

    const md5Verified = await verifiedRemoteMd5(workspaceId, archiveRemotePath, expectedMd5, timeoutMs);
    if (options.verify !== false && !md5Verified) {
      throw new Error(`sandbox upload project: md5 mismatch after writing ${archiveRemotePath}.`);
    }

    if (options.extract !== false) {
      await withDevboxConnection(workspaceId, async (connection) => {
        const extract = await execDevboxOneShot(
          connection,
          `mkdir -p ${shellQuote(targetParentDir)} && tar -xzf ${shellQuote(archiveRemotePath)} -C ` +
            `${shellQuote(targetParentDir)} && rm -f ${shellQuote(archiveRemotePath)}`,
          timeoutMs,
        );
        if (extract.exitCode !== 0) {
          throw new Error(
            `sandbox upload project: tar extraction failed (exit ${extract.exitCode}): ${extract.stderr.trim()}`,
          );
        }
        // Best-effort traverse-permission hardening for later nginx serving.
        await execDevboxOneShot(
          connection,
          [
            `REAL_PATH=$(readlink -f ${shellQuote(`${targetParentDir}/${projectName}`)} 2>/dev/null || echo ${shellQuote(`${targetParentDir}/${projectName}`)})`,
            `if [ ! -d "$REAL_PATH" ] && [ -d ${shellQuote(targetParentDir)} ]; then`,
            `  REAL_PATH=${shellQuote(`${targetParentDir}/${projectName}`)}`,
            `fi`,
            `chmod -R o+rX "$REAL_PATH" 2>/dev/null || true`,
            `find "$REAL_PATH" -type d -exec chmod o+x {} \\; 2>/dev/null || true`,
            `find "$REAL_PATH" -type f -path "*/node_modules/.bin/*" -exec chmod +x {} \\; 2>/dev/null || true`,
          ].join('\n'),
          Math.min(timeoutMs, 15000),
        ).catch(() => undefined);
      });
    }

    return {
      ok: true,
      localDir,
      remotePath: options.extract !== false ? `${targetParentDir}/${projectName}` : archiveRemotePath,
      bytes: archiveSize,
      md5: expectedMd5,
      md5Verified,
      extracted: options.extract !== false,
    };
  } finally {
    try {
      rmSync(posixDirname(archivePath), { recursive: true, force: true });
    } catch {
      // best-effort local temp cleanup
    }
  }
}
