export default function StepIndicator({
  currentStep,
  totalSteps = 3,
}: {
  currentStep: number
  totalSteps?: number
}) {
  return (
    <div className="flex items-center justify-between">
      {Array.from({ length: totalSteps }).map((_, index) => {
        const stepNum = index + 1
        const isActive = stepNum === currentStep
        const isComplete = stepNum < currentStep

        return (
          <div key={stepNum} className="flex items-center flex-1">
            {/* Step Circle */}
            <div
              className={`flex items-center justify-center w-12 h-12 rounded-full font-semibold text-sm transition-all ${
                isComplete
                  ? 'bg-emerald-500 text-white'
                  : isActive
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-200 text-slate-600'
              }`}
            >
              {isComplete ? '✓' : stepNum}
            </div>

            {/* Connector Line */}
            {stepNum < totalSteps && (
              <div
                className={`flex-1 h-1 mx-2 transition-all ${
                  isComplete ? 'bg-emerald-500' : 'bg-slate-200'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
