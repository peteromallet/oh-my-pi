import { expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

it("scaffolds both identity files in a fresh home and renders the selected JSON face without overwriting edits", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-identity-"));
	const agentDir = path.join(root, "agent");
	const env = { ...process.env, HOME: root, PI_CODING_AGENT_DIR: agentDir, OMP_AGENT_IDENTITY: "scout" };
	const cli = path.resolve(import.meta.dir, "../src/cli.ts");
	const run = async (args: string[]) => {
		const proc = Bun.spawn([process.execPath, ...args], { env, stdout: "pipe", stderr: "pipe" });
		const [out, err, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect(code, err).toBe(0);
		return out;
	};
	try {
		const preview = await run([cli, "identity", "scout"]);
		expect(preview).not.toContain("NaN");
		const file = path.join(agentDir, "identities/scout.json");
		const original = await Bun.file(file).json();
		expect(original.gradient.stops.every((stop: number[]) => stop.length === 3 && stop.every(Number.isFinite))).toBe(
			true,
		);
		expect(await Bun.file(path.join(agentDir, "agents/scout.md")).text()).toContain("name: scout");
		const edited = {
			...original,
			displayName: "Scout Face",
			logo: ["XY", "Z"],
			themeColors: { accent: "#123456" },
			cellOverrides: [{ row: 0, col: 0, char: "!", color: "#ffffff" }],
		};
		await Bun.write(file, JSON.stringify(edited));
		await run([cli, "identity", "scout"]);
		expect(await Bun.file(file).json()).toEqual(edited);
		const probe = path.join(root, "probe.ts");
		await Bun.write(
			probe,
			`import { ACTIVE_IDENTITY } from ${JSON.stringify(path.resolve(import.meta.dir, "../../tui/src/prompt/agent-identity.ts"))};
import { gradientLogo, WelcomeComponent } from ${JSON.stringify(path.resolve(import.meta.dir, "../../tui/src/prompt/welcome.ts"))};
import { createTheme } from ${JSON.stringify(path.resolve(import.meta.dir, "../../tui/src/theme/loader.ts"))};
import dark from ${JSON.stringify(path.resolve(import.meta.dir, "../../tui/src/theme/dark.json"))} with { type: "json" };
const face = ACTIVE_IDENTITY;
console.log(JSON.stringify({ id: face.id, logo: face.logo, rendered: gradientLogo(face.logo, 0, undefined, face.gradient, face.cellOverrides).map(Bun.stripANSI), accent: createTheme(dark, {mode:"truecolor"}).fg("accent", "t") }));`,
		);
		const result = JSON.parse(await run([probe]));
		expect(result).toEqual({
			id: "scout",
			logo: ["XY", "Z "],
			rendered: ["!Y", "Z "],
			accent: "\x1b[38;2;18;52;86mt\x1b[39m",
		});
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
}, 30_000);

it("refuses fork self-update before invoking any upstream installer", async () => {
	const proc = Bun.spawn([process.execPath, path.resolve(import.meta.dir, "../src/cli.ts"), "update", "--force"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
	expect(code).toBe(1);
	expect(err).toContain("scripts/sync-upstream.sh");
});

it("keeps flag values interactive and prints only when a trailing message is supplied", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-agent-flags-"));
	try {
		await Bun.write(path.join(root, ".omp/agents/scout.md"), "---\nname: scout\n---\nFixture agent prompt\n");
		const capture = path.join(root, "args.json");
		const fake = path.join(root, "omp-fixture");
		await Bun.write(
			fake,
			"#!/usr/bin/env bun\nawait Bun.write(process.env.CAPTURE, JSON.stringify(process.argv.slice(2)));\n",
		);
		await fs.chmod(fake, 0o755);
		const run = async (args: string[]) => {
			const proc = Bun.spawn(["bash", path.resolve(import.meta.dir, "../scripts/agent"), "run", "scout", ...args], {
				cwd: root,
				env: {
					...process.env,
					HOME: root,
					OMP_BIN: fake,
					CAPTURE: capture,
					PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
			expect(code, err).toBe(0);
			return ((await Bun.file(capture).json()) as string[]).slice(2);
		};
		expect(await run(["--profile", "work", "--session-dir", root, "--resume", "saved"])).toEqual([
			"--profile",
			"work",
			"--session-dir",
			root,
			"--resume",
			"saved",
		]);
		expect(await run(["--profile", "work", "-r", "saved", "hello", "there"])).toEqual([
			"--profile",
			"work",
			"-r",
			"saved",
			"--print",
			"hello",
			"there",
		]);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
