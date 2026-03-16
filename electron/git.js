'use strict';

const simpleGit = require('simple-git');

async function getInfo(projectPath) {
  const git = simpleGit(projectPath);

  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return { branch: null, lastCommit: null, isRepo: false };
    }

    const [branch, log] = await Promise.all([
      git.revparse(['--abbrev-ref', 'HEAD']).catch(() => null),
      git.log({ maxCount: 1 }).catch(() => null),
    ]);

    const lastCommit = log && log.latest
      ? {
          hash: log.latest.hash ? log.latest.hash.slice(0, 7) : '',
          message: log.latest.message || '',
          author: log.latest.author_name || '',
          date: log.latest.date || '',
        }
      : null;

    return {
      branch: branch ? branch.trim() : null,
      lastCommit,
      isRepo: true,
    };
  } catch (err) {
    return { branch: null, lastCommit: null, isRepo: false };
  }
}

module.exports = { getInfo };
