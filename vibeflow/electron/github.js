// GitHub connector: pull open issues from a repo via the `gh` CLI and turn them
// into knowledge-base inbox items (product ideas). Requires `gh` to be installed
// and authenticated (the host already has it configured).
const { execFile } = require('child_process');

function importGithub(repo, channelId, state) {
  return new Promise((resolve) => {
    if (!repo || !repo.includes('/')) {
      return resolve({ items: [], error: '仓库格式应为 owner/name' });
    }
    execFile(
      'gh',
      ['api', `repos/${repo}/issues?state=open&per_page=20`, '--jq', '.[].{title:title,body:body,user:(.user.login)}'],
      { maxBuffer: 10 * 1024 * 1024, timeout: 20000 },
      (err, stdout) => {
        if (err) return resolve({ items: [], error: err.message });
        let parsed = [];
        try {
          parsed = JSON.parse(stdout);
        } catch (e) {
          return resolve({ items: [], error: '解析 GitHub 响应失败' });
        }
        const items = (Array.isArray(parsed) ? parsed : []).map((it) => ({
          title: it.title || '未命名 Issue',
          content: it.body || '',
          author: it.user || repo,
        }));
        resolve({ items });
      }
    );
  });
}

module.exports = { importGithub };
