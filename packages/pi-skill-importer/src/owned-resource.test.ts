import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	delete_owned_skill_resource,
	get_skill_delete_target,
} from './owned-resource.js';

const temp_dirs: string[] = [];

function make_skills_dir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-skill-owned-'));
	temp_dirs.push(dir);
	mkdirSync(join(dir, 'dedicated'));
	writeFileSync(join(dir, 'dedicated', 'SKILL.md'), 'skill');
	writeFileSync(join(dir, 'one.md'), 'one');
	writeFileSync(join(dir, 'two.md'), 'two');
	return dir;
}

afterEach(() => {
	for (const dir of temp_dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('delete_owned_skill_resource', () => {
	it('removes only the file of a file-owned skill', () => {
		const dir = make_skills_dir();
		const skill = {
			skillPath: join(dir, 'one.md'),
			baseDir: dir,
			ownership: 'file' as const,
		};

		expect(get_skill_delete_target(skill)).toBe(join(dir, 'one.md'));
		expect(delete_owned_skill_resource(skill)).toEqual({
			deleted_path: join(dir, 'one.md'),
			ownership: 'file',
		});
		expect(existsSync(join(dir, 'two.md'))).toBe(true);
		expect(existsSync(join(dir, 'dedicated', 'SKILL.md'))).toBe(true);
	});

	it('removes a dedicated directory as a unit', () => {
		const dir = make_skills_dir();
		const skill = {
			skillPath: join(dir, 'dedicated', 'SKILL.md'),
			baseDir: join(dir, 'dedicated'),
			ownership: 'directory' as const,
		};

		expect(get_skill_delete_target(skill)).toBe(
			join(dir, 'dedicated'),
		);
		delete_owned_skill_resource(skill);

		expect(existsSync(join(dir, 'dedicated'))).toBe(false);
		expect(existsSync(join(dir, 'one.md'))).toBe(true);
	});

	it('removes only the link of a symlinked skill directory', () => {
		const dir = make_skills_dir();
		symlinkSync(join(dir, 'dedicated'), join(dir, 'linked'), 'dir');

		delete_owned_skill_resource({
			skillPath: join(dir, 'linked', 'SKILL.md'),
			baseDir: join(dir, 'linked'),
			ownership: 'directory',
		});

		expect(existsSync(join(dir, 'linked'))).toBe(false);
		expect(existsSync(join(dir, 'dedicated', 'SKILL.md'))).toBe(true);
	});

	it('reports no delete target when ownership is unknown', () => {
		expect(
			get_skill_delete_target({
				skillPath: '/skills/one.md',
				baseDir: '/skills',
			}),
		).toBeNull();
	});

	it.each([
		{
			label: 'unknown ownership',
			skill: (dir: string) => ({
				skillPath: join(dir, 'one.md'),
				baseDir: dir,
			}),
			error: /unknown ownership/,
		},
		{
			label: 'a directory claim over a shared directory',
			skill: (dir: string) => ({
				skillPath: join(dir, 'one.md'),
				baseDir: dir,
				ownership: 'directory' as const,
			}),
			error: /unsafe skill path/,
		},
		{
			label: 'a directory claim that does not contain the skill file',
			skill: (dir: string) => ({
				skillPath: join(dir, 'dedicated', 'SKILL.md'),
				baseDir: dir,
				ownership: 'directory' as const,
			}),
			error: /unsafe skill path/,
		},
		{
			label: 'a file claim over a directory',
			skill: (dir: string) => ({
				skillPath: join(dir, 'dedicated'),
				baseDir: dir,
				ownership: 'file' as const,
			}),
			error: /unsafe skill path/,
		},
	])('rejects $label before removal', ({ skill, error }) => {
		const dir = make_skills_dir();
		const target = skill(dir);

		expect(() => delete_owned_skill_resource(target)).toThrow(error);
		expect(existsSync(join(dir, 'one.md'))).toBe(true);
		expect(existsSync(join(dir, 'two.md'))).toBe(true);
		expect(existsSync(join(dir, 'dedicated', 'SKILL.md'))).toBe(true);
	});
});
