# Netrunner Collection

A static PWA in `static/`, deployed by GitHub Pages on every push to `main` (see README).

## Every change to static/ needs a VERSION bump and a changelog line

- Bump `VERSION` in `static/sw.js` in each commit that changes `static/` (one bump per commit, `<date>.<n>`).
- Follow the `changelog` skill (`.claude/skills/changelog/SKILL.md`): add the user-facing line to
  `static/changelog.json`, or put `Changelog: none (reason)` in the commit message, and set `"checked"`.
- **Show the user the changelog line, or the "none" reason, before every such commit, and wait for their OK.**
- `go run ./tools/changelog` must pass; the Pages workflow runs it on every commit in the push and won't deploy
  otherwise.
