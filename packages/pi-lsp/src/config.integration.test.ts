import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vite-plus/test';
import { LspServerManager } from './server-manager.js';

// Opt in when the global JSON, YAML, and TypeScript servers are installed.
describe.skipIf(process.env.MY_PI_LSP_CONFIG_INTEGRATION !== '1')(
	'configuration and JavaScript language servers',
	() => {
		it.each(['json', 'jsonc', 'yaml', 'yml', 'js'])(
			'detects and clears a real %s type/schema error',
			async (extension) => {
				const root = mkdtempSync(join(tmpdir(), 'my-pi-config-lsp-'));
				const file = join(root, `check.${extension}`);
				const schema = pathToFileURL(join(root, 'schema.json')).href;
				writeFileSync(join(root, 'package.json'), '{"private":true}');
				writeFileSync(
					join(root, 'schema.json'),
					JSON.stringify({
						type: 'object',
						properties: { count: { type: 'integer' } },
						required: ['count'],
					}),
				);
				const text = (value: string) => {
					if (extension === 'js') {
						return `// @ts-check\n/** @type {number} */\nexport const count = ${value};\n`;
					}
					if (extension === 'yaml' || extension === 'yml') {
						return `# yaml-language-server: $schema=${schema}\ncount: ${value}\n`;
					}
					const comment = extension === 'jsonc' ? '// comment\n' : '';
					return `${comment}{"$schema":${JSON.stringify(schema)},"count":${value}}\n`;
				};
				const manager = new LspServerManager({ cwd: () => root });
				try {
					writeFileSync(file, text('"wrong"'));
					const resolved = await manager.resolve_file_state(file);
					expect(resolved.ok).toBe(true);
					if (!resolved.ok) throw new Error(resolved.error.message);
					const { state, uri } = resolved.result;
					const errors = await state.client.wait_for_diagnostics(
						uri,
						10_000,
					);
					expect(
						errors?.some(
							(item) =>
								(item.severity ?? 4) <= 2 &&
								/integer|number|int/.test(item.message),
						),
					).toBe(true);

					writeFileSync(file, text('1'));
					await state.client.ensure_document_open(uri, text('1'));
					expect(
						await state.client.wait_for_diagnostics(uri, 10_000),
					).toEqual([]);
					expect(
						await state.client.document_symbols(uri),
					).not.toHaveLength(0);
					await manager.release_file_state(resolved.result);
				} finally {
					await manager.clear_language_state();
					rmSync(root, { recursive: true, force: true });
				}
			},
			30_000,
		);
	},
);
