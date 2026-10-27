import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

describe("packaged agent identity", () => {
	let root: string;
	let packagedFile: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-packaged-identity-"));
		packagedFile = path.join(root, "astrid.identity.json");
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("loads the matching packaged face and compact mark", async () => {
		await Bun.write(
			packagedFile,
			JSON.stringify({
				id: "astrid",
				displayName: "Astrid",
				statusIcon: "A",
				logo: ["XY", "Z"],
				tagline: "A s t r i d",
				gradient: { stops: [[0, 0, 0], [255, 255, 255]], ramp256: [16, 231] },
				themeColors: { accent: "#123456" },
			}),
		);
		const source = `
import { ACTIVE_IDENTITY } from ${JSON.stringify(path.resolve(import.meta.dir, "../../../src/modes/components/agent-identity.ts"))};
console.log(JSON.stringify({ id: ACTIVE_IDENTITY.id, name: ACTIVE_IDENTITY.displayName, statusIcon: ACTIVE_IDENTITY.statusIcon, logo: ACTIVE_IDENTITY.logo }));`;
		const child = Bun.spawn([process.execPath, "-e", source], {
			env: {
				...process.env,
				OMP_AGENT_IDENTITY: "astrid",
				OMP_AGENT_IDENTITY_FILE: packagedFile,
				TERM: "xterm-truecolor",
				COLORTERM: "truecolor",
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
		expect(JSON.parse(out)).toEqual({ id: "astrid", name: "Astrid", statusIcon: "A", logo: ["XY", "Z "] });
	});

	it("rejects a packaged file whose id does not match the requested identity", async () => {
		await Bun.write(packagedFile, JSON.stringify({ id: "scout", logo: ["SCOUT"] }));
		const source = `
import { ACTIVE_IDENTITY } from ${JSON.stringify(path.resolve(import.meta.dir, "../../../src/modes/components/agent-identity.ts"))};
console.log(ACTIVE_IDENTITY.id);`;
		const child = Bun.spawn([process.execPath, "-e", source], {
			env: { ...process.env, OMP_AGENT_IDENTITY: "astrid", OMP_AGENT_IDENTITY_FILE: packagedFile },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [out, err, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(code, err).toBe(0);
		expect(out.trim()).toBe("oh-my-pi");
	});
});
