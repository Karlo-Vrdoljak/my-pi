import { existsSync, lstatSync, rmSync, unlinkSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import type {
	ScannedSkill,
	SkillOwnership,
} from './scanner-primitives.js';

export interface OwnedSkillResource {
	deleted_path: string;
	ownership: SkillOwnership;
}

type OwnedSkill = Pick<
	ScannedSkill,
	'skillPath' | 'baseDir' | 'ownership'
>;

/** Path that deleting the skill removes, or null when ownership is unknown. */
export function get_skill_delete_target(
	skill: OwnedSkill,
): string | null {
	if (skill.ownership === 'file') return resolve(skill.skillPath);
	if (skill.ownership === 'directory') return resolve(skill.baseDir);
	return null;
}

/**
 * Remove only what the skill owns: the skill file for a `file` skill, or
 * the dedicated directory for a `directory` skill. Unknown or
 * inconsistent ownership is rejected before anything is removed.
 */
export function delete_owned_skill_resource(
	skill: OwnedSkill,
): OwnedSkillResource {
	const skill_file = resolve(skill.skillPath);
	const skill_dir = resolve(skill.baseDir);

	if (skill.ownership === 'directory') {
		if (!existsSync(skill_dir)) {
			throw new Error(
				`Skill directory no longer exists: ${skill.baseDir}`,
			);
		}
		if (!existsSync(skill_file)) {
			throw new Error(
				`Skill file no longer exists: ${skill.skillPath}`,
			);
		}
		if (
			basename(skill_file) !== 'SKILL.md' ||
			dirname(skill_file) !== skill_dir
		) {
			throw new Error(
				`Refusing to delete unsafe skill path: ${skill.baseDir}`,
			);
		}
		rmSync(skill_dir, { recursive: true, force: true });
		return { deleted_path: skill_dir, ownership: 'directory' };
	}

	if (skill.ownership === 'file') {
		if (!existsSync(skill_file)) {
			throw new Error(
				`Skill file no longer exists: ${skill.skillPath}`,
			);
		}
		if (lstatSync(skill_file).isDirectory()) {
			throw new Error(
				`Refusing to delete unsafe skill path: ${skill.skillPath}`,
			);
		}
		unlinkSync(skill_file);
		return { deleted_path: skill_file, ownership: 'file' };
	}

	throw new Error(
		`Refusing to delete skill with unknown ownership: ${skill.skillPath}`,
	);
}
