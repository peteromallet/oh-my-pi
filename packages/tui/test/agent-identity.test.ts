import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

interface FaceProbe {
	id: string;
	logo: string[];
	rendered: string[];
	colored: string[];
	defaultColored: string[];
	accent: string;
	welcome: string;
}

describe("packaged agent identity", () => {
	let root: string;
	let agentDir: string;
	let packagedFile: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-packaged-identity-"));
		agentDir = path.join(root, "agent");
		packagedFile = path.join(root, "astrid.identity.json");
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	const writeHomeFace = async (name = "astrid", extra: Record<string, unknown> = {}) => {
		await Bun.write(path.join(agentDir, "identities", `${name}.json`), JSON.stringify({ logo: ["HOME"], ...extra }));
	};
	const writePackagedFace = async (extra: Record<string, unknown> = {}) => {
		await Bun.write(packagedFile, JSON.stringify({ id: "astrid", logo: ["XY", "Z"], ...extra }));
	};
	const probe = async (file = packagedFile, name = "astrid", trueColor = true): Promise<FaceProbe> => {
		// A subprocess exercises ACTIVE_IDENTITY's module-load environment without
		// mutating the parent test process's cached identity or directory settings.
		const source = `
import { ACTIVE_IDENTITY, PI_IDENTITY } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/prompt/agent-identity.ts"))};
import { gradientLogo, WelcomeComponent } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/prompt/welcome.ts"))};
import { createTheme } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/theme/loader.ts"))};
import { initTheme } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/theme/index.ts"))};
import dark from ${JSON.stringify(path.resolve(import.meta.dir, "../src/theme/dark.json"))} with { type: "json" };
await initTheme(false);
const face = ACTIVE_IDENTITY;
console.log(JSON.stringify({
 id: face.id,
 logo: face.logo,
 rendered: gradientLogo(face.logo, 0, undefined, face.gradient, face.cellOverrides).map(Bun.stripANSI),
 colored: gradientLogo(face.logo, 0, undefined, face.gradient, face.cellOverrides),
 defaultColored: gradientLogo(face.logo, 0, undefined, PI_IDENTITY.gradient, face.cellOverrides),
 accent: createTheme(dark, { mode: "truecolor" }).fg("accent", "t"),
 welcome: new WelcomeComponent("1.0.0").render(80).map(Bun.stripANSI).join("\\n")
}));`;
		const child = Bun.spawn([process.execPath, "-e", source], {
			env: {
				...process.env,
				HOME: root,
				PI_CODING_AGENT_DIR: agentDir,
				OMP_AGENT_IDENTITY: name,
				OMP_AGENT_IDENTITY_FILE: file,
				TERM: trueColor ? "xterm-truecolor" : "xterm-256color",
				COLORTERM: trueColor ? "truecolor" : "",
				FORCE_COLOR: trueColor ? "3" : "1",
				NO_COLOR: undefined,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [out, err, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(code, err).toBe(0);
		return JSON.parse(out) as FaceProbe;
	};

	it("renders a packaged face, tint, and cell accents ahead of the legacy home face", async () => {
		await writeHomeFace();
		await writePackagedFace({
			displayName: "Astrid",
			gradient: {
				stops: [
					[0, 0, 0],
					[255, 255, 255],
				],
				ramp256: [16, 231],
			},
			cellOverrides: [{ row: 0, col: 0, char: "!", color: "#ffffff" }],
			themeColors: { accent: "#123456" },
		});
		const result = await probe(packagedFile, "AsTrId");
		expect(result).toMatchObject({
			id: "astrid",
			logo: ["XY", "Z "],
			rendered: ["!Y", "Z "],
			accent: "\x1b[38;2;18;52;86mt\x1b[39m",
		});
		expect(result.colored).not.toEqual(result.defaultColored);
		expect(result.welcome).toContain("Astrid");
	});

	it.each([
		{ reason: "relative path", kind: "relative" },
		{ reason: "missing file", kind: "missing" },
		{ reason: "directory", kind: "directory" },
		{ reason: "invalid JSON", text: "{" },
		{ reason: "non-object JSON", text: "null" },
		{ reason: "invalid logo", text: JSON.stringify({ id: "astrid", logo: [null] }) },
		{ reason: "terminal controls in the logo", text: JSON.stringify({ id: "astrid", logo: ["\x1b[31m"] }) },
		{ reason: "empty logo", text: JSON.stringify({ id: "astrid", logo: [] }) },
		{ reason: "zero-width logo", text: JSON.stringify({ id: "astrid", logo: [""] }) },
		{ reason: "missing id", text: JSON.stringify({ logo: ["PACKAGED"] }) },
		{ reason: "wrong id", text: JSON.stringify({ id: "scout", logo: ["PACKAGED"] }) },
		{ reason: "non-lowercase id", text: JSON.stringify({ id: "Astrid", logo: ["PACKAGED"] }) },
	])("uses the home face when the packaged file has $reason", async ({ kind, text }) => {
		await writeHomeFace();
		let file = packagedFile;
		if (kind === "relative") {
			await writePackagedFace();
			file = path.relative(process.cwd(), packagedFile);
		} else if (kind === "directory") {
			await fs.mkdir(packagedFile);
		} else if (text !== undefined) {
			await Bun.write(packagedFile, text);
		}
		const result = await probe(file);
		expect(result.id).toBe("astrid");
		expect(result.rendered).toEqual(["HOME"]);
	});

	it.each(["oh-my-pi", "PI", "arnold"])("keeps built-in %s ahead of both file sources", async name => {
		const key = name.toLowerCase();
		await writeHomeFace(key);
		await writePackagedFace({ id: key });
		const result = await probe(packagedFile, name);
		expect(result.id).toBe(key === "pi" ? "oh-my-pi" : key);
		expect(result.logo).not.toEqual(["HOME"]);
		expect(result.logo).not.toEqual(["XY", "Z "]);
	});

	it("does not leak the packaged Astrid face into an alternate requested identity", async () => {
		await writePackagedFace();
		await writeHomeFace("scout");
		const result = await probe(packagedFile, "scout");
		expect(result.id).toBe("scout");
		expect(result.rendered).toEqual(["HOME"]);
	});

	it("accepts a packaged face for another requested custom identity when its id matches", async () => {
		await writePackagedFace({ id: "scout" });
		const result = await probe(packagedFile, "SCOUT");
		expect(result.id).toBe("scout");
		expect(result.rendered).toEqual(["XY", "Z "]);
	});

	it.each(["astrid", "constructor"])("uses Oh My Pi when neither source defines %s", async name => {
		const result = await probe(packagedFile, name);
		expect(result.id).toBe("oh-my-pi");
		expect(result.rendered).toEqual(result.logo);
	});

	it("uses Oh My Pi when both the packaged and home files are malformed", async () => {
		await Bun.write(packagedFile, "{");
		await writeHomeFace("astrid", { logo: null });
		expect((await probe()).id).toBe("oh-my-pi");
	});

	it.each([
		{ stops: [], ramp256: [16] },
		{ stops: [[0, 0, 0]], ramp256: [16] },
		{
			stops: [
				[0, 0],
				[255, 255, 255],
			],
			ramp256: [16],
		},
		{
			stops: [
				[0, 0, 0],
				[256, 255, 255],
			],
			ramp256: [16],
		},
		{
			stops: [
				[0, 0, 0],
				[255, 255, 255],
			],
			ramp256: [],
		},
		{
			stops: [
				[0, 0, 0],
				[255, 255, 255],
			],
			ramp256: [256],
		},
	])("renders with the default palette when a packaged gradient is malformed: %j", async gradient => {
		await writePackagedFace({ gradient });
		for (const trueColor of [true, false]) {
			const result = await probe(packagedFile, "astrid", trueColor);
			expect(result.rendered).toEqual(["XY", "Z "]);
			expect(result.colored).toEqual(result.defaultColored);
		}
	});

	it.each(["packaged", "home"])(
		"drops unsafe optional visual fields from the %s file before rendering",
		async source => {
			const extra = {
				displayName: {},
				tagline: 123,
				gradient: "bad",
				cellOverrides: [
					null,
					{ row: 0, col: 0, color: {} },
					{ row: -1, col: 0, color: "#ffffff" },
					{ row: 0.5, col: 0, color: "#ffffff" },
					{ row: 0, col: 0, color: "#ffffff", char: {} },
					{ row: 0, col: 0, color: "#ffffff", char: "\x1b[31m" },
					{ row: 0, col: 1, color: "#ffffff", char: "!" },
				],
				themeColors: { accent: "#123456", border: null, text: "missingVar", error: "#garbage", muted: [] },
			};
			if (source === "packaged") await writePackagedFace(extra);
			else await writeHomeFace("astrid", { logo: ["XY", "Z"], ...extra });
			const result = await probe();
			expect(result.rendered).toEqual(["X!", "Z "]);
			expect(result.accent).toBe("\x1b[38;2;18;52;86mt\x1b[39m");
			expect(result.welcome).toContain("astrid");
		},
	);
});
