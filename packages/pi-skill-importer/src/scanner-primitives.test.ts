import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	dedupe_skills_by_path,
	find_project_roots,
	scan_skill_directory,
} from './scanner-primitives.js';

const temp_dirs: string[] = [];

function make_temp_dir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-skill-scanner-'));
	temp_dirs.push(dir);
	return dir;
}

function write_skill(
	path: string,
	description = 'Scanner fixture',
): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		`---\ndescription: ${description}\n---\n\n# Fixture\n`,
	);
}

afterEach(() => {
	for (const dir of temp_dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('skill scanner primitives', () => {
	it('preserves direct-root precedence and inferred names', () => {
		const root = make_temp_dir();
		write_skill(join(root, 'SKILL.md'), '  Direct fixture  ');
		write_skill(join(root, 'nested', 'SKILL.md'));

		expect(scan_skill_directory(root)).toEqual([
			{
				name: basename(root),
				description: 'Direct fixture',
				skillPath: join(root, 'SKILL.md'),
				baseDir: root,
				ownership: 'file',
			},
		]);
	});

	it('marks only dedicated skill directories as directory-owned', () => {
		const root = make_temp_dir();
		write_skill(join(root, 'SKILL.md'));
		write_skill(join(root, 'dedicated', 'SKILL.md'));
		write_skill(join(root, 'standalone.md'));

		const skills = scan_skill_directory(root, {
			include_direct_root_skill: false,
			include_root_markdown_skills: true,
		});

		expect(
			skills.map((skill) => [
				skill.skillPath,
				skill.baseDir,
				skill.ownership,
			]),
		).toEqual([
			[
				join(root, 'dedicated', 'SKILL.md'),
				join(root, 'dedicated'),
				'directory',
			],
			[join(root, 'SKILL.md'), root, 'file'],
			[join(root, 'standalone.md'), root, 'file'],
		]);
	});

	it('sorts recursive and root Markdown skills while applying exclusions', () => {
		const root = make_temp_dir();
		write_skill(join(root, 'zeta', 'SKILL.md'));
		write_skill(join(root, 'alpha', 'SKILL.md'));
		write_skill(join(root, 'standalone.md'));

		const skills = scan_skill_directory(root, {
			include_direct_root_skill: false,
			include_root_markdown_skills: true,
			exclude_matches: (match) => match.startsWith('zeta/'),
		});

		expect(skills.map((skill) => skill.name)).toEqual([
			'alpha',
			'standalone',
		]);
	});

	it('finds skills in symlinked directories without looping', () => {
		const root = make_temp_dir();
		const source = join(make_temp_dir(), 'linked');
		write_skill(join(source, 'SKILL.md'));
		symlinkSync(source, join(root, 'linked'), 'dir');
		symlinkSync(root, join(source, 'back'), 'dir');

		expect(
			scan_skill_directory(root, {
				include_direct_root_skill: false,
			}),
		).toEqual([
			{
				name: 'linked',
				description: 'Scanner fixture',
				skillPath: join(root, 'linked', 'SKILL.md'),
				baseDir: join(root, 'linked'),
				ownership: 'directory',
			},
		]);
	});

	it('keeps the earlier search scope for nested and hidden directories', () => {
		const root = make_temp_dir();
		write_skill(join(root, 'a', 'SKILL.md'));
		write_skill(join(root, 'a', 'b', 'SKILL.md'));
		write_skill(join(root, 'node_modules', 'x', 'SKILL.md'));
		write_skill(join(root, '.hidden', 'SKILL.md'));
		write_skill(join(root, 'a', 'skill.md'));

		expect(
			scan_skill_directory(root, {
				include_direct_root_skill: false,
			}).map((skill) => skill.skillPath),
		).toEqual([
			join(root, 'a', 'b', 'SKILL.md'),
			join(root, 'a', 'SKILL.md'),
			join(root, 'node_modules', 'x', 'SKILL.md'),
		]);
	});

	it('deduplicates by skill path while retaining the first match', () => {
		const first = { skillPath: '/skills/example', source: 'first' };
		const duplicate = {
			skillPath: '/skills/example',
			source: 'second',
		};

		expect(dedupe_skills_by_path([first, duplicate])).toEqual([
			first,
		]);
	});

	it('walks upward only through the nearest Git project root', () => {
		const root = make_temp_dir();
		const nested = join(root, 'one', 'two');
		mkdirSync(join(root, '.git'));
		mkdirSync(nested, { recursive: true });

		expect(find_project_roots(nested)).toEqual([
			nested,
			join(root, 'one'),
			root,
		]);
	});
});
