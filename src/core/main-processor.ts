import { ContextBuilder } from './context-builder';
import { ResponseHandler } from './response-handler';
import { RequestOrchestrator } from './orchestrator';

export async function processRequest(
  userPrompt: string,
  files: string[],
  historyIds?: string[],
  historyDepth?: number,
  systemPrompt?: string,
  autoContext?: boolean,
  autoApply?: boolean,
  model?: string,
  temperature?: number
): Promise<void> {
  const orchestrator = new RequestOrchestrator(
    new ContextBuilder(),
    new ResponseHandler()
  );

  await orchestrator.process(
    userPrompt,
    files,
    historyIds,
    historyDepth,
    systemPrompt,
    autoContext,
    autoApply,
    model,
    temperature
  );
}
