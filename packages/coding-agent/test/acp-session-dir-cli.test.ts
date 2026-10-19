import { expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ClientSideConnection, ndJsonStream, type SessionNotification } from "@oh-my-pi/pi-utils/acp";

interface RunningCli {
	connection: ClientSideConnection;
	stop(): Promise<void>;
}

async function startCli(
	root: string,
	cwd: string,
	sessionDir: string,
	updates: SessionNotification[] = [],
): Promise<RunningCli> {
	const extension = path.join(root, "local-provider.ts");
	await Bun.write(
		extension,
		`export default function(pi) {
		pi.registerProvider("session-dir-test", {
			baseUrl: "http://127.0.0.1:1/v1", apiKey: "local-only", api: "openai-completions",
			models: [{ id: "local", name: "Local session fixture", reasoning: false, input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 64 }],
		});
	}`,
	);
	const proc = Bun.spawn(
		[
			process.execPath,
			path.join(import.meta.dir, "../src/cli.ts"),
			"--mode=acp",
			"--session-dir",
			sessionDir,
			"--model=session-dir-test/local",
			"--extension",
			extension,
			"--no-lsp",
			"--no-pty",
			"--no-skills",
			"--no-rules",
		],
		{
			cwd,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				HOME: path.join(root, "home"),
				PI_CODING_AGENT_DIR: path.join(root, "agent"),
				XDG_CONFIG_HOME: path.join(root, "config"),
				XDG_DATA_HOME: path.join(root, "data"),
				XDG_STATE_HOME: path.join(root, "state"),
				XDG_CACHE_HOME: path.join(root, "cache"),
				PI_NO_TITLE: "1",
				NO_COLOR: "1",
			},
		},
	);
	const stderr = new Response(proc.stderr).text();
	const output = new WritableStream<Uint8Array>({
		write(chunk) {
			proc.stdin.write(chunk);
			proc.stdin.flush();
		},
	});
	const connection = new ClientSideConnection(
		() => ({
			requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
			sessionUpdate: async notification => {
				updates.push(notification);
			},
		}),
		ndJsonStream(output, proc.stdout),
	);
	let stopped = false;
	const stop = async () => {
		if (stopped) return;
		stopped = true;
		proc.stdin.end();
		const timer = setTimeout(() => proc.kill(), 5_000);
		try {
			const code = await proc.exited;
			expect(code, await stderr).toBe(0);
		} finally {
			clearTimeout(timer);
		}
	};
	try {
		const initialized = await connection.initialize({ protocolVersion: 1, clientCapabilities: {} });
		expect(initialized.protocolVersion).toBe(1);
	} catch (error) {
		await stop();
		throw error;
	}
	return { connection, stop };
}

it("CLI ACP cold restart lists and resumes the configured store without moving it when the saved cwd is pruned", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-acp-cli-store-"));
	const oldCwd = path.join(root, "old-managed");
	const durableCwd = path.join(root, "durable-chat");
	const sessionDir = path.join(root, "external-store", "preserved-sessions");
	await fs.mkdir(oldCwd, { recursive: true });
	await fs.mkdir(durableCwd, { recursive: true });
	await fs.mkdir(path.join(root, "home"), { recursive: true });
	let running: RunningCli | undefined;
	try {
		running = await startCli(root, oldCwd, sessionDir);
		const created = await running.connection.newSession({ cwd: oldCwd, mcpServers: [] });
		await running.connection.closeSession({ sessionId: created.sessionId });
		await running.stop();
		const names = (await fs.readdir(sessionDir)).filter(name => name.endsWith(".jsonl"));
		expect(names).toHaveLength(1);
		const sessionFile = path.join(sessionDir, names[0]!);
		const bytes = await Bun.file(sessionFile).text();
		const before = await fs.stat(sessionFile);
		running = await startCli(root, durableCwd, sessionDir);
		const listed = await running.connection.listSessions({ cwd: durableCwd });
		expect(listed.sessions?.map(session => session.sessionId)).toEqual([created.sessionId]);
		await running.connection.resumeSession({ sessionId: created.sessionId, cwd: durableCwd, mcpServers: [] });
		await running.connection.closeSession({ sessionId: created.sessionId });
		await fs.rm(oldCwd, { recursive: true });
		await running.connection.loadSession({ sessionId: created.sessionId, cwd: durableCwd, mcpServers: [] });
		await running.connection.closeSession({ sessionId: created.sessionId });
		await running.stop();
		expect(await Bun.file(sessionFile).text()).toBe(bytes);
		const after = await fs.stat(sessionFile);
		expect({ ino: after.ino, mtimeMs: after.mtimeMs }).toEqual({ ino: before.ino, mtimeMs: before.mtimeMs });
		expect((await fs.readdir(sessionDir)).filter(name => name.endsWith(".jsonl"))).toEqual(names);
	} finally {
		await running?.stop();
		await fs.rm(root, { recursive: true, force: true });
	}
}, 30_000);

it("CLI ACP recovers a real OMP 12 transcript in its existing store with the same identity and history", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-acp-v12-store-"));
	const cwd = path.join(root, "durable-chat");
	const sessionDir = path.join(root, "agent", "sessions", "--removed-managed-astrid-version-a--");
	const sessionFile = path.join(sessionDir, "2026-10-19T20-59-35-519Z_15accaef37cd9c20.jsonl");
	const sessionId = "15accaef37cd9c20";
	await fs.mkdir(cwd, { recursive: true });
	await fs.mkdir(path.join(root, "home"), { recursive: true });
	// Generated with the unmodified published OMP 12.0.0 SessionManager and
	// pi-utils 12.0.0 on Bun 1.3.14, without inference; see fixtures/omp12-session.md.
	await Bun.write(sessionFile, Bun.file(path.join(import.meta.dir, "fixtures/omp12-session.jsonl")));
	const updates: SessionNotification[] = [];
	let running: RunningCli | undefined;
	try {
		running = await startCli(root, cwd, sessionDir, updates);
		expect((await running.connection.listSessions({ cwd })).sessions?.map(session => session.sessionId)).toEqual([
			sessionId,
		]);
		await running.connection.loadSession({ sessionId, cwd, mcpServers: [] });
		const replayed = updates
			.flatMap(notification => {
				const update = notification.update;
				return (update.sessionUpdate === "user_message_chunk" || update.sessionUpdate === "agent_message_chunk") &&
					update.content.type === "text"
					? [update.content.text]
					: [];
			})
			.join("\n");
		expect(replayed).toContain("Preserve this OMP 12 conversation when the installation updates.");
		expect(replayed).toContain("The saved conversation retains its identity and history.");
		await running.connection.closeSession({ sessionId });
		await running.stop();
		running = await startCli(root, cwd, sessionDir);
		await running.connection.resumeSession({ sessionId, cwd, mcpServers: [] });
		await running.connection.closeSession({ sessionId });
		await running.stop();
		expect((await fs.readdir(sessionDir)).filter(name => name.endsWith(".jsonl"))).toEqual([
			path.basename(sessionFile),
		]);
		// A normal producer format upgrade may rewrite bytes; it must retain the
		// existing path and session ID rather than moving or resetting the store.
		const entries = (await Bun.file(sessionFile).text())
			.trim()
			.split("\n")
			.map(line => JSON.parse(line));
		expect(entries.find(entry => entry.type === "session")?.id).toBe(sessionId);
		expect(entries.filter(entry => entry.type === "message").map(entry => entry.message.role)).toEqual([
			"user",
			"assistant",
		]);
	} finally {
		await running?.stop();
		await fs.rm(root, { recursive: true, force: true });
	}
}, 30_000);
