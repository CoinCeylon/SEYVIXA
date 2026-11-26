export type WorkflowStage =
  | 'Request'
  | 'Quotes'
  | 'Eligibility'
  | 'Approval'
  | 'Escrow'
  | 'Receipt';

export const WORKFLOW_STAGES: readonly WorkflowStage[] = [
  'Request',
  'Quotes',
  'Eligibility',
  'Approval',
  'Escrow',
  'Receipt',
] as const;

interface StageIndicatorProps {
  currentStage?: WorkflowStage;
}

export default function StageIndicator({
  currentStage = 'Request',
}: StageIndicatorProps) {
  const currentIndex = WORKFLOW_STAGES.indexOf(currentStage);

  return (
    <div className="border-b border-slate-200 bg-white px-6 py-3">
      <div className="mx-auto max-w-7xl">
        <nav aria-label="Workflow progress" className="flex items-center justify-between">
          <ol className="flex w-full items-center justify-between gap-2">
            {WORKFLOW_STAGES.map((stage, idx) => {
              const isCurrent = idx === currentIndex;
              const isCompleted = idx < currentIndex;

              return (
                <li key={stage} className="flex flex-1 items-center">
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                        isCurrent
                          ? 'bg-indigo-600 text-white ring-4 ring-indigo-100'
                          : isCompleted
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        isCurrent
                          ? 'text-indigo-900 font-bold'
                          : isCompleted
                          ? 'text-slate-800'
                          : 'text-slate-500'
                      }`}
                    >
                      {stage}
                    </span>
                  </div>
                  {idx < WORKFLOW_STAGES.length - 1 && (
                    <div
                      className={`mx-3 h-0.5 flex-1 ${
                        isCompleted ? 'bg-emerald-500' : 'bg-slate-200'
                      }`}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </div>
  );
}
