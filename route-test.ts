import { DynamicRegistry } from "@adapters/dynamic-registry";
import type { AgentCard } from "@agents/types";
import type { AgentRegistryPort } from "@ports/agent-registry";

class MockRegistry implements AgentRegistryPort {
  constructor(private seed: Record<string,string>) {}
  async discoverAgents(urls: string[]): Promise<Record<string, AgentCard>> {
    const inv: Record<string,string> = {};
    for (const [k,v] of Object.entries(this.seed)) inv[v]=k;
    const out: Record<string, AgentCard> = {};
    for (const url of urls) {
      const name = inv[url]!;
      out[name] = { name: `${name} Agent`, description:"", url, version:"1.0.0", capabilities:{}, skills: MOCK_SKILLS[name] } as AgentCard;
    }
    return out;
  }
  async fetchCard(url: string): Promise<AgentCard|null> { return null; }
  async delegateTask(): Promise<string> { return ""; }
}

const MOCK_SKILLS: Record<string, AgentCard["skills"]> = {
  oracle: [{name:"",description:"",tags:["review","simplify","refactor","architecture","audit"]}],
  librarian: [{name:"",description:"",tags:["research","doc","api","library","how-to","summarize"]}],
  explorer: [{name:"",description:"",tags:["find","files","map","structure","grep","search"]}],
  designer: [{name:"",description:"",tags:["layout","responsive","ui","component","button","ux","color","palette"]}],
  fixer: [{name:"",description:"",tags:["fix","bug","error","patch","repair","debug","code","implement","function","algorithm","typescript","write","python","review"]}],
};

const seed = { oracle:"http://localhost:4001", librarian:"http://localhost:4002", explorer:"http://localhost:4003", designer:"http://localhost:4004", fixer:"http://localhost:4005" };
const dyn = new DynamicRegistry(new MockRegistry(seed), seed);
await dyn.initialize();
for (const t of ["find all TODO comments", "review this function for edge cases", "review this module for architecture concerns", "review the edge cases in this design"]) {
  const m = await dyn.matchAgent(t);
  console.log(JSON.stringify(t), "->", m?.name, m?.label);
}
