import type { AgentCard } from "../types.ts";

export interface ConsensusInput {
  agentName: string;
  card: AgentCard;
  response: string;
}

export interface ConsensusResult {
  winner: ConsensusInput;
  scores: Array<{ agentName: string; score: number; reason: string }>;
  synthesized: string;
}

export interface CognitiveLoopConfig {
  judgeAgentName?: string;
  minAgents?: number;
  confidenceThreshold?: number;
}

const DEFAULTS: Required<CognitiveLoopConfig> = {
  judgeAgentName: "oracle",
  minAgents: 2,
  confidenceThreshold: 0.7,
};

export class CognitiveLoop {
  private config: Required<CognitiveLoopConfig>;

  constructor(config?: CognitiveLoopConfig) {
    this.config = { ...DEFAULTS, ...config };
  }

  scoreResponse(
    agent: ConsensusInput,
    taskText: string,
  ): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;

    const card = agent.card;
    if (card.successRate != null) {
      score += card.successRate * 0.4;
      reasons.push(`successRate=${card.successRate.toFixed(2)}`);
    }

    const responseLength = agent.response.length;
    if (responseLength > 100) {
      score += 0.2;
      reasons.push("substantive response");
    }

    const taskLower = taskText.toLowerCase();
    const responseLower = agent.response.toLowerCase();
    const taskWords = taskLower.split(/\s+/);
    const overlap = taskWords.filter((w) => responseLower.includes(w)).length;
    const relevance = taskWords.length > 0 ? overlap / taskWords.length : 0;
    score += Math.min(relevance, 1) * 0.3;
    reasons.push(`relevance=${relevance.toFixed(2)}`);

    const tags = card.skills.flatMap((s) => s.tags);
    const tagHits = tags.filter((t) => responseLower.includes(t)).length;
    if (tags.length > 0) {
      const tagScore = Math.min(tagHits / tags.length, 1) * 0.1;
      score += tagScore;
      reasons.push(`tagHits=${tagHits}/${tags.length}`);
    }

    return { score: Math.min(score, 1), reasons };
  }

  evaluate(
    inputs: ConsensusInput[],
    taskText: string,
  ): ConsensusResult {
    const scored = inputs.map((input) => {
      const { score, reasons } = this.scoreResponse(input, taskText);
      return {
        agentName: input.agentName,
        score,
        reason: reasons.join(", "),
        input,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    const scores = scored.map((s) => ({
      agentName: s.agentName,
      score: s.score,
      reason: s.reason,
    }));

    const winner = scored[0]!;

    return {
      winner: winner.input,
      scores,
      synthesized: this.buildSynthesis(winner, scored),
    };
  }

  shouldUseConsensus(agentCards: Map<string, AgentCard>): boolean {
    const available = Array.from(agentCards.values()).filter(
      (c) => c.skills.length > 0,
    );
    return available.length >= this.config.minAgents;
  }

  getJudgeAgentName(): string {
    return this.config.judgeAgentName;
  }

  private buildSynthesis(
    winner: { agentName: string; score: number; reason: string; input: ConsensusInput },
    all: Array<{ agentName: string; score: number; reason: string; input: ConsensusInput }>,
  ): string {
    const lines: string[] = [];

    lines.push(`## Consensus Result`);
    lines.push(`**Winner**: ${winner.agentName} (score: ${winner.score.toFixed(3)})`);
    lines.push(`**Reasoning**: ${winner.reason}`);
    lines.push("");

    if (all.length > 1) {
      lines.push(`### Score Ranking`);
      for (const s of all) {
        const marker = s.agentName === winner.agentName ? " →" : "  ";
        lines.push(`${marker} ${s.agentName}: ${s.score.toFixed(3)} — ${s.reason}`);
      }
      lines.push("");
    }

    lines.push(`### Selected Response`);
    lines.push(winner.input.response);

    return lines.join("\n");
  }
}
