import {
	parseFrontmatter,
	type SkillFrontmatter,
} from '@earendil-works/pi-coding-agent';
import {
	existsSync,
	globSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from 'node:fs';
import { basename, dirname, join, parse, resolve } from 'node:path';

/**
 * What a skill owns on disk. A `directory` skill owns its dedicated
 * `baseDir`; a `file` skill owns only `skillPath` and shares `baseDir`
 * with other skills.
 */
export type SkillOwnership = 'file' | 'directory';

export interface ScannedSkill {
	name: string;
	description: string;
	skillPath: string;
	baseDir: string;
	ownership?: SkillOwnership;
}

export interface ScanSkillDirectoryOptions {
	include_direct_root_skill?: boolean;
	include_root_markdown_skills?: boolean;
	exclude_matches?: (match: string) => boolean;
}

function parse_skill_markdown(
	skill_path: string,
): { name: string; description: string } | null {
	try {
		const content = readFileSync(skill_path, 'utf-8');
		const { frontmatter } =
			parseFrontmatter<SkillFrontmatter>(content);
		const description = frontmatter?.description;
		if (!description) return null;

		const name =
			frontmatter?.name ||
			(basename(skill_path) === 'SKILL.md'
				? basename(dirname(skill_path))
				: parse(skill_path).name);
		return { name, description: description.trim() };
	} catch {
		return null;
	}
}

/**
 * Relative paths of every SKILL.md below `dir`. Follows symlinked
 * directories, as Pi does when it loads skills, and skips hidden
 * directories. Each real directory is visited once, so a link cycle ends.
 */
function find_skill_files(dir: string): string[] {
	const matches: string[] = [];
	const visited = new Set<string>();

	const walk = (current: string, relative_dir: string): void => {
		let real_path: string;
		try {
			real_path = realpathSync(current);
		} catch {
			return;
		}
		if (visited.has(real_path)) return;
		visited.add(real_path);

		for (const entry of readdirSync(current, {
			withFileTypes: true,
		})) {
			const relative_path = join(relative_dir, entry.name);
			const full_path = join(current, entry.name);
			if (entry.name === 'SKILL.md') {
				if (is_file(full_path)) matches.push(relative_path);
			} else if (
				!entry.name.startsWith('.') &&
				(entry.isDirectory() || entry.isSymbolicLink()) &&
				is_directory(full_path)
			) {
				walk(full_path, relative_path);
			}
		}
	};

	walk(dir, '');
	return matches;
}

export function scan_skill_directory(
	dir: string,
	options: ScanSkillDirectoryOptions = {},
): ScannedSkill[] {
	if (!existsSync(dir)) return [];

	const results: ScannedSkill[] = [];
	const direct = join(dir, 'SKILL.md');
	const include_direct_root_skill =
		options.include_direct_root_skill ?? true;

	if (include_direct_root_skill && existsSync(direct)) {
		const parsed = parse_skill_markdown(direct);
		if (parsed) {
			results.push({
				...parsed,
				skillPath: direct,
				baseDir: dir,
				ownership: 'file',
			});
		}
		return results;
	}

	const scan_root = resolve(dir);
	try {
		const matches = find_skill_files(dir);
		if (options.include_root_markdown_skills) {
			matches.push(
				...globSync('*.md', { cwd: dir }).filter(
					(match) => match !== 'SKILL.md',
				),
			);
		}
		for (const match of matches
			.filter((candidate) => !options.exclude_matches?.(candidate))
			.sort((a, b) => a.localeCompare(b))) {
			const full_path = resolve(dir, match);
			const parsed = parse_skill_markdown(full_path);
			if (parsed) {
				const base_dir = dirname(full_path);
				results.push({
					...parsed,
					skillPath: full_path,
					baseDir: base_dir,
					// The scan root is shared, so a skill file placed directly
					// in it never owns the directory.
					ownership:
						basename(full_path) === 'SKILL.md' &&
						base_dir !== scan_root
							? 'directory'
							: 'file',
				});
			}
		}
	} catch {
		// Skip inaccessible directories.
	}

	return results;
}

export function dedupe_skills_by_path<
	Skill extends { skillPath: string },
>(skills: readonly Skill[]): Skill[] {
	const seen = new Set<string>();
	const deduped: Skill[] = [];

	for (const skill of skills) {
		if (seen.has(skill.skillPath)) continue;
		seen.add(skill.skillPath);
		deduped.push(skill);
	}

	return deduped;
}

function parent_dir(path: string): string | null {
	const parsed = parse(path);
	const parent = dirname(path);
	return parent === path || parent === parsed.root ? null : parent;
}

function is_directory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function is_file(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

export function find_project_roots(cwd: string): string[] {
	const roots: string[] = [];
	let current = resolve(cwd);
	while (true) {
		roots.push(current);
		if (is_directory(join(current, '.git'))) break;
		const parent = parent_dir(current);
		if (!parent) break;
		current = parent;
	}
	return roots;
}
