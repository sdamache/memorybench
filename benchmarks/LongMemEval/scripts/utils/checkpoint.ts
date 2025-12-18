import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export interface CheckpointData {
	questionId: string;
	runId: string; // Renamed from randomString
	containerTag: string;
	sessions: {
		index: number;
		date: string;
		ingested: boolean;
		timestamp?: string;
		error?: string;
	}[];
}

export interface BatchCheckpointData {
	runId: string; // Renamed from randomString
	questionType: string;
	startPosition: number;
	endPosition: number;
	searchParams?: any;
	questions: {
		questionId: string;
		status: "pending" | "in_progress" | "completed" | "failed";
		timestamp: string;
	}[];
}

export class CheckpointManager {
	private checkpointDir: string;

	constructor(baseDir: string) {
		this.checkpointDir = join(baseDir, "checkpoints");
		if (!existsSync(this.checkpointDir)) {
			mkdirSync(this.checkpointDir, { recursive: true });
		}
	}

	getCheckpointPath(questionId: string, runId: string): string {
		return join(this.checkpointDir, `checkpoint-${questionId}-${runId}.json`);
	}

	loadCheckpoint(questionId: string, runId: string): CheckpointData | null {
		const path = this.getCheckpointPath(questionId, runId);
		if (existsSync(path)) {
			return JSON.parse(readFileSync(path, "utf8"));
		}
		return null;
	}

	saveCheckpoint(checkpoint: CheckpointData) {
		const path = this.getCheckpointPath(
			checkpoint.questionId,
			checkpoint.runId,
		);
		writeFileSync(path, JSON.stringify(checkpoint, null, 2));
	}
}
