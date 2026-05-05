import { Router } from 'express';
import { sessionManager } from '../session-manager.js';
import { readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const router = Router();

// ── Sessions ──────────────────────────────────────────────

/** Create a new session */
router.post('/sessions', (req, res) => {
  const { projectDir, name } = req.body;
  if (!projectDir) {
    return res.status(400).json({ error: 'projectDir is required' });
  }
  if (!existsSync(projectDir)) {
    return res.status(400).json({ error: `Directory does not exist: ${projectDir}` });
  }
  const session = sessionManager.create(projectDir, name);
  res.status(201).json(session);
});

/** List all sessions */
router.get('/sessions', (_req, res) => {
  res.json(sessionManager.list());
});

/** Get session details + messages */
router.get('/sessions/:id', (req, res) => {
  const session = sessionManager.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json(session);
});

/** Delete a session */
router.delete('/sessions/:id', (req, res) => {
  sessionManager.delete(req.params.id);
  res.status(204).end();
});

/** Flush context for a session */
router.post('/sessions/:id/flush', (req, res) => {
  const session = sessionManager.flushContext(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Context flushed', claudeSessionId: session.claudeSessionId });
});

// ── Projects ──────────────────────────────────────────────

/** Scan for project directories */
router.get('/projects', (req, res) => {
  const baseDir = req.query.dir || process.env.PROJECTS_DIR || process.env.HOME || '/home';
  if (!existsSync(baseDir)) {
    return res.status(400).json({ error: `Base directory not found: ${baseDir}` });
  }

  try {
    const entries = readdirSync(baseDir);
    const projects = [];

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const fullPath = join(baseDir, entry);
      try {
        const stat = statSync(fullPath);
        if (!stat.isDirectory()) continue;

        const hasClaude = existsSync(join(fullPath, '.claude')) || existsSync(join(fullPath, 'CLAUDE.md'));
        const hasGit = existsSync(join(fullPath, '.git'));
        const hasPackage = existsSync(join(fullPath, 'package.json'));

        projects.push({
          name: entry,
          path: fullPath,
          hasClaude,
          hasGit,
          hasPackage,
        });
      } catch {
        // skip unreadable dirs
      }
    }

    projects.sort((a, b) => {
      if (a.hasClaude && !b.hasClaude) return -1;
      if (!a.hasClaude && b.hasClaude) return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ baseDir, projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Health check */
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

export default router;
