import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSkillInstallCommand } from '../plugins/huaweicloud-core/src/search-market.mjs';

const SKILL = { name: 'billing', category: 'bss', service: 'billing' };

test('F: buildSkillInstallCommand uses HTTP ZIP download, never git', () => {
  const cmd = buildSkillInstallCommand(SKILL, '~/.claude/skills');
  assert.match(cmd, /curl -fsSL https:\/\/gitcode\.com/);
  assert.match(cmd, /unzip -oq/);
  assert.doesNotMatch(cmd, /git clone|npx skills add|gitcode\.com\/huaweicloud\/huaweicloud-skills\.git/);
});

test('F: buildSkillInstallCommand builds the exact skill path from category/service', () => {
  const cmd = buildSkillInstallCommand(SKILL, '~/.claude/skills');
  assert.match(cmd, /skills\/bss\/billing\/billing/);
  assert.match(cmd, /cp -r "\$SKILL_SRC" "~\/\.claude\/skills\/billing"/);
});

test('F: buildSkillInstallCommand falls back to find-by-name when category/service missing', () => {
  const cmd = buildSkillInstallCommand({ name: 'huawei-cloud-billing-scout' }, '<skills-dir>');
  assert.doesNotMatch(cmd, /skills\/bss/);
  assert.match(
    cmd,
    /find \/tmp\/hw-skills-net\/huaweicloud-skills-master\/skills .* -name "huawei-cloud-billing-scout"/,
  );
});

test('F: buildSkillInstallCommand reports SKILL_SRC_NOT_FOUND when the folder is absent', () => {
  const cmd = buildSkillInstallCommand(SKILL, '~/.claude/skills');
  assert.match(cmd, /SKILL_SRC_NOT_FOUND/);
});

test('F: buildSkillInstallCommand has GitHub fallback when GitCode download fails', () => {
  const cmd = buildSkillInstallCommand(SKILL, '~/.claude/skills');
  assert.match(cmd, /github\.com\/huaweicloud\/huaweicloud-skills\/archive/);
  assert.match(cmd, /\) \|\| \(/);
});

test('F: buildSkillInstallCommand sanitizes skill name into the target dir name', () => {
  const cmd = buildSkillInstallCommand({ name: 'my skill/../x', category: 'c', service: 's' }, '~/.skills');
  assert.doesNotMatch(cmd, /\/\.\.\//);
  assert.match(cmd, /~\/\.skills\/my-skill----x/);
});
