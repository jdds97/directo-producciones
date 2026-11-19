import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediaBytesDenied, MEDIA_LIMITS } from '../src/lib/editorial-policy.ts';

// MP4 reales de ffmpeg (los mismos que genera scripts/cms-media-e2e.mjs): la validación debe aceptar el exportado con faststart y rechazar el resto.
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const make = (faststart: boolean) => {
  const dir = mkdtempSync(join(tmpdir(), 'dp-ff-'));
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15', '-t', '2', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(faststart ? ['-movflags', '+faststart'] : []), join(dir, 'v.mp4')]);
    return new Uint8Array(readFileSync(join(dir, 'v.mp4')).subarray(0, MEDIA_LIMITS.headBytes));
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('MP4 H.264 de ffmpeg: con faststart pasa, sin él se rechaza con la pista de «Web optimizado»', { skip: !hasFfmpeg && 'ffmpeg no instalado' }, () => {
  assert.equal(mediaBytesDenied('video/mp4', make(true)), null);
  assert.match(mediaBytesDenied('video/mp4', make(false))!, /Web optimizado/);
});
